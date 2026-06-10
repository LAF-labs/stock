"use client";

import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  comparePartialData,
  displayTickerRef,
  pendingMessage,
  toCompareItem,
  type CompareItem,
} from "@/components/stockCompareHelpers";
import { partialStockDataFromTicker, usableChartPoints } from "@/components/stockDashboardHelpers";
import { compareQueryOptions } from "@/lib/stockQueryOptions";
import type { ApiError, ApiPartial, ApiPending, CompareQueryResult, CompareScoreItemResult } from "@/lib/stockQueryTypes";
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

export function useStockCompareQueries(tickers: readonly string[]): StockCompareQueryView {
  const compareQuery = useQuery({
    ...compareQueryOptions(tickers),
    placeholderData: (previousData) => previousData,
  });
  const states = useMemo(() => compareStatesFromQuery(tickers, compareQuery.data, compareQuery.error, compareQuery.isLoading), [compareQuery.data, compareQuery.error, compareQuery.isLoading, tickers]);
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
  }, [compareQuery]);

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

function compareStatesFromQuery(tickers: readonly string[], result: CompareQueryResult | undefined, error: unknown, isLoading: boolean): CompareLoadState[] {
  if (!tickers.length) return [];
  if (result) {
    const byTicker = new Map(result.results.map((item) => [item.ticker, item]));
    return tickers.map((ticker) => stateFromCompareItem(ticker, byTicker.get(ticker)));
  }
  if (error) {
    const message = error instanceof Error ? error.message : "데이터를 불러오지 못했어요.";
    return tickers.map((ticker) => ({ status: "error", ticker, error: message }));
  }
  if (isLoading) return tickers.map((ticker) => optimisticComparePendingState(ticker));
  return tickers.map((ticker) => optimisticComparePendingState(ticker));
}

function stateFromCompareItem(ticker: string, item: CompareScoreItemResult | undefined): CompareLoadState {
  const result = item?.result;
  if (!result) return optimisticComparePendingState(ticker);

  if (result.state === "ready") {
    return { status: "success", ticker, data: result.data };
  }

  if (result.state === "partial") {
    return partialStateFromResult(ticker, result);
  }

  if (result.state === "pending") {
    return pendingStateFromResult(ticker, result);
  }

  if (result.state === "unsupported") {
    return { status: "error", ticker, error: "비교할 수 없는 상품이에요." };
  }

  return errorStateFromResult(ticker, result);
}

function partialStateFromResult(ticker: string, result: ApiPartial<StockScoreResponse>): Extract<CompareLoadState, { status: "partial" }> {
  const data = comparePartialData(result.payload as StockScoreResponse, ticker) || result.data || partialStockDataFromTicker(ticker);
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
    message: `${displayTickerRef(ticker)} 종목은 먼저 특정했고, 비교 점수와 가격 데이터는 계속 확인하고 있어요.`,
  };
}
