"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PriceRefreshState, QuoteState } from "@/components/StockHeader";
import {
  chooseRicherStockData,
  dashboardStateFromDetailView,
  partialStockDataFromPayload,
  partialStockDataFromQuote,
  partialStockDataFromTicker,
  refreshCooldownMessage,
  scoreDataWithQuote,
  snapshotPendingFromPayload,
  type SnapshotPendingState,
} from "@/components/stockDashboardHelpers";
import { refreshQuote as refreshQuoteRequest } from "@/lib/stockQueryFns";
import {
  STOCK_DETAIL_VIEW_DEFAULT_POLL_INTERVAL_MS,
  detailViewQueryOptions,
  displayQueryOptions,
  displayQueryResultFromPayload,
  quoteDataFromQueryResult,
  quoteQueryDataFromDisplayPayload,
  quoteQueryDataFromRefreshResult,
  quoteQueryDataFromScore,
  quoteQueryOptions,
  quoteQueryUpdatedAtFromDisplayPayload,
  scoreQueryOptions,
} from "@/lib/stockQueryOptions";
import { stockQueryKeys } from "@/lib/stockQueryKeys";
import type { ApiPending, QuoteQueryResult, QuoteRefreshMutationResult, ScoreQueryResult } from "@/lib/stockQueryTypes";
import type { StockDetailViewResponse } from "@/lib/stockDetailViewTypes";
import type { StockDisplayPayload } from "@/lib/stockDisplayTypes";
import type { StockQuoteResponse, StockScoreResponse } from "@/lib/types";
import { stockScoreDataFromDisplayPayload } from "@/components/stockDisplayAdapters";

export type DashboardLoadState =
  | { status: "idle" | "loading"; data?: undefined; error?: undefined }
  | { status: "success"; data: StockScoreResponse; error?: undefined }
  | { status: "partial"; data: StockScoreResponse; error?: undefined; pending: SnapshotPendingState }
  | { status: "pending"; data?: undefined; error?: undefined; pending: SnapshotPendingState }
  | { status: "error"; data?: undefined; error: string };

export type StockDashboardQueryView = {
  state: DashboardLoadState;
  quoteState: QuoteState;
  priceRefreshState: PriceRefreshState;
  scorePending: SnapshotPendingState | undefined;
  quotePending: SnapshotPendingState | undefined;
  quoteData: StockQuoteResponse | undefined;
  data: StockScoreResponse | undefined;
  partialData: StockScoreResponse | undefined;
  hasDetailViewResponse: boolean;
  retryLoad: () => void;
  refreshPrice: () => void;
};

export function useStockDashboardQueries(ticker: string | undefined, initialDisplayPayload?: StockDisplayPayload): StockDashboardQueryView {
  const queryClient = useQueryClient();
  const enabled = Boolean(ticker);
  const queryEnablement = stockDashboardQueryEnablement({
    enabled,
    detailViewPrimary: stockDetailViewPrimaryEnabled(),
  });
  const tickerKey = ticker || "__stock-dashboard-disabled__";
  const initialDisplayResult = useMemo(
    () => initialDisplayPayload && initialDisplayPayload.ticker === ticker ? displayQueryResultFromPayload(initialDisplayPayload) : undefined,
    [initialDisplayPayload, ticker],
  );
  const initialQuoteResult = useMemo(
    () => initialDisplayPayload && initialDisplayPayload.ticker === ticker ? quoteQueryDataFromDisplayPayload(initialDisplayPayload) : undefined,
    [initialDisplayPayload, ticker],
  );
  const initialQuoteUpdatedAt = useMemo(
    () => initialDisplayPayload && initialDisplayPayload.ticker === ticker ? quoteQueryUpdatedAtFromDisplayPayload(initialDisplayPayload) : undefined,
    [initialDisplayPayload, ticker],
  );
  const scoreQuery = useQuery({
    ...scoreQueryOptions(tickerKey, "detail"),
    enabled: queryEnablement.score,
    placeholderData: queryEnablement.score ? scorePlaceholder(tickerKey) : undefined,
  });
  const displayQuery = useQuery({
    ...displayQueryOptions(tickerKey, "detail"),
    initialData: initialDisplayResult,
    enabled: queryEnablement.display,
    placeholderData: (previous) => previous,
  });
  const detailViewQuery = useQuery({
    ...detailViewQueryOptions(tickerKey, "detail"),
    enabled: queryEnablement.detailView,
  });
  const quoteQuery = useQuery({
    ...quoteQueryOptions(tickerKey),
    initialData: initialQuoteResult,
    initialDataUpdatedAt: initialQuoteUpdatedAt,
    enabled: queryEnablement.quote,
  });

  const detailViewAdapterState = dashboardStateFromDetailView(detailViewQuery.data);
  const detailViewScoreData = detailViewAdapterState?.data;
  const detailViewQuoteResult = ticker && detailViewScoreData ? quoteQueryDataFromScore(detailViewScoreData, ticker) : undefined;
  const quoteStateResult = quoteResultForHeader(quoteQuery.data, detailViewQuoteResult);
  const quoteData = quoteDataFromQueryResult(quoteQuery.data) || quoteDataFromQueryResult(detailViewQuoteResult);
  const displayData = displayQuery.data?.state === "ready" ? stockScoreDataFromDisplayPayload(displayQuery.data.data) : undefined;
  const rawScoreData = scoreQuery.data?.state === "ready" ? scoreQuery.data.data : undefined;

  const priceRefreshMutation = useMutation({
    mutationFn: (requestedTicker: string) => refreshQuoteRequest(requestedTicker),
    onSuccess: (result, requestedTicker) => {
      queryClient.setQueryData(stockQueryKeys.quote(requestedTicker), (previous: QuoteQueryResult | undefined) => quoteQueryDataFromRefreshResult(result, previous));
      void queryClient.invalidateQueries({ queryKey: stockQueryKeys.detailView(requestedTicker, "detail") });
    },
  });

  const refreshResult = priceRefreshMutation.variables === ticker ? priceRefreshMutation.data : undefined;
  const refreshError = priceRefreshMutation.variables === ticker ? priceRefreshMutation.error : undefined;
  const refreshPending = priceRefreshMutation.variables === ticker && priceRefreshMutation.isPending;
  const refreshNextAllowedAt = refreshResult?.state === "cooldown" ? refreshResult.nextAllowedAt : undefined;
  const [cooldownTick, setCooldownTick] = useState(0);

  useEffect(() => {
    if (!refreshNextAllowedAt) return undefined;
    const remainingMs = Date.parse(refreshNextAllowedAt) - Date.now();
    if (remainingMs <= 0) {
      setCooldownTick((tick) => tick + 1);
      return undefined;
    }
    const timer = window.setTimeout(() => setCooldownTick((tick) => tick + 1), Math.min(remainingMs, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [refreshNextAllowedAt]);

  const priceRefreshState = priceRefreshStateFromMutation(refreshResult, refreshPending, refreshError, cooldownTick);
  const legacyState = dashboardStateFromQuery({
    ticker,
    scoreResult: scoreQuery.data,
    scoreError: scoreQuery.error,
    isScoreLoading: queryEnablement.score && scoreQuery.isLoading,
    quoteData,
    displayData,
  });
  const detailViewState = dashboardLoadStateFromDetailView(detailViewAdapterState, ticker, detailViewQuery.data);
  const state = chooseDashboardLoadState(detailViewState, legacyState);
  const quoteState = quoteStateFromQuery(ticker, quoteStateResult, quoteQuery.error, queryEnablement.quote && quoteQuery.isLoading);
  const data = ticker && state.status === "success" ? state.data : undefined;
  const partialData = ticker && state.status === "partial" ? scoreDataWithQuote(state.data, quoteData) : undefined;
  const scorePending = ticker && (state.status === "pending" || state.status === "partial") ? state.pending : undefined;
  const quotePending =
    ticker && quoteQuery.data?.state === "pending"
      ? pendingFromApiPending(quoteQuery.data, ticker)
      : ticker && quoteQuery.data?.state === "partial"
        ? pendingFromApiPending(quoteQuery.data.pending, ticker)
        : undefined;

  useEffect(() => {
    const scoreData = rawScoreData || detailViewScoreData;
    if (!ticker || !scoreData) return;
    queryClient.setQueryData(stockQueryKeys.quote(ticker), (previous: QuoteQueryResult | undefined) => quoteQueryDataFromScore(scoreData, ticker, previous));
  }, [detailViewScoreData, queryClient, rawScoreData, ticker]);

  const retryLoad = useCallback(() => {
    if (!ticker) return;
    void detailViewQuery.refetch();
    if (queryEnablement.display) void displayQuery.refetch();
    if (queryEnablement.score) void scoreQuery.refetch();
    if (queryEnablement.quote) void quoteQuery.refetch();
  }, [detailViewQuery, displayQuery, queryEnablement.display, queryEnablement.quote, queryEnablement.score, quoteQuery, scoreQuery, ticker]);

  const refreshPrice = useCallback(() => {
    if (!ticker) return;
    if (priceRefreshState.status === "refreshing" || priceRefreshState.status === "cooldown" || priceRefreshState.status === "pending") return;
    priceRefreshMutation.mutate(ticker);
  }, [priceRefreshMutation, priceRefreshState.status, ticker]);

  return {
    state,
    quoteState,
    priceRefreshState,
    scorePending,
    quotePending,
    quoteData,
    data,
    partialData,
    hasDetailViewResponse: Boolean(detailViewQuery.data),
    retryLoad,
    refreshPrice,
  };
}

export function stockDetailViewPrimaryEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const raw = env.NEXT_PUBLIC_STOCK_DETAIL_VIEW_PRIMARY?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  if (raw === "1" || raw === "true" || raw === "on") return true;
  return true;
}

export function stockDashboardQueryEnablement({
  enabled,
  detailViewPrimary,
}: {
  enabled: boolean;
  detailViewPrimary: boolean;
}): { detailView: boolean; score: boolean; display: boolean; quote: boolean } {
  return {
    detailView: enabled,
    score: enabled && !detailViewPrimary,
    display: enabled && !detailViewPrimary,
    quote: enabled && !detailViewPrimary,
  };
}

export function chooseDashboardLoadState(
  detailViewState: DashboardLoadState | undefined,
  legacyState: DashboardLoadState,
): DashboardLoadState {
  if (!detailViewState) return legacyState;
  if (detailViewState.status === "success") return detailViewState;
  if (legacyState.status === "success") return legacyState;
  return detailViewState;
}

function quoteResultForHeader(
  quoteResult: QuoteQueryResult | undefined,
  detailViewQuoteResult: QuoteQueryResult | undefined,
): QuoteQueryResult | undefined {
  if (quoteResult?.state === "ready" || quoteResult?.state === "partial") return quoteResult;
  return detailViewQuoteResult || quoteResult;
}

function dashboardLoadStateFromDetailView(
  detailState: ReturnType<typeof dashboardStateFromDetailView>,
  ticker: string | undefined,
  detailViewResult: StockDetailViewResponse | undefined,
): DashboardLoadState | undefined {
  if (!ticker || !detailState) return undefined;
  if (detailState.status === "error") return { status: "error", error: detailState.error || "데이터를 불러오지 못했어요." };
  if (!detailState.data) return undefined;
  if (detailState.status === "success") return { status: "success", data: detailState.data };
  return {
    status: "partial",
    data: detailState.data,
    pending: detailViewResult ? detailViewPendingFromResult(detailViewResult, ticker) : pendingFromTicker(ticker),
  };
}

function dashboardStateFromQuery({
  ticker,
  scoreResult,
  scoreError,
  isScoreLoading,
  quoteData,
  displayData,
}: {
  ticker: string | undefined;
  scoreResult: ScoreQueryResult | undefined;
  scoreError: unknown;
  isScoreLoading: boolean;
  quoteData: StockQuoteResponse | undefined;
  displayData: StockScoreResponse | undefined;
}): DashboardLoadState {
  if (!ticker) return { status: "idle" };

  if (scoreResult?.state === "ready") {
    return { status: "success", data: scoreDataWithQuote(scoreResult.data, quoteData) };
  }

  if (scoreResult?.state === "partial") {
    const pending = snapshotPendingFromPayload(scoreResult.payload, ticker) || pendingFromApiPending(scoreResult.pending, ticker) || pendingFromTicker(ticker);
    const partial = chooseRicherStockData(
      displayData,
      partialStockDataFromPayload(scoreResult.payload, ticker) || scoreResult.data || partialStockDataFromTicker(ticker),
    ) || partialStockDataFromTicker(ticker);
    return { status: "partial", data: scoreDataWithQuote(partial, quoteData), pending };
  }

  if (scoreResult?.state === "pending") {
    if (displayData) {
      return {
        status: "partial",
        data: displayData,
        pending: quoteFirstPending(ticker),
      };
    }
    const pending = pendingFromApiPending(scoreResult, ticker);
    const quotePartial = quoteData ? partialStockDataFromQuote(quoteData, ticker) : undefined;
    if (quotePartial) {
      return {
        status: "partial",
        data: quotePartial,
        pending: pending || quoteFirstPending(ticker),
      };
    }
    return { status: "pending", pending: pending || pendingFromTicker(ticker, scoreResult.message, scoreResult.retryAfterSeconds) };
  }

  if (scoreError) {
    if (displayData) {
      return {
        status: "partial",
        data: displayData,
        pending: quoteFirstPending(ticker),
      };
    }
    const quotePartial = quoteData ? partialStockDataFromQuote(quoteData, ticker) : undefined;
    if (quotePartial) {
      return {
        status: "partial",
        data: quotePartial,
        pending: quoteFirstPending(ticker),
      };
    }
    return { status: "error", error: errorMessage(scoreError, "데이터를 불러오지 못했어요.") };
  }

  if (isScoreLoading) {
    if (displayData) {
      return {
        status: "partial",
        data: displayData,
        pending: quoteFirstPending(ticker),
      };
    }
    const quotePartial = quoteData ? partialStockDataFromQuote(quoteData, ticker) : undefined;
    return {
      status: "partial",
      data: quotePartial || partialStockDataFromTicker(ticker),
      pending: quotePartial ? quoteFirstPending(ticker) : pendingFromTicker(ticker),
    };
  }

  return {
    status: "partial",
    data: displayData || partialStockDataFromTicker(ticker),
    pending: pendingFromTicker(ticker),
  };
}

function quoteStateFromQuery(ticker: string | undefined, result: QuoteQueryResult | undefined, error: unknown, isLoading: boolean): QuoteState {
  if (!ticker) return { status: "idle" };
  if (result?.state === "ready") return { status: "success", data: result.data };
  if (result?.state === "partial") {
    return {
      status: "pending",
      pending: {
        message: pendingFromApiPending(result.pending, ticker)?.message || "현재가를 화면에 반영합니다.",
      },
    };
  }
  if (result?.state === "pending") {
    return {
      status: "pending",
      pending: {
        message: pendingFromApiPending(result, ticker)?.message || result.message,
      },
    };
  }
  if (error) return { status: "error", error: errorMessage(error, "quote_fetch_failed") };
  return isLoading ? { status: "loading" } : { status: "idle" };
}

function priceRefreshStateFromMutation(
  result: QuoteRefreshMutationResult | undefined,
  isPending: boolean,
  error: unknown,
  cooldownTick: number
): PriceRefreshState {
  void cooldownTick;
  if (isPending) return { status: "refreshing", message: "현재가 업데이트 반영" };
  if (error) return { status: "error", message: errorMessage(error, "quote_refresh_failed") };
  if (!result) return { status: "idle" };

  if (result.state === "ready") return { status: "success", message: "현재가가 업데이트됐어요." };
  if (result.state === "pending") return { status: "pending", message: pendingFromApiPending(result, result.ticker || "")?.message || result.message };
  if (result.state === "cooldown") {
    const remainingMs = result.nextAllowedAt ? Date.parse(result.nextAllowedAt) - Date.now() : Number.POSITIVE_INFINITY;
    if (remainingMs <= 0) return { status: "idle" };
    return {
      status: "cooldown",
      nextAllowedAt: result.nextAllowedAt,
      message: refreshCooldownMessage(result.nextAllowedAt) || result.message || "잠시 후 다시 시도해주세요.",
    };
  }

  return { status: "idle" };
}

function scorePlaceholder(ticker: string): ScoreQueryResult {
  return {
    state: "partial",
    status: 200,
    payload: {
      type: "partial_stock_snapshot",
      requested_ticker: ticker,
      server_cache: { state: "pending", source: "placeholder", refresh_started: true },
    },
    data: partialStockDataFromTicker(ticker),
    pending: {
      state: "pending",
      status: 202,
      payload: { error: "snapshot_pending", ticker },
      error: "snapshot_pending",
      message: "종목 정보와 가격 데이터를 화면에 반영했어요.",
      ticker,
      queued: false,
    },
  };
}

function pendingFromApiPending(pending: ApiPending | undefined, fallbackTicker: string): SnapshotPendingState | undefined {
  if (!pending) return undefined;
  return snapshotPendingFromPayload(pending.payload, fallbackTicker) || {
    message: pending.message,
    ticker: pending.ticker || fallbackTicker,
    queued: pending.queued,
    retryAfterSeconds: pending.retryAfterSeconds,
  };
}

function pendingFromTicker(ticker: string, message?: string, retryAfterSeconds?: number): SnapshotPendingState {
  return {
    message: message || "종목 정보와 가격 데이터를 화면에 반영했어요.",
    ticker,
    queued: false,
    retryAfterSeconds,
  };
}

function quoteFirstPending(ticker: string): SnapshotPendingState {
  return {
    message: "가격 데이터와 점수, 재무 지표를 계속 맞춰보고 있어요.",
    ticker,
    queued: false,
  };
}

export function detailViewPendingFromResult(result: StockDetailViewResponse, fallbackTicker: string): SnapshotPendingState {
  const ticker = result.ok ? result.ticker || fallbackTicker : fallbackTicker;
  if (result.ok && detailViewHasActiveRecovery(result)) {
    return {
      message: "부족한 데이터가 들어오면 자동으로 업데이트해요.",
      ticker,
      queued: true,
      retryAfterSeconds: detailViewRetryAfterSeconds(result),
    };
  }
  return {
    message: "현재 제공 가능한 데이터만 표시했어요.",
    ticker,
    queued: false,
  };
}

function detailViewHasActiveRecovery(result: StockDetailViewResponse): boolean {
  if (!result.ok || result.mode === "ready") return false;
  if (result.jobs.length > 0) return true;
  return Object.values(result.parts).some((part) => part.state === "refreshing" || part.state === "failed_retrying");
}

function detailViewRetryAfterSeconds(result: StockDetailViewResponse): number | undefined {
  if (!result.ok) return undefined;
  const pollMs = detailViewExplicitPollMs(result) ?? STOCK_DETAIL_VIEW_DEFAULT_POLL_INTERVAL_MS;
  return Math.max(1, Math.ceil(pollMs / 1000));
}

function detailViewExplicitPollMs(result: StockDetailViewResponse): number | undefined {
  if (!result.ok) return undefined;
  return typeof result.nextPollMs === "number" && Number.isFinite(result.nextPollMs) && result.nextPollMs > 0 ? result.nextPollMs : undefined;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
