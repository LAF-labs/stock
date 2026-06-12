"use client";

import { useCallback, useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { stockDisplayPayloadIsComplete, stockScoreDataFromDisplayPayload } from "@/components/stockDisplayAdapters";
import {
  displayTickerRef,
  toCompareItem,
  type CompareItem,
} from "@/components/stockCompareHelpers";
import {
  hasDisplayableScoreComponents,
  hasDisplayableStockPartialData,
  partialStockDataFromTicker,
  stockHeaderIdentity,
  usableChartPoints,
} from "@/components/stockDashboardHelpers";
import { displayQueryOptions, displayQueryResultFromPayload } from "@/lib/stockQueryOptions";
import type { DisplayQueryResult } from "@/lib/stockQueryTypes";
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
  chartItems: CompareChartItem[];
  partialStates: Array<Extract<CompareLoadState, { status: "partial" }>>;
  waitingStates: Array<Extract<CompareLoadState, { status: "loading" | "pending" }>>;
  pendingStates: Array<Extract<CompareLoadState, { status: "pending" | "partial" }>>;
  errorStates: Array<Extract<CompareLoadState, { status: "error" }>>;
  retryCompare: () => void;
};

export type CompareChartItem = Pick<CompareItem, "ticker" | "identity" | "data">;

export function useStockCompareQueries(tickers: readonly string[], initialDisplayPayloads: readonly StockDisplayPayload[] = []): StockCompareQueryView {
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
  const states = useMemo(
    () => tickers.map((ticker, index) => compareStateFromDisplayQuery(ticker, displayQueries[index])),
    [displayQueries, tickers],
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
    displayQueries.forEach((query) => void query.refetch());
  }, [displayQueries]);

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

type DisplayQueryLike = {
  data?: DisplayQueryResult;
  error?: unknown;
  isLoading?: boolean;
  isPending?: boolean;
};

function compareStateFromDisplayQuery(ticker: string, query: DisplayQueryLike | undefined): CompareLoadState {
  if (query?.data?.state === "ready") return compareStateFromDisplayPayload(query.data.data);
  if (query?.error) {
    const message = query.error instanceof Error ? query.error.message : "데이터를 불러오지 못했어요.";
    return { status: "error", ticker, error: message };
  }
  return optimisticComparePendingState(ticker);
}

export function compareStateFromDisplayPayload(payload: StockDisplayPayload): CompareLoadState {
  const data = stockScoreDataFromDisplayPayload(payload);
  if (stockDisplayPayloadIsComplete(payload)) return { status: "success", ticker: payload.ticker, data };
  return displayCompareState(payload.ticker, data);
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

export function shouldShowCompareOverviewSkeleton(states: readonly CompareLoadState[], items: readonly CompareItem[], loadingExpired = false): boolean {
  if (loadingExpired) return false;
  if (items.length > 0) return false;
  return !states.some((state) => state.status === "partial" && hasDisplayableStockPartialData(state.data));
}

export function shouldShowCompareChartSkeleton(states: readonly CompareLoadState[], items: readonly CompareItem[], hasCompareChart: boolean, loadingExpired = false): boolean {
  if (loadingExpired) return false;
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

function displayCompareState(ticker: string, data: StockScoreResponse): Extract<CompareLoadState, { status: "partial" }> {
  return {
    status: "partial",
    ticker,
    data,
    message: `${displayTickerRef(ticker)} 종목 정보를 확인했어요.`,
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
