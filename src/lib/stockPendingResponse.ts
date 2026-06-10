import { NextResponse } from "next/server";
import { stockPartialResponseCacheHeaders as stockPartialResponseCacheHeadersFromPolicy } from "@/lib/httpCacheHeaders";
import { privateNoStoreHeaders } from "@/lib/refreshCooldown";
import {
  stockDataPendingPayload,
  type StockDataKind,
  type StockDataPendingPayload,
  type StockDataScoreView,
  type StockDataUnavailableReason,
} from "@/lib/stockDataRuntime";
import { enqueueStockRefreshJob, type EnqueueStockRefreshResult } from "@/lib/stockRefreshQueue";

export type StockPendingInput = {
  kind: StockDataKind;
  ticker: string;
  reason: StockDataUnavailableReason;
  priority: number;
  view?: StockDataScoreView;
};

export type StockRefreshQueueUnavailablePayload = Omit<StockDataPendingPayload, "error" | "message"> & {
  error: "refresh_queue_unavailable";
  message: string;
};

export type StockPendingPayload = StockDataPendingPayload | StockRefreshQueueUnavailablePayload;

export function optimisticStockPendingPayload(input: StockPendingInput): StockDataPendingPayload {
  return stockDataPendingPayload({
    kind: input.kind,
    ticker: input.ticker,
    view: input.view,
    reason: input.reason,
    refreshRequest: { queued: true, status: "queued" },
  });
}

export async function enqueueStockPendingPayload(input: StockPendingInput): Promise<StockPendingPayload> {
  const refreshRequest = await enqueueStockRefreshJob({
    kind: input.kind,
    ticker: input.ticker,
    view: input.view,
    priority: input.priority,
    reason: input.reason,
  });
  const publicRefreshRequest = publicRefreshRequestFromResult(refreshRequest);
  const payload = stockDataPendingPayload({
    kind: input.kind,
    ticker: input.ticker,
    view: input.view,
    reason: input.reason,
    refreshRequest: publicRefreshRequest,
  });

  return publicRefreshRequest.queued
    ? payload
    : {
        ...payload,
        error: "refresh_queue_unavailable",
        message: "Stock refresh queue is unavailable.",
      };
}

export function stockPendingJsonResponse(payload: StockPendingPayload): NextResponse {
  return NextResponse.json(payload, {
    status: payload.error === "snapshot_pending" ? 202 : 503,
    headers: stockPendingHeaders(payload),
  });
}

export function stockPendingHeaders(payload: StockPendingPayload): HeadersInit {
  if (payload.error !== "snapshot_pending") return privateNoStoreHeaders();
  return {
    ...privateNoStoreHeaders(),
    "Retry-After": String(payload.retry_after_seconds),
  };
}

export function stockPartialResponseCacheHeaders(): HeadersInit {
  return stockPartialResponseCacheHeadersFromPolicy();
}

function publicRefreshRequestFromResult(refreshRequest: EnqueueStockRefreshResult): StockDataPendingPayload["refresh_request"] {
  return refreshRequest.queued
    ? {
        queued: true,
        job_id: refreshRequest.job?.id,
        status: refreshRequest.job?.status,
      }
    : {
        queued: false,
        reason: refreshRequest.reason,
      };
}
