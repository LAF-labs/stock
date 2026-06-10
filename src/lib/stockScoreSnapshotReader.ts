import { stockCachePolicyStaleSeconds } from "@/lib/stockCachePolicy";
import {
  isCurrentScoreSnapshot,
  stockScoreCacheKey,
  type CacheSource,
  type ScoreView,
  type StockScoreResult,
  type StoredScoreSnapshot,
} from "@/lib/stockScoreContract";
import { fetchWithTimeout, layeredNumericEnv, numericEnv, supabaseHeaders, supabaseReadConfig } from "@/lib/supabaseRest";
import { normalizeTickerRef } from "@/lib/tickerRef";

type SupabaseSnapshotRow = {
  ticker: string;
  view_mode: ScoreView;
  payload: Record<string, unknown>;
  fetched_at: string;
  expires_at: string;
};

const SUPABASE_TABLE = "stock_score_snapshots";
const memoryCache = (globalThis.__stockScoreMemoryCache ??= new Map<string, StoredScoreSnapshot>());

export async function readStockScoreSnapshotForDisplay(tickerRef: string, view: ScoreView): Promise<StockScoreResult | undefined> {
  const ticker = normalizeTickerRef(tickerRef);
  const nowMs = Date.now();
  const key = stockScoreCacheKey(ticker, view);

  const memorySnapshot = memoryCache.get(key);
  if (memorySnapshot && isFresh(memorySnapshot, nowMs)) return decorate(memorySnapshot, "fresh", "memory");
  if (memorySnapshot && isServeableStale(memorySnapshot, nowMs)) return decorate(memorySnapshot, "stale", "memory");

  const dbSnapshot = await readSupabaseSnapshot(ticker, view);
  if (!dbSnapshot) return undefined;
  if (isFresh(dbSnapshot, nowMs)) {
    rememberMemorySnapshot(key, dbSnapshot, nowMs);
    return decorate(dbSnapshot, "fresh", "supabase");
  }
  if (isServeableStale(dbSnapshot, nowMs)) {
    rememberMemorySnapshot(key, dbSnapshot, nowMs);
    return decorate(dbSnapshot, "stale", "supabase");
  }
  return undefined;
}

async function readSupabaseSnapshot(ticker: string, view: ScoreView): Promise<StoredScoreSnapshot | undefined> {
  const config = supabaseReadConfig();
  if (!config) return undefined;

  try {
    const url = `${config.url}/rest/v1/${SUPABASE_TABLE}?ticker=eq.${encodeURIComponent(ticker)}&view_mode=eq.${view}&select=ticker,view_mode,payload,fetched_at,expires_at&limit=1`;
    const response = await fetchWithTimeout(url, { headers: supabaseHeaders(config.key), cache: "no-store" }, scoreDisplaySnapshotReadTimeoutMs());
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

function isFresh(snapshot: StoredScoreSnapshot, nowMs: number): boolean {
  return isCurrentScoreSnapshot(snapshot) && Date.parse(snapshot.expiresAt) > nowMs;
}

function isServeableStale(snapshot: StoredScoreSnapshot, nowMs: number): boolean {
  if (!isCurrentScoreSnapshot(snapshot)) return false;
  const fetchedAt = Date.parse(snapshot.fetchedAt);
  return Number.isFinite(fetchedAt) && fetchedAt + staleTtlSeconds(snapshot.view) * 1000 > nowMs;
}

function staleTtlSeconds(view: ScoreView): number {
  const policyDefault = view === "technical" ? stockCachePolicyStaleSeconds("technical") : stockCachePolicyStaleSeconds("score");
  return numericEnv("STOCK_SCORE_CACHE_STALE_SECONDS", policyDefault);
}

function decorate(snapshot: StoredScoreSnapshot, state: "fresh" | "stale", source: CacheSource): StockScoreResult {
  const serverCache = {
    state,
    source,
    ticker: snapshot.ticker,
    view: snapshot.view,
    fetched_at: snapshot.fetchedAt,
    expires_at: snapshot.expiresAt,
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
      refreshStarted: false,
    },
  };
}

function rememberMemorySnapshot(key: string, snapshot: StoredScoreSnapshot, nowMs: number) {
  memoryCache.set(key, snapshot);
  pruneMemoryCache(nowMs);
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

function scoreDisplaySnapshotReadTimeoutMs(): number {
  return layeredNumericEnv("STOCK_DISPLAY_SCORE_SNAPSHOT_READ_TIMEOUT_MS", "STOCK_SCORE_SUPABASE_READ_TIMEOUT_MS", 1_000);
}
