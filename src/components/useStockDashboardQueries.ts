"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { JudgmentState, QuoteRefreshState, QuoteState } from "@/components/StockHeader";
import {
  partialStockDataFromPayload,
  partialStockDataFromQuote,
  partialStockDataFromTicker,
  refreshCooldownMessage,
  scoreDataWithQuote,
  snapshotPendingFromPayload,
  stringFromUnknown,
  stockJudgmentRequestPayload,
  type SnapshotPendingState,
} from "@/components/stockDashboardHelpers";
import { refreshQuote as refreshQuoteRequest } from "@/lib/stockQueryFns";
import {
  judgmentQueryOptions,
  quoteDataFromQueryResult,
  quoteQueryDataFromRefreshResult,
  quoteQueryDataFromScore,
  quoteQueryOptions,
  scoreQueryOptions,
} from "@/lib/stockQueryOptions";
import { stockQueryKeys } from "@/lib/stockQueryKeys";
import type { ApiPending, QuoteQueryResult, QuoteRefreshMutationResult, ScoreQueryResult } from "@/lib/stockQueryTypes";
import type { StockJudgment, StockQuoteResponse, StockScoreResponse } from "@/lib/types";

export type DashboardLoadState =
  | { status: "idle" | "loading"; data?: undefined; error?: undefined }
  | { status: "success"; data: StockScoreResponse; error?: undefined }
  | { status: "partial"; data: StockScoreResponse; error?: undefined; pending: SnapshotPendingState }
  | { status: "pending"; data?: undefined; error?: undefined; pending: SnapshotPendingState }
  | { status: "error"; data?: undefined; error: string };

export type StockDashboardQueryView = {
  state: DashboardLoadState;
  quoteState: QuoteState;
  quoteRefreshState: QuoteRefreshState;
  judgmentState: JudgmentState;
  scorePending: SnapshotPendingState | undefined;
  quotePending: SnapshotPendingState | undefined;
  quoteData: StockQuoteResponse | undefined;
  data: StockScoreResponse | undefined;
  partialData: StockScoreResponse | undefined;
  retryLoad: () => void;
  refreshQuote: () => void;
};

export function useStockDashboardQueries(ticker: string | undefined): StockDashboardQueryView {
  const queryClient = useQueryClient();
  const enabled = Boolean(ticker);
  const tickerKey = ticker || "__stock-dashboard-disabled__";
  const scoreQuery = useQuery({
    ...scoreQueryOptions(tickerKey, "detail"),
    enabled,
    placeholderData: enabled ? scorePlaceholder(tickerKey) : undefined,
  });
  const quoteQuery = useQuery({
    ...quoteQueryOptions(tickerKey),
    enabled,
  });

  const quoteData = quoteDataFromQueryResult(quoteQuery.data);
  const rawScoreData = scoreQuery.data?.state === "ready" ? scoreQuery.data.data : undefined;
  const judgmentPayload = useMemo(() => (rawScoreData ? stockJudgmentRequestPayload(rawScoreData) : undefined), [rawScoreData]);
  const judgmentInputHash = useMemo(() => (judgmentPayload ? stablePayloadHash(judgmentPayload) : ""), [judgmentPayload]);
  const scoreVersion = stringFromUnknown(rawScoreData?.score_model_version) || stringFromUnknown(rawScoreData?.server_cache?.fetched_at) || "score";
  const judgmentQuery = useQuery(
    judgmentQueryOptions({
      ticker: tickerKey,
      scoreVersion,
      inputHash: judgmentInputHash,
      payload: judgmentPayload,
    })
  );

  const quoteRefreshMutation = useMutation({
    mutationFn: (requestedTicker: string) => refreshQuoteRequest(requestedTicker),
    onSuccess: (result, requestedTicker) => {
      queryClient.setQueryData(stockQueryKeys.quote(requestedTicker), (previous: QuoteQueryResult | undefined) => quoteQueryDataFromRefreshResult(result, previous));
    },
  });

  const refreshResult = quoteRefreshMutation.variables === ticker ? quoteRefreshMutation.data : undefined;
  const refreshError = quoteRefreshMutation.variables === ticker ? quoteRefreshMutation.error : undefined;
  const refreshPending = quoteRefreshMutation.variables === ticker && quoteRefreshMutation.isPending;
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

  const quoteRefreshState = quoteRefreshStateFromMutation(refreshResult, refreshPending, refreshError, cooldownTick);
  const state = dashboardStateFromQuery({
    ticker,
    scoreResult: scoreQuery.data,
    scoreError: scoreQuery.error,
    isScoreLoading: scoreQuery.isLoading,
    quoteData,
  });
  const quoteState = quoteStateFromQuery(ticker, quoteQuery.data, quoteQuery.error, quoteQuery.isLoading);
  const judgmentState = judgmentStateFromQuery(rawScoreData ? judgmentQuery.data?.data : undefined, judgmentQuery.error, judgmentQuery.isLoading && Boolean(rawScoreData));
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
    if (!ticker || !rawScoreData) return;
    queryClient.setQueryData(stockQueryKeys.quote(ticker), (previous: QuoteQueryResult | undefined) => quoteQueryDataFromScore(rawScoreData, ticker, previous));
  }, [queryClient, rawScoreData, ticker]);

  const retryLoad = useCallback(() => {
    if (!ticker) return;
    void scoreQuery.refetch();
    void quoteQuery.refetch();
    if (rawScoreData) void judgmentQuery.refetch();
  }, [judgmentQuery, quoteQuery, rawScoreData, scoreQuery, ticker]);

  const refreshQuote = useCallback(() => {
    if (!ticker) return;
    if (quoteRefreshState.status === "refreshing" || quoteRefreshState.status === "cooldown" || quoteRefreshState.status === "pending") return;
    quoteRefreshMutation.mutate(ticker);
  }, [quoteRefreshMutation, quoteRefreshState.status, ticker]);

  return {
    state,
    quoteState,
    quoteRefreshState,
    judgmentState,
    scorePending,
    quotePending,
    quoteData,
    data,
    partialData,
    retryLoad,
    refreshQuote,
  };
}

function dashboardStateFromQuery({
  ticker,
  scoreResult,
  scoreError,
  isScoreLoading,
  quoteData,
}: {
  ticker: string | undefined;
  scoreResult: ScoreQueryResult | undefined;
  scoreError: unknown;
  isScoreLoading: boolean;
  quoteData: StockQuoteResponse | undefined;
}): DashboardLoadState {
  if (!ticker) return { status: "idle" };

  if (scoreResult?.state === "ready") {
    return { status: "success", data: scoreDataWithQuote(scoreResult.data, quoteData) };
  }

  if (scoreResult?.state === "partial") {
    const pending = snapshotPendingFromPayload(scoreResult.payload, ticker) || pendingFromApiPending(scoreResult.pending, ticker) || pendingFromTicker(ticker);
    const partial = partialStockDataFromPayload(scoreResult.payload, ticker) || scoreResult.data || partialStockDataFromTicker(ticker);
    return { status: "partial", data: scoreDataWithQuote(partial, quoteData), pending };
  }

  if (scoreResult?.state === "pending") {
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
    const quotePartial = quoteData ? partialStockDataFromQuote(quoteData, ticker) : undefined;
    return {
      status: "partial",
      data: quotePartial || partialStockDataFromTicker(ticker),
      pending: quotePartial ? quoteFirstPending(ticker) : pendingFromTicker(ticker),
    };
  }

  return {
    status: "partial",
    data: partialStockDataFromTicker(ticker),
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
        message: pendingFromApiPending(result.pending, ticker)?.message || "현재가를 다시 확인하고 있어요.",
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

function quoteRefreshStateFromMutation(
  result: QuoteRefreshMutationResult | undefined,
  isPending: boolean,
  error: unknown,
  cooldownTick: number
): QuoteRefreshState {
  void cooldownTick;
  if (isPending) return { status: "refreshing", message: "최신 현재가 확인 중" };
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

function judgmentStateFromQuery(judgment: StockJudgment | undefined, error: unknown, isLoading: boolean): JudgmentState {
  if (judgment) return { status: "success", judgment };
  if (error) return { status: "error", error: errorMessage(error, "판단을 불러오지 못했어요.") };
  return isLoading ? { status: "loading" } : { status: "idle" };
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
      message: "종목은 먼저 특정했고, 가격과 점수 데이터는 계속 확인하고 있어요.",
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
    message: message || "종목은 먼저 특정했고, 가격과 점수 데이터는 계속 확인하고 있어요.",
    ticker,
    queued: false,
    retryAfterSeconds,
  };
}

function quoteFirstPending(ticker: string): SnapshotPendingState {
  return {
    message: "가격 데이터는 먼저 확인했고, 점수와 재무 지표를 이어서 준비하고 있어요.",
    ticker,
    queued: false,
  };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function stablePayloadHash(payload: Record<string, unknown>): string {
  let hash = 2_166_136_261;
  const normalized = stableStringify(payload);
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}
