import { safeErrorMessage } from "@/lib/errorSafety";
import { enqueueStockPendingPayload, type StockPendingInput } from "@/lib/stockPendingResponse";
import { isStockDataUnavailableError } from "@/lib/stockDataRuntime";
import type { StockScoreResult } from "@/lib/stockSnapshotCache";
import { numericEnv } from "@/lib/supabaseRest";

export type SettledStockScoreResult =
  | { status: "fulfilled"; value: StockScoreResult }
  | { status: "rejected"; error: unknown };

export type TimedStockScoreResult = SettledStockScoreResult | { status: "timeout" };

const DEFAULT_INTERACTIVE_SCORE_TIMEOUT_MS = 4_000;
const DEFAULT_INTERACTIVE_TECHNICAL_SCORE_TIMEOUT_MS = 4_000;

export function settleStockScore(promise: Promise<StockScoreResult>): Promise<SettledStockScoreResult> {
  return promise.then(
    (value) => ({ status: "fulfilled", value }),
    (error: unknown) => ({ status: "rejected", error })
  );
}

export async function waitForPartialStockScore(
  settledPromise: Promise<SettledStockScoreResult>,
  options: { view?: string; timeoutMs?: number } = {}
): Promise<TimedStockScoreResult> {
  const timeoutMs = options.timeoutMs ?? partialStockScoreTimeoutMs(options.view);
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

export function partialStockScoreTimeoutMs(view?: string): number {
  if (view === "technical") {
    const generic = process.env.STOCK_PENDING_PARTIAL_SCORE_TIMEOUT_MS;
    if (generic !== undefined && generic.trim()) return numericEnv("STOCK_PENDING_PARTIAL_SCORE_TIMEOUT_MS", DEFAULT_INTERACTIVE_SCORE_TIMEOUT_MS);
    return numericEnv("STOCK_PENDING_PARTIAL_TECHNICAL_SCORE_TIMEOUT_MS", DEFAULT_INTERACTIVE_TECHNICAL_SCORE_TIMEOUT_MS);
  }
  return numericEnv("STOCK_PENDING_PARTIAL_SCORE_TIMEOUT_MS", DEFAULT_INTERACTIVE_SCORE_TIMEOUT_MS);
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
