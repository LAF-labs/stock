import { Suspense } from "react";
import StockCompare from "@/components/StockCompare";
import { displayTickerRef, parseTickers } from "@/components/stockCompareHelpers";

type CompareRouteSearchParams = Record<string, string | string[] | undefined>;

type CompareRouteProps = {
  searchParams?: CompareRouteSearchParams | Promise<CompareRouteSearchParams>;
};

export default async function ComparePage({ searchParams }: CompareRouteProps) {
  const params = await searchParams;
  const tickers = parseTickers(firstParam(params?.tickers) || firstParam(params?.ticker) || null);

  return (
    <Suspense fallback={<CompareRouteFallback tickers={tickers} />}>
      <StockCompare />
    </Suspense>
  );
}

function CompareRouteFallback({ tickers }: { tickers: string[] }) {
  return (
    <main className="stock-app compare-app">
      <section className="compare-landing">
        <section className="compare-hero">
          <div>
            <span>종목 비교</span>
            <h1>선택한 종목을 함께 보기</h1>
            <p>{tickers.length}개 종목을 먼저 표시했고, 비교 점수와 가격 데이터는 이어서 준비하고 있어요.</p>
          </div>
          <div className="compare-count">{tickers.length}/5</div>
        </section>
        <section className="compare-picks" aria-label="선택된 종목">
          {tickers.map((ticker, index) => (
            <span key={ticker} className={index === 0 ? "base" : undefined}>
              {displayTickerRef(ticker)}
              {index === 0 ? <b>선택됨</b> : null}
            </span>
          ))}
        </section>
      </section>
      <div className="compare-feed" role="status" aria-live="polite">
        <section className="compare-section compare-brief">
          <div className="section-title">
            <span>비교 준비 중</span>
            <h2>준비된 종목부터 채우고 있어요</h2>
          </div>
          <p>종목은 먼저 특정했고, 비교 점수와 가격 데이터는 계속 확인하고 있어요.</p>
        </section>
      </div>
    </main>
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
