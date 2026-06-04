import { spawn } from "node:child_process";
import { cacheExpiresAtForMarket, marketFromTicker, secondsUntil, type MarketSession } from "@/lib/marketCalendar";
import { fetchWithTimeout, numericEnv, supabaseAdminConfig, supabaseReadConfig, supabaseHeaders } from "@/lib/supabaseRest";
import { normalizeTickerRef, statusFromPayload, type StockPayload } from "@/lib/stockSnapshotCache";

export type QuoteCacheState = "fresh" | "stale" | "miss";
export type QuoteCacheSource = "memory" | "supabase" | "collector";

export type StockQuoteResult = {
  payload: StockPayload;
  cache: {
    state: QuoteCacheState;
    source: QuoteCacheSource;
    ticker: string;
    fetchedAt?: string;
    expiresAt?: string;
    refreshError?: string;
  };
};

type StoredQuoteSnapshot = {
  ticker: string;
  payload: StockPayload;
  fetchedAt: string;
  expiresAt: string;
};

type SupabaseQuoteRow = {
  ticker: string;
  payload: StockPayload;
  fetched_at: string;
  expires_at: string;
};

declare global {
  var __stockQuoteMemoryCache: Map<string, StoredQuoteSnapshot> | undefined;
  var __stockQuoteInflight: Map<string, Promise<StoredQuoteSnapshot>> | undefined;
}

const SCRIPT_PATH = "scripts/fetch_yfinance_score.py";
const PYTHON_BIN = process.env.PYTHON_BIN || process.env.PYTHON || "python";
const TIMEOUT_MS = 18_000;
const SUPABASE_TABLE = "stock_quote_snapshots";

const memoryCache = (globalThis.__stockQuoteMemoryCache ??= new Map<string, StoredQuoteSnapshot>());
const inflightRefreshes = (globalThis.__stockQuoteInflight ??= new Map<string, Promise<StoredQuoteSnapshot>>());

function staleTtlSeconds(): number {
  return numericEnv("STOCK_QUOTE_CACHE_STALE_SECONDS", 86_400);
}

function isFresh(snapshot: StoredQuoteSnapshot, nowMs: number): boolean {
  return Date.parse(snapshot.expiresAt) > nowMs;
}

function isServeableStale(snapshot: StoredQuoteSnapshot, nowMs: number): boolean {
  const fetchedAt = Date.parse(snapshot.fetchedAt);
  return Number.isFinite(fetchedAt) && fetchedAt + staleTtlSeconds() * 1000 > nowMs;
}

async function readSupabaseSnapshot(ticker: string): Promise<StoredQuoteSnapshot | undefined> {
  const config = supabaseReadConfig();
  if (!config) return undefined;

  try {
    const url = `${config.url}/rest/v1/${SUPABASE_TABLE}?ticker=eq.${encodeURIComponent(ticker)}&select=ticker,payload,fetched_at,expires_at&limit=1`;
    const response = await fetchWithTimeout(url, { headers: supabaseHeaders(config.key), cache: "no-store" });
    if (!response.ok) return undefined;
    const rows = (await response.json()) as SupabaseQuoteRow[];
    const row = rows[0];
    if (!row?.payload) return undefined;
    return {
      ticker: row.ticker,
      payload: row.payload,
      fetchedAt: row.fetched_at,
      expiresAt: row.expires_at,
    };
  } catch {
    return undefined;
  }
}

async function writeSupabaseSnapshot(snapshot: StoredQuoteSnapshot): Promise<void> {
  const config = supabaseAdminConfig();
  if (!config) return;

  try {
    const response = await fetchWithTimeout(`${config.url}/rest/v1/${SUPABASE_TABLE}?on_conflict=ticker`, {
      method: "POST",
      headers: {
        ...supabaseHeaders(config.key),
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        ticker: snapshot.ticker,
        payload: snapshot.payload,
        fetched_at: snapshot.fetchedAt,
        expires_at: snapshot.expiresAt,
      }),
    });
    if (!response.ok) {
      console.warn("stock_quote_cache_write_failed", { ticker: snapshot.ticker, status: response.status });
    }
  } catch (error) {
    // Quote cache writes are best effort.
    console.warn("stock_quote_cache_write_failed", { ticker: snapshot.ticker, error: error instanceof Error ? error.message : "unknown" });
  }
}

function runQuoteCollector(ticker: string): Promise<StockPayload> {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, [SCRIPT_PATH, ticker, "--view", "quote"], {
      env: {
        ...process.env,
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
      },
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Quote lookup timed out after ${TIMEOUT_MS / 1000}s`));
    }, TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      if (exitCode !== 0) {
        reject(new Error(stderr || `Python quote collector exited with ${exitCode}`));
        return;
      }

      try {
        resolve(JSON.parse(stdout) as StockPayload);
      } catch {
        reject(new Error("Python quote collector did not return valid JSON."));
      }
    });
  });
}

async function refreshQuoteSnapshot(ticker: string): Promise<StoredQuoteSnapshot> {
  const existing = inflightRefreshes.get(ticker);
  if (existing) return existing;

  const promise = (async () => {
    const payload = await runQuoteCollector(ticker);
    const nowMs = Date.now();
    const market = payload.market === "KR" || payload.market === "US" ? payload.market : marketFromTicker(ticker);
    const { expiresAt, session } = await cacheExpiresAtForMarket(market, "quote", nowMs);
    const fetchedAt = new Date(nowMs).toISOString();
    const snapshot: StoredQuoteSnapshot = {
      ticker,
      payload: {
        ...payload,
        market_session: session,
      },
      fetchedAt,
      expiresAt,
    };

    if (payload.ok !== false) {
      memoryCache.set(ticker, snapshot);
      await writeSupabaseSnapshot(snapshot);
    }

    return snapshot;
  })();

  inflightRefreshes.set(ticker, promise);
  try {
    return await promise;
  } finally {
    inflightRefreshes.delete(ticker);
  }
}

function decorate(snapshot: StoredQuoteSnapshot, state: QuoteCacheState, source: QuoteCacheSource, extra?: { refreshError?: string }): StockQuoteResult {
  const serverCache = {
    state,
    source,
    ticker: snapshot.ticker,
    fetched_at: snapshot.fetchedAt,
    expires_at: snapshot.expiresAt,
    refresh_error: extra?.refreshError,
  };

  return {
    payload: {
      ...snapshot.payload,
      server_cache: serverCache,
    },
    cache: {
      state,
      source,
      ticker: snapshot.ticker,
      fetchedAt: snapshot.fetchedAt,
      expiresAt: snapshot.expiresAt,
      refreshError: extra?.refreshError,
    },
  };
}

export async function getStockQuote(tickerRef: string, options: { forceRefresh?: boolean } = {}): Promise<StockQuoteResult> {
  const ticker = normalizeTickerRef(tickerRef);
  const nowMs = Date.now();
  let staleCandidate: StoredQuoteSnapshot | undefined;
  let staleSource: QuoteCacheSource = "memory";

  if (!options.forceRefresh) {
    const memorySnapshot = memoryCache.get(ticker);
    if (memorySnapshot && isFresh(memorySnapshot, nowMs)) {
      return decorate(memorySnapshot, "fresh", "memory");
    }
    if (memorySnapshot && isServeableStale(memorySnapshot, nowMs)) {
      staleCandidate = memorySnapshot;
      staleSource = "memory";
    }

    const dbSnapshot = await readSupabaseSnapshot(ticker);
    if (dbSnapshot && isFresh(dbSnapshot, nowMs)) {
      memoryCache.set(ticker, dbSnapshot);
      return decorate(dbSnapshot, "fresh", "supabase");
    }
    if (dbSnapshot && isServeableStale(dbSnapshot, nowMs)) {
      staleCandidate = dbSnapshot;
      staleSource = "supabase";
    }
  }

  try {
    const refreshed = await refreshQuoteSnapshot(ticker);
    return decorate(refreshed, "miss", "collector");
  } catch (error) {
    if (staleCandidate) {
      return decorate(staleCandidate, "stale", staleSource, {
        refreshError: error instanceof Error ? error.message : "refresh_failed",
      });
    }
    throw error;
  }
}

export function quoteResponseCacheHeaders(result: StockQuoteResult): HeadersInit {
  if (result.payload.ok === false) {
    return { "Cache-Control": "no-store" };
  }

  return {
    "Cache-Control": `private, no-cache, max-age=0, s-maxage=0`,
    Vary: "Cookie",
    "X-Quote-Cache-Seconds": String(secondsUntil(result.cache.expiresAt)),
  };
}

export function quoteStatusFromPayload(payload: StockPayload): number {
  return statusFromPayload(payload);
}

export type { MarketSession };
