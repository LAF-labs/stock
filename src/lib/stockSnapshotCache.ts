import { cacheExpiresAtForMarket, marketFromTicker, secondsUntil, scoreOpenTtlSeconds } from "@/lib/marketCalendar";
import { getMarketDataServiceScore } from "@/lib/marketDataServiceClient";
import { isCurrentScoreModelPayload } from "@/lib/scoreModel";
import { publicRefreshErrorCode } from "@/lib/errorSafety";
import { pythonCollectorEnabled, StockDataUnavailableError } from "@/lib/stockDataRuntime";
import { enqueueStockRefreshJob } from "@/lib/stockRefreshQueue";
import { fetchWithTimeout, numericEnv, supabaseAdminConfig, supabaseReadConfig, supabaseHeaders } from "@/lib/supabaseRest";
import { normalizeTickerRef as normalizeTickerRefValue } from "@/lib/tickerRef";

export { normalizeTickerRef } from "@/lib/tickerRef";

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

const SUPABASE_TABLE = "stock_score_snapshots";

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

export function parseTickerList(value: string | null, maxTickers = 5): string[] {
  const unique: string[] = [];
  (value || "")
    .split(",")
    .map((ticker) => normalizeTickerRefValue(ticker, ""))
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
  return isCurrentScoreSnapshot(snapshot) && Date.parse(snapshot.expiresAt) > nowMs;
}

function isServeableStale(snapshot: StoredSnapshot, nowMs: number): boolean {
  if (!isCurrentScoreSnapshot(snapshot)) return false;
  const fetchedAt = Date.parse(snapshot.fetchedAt);
  return Number.isFinite(fetchedAt) && fetchedAt + staleTtlSeconds() * 1000 > nowMs;
}

function isCurrentScoreSnapshot(snapshot: StoredSnapshot): boolean {
  return isCurrentScorePayload(snapshot.payload);
}

export function isCurrentScorePayload(payload: StockPayload): boolean {
  return isCurrentScoreModelPayload(payload);
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

async function refreshSnapshot(ticker: string, view: ScoreView): Promise<StoredSnapshot> {
  const key = cacheKey(ticker, view);
  const existing = inflightRefreshes.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const { runScoreCollector } = await import("@/lib/pythonStockCollector");
    const payload = await runScoreCollector(ticker, view);
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
  if (!pythonCollectorEnabled()) return;
  const key = cacheKey(ticker, view);
  if (inflightRefreshes.has(key)) return;
  void refreshSnapshot(ticker, view).catch(() => undefined);
}

function scheduleQueuedRefresh(ticker: string, view: ScoreView, priority: number, reason: "snapshot_miss" | "refresh_background_only") {
  void enqueueStockRefreshJob({ kind: "score", ticker, view, priority, reason }).catch(() => undefined);
}

export async function getStockScore(tickerRef: string, view: ScoreView, options: { forceRefresh?: boolean } = {}): Promise<StockScoreResult> {
  const ticker = normalizeTickerRefValue(tickerRef);
  const key = cacheKey(ticker, view);
  const nowMs = Date.now();
  let freshCandidate: StoredSnapshot | undefined;
  let freshSource: CacheSource = "memory";
  let staleCandidate: StoredSnapshot | undefined;
  let staleSource: CacheSource = "memory";

  const memorySnapshot = memoryCache.get(key);
  if (memorySnapshot && isFresh(memorySnapshot, nowMs)) {
    freshCandidate = memorySnapshot;
    freshSource = "memory";
  }
  if (memorySnapshot && isServeableStale(memorySnapshot, nowMs)) {
    staleCandidate = memorySnapshot;
    staleSource = "memory";
  }

  if (!freshCandidate) {
    const dbSnapshot = await readSupabaseSnapshot(ticker, view);
    if (dbSnapshot && isFresh(dbSnapshot, nowMs)) {
      memoryCache.set(key, dbSnapshot);
      freshCandidate = dbSnapshot;
      freshSource = "supabase";
    }
    if (dbSnapshot && isServeableStale(dbSnapshot, nowMs)) {
      staleCandidate = dbSnapshot;
      staleSource = "supabase";
    }
  }

  if (!options.forceRefresh) {
    if (freshCandidate) return decorate(freshCandidate, "fresh", freshSource);

    if (staleCandidate) {
      memoryCache.set(key, staleCandidate);
      if (pythonCollectorEnabled()) {
        scheduleRefresh(ticker, view);
        return decorate(staleCandidate, "stale", staleSource, { refreshStarted: true });
      }
      scheduleQueuedRefresh(ticker, view, 60, "snapshot_miss");
      return decorate(staleCandidate, "stale", staleSource, { refreshStarted: false });
    }
  }

  try {
    const marketDataResult = await getMarketDataServiceScore(ticker, view, { forceRefresh: options.forceRefresh });
    if (marketDataResult) return marketDataResult;

    if (!pythonCollectorEnabled()) {
      throw new StockDataUnavailableError({
        kind: "score",
        ticker,
        view,
        reason: options.forceRefresh ? "refresh_background_only" : "snapshot_miss",
      });
    }

    const refreshed = await refreshSnapshot(ticker, view);
    return decorate(refreshed, "miss", "collector");
  } catch (error) {
    if (freshCandidate) {
      return decorate(freshCandidate, "fresh", freshSource, {
        refreshError: publicRefreshErrorCode(error),
      });
    }
    if (staleCandidate) {
      return decorate(staleCandidate, "stale", staleSource, {
        refreshStarted: false,
        refreshError: publicRefreshErrorCode(error),
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
