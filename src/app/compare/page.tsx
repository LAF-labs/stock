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
  const hasTickers = tickers.length > 0;
  return (
    <main className="stock-app compare-app">
      <section className="compare-landing">
        <section className="compare-hero">
          <div>
            <span>종목 비교</span>
            <h1>선택한 종목을 함께 보기</h1>
            <p>{hasTickers ? `${tickers.length}개 종목을 먼저 표시했고, 비교 점수와 가격 데이터는 이어서 준비하고 있어요.` : "비교할 종목을 검색해서 추가해주세요. 최대 5개까지 같은 기준으로 볼 수 있어요."}</p>
          </div>
          <div className="compare-count">{tickers.length}/5</div>
        </section>
        <section className="compare-picks" aria-label="선택된 종목">
          {hasTickers ? tickers.map((ticker, index) => (
            <span key={ticker} className={index === 0 ? "base" : undefined}>
              {displayTickerRef(ticker)}
              {index === 0 ? <b>선택됨</b> : null}
            </span>
          )) : <span>비교할 종목을 추가해주세요</span>}
        </section>
      </section>
      {hasTickers ? <div className="compare-feed" role="status" aria-live="polite">
        <section className="compare-section compare-brief">
          <div className="section-title">
            <span>비교 준비 중</span>
            <h2>준비된 종목부터 채우고 있어요</h2>
          </div>
          <p>종목은 먼저 특정했고, 비교 점수와 가격 데이터는 계속 확인하고 있어요.</p>
        </section>
      </div> : null}
    </main>
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
