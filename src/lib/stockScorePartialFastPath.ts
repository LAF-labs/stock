import { safeErrorMessage } from "@/lib/errorSafety";
import { enqueueStockPendingPayload, type StockPendingInput } from "@/lib/stockPendingResponse";
import { isStockDataUnavailableError } from "@/lib/stockDataRuntime";
import type { StockScoreResult } from "@/lib/stockSnapshotCache";
import { numericEnv } from "@/lib/supabaseRest";

export type SettledStockScoreResult =
  | { status: "fulfilled"; value: StockScoreResult }
  | { status: "rejected"; error: unknown };

export type TimedStockScoreResult = SettledStockScoreResult | { status: "timeout" };

export function settleStockScore(promise: Promise<StockScoreResult>): Promise<SettledStockScoreResult> {
  return promise.then(
    (value) => ({ status: "fulfilled", value }),
    (error: unknown) => ({ status: "rejected", error })
  );
}

export async function waitForPartialStockScore(settledPromise: Promise<SettledStockScoreResult>): Promise<TimedStockScoreResult> {
  const timeoutMs = numericEnv("STOCK_PENDING_PARTIAL_SCORE_TIMEOUT_MS", 900);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      settledPromise,
      new Promise<{ status: "timeout" }>((resolve) => {
        timeout = setTimeout(() => resolve({ status: "timeout" }), timeoutMs);
        unrefTimer(timeout);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function enqueueScoreRefreshAfterUnavailable(
  settledPromise: Promise<SettledStockScoreResult>,
  input: StockPendingInput,
  context: { ticker: string; view?: string }
) {
  void settledPromise
    .then(async (settled) => {
      if (settled.status !== "rejected") return;
      if (isStockDataUnavailableError(settled.error)) {
        await enqueueStockPendingPayload({
          ...input,
          reason: settled.error.payload.reason,
        });
        return;
      }
      console.warn("stock_partial_score_timeout_unavailable", {
        ticker: context.ticker,
        view: context.view,
        error: safeErrorMessage(settled.error),
      });
    })
    .catch(() => undefined);
}

function unrefTimer(timeout: ReturnType<typeof setTimeout>) {
  if (typeof timeout === "object" && timeout && "unref" in timeout && typeof timeout.unref === "function") {
    timeout.unref();
  }
}
