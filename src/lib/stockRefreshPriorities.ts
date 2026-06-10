import type { StockDataKind, StockDataUnavailableReason } from "@/lib/stockDataRuntime";
import type { ScoreView } from "@/lib/stockScoreContract";

export const STOCK_REFRESH_PRIORITIES = {
  FORCE_REFRESH: 1,
  USER_QUOTE_MISS: 5,
  USER_CHART_MISS: 15,
  USER_TECHNICAL_SCORE_MISS: 20,
  USER_DETAIL_SCORE_MISS: 25,
  USER_COMPARE_SCORE_MISS: 30,
  STALE_QUOTE_REFRESH: 50,
  STALE_CHART_REFRESH: 60,
  STALE_SCORE_REFRESH: 70,
} as const;

export function defaultStockRefreshPriority(kind: StockDataKind, view: ScoreView | undefined, reason?: StockDataUnavailableReason): number {
  if (reason === "stale_refresh") {
    if (kind === "quote") return STOCK_REFRESH_PRIORITIES.STALE_QUOTE_REFRESH;
    if (kind === "chart") return STOCK_REFRESH_PRIORITIES.STALE_CHART_REFRESH;
    return STOCK_REFRESH_PRIORITIES.STALE_SCORE_REFRESH;
  }

  if (kind === "quote") return STOCK_REFRESH_PRIORITIES.USER_QUOTE_MISS;
  if (kind === "chart") return STOCK_REFRESH_PRIORITIES.USER_CHART_MISS;
  if (view === "technical") return STOCK_REFRESH_PRIORITIES.USER_TECHNICAL_SCORE_MISS;
  if (view === "compare") return STOCK_REFRESH_PRIORITIES.USER_COMPARE_SCORE_MISS;
  return STOCK_REFRESH_PRIORITIES.USER_DETAIL_SCORE_MISS;
}

export function userScoreRefreshPriority(view: ScoreView, forceRefresh = false): number {
  if (forceRefresh) return STOCK_REFRESH_PRIORITIES.FORCE_REFRESH;
  return defaultStockRefreshPriority("score", view);
}
