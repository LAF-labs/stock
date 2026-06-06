import { NextResponse } from "next/server";
import { privateNoStoreHeaders } from "@/lib/refreshCooldown";
import {
  stockDataPendingPayload,
  type StockDataKind,
  type StockDataPendingPayload,
  type StockDataUnavailableReason,
} from "@/lib/stockDataRuntime";
import { enqueueStockRefreshJob, type EnqueueStockRefreshResult } from "@/lib/stockRefreshQueue";

type ScoreView = "detail" | "compare";

export type StockPendingInput = {
  kind: StockDataKind;
  ticker: string;
  reason: StockDataUnavailableReason;
  priority: number;
  view?: ScoreView;
};

export async function enqueueStockPendingPayload(input: StockPendingInput): Promise<StockDataPendingPayload> {
  const refreshRequest = await enqueueStockRefreshJob({
    kind: input.kind,
    ticker: input.ticker,
    view: input.view,
    priority: input.priority,
    reason: input.reason,
  });

  return stockDataPendingPayload({
    kind: input.kind,
    ticker: input.ticker,
    view: input.view,
    reason: input.reason,
    refreshRequest: publicRefreshRequest(refreshRequest),
  });
}

export function stockPendingJsonResponse(payload: StockDataPendingPayload): NextResponse {
  return NextResponse.json(payload, {
    status: 202,
    headers: stockPendingHeaders(payload),
  });
}

export function stockPendingHeaders(payload: StockDataPendingPayload): HeadersInit {
  return {
    ...privateNoStoreHeaders(),
    "Retry-After": String(payload.retry_after_seconds),
  };
}

function publicRefreshRequest(refreshRequest: EnqueueStockRefreshResult): StockDataPendingPayload["refresh_request"] {
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
