import { safeErrorMessage } from "@/lib/errorSafety";
import { fetchWithTimeout, supabaseAdminConfig, supabaseHeaders } from "@/lib/supabaseRest";
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

export async function enqueueStockRefreshJob(input: EnqueueStockRefreshInput): Promise<EnqueueStockRefreshResult> {
  const config = supabaseAdminConfig();
  if (!config) return { queued: false, reason: "missing_supabase_admin_config" };

  const parsed = parseTickerRef(input.ticker);
  const view = input.kind === "score" ? input.view || "detail" : undefined;
  const body = {
    p_kind: input.kind,
    p_market: parsed.market,
    p_symbol: parsed.symbol,
    p_view_mode: view ?? null,
    p_priority: input.priority ?? defaultPriority(input.kind, view),
    p_payload: {
      reason: input.reason || "snapshot_miss",
      requested_ticker: parsed.ticker,
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
      2_500
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

function defaultPriority(kind: StockDataKind, view: ScoreView | undefined): number {
  if (kind === "chart") return 15;
  if (kind === "score" && view === "detail") return 20;
  if (kind === "score" && view === "compare") return 20;
  if (kind === "score" && view === "technical") return 20;
  return 40;
}

function pickJobFields(job: Record<string, unknown>): EnqueuedStockRefreshJob {
  return {
    id: typeof job.id === "string" ? job.id : undefined,
    status: typeof job.status === "string" ? job.status : undefined,
  };
}
