export const STOCK_SCORE_BATCH_MAX_TICKERS = 5;

export function stockScoreBatchConcurrency(env: Record<string, string | undefined> = process.env): number {
  const parsed = Number(env.STOCK_SCORE_BATCH_CONCURRENCY);
  const value = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : STOCK_SCORE_BATCH_MAX_TICKERS;
  return Math.max(1, Math.min(STOCK_SCORE_BATCH_MAX_TICKERS, value));
}
