import { cacheExpiresAtForMarket, marketFromTicker, secondsUntil } from "@/lib/marketCalendar";
import { publicRefreshErrorCode } from "@/lib/errorSafety";
import { enqueueStockRefreshJob } from "@/lib/stockRefreshQueue";
import { StockDataUnavailableError, type StockDataUnavailableReason } from "@/lib/stockDataRuntime";
import { STOCK_REFRESH_PRIORITIES } from "@/lib/stockRefreshPriorities";
import { stockCachePolicyFreshSeconds, stockCachePolicyStaleSeconds } from "@/lib/stockCachePolicy";
import { sanitizeSnapshotPayload } from "@/lib/snapshotPayloadSanitizer";
import { fetchWithTimeout, numericEnv, supabaseAdminConfig, supabaseHeaders, supabaseReadConfig, type SupabaseConfig } from "@/lib/supabaseRest";
import { normalizeTickerRef } from "@/lib/tickerRef";

export type ChartPayload = Record<string, unknown>;
export type ChartCacheState = "fresh" | "stale" | "miss";
export type ChartCacheSource = "memory" | "supabase";

export type StockChartResult = {
  payload: ChartPayload;
  cache: {
    state: ChartCacheState;
    source: ChartCacheSource;
    ticker: string;
    fetchedAt?: string;
    expiresAt?: string;
    staleExpiresAt?: string;
    lastBarDate?: string;
    refreshStarted?: boolean;
    refreshError?: string;
  };
};

type StoredChartSnapshot = {
  ticker: string;
  payload: ChartPayload;
  fetchedAt: string;
  expiresAt: string;
  staleExpiresAt: string;
  lastBarDate?: string;
};

type SupabaseChartRow = {
  ticker: string;
  payload: ChartPayload;
  fetched_at: string;
  expires_at: string;
  stale_expires_at: string;
  last_bar_date?: string | null;
};

declare global {
  var __stockChartMemoryCache: Map<string, StoredChartSnapshot> | undefined;
}

const SUPABASE_TABLE = "stock_chart_snapshots";
const memoryCache = (globalThis.__stockChartMemoryCache ??= new Map<string, StoredChartSnapshot>());

function isFresh(snapshot: StoredChartSnapshot, nowMs: number): boolean {
  return Date.parse(snapshot.expiresAt) > nowMs;
}

function isServeableStale(snapshot: StoredChartSnapshot, nowMs: number): boolean {
  const staleExpiresAt = Date.parse(snapshot.staleExpiresAt || "");
  if (Number.isFinite(staleExpiresAt)) return staleExpiresAt > nowMs;
  const fetchedAt = Date.parse(snapshot.fetchedAt);
  return Number.isFinite(fetchedAt) && fetchedAt + stockCachePolicyStaleSeconds("chart") * 1000 > nowMs;
}

async function readSupabaseSnapshot(ticker: string): Promise<StoredChartSnapshot | undefined> {
  const config = supabaseReadConfig();
  if (!config) return undefined;

  try {
    const url = `${config.url}/rest/v1/${SUPABASE_TABLE}?ticker=eq.${encodeURIComponent(ticker)}&select=ticker,payload,fetched_at,expires_at,stale_expires_at,last_bar_date&limit=1`;
    const response = await fetchWithTimeout(url, { headers: supabaseHeaders(config.key), cache: "no-store" });
    if (!response.ok) return undefined;
    const rows = (await response.json()) as SupabaseChartRow[];
    const row = rows[0];
    if (!row?.payload) return undefined;
    return {
      ticker: row.ticker,
      payload: row.payload,
      fetchedAt: row.fetched_at,
      expiresAt: row.expires_at,
      staleExpiresAt: row.stale_expires_at,
      lastBarDate: row.last_bar_date || undefined,
    };
  } catch {
    return undefined;
  }
}

function rememberMemorySnapshot(snapshot: StoredChartSnapshot, nowMs: number) {
  memoryCache.set(snapshot.ticker, snapshot);
  pruneMemoryCache(nowMs);
}

function decorate(snapshot: StoredChartSnapshot, state: ChartCacheState, source: ChartCacheSource, extra?: { refreshStarted?: boolean; refreshError?: string }): StockChartResult {
  const serverCache = {
    state,
    source,
    ticker: snapshot.ticker,
    fetched_at: snapshot.fetchedAt,
    expires_at: snapshot.expiresAt,
    stale_expires_at: snapshot.staleExpiresAt,
    last_bar_date: snapshot.lastBarDate,
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
      fetchedAt: snapshot.fetchedAt,
      expiresAt: snapshot.expiresAt,
      staleExpiresAt: snapshot.staleExpiresAt,
      lastBarDate: snapshot.lastBarDate,
      refreshStarted: extra?.refreshStarted,
      refreshError: extra?.refreshError,
    },
  };
}

function scheduleQueuedRefresh(ticker: string, priority: number, reason: StockDataUnavailableReason) {
  void enqueueStockRefreshJob({ kind: "chart", ticker, priority, reason }).catch(() => undefined);
}

export async function getStockChart(
  tickerRef: string,
  options: { forceRefresh?: boolean; enqueueOnMiss?: boolean; enqueueStaleRefresh?: boolean } = {}
): Promise<StockChartResult> {
  const ticker = normalizeTickerRef(tickerRef);
  const nowMs = Date.now();
  let freshCandidate: StoredChartSnapshot | undefined;
  let freshSource: ChartCacheSource = "memory";
  let staleCandidate: StoredChartSnapshot | undefined;
  let staleSource: ChartCacheSource = "memory";

  const memorySnapshot = memoryCache.get(ticker);
  if (memorySnapshot && isFresh(memorySnapshot, nowMs)) {
    freshCandidate = memorySnapshot;
    freshSource = "memory";
  }
  if (memorySnapshot && isServeableStale(memorySnapshot, nowMs)) {
    staleCandidate = memorySnapshot;
    staleSource = "memory";
  }

  if (!freshCandidate) {
    const dbSnapshot = await readSupabaseSnapshot(ticker);
    if (dbSnapshot && isFresh(dbSnapshot, nowMs)) {
      rememberMemorySnapshot(dbSnapshot, nowMs);
      freshCandidate = dbSnapshot;
      freshSource = "supabase";
    }
    if (dbSnapshot && isServeableStale(dbSnapshot, nowMs)) {
      staleCandidate = dbSnapshot;
      staleSource = "supabase";
    }
  }

  if (!options.forceRefresh && freshCandidate) return decorate(freshCandidate, "fresh", freshSource);

  if (!options.forceRefresh && staleCandidate) {
    rememberMemorySnapshot(staleCandidate, nowMs);
    if (options.enqueueStaleRefresh !== false) {
      scheduleQueuedRefresh(ticker, STOCK_REFRESH_PRIORITIES.STALE_CHART_REFRESH, "stale_refresh");
    }
    return decorate(staleCandidate, "stale", staleSource, { refreshStarted: true });
  }

  if (freshCandidate) return decorate(freshCandidate, "fresh", freshSource, { refreshError: publicRefreshErrorCode(new Error("refresh_background_only")) });
  if (staleCandidate) return decorate(staleCandidate, "stale", staleSource, { refreshError: publicRefreshErrorCode(new Error("refresh_background_only")) });

  if (options.enqueueOnMiss !== false) {
    scheduleQueuedRefresh(
      ticker,
      options.forceRefresh ? STOCK_REFRESH_PRIORITIES.FORCE_REFRESH : STOCK_REFRESH_PRIORITIES.USER_CHART_MISS,
      options.forceRefresh ? "refresh_background_only" : "snapshot_miss"
    );
  }
  throw new StockDataUnavailableError({
    kind: "chart",
    ticker,
    reason: options.forceRefresh ? "refresh_background_only" : "snapshot_miss",
  });
}

export async function writeSupabaseChartSnapshot(snapshot: StoredChartSnapshot): Promise<void> {
  const config = supabaseAdminConfig();
  if (!config) return;
  await writeSupabaseChartSnapshotWithConfig(config, snapshot);
}

export async function writeSupabaseChartSnapshotWithConfig(config: SupabaseConfig, snapshot: StoredChartSnapshot): Promise<void> {
  const target = normalizeTickerRef(snapshot.ticker);
  const [market, symbol] = target.split(":");
  const response = await fetchWithTimeout(
    `${config.url}/rest/v1/${SUPABASE_TABLE}?on_conflict=ticker,source`,
    {
      method: "POST",
      headers: {
        ...supabaseHeaders(config.key),
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        ticker: target,
        market,
        symbol,
        source: "kis",
        payload: sanitizeSnapshotPayload(snapshot.payload),
        last_bar_date: snapshot.lastBarDate || lastBarDateFromChartPayload(snapshot.payload),
        fetched_at: snapshot.fetchedAt,
        expires_at: snapshot.expiresAt,
        stale_expires_at: snapshot.staleExpiresAt,
      }),
    },
    5_000
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Supabase chart snapshot upsert failed: HTTP ${response.status} ${text.slice(0, 300)}`);
  }
}

export async function chartSnapshotExpiresAt(ticker: string, fetchedAtMs = Date.now()) {
  const { expiresAt, session } = await cacheExpiresAtForMarket(marketFromTicker(ticker), "chart", fetchedAtMs);
  const staleExpiresAt = new Date(Math.max(Date.parse(expiresAt), fetchedAtMs + stockCachePolicyStaleSeconds("chart") * 1000)).toISOString();
  return { expiresAt, staleExpiresAt, session };
}

export function lastBarDateFromChartPayload(payload: ChartPayload): string | undefined {
  const rows = Array.isArray(payload.chart_series) ? payload.chart_series : [];
  for (const row of [...rows].reverse()) {
    if (row && typeof row === "object" && !Array.isArray(row)) {
      const date = (row as Record<string, unknown>).date;
      if (typeof date === "string" && date.trim()) return date.trim();
    }
  }
  return undefined;
}

export function chartResponseCacheHeaders(result: StockChartResult): HeadersInit {
  if (result.payload.ok === false) return { "Cache-Control": "no-store" };
  const seconds =
    result.cache.state === "stale"
      ? 15
      : Math.max(15, Math.min(secondsUntil(result.cache.expiresAt, Date.now(), stockCachePolicyFreshSeconds("chart")), numericEnv("STOCK_CHART_HTTP_CACHE_MAX_SECONDS", 900)));
  return {
    "Cache-Control": `public, max-age=5, s-maxage=${seconds}, stale-while-revalidate=120`,
  };
}

function pruneMemoryCache(nowMs: number) {
  const limit = numericEnv("STOCK_CHART_MEMORY_CACHE_MAX_ENTRIES", 1_000);
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
