"use client";

import { useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { isTechnicalAnalysisPayload, safeInternalRedirectPath } from "@/components/technicalAnalysisHelpers";
import {
  partialStockDataFromPayload,
  partialStockDataFromQuote,
  partialStockDataFromTicker,
  scoreDataWithQuote,
  snapshotPendingFromPayload,
  type SnapshotPendingState,
} from "@/components/stockDashboardHelpers";
import { quoteQueryOptions, technicalScoreQueryOptions } from "@/lib/stockQueryOptions";
import type { ApiPending, TechnicalScoreQueryResult } from "@/lib/stockQueryTypes";
import type { StockQuoteResponse, StockScoreResponse } from "@/lib/types";

export type TechnicalLoadState =
  | { status: "loading"; ticker?: string; data?: undefined; error?: undefined; pending?: undefined }
  | { status: "success"; ticker: string; data: StockScoreResponse; error?: undefined; pending?: undefined }
  | { status: "partial"; ticker: string; data: StockScoreResponse; error?: undefined; pending: SnapshotPendingState }
  | { status: "pending"; ticker: string; data?: undefined; error?: undefined; pending: SnapshotPendingState }
  | { status: "error"; ticker: string; data?: undefined; error: string; pending?: undefined };

export type TechnicalAnalysisQueryView = {
  state: TechnicalLoadState;
  quote: StockQuoteResponse | undefined;
  retryTechnical: () => void;
};

export function useTechnicalAnalysisQueries(ticker: string, detailHref: string): TechnicalAnalysisQueryView {
  const scoreQuery = useQuery({
    ...technicalScoreQueryOptions(ticker),
    placeholderData: technicalPlaceholder(ticker),
  });
  const quoteQuery = useQuery(quoteQueryOptions(ticker));
  const quote = quoteQuery.data?.state === "ready" ? quoteQuery.data.data : undefined;

  useEffect(() => {
    const result = scoreQuery.data;
    if (result?.state !== "unsupported") return;
    window.location.assign(safeInternalRedirectPath(result.redirectTo, detailHref));
  }, [detailHref, scoreQuery.data]);

  const retryTechnical = useCallback(() => {
    void scoreQuery.refetch();
    void quoteQuery.refetch();
  }, [quoteQuery, scoreQuery]);

  return {
    state: technicalStateFromQuery(ticker, scoreQuery.data, scoreQuery.error, scoreQuery.isLoading, quote),
    quote,
    retryTechnical,
  };
}

function technicalStateFromQuery(
  ticker: string,
  result: TechnicalScoreQueryResult | undefined,
  error: unknown,
  isLoading: boolean,
  quote: StockQuoteResponse | undefined,
): TechnicalLoadState {
  if (result?.state === "ready") {
    if (!isTechnicalAnalysisPayload(result.data.technical_analysis)) {
      return { status: "error", ticker, error: "기술적 분석 데이터를 찾지 못했어요." };
    }
    return { status: "success", ticker, data: scoreDataWithQuote(result.data, quote) };
  }

  if (result?.state === "partial") {
    const pending = snapshotPendingFromPayload(result.payload, ticker) || pendingFromApiPending(result.pending, ticker) || pendingFromTicker(ticker);
    const partial = partialStockDataFromPayload(result.payload, ticker) || result.data || partialStockDataFromTicker(ticker);
    return { status: "partial", ticker, data: scoreDataWithQuote(partial, quote), pending };
  }

  if (result?.state === "pending") {
    const pending = pendingFromApiPending(result, ticker);
    const quotePartial = quote ? partialStockDataFromQuote(quote, ticker) : undefined;
    if (quotePartial) {
      return {
        status: "partial",
        ticker,
        data: quotePartial,
        pending: pending || quoteFirstPending(ticker),
      };
    }
    return { status: "pending", ticker, pending: pending || pendingFromTicker(ticker, result.message, result.retryAfterSeconds) };
  }

  if (result?.state === "unsupported") {
    return { status: "error", ticker, error: "지원하지 않는 상품이라 상세 화면으로 이동하고 있어요." };
  }

  if (error) {
    const quotePartial = quote ? partialStockDataFromQuote(quote, ticker) : undefined;
    if (quotePartial) {
      return {
        status: "partial",
        ticker,
        data: quotePartial,
        pending: quoteFirstPending(ticker),
      };
    }
    return { status: "error", ticker, error: errorMessage(error, "기술적 분석을 불러오지 못했어요.") };
  }

  if (isLoading) {
    const quotePartial = quote ? partialStockDataFromQuote(quote, ticker) : undefined;
    return {
      status: "partial",
      ticker,
      data: quotePartial || partialStockDataFromTicker(ticker),
      pending: quotePartial ? quoteFirstPending(ticker) : pendingFromTicker(ticker),
    };
  }

  return {
    status: "partial",
    ticker,
    data: partialStockDataFromTicker(ticker),
    pending: pendingFromTicker(ticker),
  };
}

function technicalPlaceholder(ticker: string): TechnicalScoreQueryResult {
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
      message: "종목은 먼저 특정했고, 가격 캔들과 보조지표는 계속 확인하고 있어요.",
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
    message: message || "종목은 먼저 특정했고, 가격 캔들과 보조지표는 계속 확인하고 있어요.",
    ticker,
    queued: false,
    retryAfterSeconds,
  };
}

function quoteFirstPending(ticker: string): SnapshotPendingState {
  return {
    message: "가격 데이터는 먼저 확인했고, 차트 분석을 이어서 준비하고 있어요.",
    ticker,
    queued: false,
  };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
