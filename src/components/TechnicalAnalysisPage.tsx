"use client";

import { useEffect, useState } from "react";
import {
  isTechnicalAnalysisPayload,
  safeInternalRedirectPath,
} from "@/components/technicalAnalysisHelpers";
import { TechnicalAnalysisFeed, TechnicalAnalysisTopbar, TechnicalStatus } from "@/components/TechnicalAnalysisSections";
import { displayTickerInput, scoreDataWithQuote, snapshotPendingFromPayload, stringFromUnknown, stockHeaderIdentity, type SnapshotPendingState } from "@/components/stockDashboardHelpers";
import type { StockQuoteResponse, StockScoreResponse } from "@/lib/types";

type LoadState =
  | { status: "loading"; data?: undefined; error?: undefined; pending?: undefined }
  | { status: "success"; data: StockScoreResponse; error?: undefined; pending?: undefined }
  | { status: "pending"; data?: undefined; error?: undefined; pending: SnapshotPendingState }
  | { status: "error"; data?: undefined; error: string; pending?: undefined };

type ApiPayload = Record<string, unknown>;

async function readApiPayload(response: Response): Promise<ApiPayload> {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error(response.ok ? "서버 응답이 비어 있어요." : `서버 응답이 비어 있어요. (HTTP ${response.status})`);
  }

  try {
    const payload = JSON.parse(text) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("non_object_payload");
    return payload as ApiPayload;
  } catch {
    throw new Error(response.ok ? "서버 응답 형식이 올바르지 않아요." : `서버 오류 응답을 읽지 못했어요. (HTTP ${response.status})`);
  }
}

function apiPayloadMessage(payload: ApiPayload, fallback: string): string {
  return stringFromUnknown(payload.message) || stringFromUnknown(payload.error) || fallback;
}

async function quoteForTechnicalPage(ticker: string, signal: AbortSignal): Promise<StockQuoteResponse | undefined> {
  try {
    const query = new URLSearchParams({ ticker });
    const response = await fetch(`/api/quote?${query.toString()}`, { cache: "no-store", signal });
    if (!response.ok) return undefined;
    const payload = await readApiPayload(response);
    return payload as StockQuoteResponse;
  } catch {
    return undefined;
  }
}

export default function TechnicalAnalysisPage({ ticker }: { ticker: string }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reloadVersion, setReloadVersion] = useState(0);
  const detailHref = `/?ticker=${encodeURIComponent(ticker)}`;

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ ticker, view: "technical" });
    setState({ status: "loading" });

    fetch(`/api/score?${query.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await readApiPayload(response);
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
        const quote = await quoteForTechnicalPage(ticker, controller.signal);
        if (controller.signal.aborted) return;
        setState({ status: "success", data: scoreDataWithQuote(data, quote) });
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
  const displayTicker = identity?.primary || displayTickerInput(ticker);

  return (
    <main className="stock-app stock-detail-app technical-analysis-app">
      <TechnicalAnalysisTopbar detailHref={detailHref} displayTicker={displayTicker} />

      {state.status === "loading" ? <TechnicalStatus title="기술적 분석 준비 중" body="차트 데이터를 확인하고 있어요." /> : null}
      {state.status === "pending" ? (
        <TechnicalStatus title="데이터 준비 중" body={state.pending.message} actionLabel="다시 확인" onAction={() => setReloadVersion((version) => version + 1)} />
      ) : null}
      {state.status === "error" ? (
        <TechnicalStatus title="조회할 수 없어요" body={state.error} tone="error" actionLabel="다시 시도" onAction={() => setReloadVersion((version) => version + 1)} />
      ) : null}

      {data && technical ? <TechnicalAnalysisFeed data={data} technical={technical} identity={identity} displayTicker={displayTicker} /> : null}
    </main>
  );
}
