import { STOCK_RULE_JUDGMENT_PROMPT_VERSION } from "@/lib/judgmentCache";

export const stockQueryKeys = {
  all: ["stock"] as const,
  display: (ticker: string, view: "detail" | "compare" | "technical") => ["stock", "display", view, ticker] as const,
  detailView: (ticker: string, view: "detail" | "compare" | "technical") => ["stock", "detail-view", view, ticker] as const,
  score: (ticker: string, view: "detail" | "compare" | "technical") => ["stock", "score", view, ticker] as const,
  quote: (ticker: string) => ["stock", "quote", ticker] as const,
  compare: (tickers: readonly string[]) => ["stock", "compare", tickers.join(",")] as const,
  symbols: (query: string, market?: string) => ["stock", "symbols", market || "all", query.trim()] as const,
  judgment: (ticker: string, scoreVersion: string, inputHash: string, promptVersion = STOCK_RULE_JUDGMENT_PROMPT_VERSION) =>
    ["stock", "judgment", ticker, scoreVersion, promptVersion, inputHash] as const,
};
