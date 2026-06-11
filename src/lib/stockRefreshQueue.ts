import { safeErrorMessage } from "@/lib/errorSafety";
import { defaultStockRefreshPriority } from "@/lib/stockRefreshPriorities";
import type { ScoreView } from "@/lib/stockScoreContract";
import { fetchWithTimeout, layeredNumericEnv, numericEnv, supabaseAdminConfig, supabaseHeaders } from "@/lib/supabaseRest";
import type { StockDataKind, StockDataUnavailableReason } from "@/lib/stockDataRuntime";
import { parseTickerRef } from "@/lib/tickerRef";

export type EnqueueStockRefreshInput = {
  kind: StockDataKind;
  ticker: string;
  view?: ScoreView;
  priority?: number;
  reason?: StockDataUnavailableReason;
};

export type EnqueuedStockRefreshJob = {
  id?: string;
  status?: string;
};

export type EnqueueStockRefreshResult =
  | { queued: true; job?: EnqueuedStockRefreshJob }
  | { queued: false; reason: "missing_supabase_admin_config" | "enqueue_failed" };

declare global {
  var __stockRefreshEnqueueMemory: Map<string, number> | undefined;
}

const enqueueMemory = (globalThis.__stockRefreshEnqueueMemory ??= new Map<string, number>());

export function stockRefreshDedupeKey(input: {
  kind: StockDataKind;
  market: string;
  symbol: string;
  view?: ScoreView;
  reason?: StockDataUnavailableReason;
}): string {
  const viewBucket = input.kind === "score" ? input.view || "detail" : "-";
  const reasonBucket = stockRefreshReasonBucket(input.reason);
  return `${input.kind}:${input.market}:${input.symbol}:${viewBucket}:${reasonBucket}`;
}

export async function enqueueStockRefreshJob(input: EnqueueStockRefreshInput): Promise<EnqueueStockRefreshResult> {
  const config = supabaseAdminConfig();
  if (!config) return { queued: false, reason: "missing_supabase_admin_config" };

  const parsed = parseTickerRef(input.ticker);
  const view = input.kind === "score" ? input.view || "detail" : undefined;
  const reasonBucket = stockRefreshReasonBucket(input.reason);
  const dedupeKey = stockRefreshDedupeKey({
    kind: input.kind,
    market: parsed.market,
    symbol: parsed.symbol,
    view,
    reason: reasonBucket,
  });
  if (recentlyEnqueued(dedupeKey)) {
    return { queued: true, job: { status: "recently_queued" } };
  }
  const body = {
    p_kind: input.kind,
    p_market: parsed.market,
    p_symbol: parsed.symbol,
    p_view_mode: view ?? null,
    p_priority: input.priority ?? defaultStockRefreshPriority(input.kind, view, input.reason),
    p_payload: {
      reason: reasonBucket,
      reason_bucket: reasonBucket,
      requested_ticker: parsed.ticker,
      dedupe_key: dedupeKey,
    },
  };

  try {
    const response = await fetchWithTimeout(
      `${config.url}/rest/v1/rpc/enqueue_stock_refresh_job`,
      {
        method: "POST",
        headers: supabaseHeaders(config.key),
        body: JSON.stringify(body),
      },
      refreshQueueEnqueueTimeoutMs()
    );
    if (!response.ok) {
      console.warn("stock_refresh_enqueue_failed", { ticker: parsed.ticker, kind: input.kind, status: response.status });
      return { queued: false, reason: "enqueue_failed" };
    }

    const job = await response.json().catch(() => undefined);
    rememberEnqueue(dedupeKey);
    return {
      queued: true,
      job: job && typeof job === "object" && !Array.isArray(job) ? pickJobFields(job as Record<string, unknown>) : undefined,
    };
  } catch (error) {
    console.warn("stock_refresh_enqueue_failed", {
      ticker: parsed.ticker,
      kind: input.kind,
      error: safeErrorMessage(error),
    });
    return { queued: false, reason: "enqueue_failed" };
  }
}

export function clearStockRefreshEnqueueMemoryForTests() {
  enqueueMemory.clear();
}

function pickJobFields(job: Record<string, unknown>): EnqueuedStockRefreshJob {
  return {
    id: typeof job.id === "string" ? job.id : undefined,
    status: typeof job.status === "string" ? job.status : undefined,
  };
}

function stockRefreshReasonBucket(reason: StockDataUnavailableReason | undefined): StockDataUnavailableReason {
  return reason || "snapshot_miss";
}

function refreshQueueEnqueueTimeoutMs(): number {
  return layeredNumericEnv("STOCK_REFRESH_QUEUE_ENQUEUE_TIMEOUT_MS", "SUPABASE_RPC_TIMEOUT_MS", 2_500);
}

function enqueueMemoryDedupeMs(): number {
  return Math.max(0, numericEnv("STOCK_REFRESH_ENQUEUE_MEMORY_DEDUPE_SECONDS", 30) * 1000);
}

function recentlyEnqueued(key: string): boolean {
  const ttlMs = enqueueMemoryDedupeMs();
  if (ttlMs <= 0) return false;
  const now = Date.now();
  const expiresAt = enqueueMemory.get(key);
  if (expiresAt && expiresAt > now) return true;
  if (expiresAt) enqueueMemory.delete(key);
  return false;
}

function rememberEnqueue(key: string) {
  const ttlMs = enqueueMemoryDedupeMs();
  if (ttlMs <= 0) return;
  const now = Date.now();
  enqueueMemory.set(key, now + ttlMs);
  pruneEnqueueMemory(now);
}

function pruneEnqueueMemory(now: number) {
  if (enqueueMemory.size < numericEnv("STOCK_REFRESH_ENQUEUE_MEMORY_MAX_ENTRIES", 2_000)) return;
  for (const [key, expiresAt] of enqueueMemory) {
    if (expiresAt <= now) enqueueMemory.delete(key);
  }
}
