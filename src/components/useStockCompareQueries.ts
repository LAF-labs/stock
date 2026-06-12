"use client";

import { useCallback, useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { stockScoreDataFromDisplayPayload } from "@/components/stockDisplayAdapters";
import {
  comparePartialData,
  displayTickerRef,
  pendingMessage,
  toCompareItem,
  type CompareItem,
} from "@/components/stockCompareHelpers";
import { hasDisplayableScoreComponents, hasDisplayableStockPartialData, partialStockDataFromTicker, stockHeaderIdentity, usableChartPoints } from "@/components/stockDashboardHelpers";
import { compareQueryOptions, displayQueryOptions, displayQueryResultFromPayload } from "@/lib/stockQueryOptions";
import type { ApiError, ApiPartial, ApiPending, CompareQueryResult, CompareScoreItemResult, DisplayQueryResult } from "@/lib/stockQueryTypes";
import type { StockDisplayPayload } from "@/lib/stockDisplayTypes";
import type { JsonValue, StockScoreResponse } from "@/lib/types";

export type CompareLoadState =
  | { status: "loading"; ticker: string; data?: undefined; error?: undefined }
  | { status: "success"; ticker: string; data: StockScoreResponse; error?: undefined }
  | { status: "partial"; ticker: string; data: StockScoreResponse; error?: undefined; message: string; retryAfterSeconds?: number }
  | { status: "pending"; ticker: string; data?: undefined; error?: undefined; message: string; retryAfterSeconds?: number }
  | { status: "error"; ticker: string; data?: undefined; error: string };

export type StockCompareQueryView = {
  states: CompareLoadState[];
  items: CompareItem[];
  chartItems: CompareChartItem[];
  partialStates: Array<Extract<CompareLoadState, { status: "partial" }>>;
  waitingStates: Array<Extract<CompareLoadState, { status: "loading" | "pending" }>>;
  pendingStates: Array<Extract<CompareLoadState, { status: "pending" | "partial" }>>;
  errorStates: Array<Extract<CompareLoadState, { status: "error" }>>;
  retryCompare: () => void;
};

export type CompareChartItem = Pick<CompareItem, "ticker" | "identity" | "data">;

export function useStockCompareQueries(tickers: readonly string[], initialDisplayPayloads: readonly StockDisplayPayload[] = []): StockCompareQueryView {
  const compareQuery = useQuery({
    ...compareQueryOptions(tickers),
    placeholderData: (previousData) => previousData,
  });
  const initialDisplayResults = useMemo(() => {
    const byTicker = new Map<string, DisplayQueryResult>();
    initialDisplayPayloads.forEach((payload) => {
      if (tickers.includes(payload.ticker)) byTicker.set(payload.ticker, displayQueryResultFromPayload(payload));
    });
    return byTicker;
  }, [initialDisplayPayloads, tickers]);
  const displayQueries = useQueries({
    queries: tickers.map((ticker) => ({
      ...displayQueryOptions(ticker, "compare"),
      initialData: initialDisplayResults.get(ticker),
      placeholderData: (previousData: DisplayQueryResult | undefined) => previousData,
    })),
  });
  const displayFallbacks = useMemo(() => {
    const byTicker = new Map<string, StockScoreResponse>();
    initialDisplayPayloads.forEach((payload) => {
      if (tickers.includes(payload.ticker)) byTicker.set(payload.ticker, stockScoreDataFromDisplayPayload(payload));
    });
    tickers.forEach((ticker, index) => {
      const data = displayQueries[index]?.data;
      if (data?.state === "ready") byTicker.set(ticker, stockScoreDataFromDisplayPayload(data.data));
    });
    return byTicker;
  }, [displayQueries, initialDisplayPayloads, tickers]);
  const states = useMemo(
    () => compareStatesFromQuery(tickers, compareQuery.data, compareQuery.error, compareQuery.isLoading, displayFallbacks),
    [compareQuery.data, compareQuery.error, compareQuery.isLoading, displayFallbacks, tickers],
  );
  const items = useMemo(() => compareItemsFromStates(states), [states]);
  const chartItems = useMemo(() => compareChartItemsFromStates(states), [states]);
  const partialStates = useMemo(
    () => states.filter((state): state is Extract<CompareLoadState, { status: "partial" }> => state.status === "partial" && !shouldPromotePartialCompareData(state.data)),
    [states],
  );
  const waitingStates = useMemo(
    () => states.filter((state): state is Extract<CompareLoadState, { status: "loading" | "pending" }> => state.status === "loading" || state.status === "pending"),
    [states],
  );
  const pendingStates = useMemo(
    () => states.filter((state): state is Extract<CompareLoadState, { status: "pending" | "partial" }> => state.status === "pending" || state.status === "partial"),
    [states],
  );
  const errorStates = useMemo(() => states.filter((state): state is Extract<CompareLoadState, { status: "error" }> => state.status === "error"), [states]);
  const retryCompare = useCallback(() => {
    void compareQuery.refetch();
    displayQueries.forEach((query) => void query.refetch());
  }, [compareQuery, displayQueries]);

  return {
    states,
    items,
    chartItems,
    partialStates,
    waitingStates,
    pendingStates,
    errorStates,
    retryCompare,
  };
}

export function compareItemsFromStates(states: readonly CompareLoadState[]): CompareItem[] {
  return states.flatMap((state) => {
    if (state.status === "success") return [toCompareItem(state.data, state.ticker)];
    if (state.status === "partial" && shouldPromotePartialCompareData(state.data)) {
      return [toCompareItem(state.data, state.ticker, { provisional: true, provisionalLabel: "가격 기준 참고값" })];
    }
    return [];
  });
}

export function compareChartItemsFromStates(states: readonly CompareLoadState[]): CompareChartItem[] {
  return states.flatMap((state) => {
    if (state.status !== "success" && state.status !== "partial") return [];
    if (usableChartPoints(state.data.chart_series).length < 1) return [];
    return [{
      ticker: displayTickerRef(state.ticker) || state.data.symbol || state.data.requested_ticker || state.ticker,
      identity: stockHeaderIdentity(state.data),
      data: state.data,
    }];
  });
}

export function shouldShowCompareOverviewSkeleton(states: readonly CompareLoadState[], items: readonly CompareItem[]): boolean {
  if (items.length > 0) return false;
  return !states.some((state) => state.status === "partial" && hasDisplayableStockPartialData(state.data));
}

export function shouldShowCompareChartSkeleton(states: readonly CompareLoadState[], items: readonly CompareItem[], hasCompareChart: boolean): boolean {
  if (items.length < 2 || hasCompareChart) return false;
  return states.some((state) => {
    if (state.status === "loading" || state.status === "pending") return true;
    if (state.status === "partial") return !hasTerminalInsufficientChartHistory(state.data);
    return false;
  });
}

export function shouldPromotePartialCompareData(data: StockScoreResponse): boolean {
  if (isIdentityOnlyFastPath(data)) return false;
  return hasDisplayableScoreComponents(data.components) && hasFiniteNumber(data.quality_score ?? data.score) && hasPriceSignal(data);
}

function hasPriceSignal(data: StockScoreResponse): boolean {
  if (hasFiniteNumber(data.latest_price)) return true;
  return usableChartPoints(data.chart_series).length >= 1;
}

function hasTerminalInsufficientChartHistory(data: StockScoreResponse): boolean {
  return Array.isArray(data.chart_series) && data.chart_series.length > 0 && usableChartPoints(data.chart_series).length < 2;
}

function isIdentityOnlyFastPath(data: StockScoreResponse): boolean {
  const quality = typeof data.data_quality === "string" ? data.data_quality.toLowerCase() : "";
  return quality === "identity_fast_path" || data.fetch?.identity_only_fast_path === true || data.financials?.identity_only_fast_path === true;
}

function hasFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function compareStockDataWithDisplayFallback(
  primary: StockScoreResponse,
  displayFallback: StockScoreResponse | undefined,
): StockScoreResponse {
  if (!displayFallback) return primary;
  const primaryChartPoints = usableChartPoints(primary.chart_series).length;
  const fallbackChartPoints = usableChartPoints(displayFallback.chart_series).length;
  const chartSeries = fallbackChartPoints > primaryChartPoints ? displayFallback.chart_series : primary.chart_series || displayFallback.chart_series;

  return {
    ...displayFallback,
    ...primary,
    requested_ticker: stringOrFallback(primary.requested_ticker, displayFallback.requested_ticker),
    market: primary.market || displayFallback.market,
    symbol: stringOrFallback(primary.symbol, displayFallback.symbol),
    name: stringOrFallback(primary.name, displayFallback.name),
    display_name: stringOrFallback(primary.display_name, displayFallback.display_name),
    korean_name: stringOrFallback(primary.korean_name, displayFallback.korean_name),
    english_name: stringOrFallback(primary.english_name, displayFallback.english_name),
    instrument_type: stringOrFallback(primary.instrument_type, displayFallback.instrument_type),
    exchange: stringOrFallback(primary.exchange, displayFallback.exchange),
    currency: stringOrFallback(primary.currency, displayFallback.currency),
    latest_price: finiteOrFallback(primary.latest_price, displayFallback.latest_price),
    latest_price_label: stringOrFallback(primary.latest_price_label, displayFallback.latest_price_label),
    latest_bar_date: stringOrFallback(primary.latest_bar_date, displayFallback.latest_bar_date),
    usd_krw_rate: finiteOrFallback(primary.usd_krw_rate, displayFallback.usd_krw_rate),
    usd_krw_label: stringOrFallback(primary.usd_krw_label, displayFallback.usd_krw_label),
    market_cap: finiteOrFallback(numberFromUnknown(primary.market_cap), numberFromUnknown(displayFallback.market_cap)),
    market_cap_label: stringOrFallback(stringFromUnknown(primary.market_cap_label), stringFromUnknown(displayFallback.market_cap_label)),
    score: finiteOrFallback(primary.score, displayFallback.score),
    quality_score: finiteOrFallback(primary.quality_score, displayFallback.quality_score),
    opportunity_score: finiteOrFallback(primary.opportunity_score, displayFallback.opportunity_score),
    components: nonEmptyArray(primary.components) || nonEmptyArray(displayFallback.components),
    opportunity_components: nonEmptyArray(primary.opportunity_components) || nonEmptyArray(displayFallback.opportunity_components),
    key_metrics: nonEmptyArray(primary.key_metrics) || nonEmptyArray(displayFallback.key_metrics),
    stock_profile: nonEmptyArray(primary.stock_profile) || nonEmptyArray(displayFallback.stock_profile),
    valuation_rows: nonEmptyArray(primary.valuation_rows) || nonEmptyArray(displayFallback.valuation_rows),
    chart_patterns: nonEmptyArray(primary.chart_patterns) || nonEmptyArray(displayFallback.chart_patterns),
    chart_series: chartSeries,
    price_metrics: mergeJsonRecords(displayFallback.price_metrics, primary.price_metrics),
    financials: mergeJsonRecords(displayFallback.financials, primary.financials),
    financial_statement: mergeJsonRecords(displayFallback.financial_statement, primary.financial_statement),
    technical_analysis: primary.technical_analysis || displayFallback.technical_analysis,
    news: nonEmptyArray(primary.news) || nonEmptyArray(displayFallback.news),
  };
}

function stringOrFallback(value: string | undefined, fallback: string | undefined): string | undefined {
  return value && value.trim() ? value : fallback;
}

function finiteOrFallback(value: number | undefined, fallback: number | undefined): number | undefined {
  return hasFiniteNumber(value) ? value : hasFiniteNumber(fallback) ? fallback : undefined;
}

function numberFromUnknown(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringFromUnknown(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function nonEmptyArray<T>(value: T[] | undefined): T[] | undefined {
  return Array.isArray(value) && value.length ? value : undefined;
}

function mergeJsonRecords(
  fallback: Record<string, JsonValue> | undefined,
  primary: Record<string, JsonValue> | undefined,
): Record<string, JsonValue> | undefined {
  if (!fallback) return primary;
  if (!primary) return fallback;
  return { ...fallback, ...primary };
}

function compareStatesFromQuery(
  tickers: readonly string[],
  result: CompareQueryResult | undefined,
  error: unknown,
  isLoading: boolean,
  displayFallbacks: ReadonlyMap<string, StockScoreResponse> = new Map(),
): CompareLoadState[] {
  if (!tickers.length) return [];
  if (result) {
    const byTicker = new Map(result.results.map((item) => [item.ticker, item]));
    return tickers.map((ticker) => stateFromCompareItem(ticker, byTicker.get(ticker), displayFallbacks.get(ticker)));
  }
  if (error) {
    const fallbackStates = statesFromDisplayFallbacks(tickers, displayFallbacks);
    if (fallbackStates.length) return fallbackStates;
    const message = error instanceof Error ? error.message : "데이터를 불러오지 못했어요.";
    return tickers.map((ticker) => ({ status: "error", ticker, error: message }));
  }
  const fallbackStates = statesFromDisplayFallbacks(tickers, displayFallbacks);
  if (fallbackStates.length) return fallbackStates;
  if (isLoading) return tickers.map((ticker) => optimisticComparePendingState(ticker));
  return tickers.map((ticker) => optimisticComparePendingState(ticker));
}

function stateFromCompareItem(ticker: string, item: CompareScoreItemResult | undefined, displayFallback: StockScoreResponse | undefined): CompareLoadState {
  const result = item?.result;
  if (!result) return displayFallback ? displayCompareState(ticker, displayFallback) : optimisticComparePendingState(ticker);

  if (result.state === "ready") {
    return { status: "success", ticker, data: compareStockDataWithDisplayFallback(result.data, displayFallback) };
  }

  if (result.state === "partial") {
    return partialStateFromResult(ticker, result, displayFallback);
  }

  if (result.state === "pending") {
    return displayFallback ? displayCompareState(ticker, displayFallback) : pendingStateFromResult(ticker, result);
  }

  if (result.state === "unsupported") {
    return { status: "error", ticker, error: "비교할 수 없는 상품이에요." };
  }

  return displayFallback ? displayCompareState(ticker, displayFallback) : errorStateFromResult(ticker, result);
}

function statesFromDisplayFallbacks(tickers: readonly string[], displayFallbacks: ReadonlyMap<string, StockScoreResponse>): CompareLoadState[] {
  const states = tickers.flatMap((ticker) => {
    const data = displayFallbacks.get(ticker);
    return data ? [displayCompareState(ticker, data)] : [];
  });
  return states.length === tickers.length ? states : [];
}

function displayCompareState(ticker: string, data: StockScoreResponse): Extract<CompareLoadState, { status: "partial" }> {
  return {
    status: "partial",
    ticker,
    data,
    message: `${displayTickerRef(ticker)} 종목 정보를 확인했어요.`,
  };
}

function partialStateFromResult(
  ticker: string,
  result: ApiPartial<StockScoreResponse>,
  displayFallback: StockScoreResponse | undefined,
): Extract<CompareLoadState, { status: "partial" }> {
  const partial = comparePartialData(result.payload as StockScoreResponse, ticker) || result.data || partialStockDataFromTicker(ticker);
  const data = compareStockDataWithDisplayFallback(partial, displayFallback);
  return {
    status: "partial",
    ticker,
    data,
    message: pendingMessage(result.payload as StockScoreResponse),
    retryAfterSeconds: result.pending?.retryAfterSeconds,
  };
}

function pendingStateFromResult(ticker: string, result: ApiPending): Extract<CompareLoadState, { status: "pending" }> {
  return {
    status: "pending",
    ticker,
    message: pendingMessage(result.payload as StockScoreResponse),
    retryAfterSeconds: result.retryAfterSeconds,
  };
}

function errorStateFromResult(ticker: string, result: ApiError): Extract<CompareLoadState, { status: "error" }> {
  return {
    status: "error",
    ticker,
    error: result.message || result.error || "데이터를 불러오지 못했어요.",
  };
}

function optimisticComparePendingState(ticker: string): Extract<CompareLoadState, { status: "partial" }> {
  const data = partialStockDataFromTicker(ticker);
  return {
    status: "partial",
    ticker,
    data,
    message: `${displayTickerRef(ticker)} 종목 정보를 확인했어요.`,
  };
}
