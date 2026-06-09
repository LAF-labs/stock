import { safeErrorMessage } from "@/lib/errorSafety";
import { defaultStockRefreshPriority } from "@/lib/stockRefreshPriorities";
import { fetchWithTimeout, layeredNumericEnv, supabaseAdminConfig, supabaseHeaders } from "@/lib/supabaseRest";
import type { ScoreView } from "@/lib/stockSnapshotCache";
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
      dedupe_key: stockRefreshDedupeKey({
        kind: input.kind,
        market: parsed.market,
        symbol: parsed.symbol,
        view,
        reason: reasonBucket,
      }),
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
