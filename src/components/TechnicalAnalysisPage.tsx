"use client";

import { useEffect, useRef, useState } from "react";
import {
  isTechnicalAnalysisPayload,
  safeInternalRedirectPath,
} from "@/components/technicalAnalysisHelpers";
import { TechnicalAnalysisFeed, TechnicalAnalysisTopbar, TechnicalStatus } from "@/components/TechnicalAnalysisSections";
import { apiPayloadMessage, readClientApiPayload } from "@/components/clientApi";
import { displayTickerInput, scoreDataWithQuote, snapshotPendingFromPayload, stringFromUnknown, stockHeaderIdentity, type SnapshotPendingState } from "@/components/stockDashboardHelpers";
import { technicalPendingRetryDelayMs, usePendingRetry } from "@/components/usePendingRetry";
import type { StockQuoteResponse, StockScoreResponse } from "@/lib/types";

type LoadState =
  | { status: "loading"; data?: undefined; error?: undefined; pending?: undefined }
  | { status: "success"; data: StockScoreResponse; error?: undefined; pending?: undefined }
  | { status: "pending"; data?: undefined; error?: undefined; pending: SnapshotPendingState }
  | { status: "error"; data?: undefined; error: string; pending?: undefined };

async function quoteForTechnicalPage(ticker: string, signal: AbortSignal): Promise<StockQuoteResponse | undefined> {
  try {
    const query = new URLSearchParams({ ticker });
    const response = await fetch(`/api/quote?${query.toString()}`, { cache: "no-store", signal });
    if (!response.ok) return undefined;
    const payload = await readClientApiPayload(response);
    return payload as StockQuoteResponse;
  } catch {
    return undefined;
  }
}

export default function TechnicalAnalysisPage({ ticker }: { ticker: string }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [quote, setQuote] = useState<StockQuoteResponse | undefined>();
  const [reloadVersion, setReloadVersion] = useState(0);
  const quoteRef = useRef<StockQuoteResponse | undefined>(undefined);
  const detailHref = `/?ticker=${encodeURIComponent(ticker)}`;
  const pending = state.status === "pending" ? state.pending : undefined;

  function retryTechnical() {
    setReloadVersion((version) => version + 1);
  }

  usePendingRetry({
    pending,
    retryKey: `technical:${ticker}`,
    onRetry: retryTechnical,
    maxAttempts: 24,
    delayMs: (target, attempt) => technicalPendingRetryDelayMs(target.retryAfterSeconds, attempt),
  });

  useEffect(() => {
    quoteRef.current = quote;
  }, [quote]);

  useEffect(() => {
    const controller = new AbortController();
    setQuote(undefined);
    quoteRef.current = undefined;

    quoteForTechnicalPage(ticker, controller.signal).then((nextQuote) => {
      if (controller.signal.aborted) return;
      setQuote(nextQuote);
    });

    return () => controller.abort();
  }, [ticker]);

  useEffect(() => {
    if (!quote) return;
    setState((current) => {
      if (current.status !== "success") return current;
      return { status: "success", data: scoreDataWithQuote(current.data, quote) };
    });
  }, [quote]);

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ ticker, view: "technical" });
    setState({ status: "loading" });

    fetch(`/api/score?${query.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await readClientApiPayload(response);
        const redirectTo = stringFromUnknown(payload.redirect_to);
        if (!response.ok && payload.error === "technical_unsupported_product" && redirectTo) {
          window.location.assign(safeInternalRedirectPath(redirectTo, detailHref));
          return undefined;
        }
        const pending = snapshotPendingFromPayload(payload, ticker);
        if (pending) {
          setState({ status: "pending", pending });
          return undefined;
        }
        if (!response.ok) throw new Error(apiPayloadMessage(payload, `HTTP ${response.status}`));
        return payload as StockScoreResponse;
      })
      .then(async (data) => {
        if (!data) return;
        if (!isTechnicalAnalysisPayload(data.technical_analysis)) {
          throw new Error("기술적 분석 데이터를 찾지 못했어요.");
        }
        if (controller.signal.aborted) return;
        setState({ status: "success", data: scoreDataWithQuote(data, quoteRef.current) });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", error: error instanceof Error ? error.message : "기술적 분석을 불러오지 못했어요." });
      });

    return () => controller.abort();
  }, [ticker, reloadVersion]);

  const data = state.status === "success" ? state.data : undefined;
  const technical = isTechnicalAnalysisPayload(data?.technical_analysis) ? data.technical_analysis : undefined;
  const identity = data ? stockHeaderIdentity(data) : undefined;
  const displayTicker = identity?.primary || stringFromUnknown(quote?.name) || stringFromUnknown(quote?.symbol) || displayTickerInput(ticker);
  const pendingBody =
    state.status === "pending"
      ? "차트 분석 작업이 대기열에 등록됐어요. 작업이 시작되면 보통 10초 안에 완료되고, 화면은 자동으로 다시 확인합니다."
      : undefined;

  return (
    <main className="stock-app stock-detail-app technical-analysis-app">
      <TechnicalAnalysisTopbar detailHref={detailHref} displayTicker={displayTicker} />

      {state.status === "loading" ? <TechnicalStatus title="기술적 분석 준비 중" body="차트 데이터를 확인하고 있어요." /> : null}
      {state.status === "pending" ? (
        <TechnicalStatus title="데이터 준비 중" body={pendingBody || state.pending.message} actionLabel="다시 확인" onAction={retryTechnical} />
      ) : null}
      {state.status === "error" ? (
        <TechnicalStatus title="조회할 수 없어요" body={state.error} tone="error" actionLabel="다시 시도" onAction={retryTechnical} />
      ) : null}

      {data && technical ? <TechnicalAnalysisFeed data={data} technical={technical} identity={identity} displayTicker={displayTicker} /> : null}
    </main>
  );
}
