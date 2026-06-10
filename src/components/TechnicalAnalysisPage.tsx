"use client";

import { isTechnicalAnalysisPayload } from "@/components/technicalAnalysisHelpers";
import {
  TechnicalAnalysisFeed,
  TechnicalAnalysisPendingFeed,
  TechnicalAnalysisSkeleton,
  TechnicalAnalysisTopbar,
  TechnicalStatus,
} from "@/components/TechnicalAnalysisSections";
import {
  displayTickerInput,
  stringFromUnknown,
  stockHeaderIdentity,
} from "@/components/stockDashboardHelpers";
import { useTechnicalAnalysisQueries } from "@/components/useTechnicalAnalysisQueries";

export default function TechnicalAnalysisPage({ ticker }: { ticker: string }) {
  const detailHref = `/?ticker=${encodeURIComponent(ticker)}`;
  const { state, quote, retryTechnical } = useTechnicalAnalysisQueries(ticker, detailHref);

  const data = state.status === "success" || state.status === "partial" ? state.data : undefined;
  const technical = state.status === "success" && isTechnicalAnalysisPayload(data?.technical_analysis) ? data.technical_analysis : undefined;
  const identity = data ? stockHeaderIdentity(data) : undefined;
  const displayTicker = identity?.primary || stringFromUnknown(quote?.name) || stringFromUnknown(quote?.symbol) || displayTickerInput(ticker);
  const pendingBody =
    state.status === "pending"
      ? "차트 분석 작업이 대기열에 등록됐어요. 화면은 자동으로 다시 확인하고, 준비가 끝나면 기술적 분석을 바로 표시합니다."
      : undefined;

  return (
    <main className="stock-app stock-detail-app technical-analysis-app">
      <TechnicalAnalysisTopbar detailHref={detailHref} displayTicker={displayTicker} />

      {state.status === "loading" ? <TechnicalAnalysisSkeleton body="차트 데이터를 확인하고 있어요." /> : null}
      {state.status === "pending" ? (
        <TechnicalAnalysisSkeleton title="데이터 준비 중" body={pendingBody || state.pending.message} actionLabel="다시 확인" onAction={retryTechnical} />
      ) : null}
      {state.status === "error" ? (
        <TechnicalStatus title="조회할 수 없어요" body={state.error} tone="error" actionLabel="다시 시도" onAction={retryTechnical} />
      ) : null}

      {data && technical ? <TechnicalAnalysisFeed data={data} technical={technical} identity={identity} displayTicker={displayTicker} /> : null}
      {state.status === "partial" ? (
        <TechnicalAnalysisPendingFeed data={state.data} pending={state.pending} identity={identity} displayTicker={displayTicker} onRetry={retryTechnical} />
      ) : null}
    </main>
  );
}
