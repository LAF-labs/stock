import { Suspense } from "react";
import StockDashboard from "@/components/StockDashboard";
import { dashboardInputValue, dashboardTickerFromSearchParam } from "@/components/stockDashboardHelpers";

type DashboardRouteSearchParams = Record<string, string | string[] | undefined>;

type DashboardRouteProps = {
  searchParams?: DashboardRouteSearchParams | Promise<DashboardRouteSearchParams>;
};

export default async function Page({ searchParams }: DashboardRouteProps) {
  const params = await searchParams;
  const ticker = dashboardTickerFromSearchParam(firstParam(params?.ticker) || null);

  return (
    <Suspense fallback={<DashboardRouteFallback ticker={ticker} />}>
      <StockDashboard />
    </Suspense>
  );
}

function DashboardRouteFallback({ ticker }: { ticker: string | undefined }) {
  if (!ticker) return <main className="page-shell">로딩 중...</main>;

  const label = dashboardInputValue(ticker);
  return (
    <main className="stock-app stock-detail-app">
      <h1 className="sr-only">{label} 주식 상세</h1>
      <div className="stock-feed loading-status-feed" role="status" aria-live="polite">
        <section className="stock-title-card partial-stock-title-card">
          <div className="stock-hero-main">
            <div className="stock-name-row">
              <div>
                <span>{ticker.startsWith("KR:") ? "KR" : "US"} · 최근 가격</span>
                <h2 className="ticker-primary">{label}</h2>
              </div>
            </div>
            <span className="score-time-chip">점수 준비 중</span>
          </div>
          <div className="price-strip">
            <div className="price-block">
              <strong>-</strong>
              <span>가격 확인 중</span>
            </div>
            <em className="daily-pill price-neutral">대기 중</em>
          </div>
          <div className="hero-verdict neutral partial-verdict">
            <span>오늘의 판단</span>
            <strong>종목부터 먼저 보여드려요.</strong>
            <p>종목은 먼저 특정했고, 가격과 점수 데이터는 계속 확인하고 있어요.</p>
          </div>
        </section>
      </div>
    </main>
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
