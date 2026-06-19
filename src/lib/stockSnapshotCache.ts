import { cacheExpiresAtForMarket, marketFromTicker, secondsUntil, scoreOpenTtlSeconds } from "@/lib/marketCalendar";
import { getMarketDataServiceScore } from "@/lib/marketDataServiceClient";
import { publicRefreshErrorCode, safeErrorMessage } from "@/lib/errorSafety";
import { publicVercelCdnCacheHeaders } from "@/lib/httpCacheHeaders";
import { pythonCollectorEnabled, StockDataUnavailableError, type StockDataUnavailableReason } from "@/lib/stockDataRuntime";
import { enqueueStockRefreshJob } from "@/lib/stockRefreshQueue";
import { STOCK_REFRESH_PRIORITIES } from "@/lib/stockRefreshPriorities";
import { sanitizeSnapshotPayload } from "@/lib/snapshotPayloadSanitizer";
import { stockCachePolicyStaleSeconds } from "@/lib/stockCachePolicy";
import { stockScorePayloadNeedsEnrichment, stockScorePayloadIsDurable } from "@/lib/stockQueryCompleteness";
import {
  cleanScoreView,
  isCurrentScorePayload,
  isCurrentScoreSnapshot,
  statusFromPayload,
  stockScoreCacheKey,
  type CacheSource,
  type CacheState,
  type ScoreView,
  type StockPayload,
  type StockScoreResult,
  type StoredScoreSnapshot,
} from "@/lib/stockScoreContract";
import { fetchWithTimeout, layeredNumericEnv, numericEnv, supabaseAdminConfig, supabaseReadConfig, supabaseHeaders } from "@/lib/supabaseRest";
import { normalizeTickerRef as normalizeTickerRefValue } from "@/lib/tickerRef";

export { normalizeTickerRef } from "@/lib/tickerRef";
export { isCurrentScorePayload, statusFromPayload };
export type { CacheSource, CacheState, ScoreView, StockPayload, StockScoreResult };

type SupabaseSnapshotRow = {
  ticker: string;
  view_mode: ScoreView;
  payload: StockPayload;
  fetched_at: string;
  expires_at: string;
};

declare global {
  var __stockScoreInflight: Map<string, Promise<StoredScoreSnapshot>> | undefined;
}

const SUPABASE_TABLE = "stock_score_snapshots";

const memoryCache = (globalThis.__stockScoreMemoryCache ??= new Map<string, StoredScoreSnapshot>());
const inflightRefreshes = (globalThis.__stockScoreInflight ??= new Map<string, Promise<StoredScoreSnapshot>>());

function freshTtlSeconds(view: ScoreView): number {
  return scoreOpenTtlSeconds(view);
}

function staleTtlSeconds(view: ScoreView): number {
  const policyDefault = view === "technical" ? stockCachePolicyStaleSeconds("technical") : stockCachePolicyStaleSeconds("score");
  return numericEnv("STOCK_SCORE_CACHE_STALE_SECONDS", policyDefault);
}

export function cleanView(value: string | null): ScoreView {
  return cleanScoreView(value);
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

async function expiresAtFrom(nowMs: number, ticker: string, view: ScoreView): Promise<string> {
  const { expiresAt } = await cacheExpiresAtForMarket(marketFromTicker(ticker), "score", nowMs, view);
  return expiresAt;
}

function cacheKey(ticker: string, view: ScoreView): string {
  return stockScoreCacheKey(ticker, view);
}

function isFresh(snapshot: StoredScoreSnapshot, nowMs: number): boolean {
  return isCurrentScoreSnapshot(snapshot) && Date.parse(snapshot.expiresAt) > nowMs;
}

function isServeableStale(snapshot: StoredScoreSnapshot, nowMs: number): boolean {
  if (!isCurrentScoreSnapshot(snapshot)) return false;
  const fetchedAt = Date.parse(snapshot.fetchedAt);
  return Number.isFinite(fetchedAt) && fetchedAt + staleTtlSeconds(snapshot.view) * 1000 > nowMs;
}

function approximateJsonBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function maxMemoryPayloadBytes(): number {
  return Math.max(0, numericEnv("STOCK_SCORE_MEMORY_CACHE_MAX_PAYLOAD_BYTES", 500_000));
}

function shouldRememberSnapshot(snapshot: StoredScoreSnapshot): boolean {
  return approximateJsonBytes(snapshot.payload) <= maxMemoryPayloadBytes();
}

function rememberMemorySnapshot(key: string, snapshot: StoredScoreSnapshot, nowMs: number) {
  if (!shouldRememberSnapshot(snapshot)) {
    memoryCache.delete(key);
    return;
  }
  memoryCache.set(key, snapshot);
  pruneMemoryCache(nowMs);
}

async function readSupabaseSnapshot(ticker: string, view: ScoreView): Promise<StoredScoreSnapshot | undefined> {
  const config = supabaseReadConfig();
  if (!config) return undefined;

  try {
    const url = `${config.url}/rest/v1/${SUPABASE_TABLE}?ticker=eq.${encodeURIComponent(ticker)}&view_mode=eq.${view}&select=ticker,view_mode,payload,fetched_at,expires_at&limit=1`;
    const response = await fetchWithTimeout(url, { headers: supabaseHeaders(config.key), cache: "no-store" }, scoreSupabaseReadTimeoutMs());
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

async function writeSupabaseSnapshot(snapshot: StoredScoreSnapshot): Promise<void> {
  const config = supabaseAdminConfig();
  if (!config) return;

  try {
    const response = await fetchWithTimeout(
      `${config.url}/rest/v1/${SUPABASE_TABLE}?on_conflict=ticker,view_mode`,
      {
        method: "POST",
        headers: {
          ...supabaseHeaders(config.key),
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify({
          ticker: snapshot.ticker,
          view_mode: snapshot.view,
          payload: sanitizeSnapshotPayload(snapshot.payload),
          fetched_at: snapshot.fetchedAt,
          expires_at: snapshot.expiresAt,
        }),
      },
      scoreSupabaseWriteTimeoutMs()
    );
    if (!response.ok) {
      console.warn("stock_score_cache_write_failed", { ticker: snapshot.ticker, view: snapshot.view, status: response.status });
    }
  } catch (error) {
    // Cache writes are best effort. The live collector remains the fallback.
    console.warn("stock_score_cache_write_failed", { ticker: snapshot.ticker, view: snapshot.view, error: safeErrorMessage(error) });
  }
}

async function refreshSnapshot(ticker: string, view: ScoreView): Promise<StoredScoreSnapshot> {
  const key = cacheKey(ticker, view);
  const existing = inflightRefreshes.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const payload = await scoreRefreshPayload(ticker, view);
    const nowMs = Date.now();
    const fetchedAt = new Date(nowMs).toISOString();
    const snapshot: StoredScoreSnapshot = {
      ticker,
      view,
      payload,
      fetchedAt,
      expiresAt: await expiresAtFrom(nowMs, ticker, view),
    };

    if (payload.ok !== false && stockScorePayloadIsDurable(payload)) {
      rememberMemorySnapshot(key, snapshot, nowMs);
      if (snapshot.view === "compare") {
        void writeSupabaseSnapshot(snapshot);
      } else {
        await writeSupabaseSnapshot(snapshot);
      }
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

async function scoreRefreshPayload(ticker: string, view: ScoreView): Promise<StockPayload> {
  if (view === "technical") {
    const { buildTechnicalScoreFastPathPayload, technicalRequestFastPathEnabled } = await import("@/lib/technicalScoreFastPath");
    if (technicalRequestFastPathEnabled()) {
      try {
        return await buildTechnicalScoreFastPathPayload(ticker);
      } catch (error) {
        if (!pythonCollectorEnabled()) throw error;
        console.warn("technical_request_fast_path_failed", { ticker, error: publicRefreshErrorCode(error) });
      }
    }
  }

  if (!pythonCollectorEnabled()) {
    const { buildDetailScoreFastPathPayload, detailRequestFastPathEnabled } = await import("@/lib/detailScoreFastPath");
    if (detailRequestFastPathEnabled()) {
      return buildDetailScoreFastPathPayload(ticker, view);
    }
  }

  const { runScoreCollector } = await import("@/lib/pythonStockCollector");
  return runScoreCollector(ticker, view);
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

function decorate(snapshot: StoredScoreSnapshot, state: CacheState, source: CacheSource, extra?: Partial<StockScoreResult["cache"]>): StockScoreResult {
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

async function inlineScoreRefreshAvailable(view: ScoreView): Promise<boolean> {
  if (pythonCollectorEnabled()) return true;
  try {
    if (view === "technical") {
      const { technicalRequestFastPathEnabled } = await import("@/lib/technicalScoreFastPath");
      return technicalRequestFastPathEnabled();
    }
    const { detailRequestFastPathEnabled } = await import("@/lib/detailScoreFastPath");
    return detailRequestFastPathEnabled();
  } catch {
    return false;
  }
}

function scoreSupabaseReadTimeoutMs(): number {
  return layeredNumericEnv("STOCK_SCORE_SUPABASE_READ_TIMEOUT_MS", "SUPABASE_READ_TIMEOUT_MS", 1_500);
}

function scoreSupabaseWriteTimeoutMs(): number {
  return layeredNumericEnv("STOCK_SCORE_SUPABASE_WRITE_TIMEOUT_MS", "SUPABASE_WRITE_TIMEOUT_MS", 5_000);
}

function scheduleQueuedRefresh(ticker: string, view: ScoreView, priority: number, reason: StockDataUnavailableReason) {
  void enqueueStockRefreshJob({ kind: "score", ticker, view, priority, reason }).catch(() => undefined);
}

export async function getStockScore(tickerRef: string, view: ScoreView, options: { forceRefresh?: boolean } = {}): Promise<StockScoreResult> {
  const ticker = normalizeTickerRefValue(tickerRef);
  const key = cacheKey(ticker, view);
  const nowMs = Date.now();
  let freshCandidate: StoredScoreSnapshot | undefined;
  let freshSource: CacheSource = "memory";
  let staleCandidate: StoredScoreSnapshot | undefined;
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
      rememberMemorySnapshot(key, dbSnapshot, nowMs);
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
      rememberMemorySnapshot(key, staleCandidate, nowMs);
      if (await inlineScoreRefreshAvailable(view)) {
        scheduleRefresh(ticker, view);
        return decorate(staleCandidate, "stale", staleSource, { refreshStarted: true });
      }
      scheduleQueuedRefresh(ticker, view, STOCK_REFRESH_PRIORITIES.STALE_SCORE_REFRESH, "stale_refresh");
      return decorate(staleCandidate, "stale", staleSource, { refreshStarted: false });
    }
  }

  try {
    const marketDataResult = await getMarketDataServiceScore(ticker, view, { forceRefresh: options.forceRefresh });
    if (marketDataResult) return marketDataResult;

    if (!pythonCollectorEnabled()) {
      if (view === "technical") {
        try {
          const { technicalRequestFastPathEnabled } = await import("@/lib/technicalScoreFastPath");
          if (technicalRequestFastPathEnabled()) {
            const refreshed = await refreshSnapshot(ticker, view);
            return decorate(refreshed, "miss", "market-data");
          }
        } catch (error) {
          console.warn("technical_request_fast_path_unavailable", { ticker, error: publicRefreshErrorCode(error) });
        }
      }
      if (view !== "technical") {
        try {
          const { detailRequestFastPathEnabled } = await import("@/lib/detailScoreFastPath");
          if (detailRequestFastPathEnabled()) {
            const refreshed = await refreshSnapshot(ticker, view);
            scheduleQueuedRefresh(
              ticker,
              view,
              options.forceRefresh
                ? STOCK_REFRESH_PRIORITIES.FORCE_REFRESH
                : view === "compare"
                  ? STOCK_REFRESH_PRIORITIES.USER_COMPARE_SCORE_MISS
                  : STOCK_REFRESH_PRIORITIES.USER_DETAIL_SCORE_MISS,
              options.forceRefresh ? "refresh_background_only" : "snapshot_miss"
            );
            return decorate(refreshed, "miss", "market-data");
          }
        } catch (error) {
          console.warn("detail_request_fast_path_unavailable", { ticker, view, error: publicRefreshErrorCode(error) });
        }
      }
      throw new StockDataUnavailableError({
        kind: "score",
        ticker,
        view,
        reason: options.forceRefresh ? "refresh_background_only" : "snapshot_miss",
      });
    }

    const refreshed = await refreshSnapshot(ticker, view);
    return decorate(refreshed, "miss", view === "technical" ? "market-data" : "collector");
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
  if (result.payload.ok === false || stockScorePayloadNeedsEnrichment(result.payload)) {
    return { "Cache-Control": "no-store" };
  }

  const seconds =
    result.cache.state === "stale"
      ? 15
      : Math.max(15, Math.min(secondsUntil(result.cache.expiresAt, Date.now(), freshTtlSeconds(result.cache.view)), numericEnv("STOCK_SCORE_HTTP_CACHE_MAX_SECONDS", 3_600)));
  return publicVercelCdnCacheHeaders({
    sMaxAgeSeconds: seconds,
    staleWhileRevalidateSeconds: numericEnv("STOCK_SCORE_HTTP_STALE_WHILE_REVALIDATE_SECONDS", 300),
    staleIfErrorSeconds: numericEnv("STOCK_SCORE_HTTP_STALE_IF_ERROR_SECONDS", 1_800),
  });
}

export const stockSnapshotCacheTestHooks = {
  approximateJsonBytes,
  shouldRememberSnapshot,
};
