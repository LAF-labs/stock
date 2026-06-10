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
import type { StockDisplayPayload } from "@/lib/stockDisplayTypes";

export default function TechnicalAnalysisPage({ ticker, initialDisplayPayload }: { ticker: string; initialDisplayPayload?: StockDisplayPayload }) {
  const detailHref = `/?ticker=${encodeURIComponent(ticker)}`;
  const { state, quote, retryTechnical } = useTechnicalAnalysisQueries(ticker, detailHref, initialDisplayPayload);

  const data = state.status === "success" || state.status === "partial" ? state.data : undefined;
  const technical = state.status === "success" && isTechnicalAnalysisPayload(data?.technical_analysis) ? data.technical_analysis : undefined;
  const identity = data ? stockHeaderIdentity(data) : undefined;
  const displayTicker = identity?.primary || stringFromUnknown(quote?.name) || stringFromUnknown(quote?.symbol) || displayTickerInput(ticker);

  return (
    <main className="stock-app stock-detail-app technical-analysis-app">
      <TechnicalAnalysisTopbar detailHref={detailHref} displayTicker={displayTicker} />

      {state.status === "loading" ? <TechnicalAnalysisSkeleton /> : null}
      {state.status === "pending" ? (
        <TechnicalAnalysisSkeleton title="가격 흐름" actionLabel="다시 확인" onAction={retryTechnical} />
      ) : null}
      {state.status === "error" ? (
        <TechnicalStatus title="조회할 수 없어요" body={state.error} tone="error" actionLabel="다시 시도" onAction={retryTechnical} />
      ) : null}

      {data && technical ? <TechnicalAnalysisFeed data={data} technical={technical} identity={identity} displayTicker={displayTicker} /> : null}
      {state.status === "partial" ? <TechnicalAnalysisPendingFeed data={state.data} identity={identity} displayTicker={displayTicker} /> : null}
    </main>
  );
}
