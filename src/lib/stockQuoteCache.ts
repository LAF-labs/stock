import { cacheExpiresAtForMarket, marketFromTicker, secondsUntil, type MarketSession } from "@/lib/marketCalendar";
import { publicRefreshErrorCode, safeErrorMessage } from "@/lib/errorSafety";
import { publicVercelCdnCacheHeaders } from "@/lib/httpCacheHeaders";
import { fetchKisQuote, kisQuoteConfigured } from "@/lib/kisQuoteClient";
import { formatCurrencyAmount } from "@/lib/format";
import { getMarketDataServiceQuote, marketDataServiceConfig } from "@/lib/marketDataServiceClient";
import { QUOTE_CACHE_STALE_SECONDS } from "@/lib/quoteContract";
import { StockDataUnavailableError, type StockDataUnavailableReason } from "@/lib/stockDataRuntime";
import { acquireStockRefreshLease, type StockRefreshLeaseResult } from "@/lib/stockRefreshLease";
import { enqueueStockRefreshJob } from "@/lib/stockRefreshQueue";
import { STOCK_REFRESH_PRIORITIES } from "@/lib/stockRefreshPriorities";
import { sanitizeSnapshotPayload } from "@/lib/snapshotPayloadSanitizer";
import { fetchWithTimeout, layeredNumericEnv, numericEnv, supabaseAdminConfig, supabaseReadConfig, supabaseHeaders } from "@/lib/supabaseRest";
import { parseTickerRef } from "@/lib/tickerRef";
import { normalizeTickerRef, statusFromPayload, type StockPayload } from "@/lib/stockSnapshotCache";

export type QuoteCacheState = "fresh" | "stale" | "miss";
export type QuoteCacheSource = "memory" | "supabase" | "market-data";

export type StockQuoteResult = {
  payload: StockPayload;
  cache: {
    state: QuoteCacheState;
    source: QuoteCacheSource;
    ticker: string;
    fetchedAt?: string;
    expiresAt?: string;
    staleExpiresAt?: string;
    refreshStarted?: boolean;
    refreshError?: string;
  };
};

type StoredQuoteSnapshot = {
  ticker: string;
  payload: StockPayload;
  fetchedAt: string;
  expiresAt: string;
  staleExpiresAt?: string;
};

type SupabaseQuoteRow = {
  ticker: string;
  payload: StockPayload;
  fetched_at: string;
  expires_at: string;
  stale_expires_at?: string;
};

declare global {
  var __stockQuoteMemoryCache: Map<string, StoredQuoteSnapshot> | undefined;
  var __stockQuoteInflight: Map<string, Promise<StoredQuoteSnapshot>> | undefined;
}

const SUPABASE_TABLE = "stock_quote_snapshots";

const memoryCache = (globalThis.__stockQuoteMemoryCache ??= new Map<string, StoredQuoteSnapshot>());
const inflightRefreshes = (globalThis.__stockQuoteInflight ??= new Map<string, Promise<StoredQuoteSnapshot>>());

function staleTtlSeconds(): number {
  return numericEnv("STOCK_QUOTE_CACHE_STALE_SECONDS", QUOTE_CACHE_STALE_SECONDS);
}

function isFresh(snapshot: StoredQuoteSnapshot, nowMs: number): boolean {
  return Date.parse(snapshot.expiresAt) > nowMs;
}

function isServeableStale(snapshot: StoredQuoteSnapshot, nowMs: number): boolean {
  const staleExpiresAt = Date.parse(snapshot.staleExpiresAt || "");
  if (Number.isFinite(staleExpiresAt)) return staleExpiresAt > nowMs;
  const fetchedAt = Date.parse(snapshot.fetchedAt);
  return Number.isFinite(fetchedAt) && fetchedAt + staleTtlSeconds() * 1000 > nowMs;
}

async function readSupabaseSnapshot(ticker: string): Promise<StoredQuoteSnapshot | undefined> {
  const config = supabaseReadConfig();
  if (!config) return undefined;

  try {
    const url = `${config.url}/rest/v1/${SUPABASE_TABLE}?ticker=eq.${encodeURIComponent(ticker)}&select=ticker,payload,fetched_at,expires_at,stale_expires_at&limit=1`;
    const response = await fetchWithTimeout(url, { headers: supabaseHeaders(config.key), cache: "no-store" }, quoteSupabaseReadTimeoutMs());
    if (!response.ok) return undefined;
    const rows = (await response.json()) as SupabaseQuoteRow[];
    const row = rows[0];
    if (!row?.payload) return undefined;
    return {
      ticker: row.ticker,
      payload: row.payload,
      fetchedAt: row.fetched_at,
      expiresAt: row.expires_at,
      staleExpiresAt: row.stale_expires_at,
    };
  } catch {
    return undefined;
  }
}

async function writeSupabaseSnapshot(snapshot: StoredQuoteSnapshot): Promise<void> {
  const config = supabaseAdminConfig();
  if (!config) return;

  try {
    const target = parseTickerRef(snapshot.ticker);
    const response = await fetchWithTimeout(
      `${config.url}/rest/v1/${SUPABASE_TABLE}?on_conflict=ticker`,
      {
        method: "POST",
        headers: {
          ...supabaseHeaders(config.key),
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify({
          ticker: snapshot.ticker,
          market: target.market,
          symbol: target.symbol,
          source: "kis",
          payload: sanitizeSnapshotPayload(snapshot.payload),
          fetched_at: snapshot.fetchedAt,
          expires_at: snapshot.expiresAt,
          stale_expires_at: snapshot.staleExpiresAt || fallbackStaleExpiresAt(snapshot.fetchedAt, snapshot.expiresAt),
        }),
      },
      quoteSupabaseWriteTimeoutMs()
    );
    if (!response.ok) {
      console.warn("stock_quote_cache_write_failed", { ticker: snapshot.ticker, status: response.status });
    }
  } catch (error) {
    // Quote cache writes are best effort.
    console.warn("stock_quote_cache_write_failed", { ticker: snapshot.ticker, error: safeErrorMessage(error) });
  }
}

async function collectLiveQuotePayload(ticker: string): Promise<StockPayload> {
  if (kisQuoteConfigured()) {
    return fetchKisQuote(ticker);
  }

  throw new StockDataUnavailableError({
    kind: "quote",
    ticker,
    reason: "refresh_background_only",
  });
}

async function refreshQuoteSnapshot(
  ticker: string,
  options: { fallbackSnapshot?: StoredQuoteSnapshot; unavailableReason?: StockDataUnavailableReason } = {}
): Promise<{ snapshot: StoredQuoteSnapshot; refreshed: boolean; lease?: StockRefreshLeaseResult }> {
  const existing = inflightRefreshes.get(ticker);
  if (existing) return { snapshot: await existing, refreshed: true };

  const promise = (async () => {
    const lease = await acquireStockRefreshLease({
      kind: "quote",
      ticker,
      lockSeconds: numericEnv("STOCK_QUOTE_REFRESH_LEASE_SECONDS", 30),
    });

    if (!lease.acquired) {
      if (options.fallbackSnapshot) {
        return { snapshot: options.fallbackSnapshot, refreshed: false, lease };
      }
      throw new StockDataUnavailableError({
        kind: "quote",
        ticker,
        reason: options.unavailableReason || "snapshot_miss",
      });
    }

    if (!kisQuoteConfigured()) {
      throw new StockDataUnavailableError({
        kind: "quote",
        ticker,
        reason: options.unavailableReason || "snapshot_miss",
      });
    }

    const payload = await collectLiveQuotePayload(ticker);
    const nowMs = Date.now();
    const market = payload.market === "KR" || payload.market === "US" ? payload.market : marketFromTicker(ticker);
    const { expiresAt, session } = await cacheExpiresAtForMarket(market, "quote", nowMs);
    const fetchedAt = new Date(nowMs).toISOString();
    const staleExpiresAt = fallbackStaleExpiresAt(fetchedAt, expiresAt);
    const snapshot: StoredQuoteSnapshot = {
      ticker,
      payload: normalizeQuotePayloadLabels({
        ...payload,
        market_session: session,
      }),
      fetchedAt,
      expiresAt,
      staleExpiresAt,
    };

    if (payload.ok !== false) {
      memoryCache.set(ticker, snapshot);
      pruneMemoryCache(nowMs);
      await writeSupabaseSnapshot(snapshot);
    }

    return { snapshot, refreshed: true, lease };
  })();

  const snapshotPromise = promise.then((result) => result.snapshot);
  void snapshotPromise.catch(() => undefined);
  inflightRefreshes.set(ticker, snapshotPromise);
  try {
    return await promise;
  } finally {
    inflightRefreshes.delete(ticker);
  }
}

function decorate(
  snapshot: StoredQuoteSnapshot,
  state: QuoteCacheState,
  source: QuoteCacheSource,
  extra?: { refreshStarted?: boolean; refreshError?: string }
): StockQuoteResult {
  const serverCache = {
    state,
    source,
    ticker: snapshot.ticker,
    fetched_at: snapshot.fetchedAt,
    expires_at: snapshot.expiresAt,
    stale_expires_at: snapshot.staleExpiresAt,
    refresh_started: extra?.refreshStarted,
    refresh_error: extra?.refreshError,
  };

  return {
    payload: {
      ...normalizeQuotePayloadLabels(snapshot.payload),
      server_cache: serverCache,
    },
    cache: {
      state,
      source,
      ticker: snapshot.ticker,
      fetchedAt: snapshot.fetchedAt,
      expiresAt: snapshot.expiresAt,
      staleExpiresAt: snapshot.staleExpiresAt,
      refreshStarted: extra?.refreshStarted,
      refreshError: extra?.refreshError,
    },
  };
}

function fallbackStaleExpiresAt(fetchedAt: string, expiresAt: string): string {
  const fetchedAtMs = Date.parse(fetchedAt);
  const expiresAtMs = Date.parse(expiresAt);
  const staleExpiresAtMs = Number.isFinite(fetchedAtMs) ? fetchedAtMs + staleTtlSeconds() * 1000 : NaN;
  const fallbackMs = Math.max(Number.isFinite(expiresAtMs) ? expiresAtMs : 0, Number.isFinite(staleExpiresAtMs) ? staleExpiresAtMs : 0);
  return new Date(fallbackMs || Date.now()).toISOString();
}

function quoteSupabaseReadTimeoutMs(): number {
  return layeredNumericEnv("STOCK_QUOTE_SUPABASE_READ_TIMEOUT_MS", "SUPABASE_READ_TIMEOUT_MS", 1_500);
}

function quoteSupabaseWriteTimeoutMs(): number {
  return layeredNumericEnv("STOCK_QUOTE_SUPABASE_WRITE_TIMEOUT_MS", "SUPABASE_WRITE_TIMEOUT_MS", 5_000);
}

function scheduleQueuedRefresh(ticker: string, priority: number, reason: StockDataUnavailableReason) {
  void enqueueStockRefreshJob({ kind: "quote", ticker, priority, reason }).catch(() => undefined);
}

function scheduleInlineRefresh(ticker: string, fallbackSnapshot: StoredQuoteSnapshot) {
  void (async () => {
    const marketDataResult = await getMarketDataServiceQuote(ticker, { forceRefresh: true });
    if (marketDataResult) return;
    await refreshQuoteSnapshot(ticker, {
      fallbackSnapshot,
      unavailableReason: "stale_refresh",
    });
  })().catch(() => undefined);
}

function inlineQuoteRefreshAvailable(): boolean {
  return kisQuoteConfigured() || !!marketDataServiceConfig();
}

export async function getStockQuote(tickerRef: string, options: { forceRefresh?: boolean } = {}): Promise<StockQuoteResult> {
  const ticker = normalizeTickerRef(tickerRef);
  const nowMs = Date.now();
  let freshCandidate: StoredQuoteSnapshot | undefined;
  let freshSource: QuoteCacheSource = "memory";
  let staleCandidate: StoredQuoteSnapshot | undefined;
  let staleSource: QuoteCacheSource = "memory";

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
      memoryCache.set(ticker, dbSnapshot);
      freshCandidate = dbSnapshot;
      freshSource = "supabase";
    }
    if (dbSnapshot && isServeableStale(dbSnapshot, nowMs)) {
      staleCandidate = dbSnapshot;
      staleSource = "supabase";
    }
  }

  if (!options.forceRefresh && freshCandidate) {
    return decorate(freshCandidate, "fresh", freshSource);
  }

  if (!options.forceRefresh) {
    if (staleCandidate) {
      memoryCache.set(ticker, staleCandidate);
      if (inlineQuoteRefreshAvailable()) {
        scheduleInlineRefresh(ticker, staleCandidate);
      } else {
        scheduleQueuedRefresh(ticker, STOCK_REFRESH_PRIORITIES.STALE_QUOTE_REFRESH, "stale_refresh");
      }
      return decorate(staleCandidate, "stale", staleSource, { refreshStarted: true });
    }
  }

  try {
    const marketDataResult = await getMarketDataServiceQuote(ticker, { forceRefresh: options.forceRefresh });
    if (marketDataResult) return normalizeStockQuoteResult(marketDataResult);

    if (!inlineQuoteRefreshAvailable()) {
      throw new StockDataUnavailableError({
        kind: "quote",
        ticker,
        reason: options.forceRefresh ? "refresh_background_only" : "snapshot_miss",
      });
    }

    const fallbackSnapshot = freshCandidate || staleCandidate;
    const refreshed = await refreshQuoteSnapshot(ticker, {
      fallbackSnapshot,
      unavailableReason: options.forceRefresh ? "refresh_background_only" : "snapshot_miss",
    });

    if (!refreshed.refreshed) {
      const state = freshCandidate && refreshed.snapshot === freshCandidate ? "fresh" : "stale";
      const source = freshCandidate && refreshed.snapshot === freshCandidate ? freshSource : staleSource;
      return decorate(refreshed.snapshot, state, source, { refreshStarted: true });
    }

    return decorate(refreshed.snapshot, "miss", "market-data");
  } catch (error) {
    if (freshCandidate) {
      return decorate(freshCandidate, "fresh", freshSource, {
        refreshError: publicRefreshErrorCode(error),
      });
    }
    if (staleCandidate) {
      return decorate(staleCandidate, "stale", staleSource, {
        refreshError: publicRefreshErrorCode(error),
      });
    }
    throw error;
  }
}

function normalizeStockQuoteResult(result: StockQuoteResult): StockQuoteResult {
  return {
    ...result,
    payload: normalizeQuotePayloadLabels(result.payload),
  };
}

function normalizeQuotePayloadLabels(payload: StockPayload): StockPayload {
  if (payload.ok === false) return payload;
  const latestPrice = numberValue(payload.latest_price);
  const currency = quoteCurrency(payload);
  const usdKrwRate = numberValue(payload.usd_krw_rate);
  return {
    ...payload,
    ...(latestPrice === undefined ? {} : { latest_price_label: formatCurrencyAmount(latestPrice, currency) }),
    ...(currency === "USD" && usdKrwRate !== undefined ? { usd_krw_label: `$1 = 약 ${formatCurrencyAmount(usdKrwRate, "KRW")}` } : {}),
  };
}

function quoteCurrency(payload: StockPayload): string {
  const currency = stringValue(payload.currency);
  if (currency) return currency;
  return payload.market === "KR" ? "KRW" : "USD";
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function quoteResponseCacheHeaders(result: StockQuoteResult): HeadersInit {
  if (result.payload.ok === false) {
    return { "Cache-Control": "no-store" };
  }

  return {
    ...publicVercelCdnCacheHeaders({
      sMaxAgeSeconds: Math.max(15, Math.min(secondsUntil(result.cache.expiresAt), numericEnv("STOCK_QUOTE_HTTP_CACHE_MAX_SECONDS", 300))),
      staleWhileRevalidateSeconds: numericEnv("STOCK_QUOTE_HTTP_STALE_WHILE_REVALIDATE_SECONDS", 60),
      staleIfErrorSeconds: numericEnv("STOCK_QUOTE_HTTP_STALE_IF_ERROR_SECONDS", 300),
    }),
    "X-Quote-Cache-Seconds": String(secondsUntil(result.cache.expiresAt)),
  };
}

function pruneMemoryCache(nowMs: number) {
  const limit = numericEnv("STOCK_QUOTE_MEMORY_CACHE_MAX_ENTRIES", 2_000);
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

export function quoteStatusFromPayload(payload: StockPayload): number {
  return statusFromPayload(payload);
}

export type { MarketSession };
