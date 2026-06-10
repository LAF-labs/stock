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
import { chooseRicherStockData, partialStockDataFromTicker, usableChartPoints } from "@/components/stockDashboardHelpers";
import { compareQueryOptions, displayQueryOptions } from "@/lib/stockQueryOptions";
import type { ApiError, ApiPartial, ApiPending, CompareQueryResult, CompareScoreItemResult, DisplayQueryResult } from "@/lib/stockQueryTypes";
import type { StockDisplayPayload } from "@/lib/stockDisplayTypes";
import type { StockScoreResponse } from "@/lib/types";

export type CompareLoadState =
  | { status: "loading"; ticker: string; data?: undefined; error?: undefined }
  | { status: "success"; ticker: string; data: StockScoreResponse; error?: undefined }
  | { status: "partial"; ticker: string; data: StockScoreResponse; error?: undefined; message: string; retryAfterSeconds?: number }
  | { status: "pending"; ticker: string; data?: undefined; error?: undefined; message: string; retryAfterSeconds?: number }
  | { status: "error"; ticker: string; data?: undefined; error: string };

export type StockCompareQueryView = {
  states: CompareLoadState[];
  items: CompareItem[];
  partialStates: Array<Extract<CompareLoadState, { status: "partial" }>>;
  waitingStates: Array<Extract<CompareLoadState, { status: "loading" | "pending" }>>;
  pendingStates: Array<Extract<CompareLoadState, { status: "pending" | "partial" }>>;
  errorStates: Array<Extract<CompareLoadState, { status: "error" }>>;
  retryCompare: () => void;
};

export function useStockCompareQueries(tickers: readonly string[], initialDisplayPayloads: readonly StockDisplayPayload[] = []): StockCompareQueryView {
  const compareQuery = useQuery({
    ...compareQueryOptions(tickers),
    placeholderData: (previousData) => previousData,
  });
  const displayQueries = useQueries({
    queries: tickers.map((ticker) => ({
      ...displayQueryOptions(ticker, "compare"),
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
      return [toCompareItem(state.data, state.ticker, { provisional: true, provisionalLabel: "빠른 점수" })];
    }
    return [];
  });
}

export function shouldPromotePartialCompareData(data: StockScoreResponse): boolean {
  if (isIdentityOnlyFastPath(data)) return false;
  return hasFiniteNumber(data.quality_score ?? data.score) && hasPriceSignal(data);
}

function hasPriceSignal(data: StockScoreResponse): boolean {
  if (hasFiniteNumber(data.latest_price)) return true;
  return usableChartPoints(data.chart_series).length >= 2;
}

function isIdentityOnlyFastPath(data: StockScoreResponse): boolean {
  const quality = typeof data.data_quality === "string" ? data.data_quality.toLowerCase() : "";
  return quality === "identity_fast_path" || data.fetch?.identity_only_fast_path === true || data.financials?.identity_only_fast_path === true;
}

function hasFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
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
    return { status: "success", ticker, data: result.data };
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
  const data = chooseRicherStockData(displayFallback, partial) || partial;
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
