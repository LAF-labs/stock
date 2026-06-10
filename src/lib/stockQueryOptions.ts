import { queryOptions } from "@tanstack/react-query";
import { STOCK_QUERY_CACHE_MAX_AGE_MS } from "@/components/QueryProvider";
import { stockCachePolicyFreshSeconds } from "@/lib/stockCachePolicy";
import { fetchCompareScores, fetchStockQuote, fetchStockScore, fetchSymbols, fetchTechnicalScore, postJudgment } from "@/lib/stockQueryFns";
import { stockQueryKeys } from "@/lib/stockQueryKeys";
import { cleanTickerSymbol, resolveTickerAlias } from "@/lib/tickerRef";
import type {
  ApiPartial,
  ApiPending,
  CompareQueryResult,
  JudgmentQueryResult,
  QuoteQueryResult,
  QuoteRefreshMutationResult,
  ScoreQueryResult,
  StockScoreView,
  SymbolSearchQueryResult,
  TechnicalScoreQueryResult,
} from "@/lib/stockQueryTypes";
import type { ClientApiPayload } from "@/lib/clientApi";
import type { StockQuoteResponse, StockScoreResponse } from "@/lib/types";

export const STOCK_QUERY_MAX_PENDING_POLLS = 24;
export const STOCK_QUERY_PENDING_BACKOFF_SECONDS = [1, 2, 3, 5, 8, 13, 21, 34, 55, 60] as const;
export const STOCK_SYMBOL_SEARCH_STALE_TIME_MS = 24 * 60 * 60 * 1000;

export const stockQueryStaleTimesMs = {
  quote: stockCachePolicyFreshSeconds("quote") * 1000,
  score: stockCachePolicyFreshSeconds("score") * 1000,
  technical: stockCachePolicyFreshSeconds("technical") * 1000,
  judgment: stockCachePolicyFreshSeconds("judgment") * 1000,
  symbols: STOCK_SYMBOL_SEARCH_STALE_TIME_MS,
} as const;

export function scoreQueryOptions(ticker: string, view: StockScoreView = "detail") {
  return queryOptions({
    queryKey: stockQueryKeys.score(ticker, view),
    queryFn: ({ signal }) => fetchStockScore({ ticker, view, signal }),
    staleTime: view === "technical" ? stockQueryStaleTimesMs.technical : stockQueryStaleTimesMs.score,
    gcTime: STOCK_QUERY_CACHE_MAX_AGE_MS,
    refetchOnMount: (query) => stockQueryRefetchOnMount(query.state.data as ScoreQueryResult | undefined),
    refetchInterval: (query) => stockQueryRefetchIntervalMs(query.state.data as ScoreQueryResult | undefined, query.state.dataUpdateCount, view),
    meta: { feature: "stock-score", view, maxPendingPolls: STOCK_QUERY_MAX_PENDING_POLLS },
  });
}

export function technicalScoreQueryOptions(ticker: string) {
  return queryOptions({
    queryKey: stockQueryKeys.score(ticker, "technical"),
    queryFn: ({ signal }) => fetchTechnicalScore(ticker, signal),
    staleTime: stockQueryStaleTimesMs.technical,
    gcTime: STOCK_QUERY_CACHE_MAX_AGE_MS,
    refetchOnMount: (query) => stockQueryRefetchOnMount(query.state.data as TechnicalScoreQueryResult | undefined),
    refetchInterval: (query) => stockQueryRefetchIntervalMs(query.state.data as TechnicalScoreQueryResult | undefined, query.state.dataUpdateCount, "technical"),
    meta: { feature: "stock-score", view: "technical", maxPendingPolls: STOCK_QUERY_MAX_PENDING_POLLS },
  });
}

export function quoteQueryOptions(ticker: string) {
  return queryOptions({
    queryKey: stockQueryKeys.quote(ticker),
    queryFn: ({ signal }) => fetchStockQuote(ticker, signal),
    staleTime: stockQueryStaleTimesMs.quote,
    gcTime: STOCK_QUERY_CACHE_MAX_AGE_MS,
    refetchOnMount: (query) => stockQueryRefetchOnMount(query.state.data as QuoteQueryResult | undefined),
    refetchInterval: (query) => stockQueryRefetchIntervalMs(query.state.data as QuoteQueryResult | undefined, query.state.dataUpdateCount, "detail"),
    meta: { feature: "stock-quote", maxPendingPolls: STOCK_QUERY_MAX_PENDING_POLLS },
  });
}

export function compareQueryOptions(tickers: readonly string[]) {
  return queryOptions({
    queryKey: stockQueryKeys.compare(tickers),
    queryFn: ({ signal }) => fetchCompareScores(tickers, signal),
    staleTime: stockQueryStaleTimesMs.score,
    gcTime: STOCK_QUERY_CACHE_MAX_AGE_MS,
    enabled: tickers.length > 0,
    refetchOnMount: (query) => stockQueryRefetchOnMount(query.state.data as CompareQueryResult | undefined),
    refetchInterval: (query) => stockQueryRefetchIntervalMs(query.state.data as CompareQueryResult | undefined, query.state.dataUpdateCount, "compare"),
    meta: { feature: "stock-compare", view: "compare", maxPendingPolls: STOCK_QUERY_MAX_PENDING_POLLS },
  });
}

export function symbolSearchQueryOptions(query: string, market?: string) {
  const trimmed = query.trim();
  return queryOptions({
    queryKey: stockQueryKeys.symbols(trimmed, market),
    queryFn: ({ signal }) => fetchSymbols({ query: trimmed, market, signal }),
    staleTime: stockQueryStaleTimesMs.symbols,
    gcTime: STOCK_QUERY_CACHE_MAX_AGE_MS,
    enabled: shouldEnableSymbolSearch(trimmed),
    meta: { feature: "symbol-search", market: market || "all" },
  });
}

export function judgmentQueryOptions({
  ticker,
  scoreVersion,
  inputHash,
  payload,
}: {
  ticker: string;
  scoreVersion: string;
  inputHash: string;
  payload: Record<string, unknown> | undefined;
}) {
  return queryOptions({
    queryKey: stockQueryKeys.judgment(ticker, scoreVersion, inputHash),
    queryFn: ({ signal }) => postJudgment(payload || {}, signal),
    staleTime: stockQueryStaleTimesMs.judgment,
    gcTime: STOCK_QUERY_CACHE_MAX_AGE_MS,
    enabled: Boolean(ticker && scoreVersion && inputHash && payload),
    meta: { feature: "stock-judgment" },
  });
}

export function shouldEnableSymbolSearch(query: string): boolean {
  return query.trim().length >= 2;
}

export function stockPendingRetryDelayMs(attempt = 0): number {
  const safeAttempt = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  const seconds = STOCK_QUERY_PENDING_BACKOFF_SECONDS[Math.min(safeAttempt, STOCK_QUERY_PENDING_BACKOFF_SECONDS.length - 1)] ?? 60;
  return seconds * 1000;
}

export function stockQueryRefetchIntervalMs(
  result: ScoreQueryResult | TechnicalScoreQueryResult | QuoteQueryResult | CompareQueryResult | JudgmentQueryResult | SymbolSearchQueryResult | undefined,
  attempt = 0,
  view: StockScoreView = "detail",
): number | false {
  if (!stockQueryShouldPoll(result)) return false;
  if (attempt >= STOCK_QUERY_MAX_PENDING_POLLS) return false;
  void view;
  return stockPendingRetryDelayMs(attempt);
}

export function stockQueryShouldPoll(
  result: ScoreQueryResult | TechnicalScoreQueryResult | QuoteQueryResult | CompareQueryResult | JudgmentQueryResult | SymbolSearchQueryResult | undefined,
): boolean {
  if (!result) return false;
  if ("results" in result) {
    return result.results.some(({ result: itemResult }) => {
      if (itemResult.state === "pending" || itemResult.state === "partial") return true;
      return false;
    });
  }
  if (result.state === "pending") return isPollablePending(result);
  if (result.state === "partial") return isPollablePending(result.pending);
  if (result.state === "unsupported" || result.state === "ready") return false;
  return false;
}

export function stockQueryRefetchOnMount(
  result: ScoreQueryResult | TechnicalScoreQueryResult | QuoteQueryResult | CompareQueryResult | JudgmentQueryResult | SymbolSearchQueryResult | undefined,
): boolean | "always" {
  if (!result) return true;
  if (result.state === "ready") return true;
  if (result.state === "unsupported") return false;
  return "always";
}

export function quoteDataFromQueryResult(result: QuoteQueryResult | undefined): StockQuoteResponse | undefined {
  if (result?.state === "ready" || result?.state === "partial") return result.data;
  return undefined;
}

export function quoteQueryDataFromRefreshResult(
  result: QuoteRefreshMutationResult,
  previous: QuoteQueryResult | undefined,
): QuoteQueryResult | undefined {
  if (result.state === "ready") return result;
  if (result.state === "cooldown") return previous;
  return quoteQueryDataWithPending(result, previous);
}

export function quoteQueryDataFromScore(
  score: StockScoreResponse,
  ticker: string,
  previous?: QuoteQueryResult,
): QuoteQueryResult | undefined {
  const seeded = quoteQueryResultFromScore(score, ticker);
  if (!seeded) return previous;
  if (!previous) return seeded;
  if (previous.state === "ready" || previous.state === "partial") return previous;
  return quoteQueryDataWithPending(previous, seeded);
}

export function quoteQueryResultFromScore(score: StockScoreResponse, ticker: string): QuoteQueryResult | undefined {
  const requestedTicker = normalizedTicker(score.requested_ticker) || normalizedTicker(ticker);
  if (!requestedTicker || requestedTicker !== normalizedTicker(ticker) || !scoreMatchesTicker(score, requestedTicker)) return undefined;
  if (!scoreHasQuoteFields(score)) return undefined;

  const quote: StockQuoteResponse = {
    type: "quote",
    requested_ticker: requestedTicker,
    market: score.market || marketFromTicker(requestedTicker),
    symbol: stringFromUnknown(score.symbol) || symbolFromTicker(requestedTicker),
    name: stringFromUnknown(score.name) || stringFromUnknown(score.display_name) || stringFromUnknown(score.korean_name) || stringFromUnknown(score.english_name),
    exchange: stringFromUnknown(score.exchange),
    currency: stringFromUnknown(score.currency),
    usd_krw_rate: numberFromUnknown(score.usd_krw_rate),
    usd_krw_label: stringFromUnknown(score.usd_krw_label),
    latest_price: numberFromUnknown(score.latest_price),
    latest_price_label: stringFromUnknown(score.latest_price_label),
    latest_bar_date: stringFromUnknown(score.latest_bar_date),
    price_metrics: score.price_metrics,
    server_cache: score.server_cache,
  };

  const payload = compactQuotePayload(quote);
  return {
    state: "ready",
    status: 200,
    payload,
    data: payload,
  };
}

function isPollablePending(pending: ApiPending | undefined): boolean {
  return Boolean(pending && (pending.queued || pending.retryAfterSeconds !== undefined));
}

function quoteQueryDataWithPending(pending: ApiPending, previous: QuoteQueryResult | undefined): QuoteQueryResult {
  if (previous?.state === "ready" || previous?.state === "partial") {
    return {
      state: "partial",
      status: pending.status,
      payload: pending.payload,
      data: previous.data,
      pending,
    };
  }
  return pending;
}

function scoreMatchesTicker(score: StockScoreResponse, ticker: string): boolean {
  const requestedTicker = normalizedTicker(score.requested_ticker);
  if (requestedTicker) return requestedTicker === ticker;
  const market = score.market;
  const symbol = stringFromUnknown(score.symbol);
  return Boolean(market && symbol && `${market}:${cleanTickerSymbol(symbol)}` === ticker);
}

function scoreHasQuoteFields(score: StockScoreResponse): boolean {
  return (
    numberFromUnknown(score.latest_price) !== undefined ||
    stringFromUnknown(score.latest_price_label) !== undefined ||
    stringFromUnknown(score.latest_bar_date) !== undefined ||
    score.price_metrics !== undefined
  );
}

function normalizedTicker(value: unknown): string | undefined {
  const raw = stringFromUnknown(value);
  if (!raw) return undefined;
  const resolved = resolveTickerAlias(raw);
  return resolved.ok ? resolved.ticker : raw.trim().toUpperCase();
}

function marketFromTicker(ticker: string): StockQuoteResponse["market"] | undefined {
  if (ticker.startsWith("KR:")) return "KR";
  if (ticker.startsWith("US:")) return "US";
  return undefined;
}

function symbolFromTicker(ticker: string): string {
  return cleanTickerSymbol(ticker.split(":")[1] || ticker);
}

function stringFromUnknown(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberFromUnknown(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function compactQuotePayload(quote: StockQuoteResponse): StockQuoteResponse & ClientApiPayload {
  return Object.fromEntries(Object.entries(quote).filter(([, value]) => value !== undefined)) as StockQuoteResponse & ClientApiPayload;
}
