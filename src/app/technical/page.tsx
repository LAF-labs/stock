import { Suspense } from "react";
import { redirect } from "next/navigation";
import TechnicalAnalysisPage from "@/components/TechnicalAnalysisPage";
import { displayTickerInput } from "@/components/stockDashboardHelpers";
import { detailPathForTicker, technicalEligibilityForTicker } from "@/lib/technicalAnalysisEligibility";

type TechnicalRouteSearchParams = Record<string, string | string[] | undefined>;

type TechnicalRouteProps = {
  searchParams?: TechnicalRouteSearchParams | Promise<TechnicalRouteSearchParams>;
};

export default async function TechnicalPage({ searchParams }: TechnicalRouteProps) {
  const params = await searchParams;
  const rawTicker = firstParam(params?.ticker)?.trim();
  if (!rawTicker) {
    redirect("/");
  }
  const eligibility = await technicalEligibilityForTicker(rawTicker);

  if (!eligibility.eligible) {
    redirect(detailPathForTicker(eligibility.ticker));
  }

  return (
    <Suspense fallback={<TechnicalRouteFallback ticker={eligibility.ticker} />}>
      <TechnicalAnalysisPage ticker={eligibility.ticker} />
    </Suspense>
  );
}

function TechnicalRouteFallback({ ticker }: { ticker: string }) {
  const label = displayTickerInput(ticker);
  return (
    <main className="stock-app stock-detail-app technical-analysis-app">
      <header className="technical-topbar">
        <a href={detailPathForTicker(ticker)}>상세로 돌아가기</a>
        <span>{label}</span>
      </header>
      <div className="technical-feed loading-status-feed" role="status" aria-live="polite">
        <section className="technical-hero neutral technical-pending-hero">
          <div className="technical-hero-heading">
            <span>기술적 분석</span>
            <h1>{label}</h1>
            <p>{ticker.startsWith("KR:") ? "KR" : "US"} · {label}</p>
          </div>
          <div className="technical-summary">
            <span>분석 준비 중</span>
            <strong>종목부터 먼저 보여드려요.</strong>
            <p>종목은 먼저 특정했고, 가격 캔들과 보조지표는 계속 확인하고 있어요.</p>
          </div>
        </section>
      </div>
    </main>
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
