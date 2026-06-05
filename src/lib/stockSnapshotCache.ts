import { spawn } from "node:child_process";
import { acquireRateLimit, apiLimitPolicy, fixedRateLimitKey } from "@/lib/apiRateLimit";
import { cacheExpiresAtForMarket, marketFromTicker, secondsUntil, scoreOpenTtlSeconds } from "@/lib/marketCalendar";
import { getMarketDataServiceScore } from "@/lib/marketDataServiceClient";
import { fetchWithTimeout, numericEnv, supabaseAdminConfig, supabaseReadConfig, supabaseHeaders } from "@/lib/supabaseRest";
import { appendBoundedOutput, subprocessErrorMessage, type BoundedOutput } from "@/lib/subprocessGuards";

export type ScoreView = "detail" | "compare";
export type StockPayload = Record<string, unknown>;
export type CacheState = "fresh" | "stale" | "miss";
export type CacheSource = "memory" | "supabase" | "collector" | "market-data";

export type StockScoreResult = {
  payload: StockPayload;
  cache: {
    state: CacheState;
    source: CacheSource;
    ticker: string;
    view: ScoreView;
    fetchedAt?: string;
    expiresAt?: string;
    refreshStarted?: boolean;
    refreshError?: string;
  };
};

type StoredSnapshot = {
  ticker: string;
  view: ScoreView;
  payload: StockPayload;
  fetchedAt: string;
  expiresAt: string;
};

type SupabaseSnapshotRow = {
  ticker: string;
  view_mode: ScoreView;
  payload: StockPayload;
  fetched_at: string;
  expires_at: string;
};

declare global {
  var __stockScoreMemoryCache: Map<string, StoredSnapshot> | undefined;
  var __stockScoreInflight: Map<string, Promise<StoredSnapshot>> | undefined;
}

const SCRIPT_PATH = "scripts/fetch_yfinance_score.py";
const PYTHON_BIN = process.env.PYTHON_BIN || process.env.PYTHON || "python";
const TIMEOUT_MS = 35_000;
const SUPABASE_TABLE = "stock_score_snapshots";
const COLLECTOR_OUTPUT_MAX_BYTES = 1_000_000;

const memoryCache = (globalThis.__stockScoreMemoryCache ??= new Map<string, StoredSnapshot>());
const inflightRefreshes = (globalThis.__stockScoreInflight ??= new Map<string, Promise<StoredSnapshot>>());

function freshTtlSeconds(view: ScoreView): number {
  return scoreOpenTtlSeconds(view);
}

function staleTtlSeconds(): number {
  return numericEnv("STOCK_SCORE_CACHE_STALE_SECONDS", 86_400);
}

export function cleanView(value: string | null): ScoreView {
  return value === "compare" ? "compare" : "detail";
}

export function normalizeTickerRef(value: string | null | undefined, fallback = "US:ASTS"): string {
  const raw = (value || fallback).trim().replace(/^!/, "").toUpperCase();

  if (raw.includes(":")) {
    const [market, symbolPart] = raw.split(":", 2);
    const symbol = (symbolPart || "").replace(/[^A-Z0-9.-]/g, "");
    if ((market === "US" || market === "KR") && symbol) return `${market}:${symbol}`;
  }

  const symbol = raw.replace(/[^A-Z0-9.-]/g, "");
  if (!symbol) return fallback;
  if (/^(?:\d{6}|Q\d{6})$/.test(symbol)) return `KR:${symbol}`;
  return `US:${symbol}`;
}

export function parseTickerList(value: string | null, maxTickers = 5): string[] {
  const unique: string[] = [];
  (value || "")
    .split(",")
    .map((ticker) => normalizeTickerRef(ticker, ""))
    .filter(Boolean)
    .forEach((ticker) => {
      if (!unique.includes(ticker)) unique.push(ticker);
    });
  return unique.slice(0, maxTickers);
}

export function statusFromPayload(payload: StockPayload): number {
  return typeof payload.status === "number" ? payload.status : payload.ok === false ? 400 : 200;
}

function cacheKey(ticker: string, view: ScoreView): string {
  return `${view}:${ticker}`;
}

async function expiresAtFrom(nowMs: number, ticker: string, view: ScoreView): Promise<string> {
  const { expiresAt } = await cacheExpiresAtForMarket(marketFromTicker(ticker), "score", nowMs, view);
  return expiresAt;
}

function isFresh(snapshot: StoredSnapshot, nowMs: number): boolean {
  return Date.parse(snapshot.expiresAt) > nowMs;
}

function isServeableStale(snapshot: StoredSnapshot, nowMs: number): boolean {
  const fetchedAt = Date.parse(snapshot.fetchedAt);
  return Number.isFinite(fetchedAt) && fetchedAt + staleTtlSeconds() * 1000 > nowMs;
}

async function readSupabaseSnapshot(ticker: string, view: ScoreView): Promise<StoredSnapshot | undefined> {
  const config = supabaseReadConfig();
  if (!config) return undefined;

  try {
    const url = `${config.url}/rest/v1/${SUPABASE_TABLE}?ticker=eq.${encodeURIComponent(ticker)}&view_mode=eq.${view}&select=ticker,view_mode,payload,fetched_at,expires_at&limit=1`;
    const response = await fetchWithTimeout(url, { headers: supabaseHeaders(config.key), cache: "no-store" });
    if (!response.ok) return undefined;
    const rows = (await response.json()) as SupabaseSnapshotRow[];
    const row = rows[0];
    if (!row?.payload) return undefined;
    return {
      ticker: row.ticker,
      view: row.view_mode,
      payload: row.payload,
      fetchedAt: row.fetched_at,
      expiresAt: row.expires_at,
    };
  } catch {
    return undefined;
  }
}

async function writeSupabaseSnapshot(snapshot: StoredSnapshot): Promise<void> {
  const config = supabaseAdminConfig();
  if (!config) return;

  try {
    const response = await fetchWithTimeout(`${config.url}/rest/v1/${SUPABASE_TABLE}?on_conflict=ticker,view_mode`, {
      method: "POST",
      headers: {
        ...supabaseHeaders(config.key),
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        ticker: snapshot.ticker,
        view_mode: snapshot.view,
        payload: snapshot.payload,
        fetched_at: snapshot.fetchedAt,
        expires_at: snapshot.expiresAt,
      }),
    });
    if (!response.ok) {
      console.warn("stock_score_cache_write_failed", { ticker: snapshot.ticker, view: snapshot.view, status: response.status });
    }
  } catch (error) {
    // Cache writes are best effort. The live collector remains the fallback.
    console.warn("stock_score_cache_write_failed", { ticker: snapshot.ticker, view: snapshot.view, error: error instanceof Error ? error.message : "unknown" });
  }
}

async function acquireCollectorSlot() {
  const result = await acquireRateLimit(
    fixedRateLimitKey("stock-score-collector-global"),
    apiLimitPolicy("stock_score_collector", 30, 60)
  );
  if (!result.allowed) {
    throw new Error(`collector_rate_limited_until_${result.resetAt}`);
  }
}

async function runCollector(ticker: string, view: ScoreView): Promise<StockPayload> {
  await acquireCollectorSlot();
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, [SCRIPT_PATH, ticker, "--view", view], {
      env: {
        ...process.env,
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
      },
      windowsHide: true,
    });

    let stdout: BoundedOutput = { value: "", truncated: false };
    let stderr: BoundedOutput = { value: "", truncated: false };
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Stock lookup timed out after ${TIMEOUT_MS / 1000}s`));
    }, TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      const next = appendBoundedOutput(stdout.value, chunk, numericEnv("STOCK_COLLECTOR_OUTPUT_MAX_BYTES", COLLECTOR_OUTPUT_MAX_BYTES));
      stdout = { value: next.value, truncated: stdout.truncated || next.truncated };
    });
    child.stderr.on("data", (chunk) => {
      const next = appendBoundedOutput(stderr.value, chunk, numericEnv("STOCK_COLLECTOR_OUTPUT_MAX_BYTES", COLLECTOR_OUTPUT_MAX_BYTES));
      stderr = { value: next.value, truncated: stderr.truncated || next.truncated };
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      if (exitCode !== 0) {
        reject(new Error(subprocessErrorMessage(stderr, `Python collector exited with ${exitCode}`)));
        return;
      }

      try {
        resolve(JSON.parse(stdout.value) as StockPayload);
      } catch {
        reject(new Error("Python collector did not return valid JSON."));
      }
    });
  });
}

async function refreshSnapshot(ticker: string, view: ScoreView): Promise<StoredSnapshot> {
  const key = cacheKey(ticker, view);
  const existing = inflightRefreshes.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const payload = await runCollector(ticker, view);
    const nowMs = Date.now();
    const fetchedAt = new Date(nowMs).toISOString();
    const snapshot: StoredSnapshot = {
      ticker,
      view,
      payload,
      fetchedAt,
      expiresAt: await expiresAtFrom(nowMs, ticker, view),
    };

    if (payload.ok !== false) {
      memoryCache.set(key, snapshot);
      pruneMemoryCache(nowMs);
      await writeSupabaseSnapshot(snapshot);
    }

    return snapshot;
  })();

  inflightRefreshes.set(key, promise);
  try {
    return await promise;
  } finally {
    inflightRefreshes.delete(key);
  }
}

function pruneMemoryCache(nowMs: number) {
  const limit = numericEnv("STOCK_SCORE_MEMORY_CACHE_MAX_ENTRIES", 1_000);
  if (memoryCache.size <= limit) return;

  for (const [key, snapshot] of memoryCache) {
    if (!isServeableStale(snapshot, nowMs)) memoryCache.delete(key);
  }
  if (memoryCache.size <= limit) return;

  const oldest = [...memoryCache.entries()].sort((left, right) => Date.parse(left[1].fetchedAt) - Date.parse(right[1].fetchedAt));
  for (const [key] of oldest.slice(0, Math.max(0, memoryCache.size - limit))) {
    memoryCache.delete(key);
  }
}

function decorate(snapshot: StoredSnapshot, state: CacheState, source: CacheSource, extra?: Partial<StockScoreResult["cache"]>): StockScoreResult {
  const serverCache = {
    state,
    source,
    ticker: snapshot.ticker,
    view: snapshot.view,
    fetched_at: snapshot.fetchedAt,
    expires_at: snapshot.expiresAt,
    refresh_started: extra?.refreshStarted,
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
      view: snapshot.view,
      fetchedAt: snapshot.fetchedAt,
      expiresAt: snapshot.expiresAt,
      refreshStarted: extra?.refreshStarted,
      refreshError: extra?.refreshError,
    },
  };
}

function scheduleRefresh(ticker: string, view: ScoreView) {
  const key = cacheKey(ticker, view);
  if (inflightRefreshes.has(key)) return;
  void refreshSnapshot(ticker, view).catch(() => undefined);
}

export async function getStockScore(tickerRef: string, view: ScoreView, options: { forceRefresh?: boolean } = {}): Promise<StockScoreResult> {
  const ticker = normalizeTickerRef(tickerRef);
  const key = cacheKey(ticker, view);
  const nowMs = Date.now();
  let staleCandidate: StoredSnapshot | undefined;
  let staleSource: CacheSource = "memory";

  if (!options.forceRefresh) {
    const memorySnapshot = memoryCache.get(key);
    if (memorySnapshot && isFresh(memorySnapshot, nowMs)) {
      return decorate(memorySnapshot, "fresh", "memory");
    }
    if (memorySnapshot && isServeableStale(memorySnapshot, nowMs)) {
      staleCandidate = memorySnapshot;
      staleSource = "memory";
    }

    const dbSnapshot = await readSupabaseSnapshot(ticker, view);
    if (dbSnapshot && isFresh(dbSnapshot, nowMs)) {
      memoryCache.set(key, dbSnapshot);
      return decorate(dbSnapshot, "fresh", "supabase");
    }
    if (dbSnapshot && isServeableStale(dbSnapshot, nowMs)) {
      staleCandidate = dbSnapshot;
      staleSource = "supabase";
    }

    if (staleCandidate) {
      memoryCache.set(key, staleCandidate);
      scheduleRefresh(ticker, view);
      return decorate(staleCandidate, "stale", staleSource, { refreshStarted: true });
    }
  }

  try {
    const marketDataResult = await getMarketDataServiceScore(ticker, view, { forceRefresh: options.forceRefresh });
    if (marketDataResult) return marketDataResult;

    const refreshed = await refreshSnapshot(ticker, view);
    return decorate(refreshed, "miss", "collector");
  } catch (error) {
    if (staleCandidate) {
      return decorate(staleCandidate, "stale", staleSource, {
        refreshStarted: false,
        refreshError: error instanceof Error ? error.message : "refresh_failed",
      });
    }
    throw error;
  }
}

export function responseCacheHeaders(result: StockScoreResult): HeadersInit {
  if (result.payload.ok === false) {
    return { "Cache-Control": "no-store" };
  }

  const seconds =
    result.cache.state === "stale"
      ? 15
      : Math.max(15, Math.min(secondsUntil(result.cache.expiresAt, Date.now(), freshTtlSeconds(result.cache.view)), numericEnv("STOCK_SCORE_HTTP_CACHE_MAX_SECONDS", 3_600)));
  return {
    "Cache-Control": `public, max-age=10, s-maxage=${seconds}, stale-while-revalidate=300`,
  };
}
