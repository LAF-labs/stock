"use client";

import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChartStory, FactorStory, NewsFeed, RecordCard, SimpleList } from "@/components/StockDetailSections";
import StockHeader from "@/components/StockHeader";
import { StockDetailLoadingSkeleton } from "@/components/StockLoadingSkeletons";
import SymbolAutocomplete from "@/components/SymbolAutocomplete";
import { stockDisplayPayloadIsComplete, stockScoreDataFromDisplayPayload } from "@/components/stockDisplayAdapters";
import {
  chooseRicherStockData,
  dashboardInputValue,
  dashboardSearchInputValue,
  dashboardSearchSyncDecision,
  dashboardTickerFromSearchParam,
  dailyChangeText,
  dailyToneClass,
  formatPrimaryPrice,
  formatSecondaryPrice,
  scoreDataWithQuote,
  shouldShowStockSkeleton,
  stockMarketCapDisplay,
  strongestAndWeakest,
  stringFromUnknown,
  stockHeaderIdentity,
  symbolRef,
  usableChartPoints,
  visibleRecordEntries,
  type SnapshotPendingState,
} from "@/components/stockDashboardHelpers";
import { useStockDashboardQueries } from "@/components/useStockDashboardQueries";
import { clampScore } from "@/lib/format";
import { technicalAnalysisHrefForPayload } from "@/lib/technicalAnalysisLinks";
import type { SymbolSearchItem } from "@/lib/symbolTypes";
import type { StockDisplayPayload } from "@/lib/stockDisplayTypes";
import type { StockQuoteResponse, StockScoreResponse } from "@/lib/types";

const DETAIL_SECTIONS = [
  { id: "detail-summary", label: "요약" },
  { id: "detail-chart", label: "가격 흐름" },
  { id: "detail-factors", label: "점수 이유" },
  { id: "detail-key-metrics", label: "핵심 숫자" },
  { id: "detail-news", label: "뉴스" },
  { id: "detail-profile", label: "회사 정보" },
  { id: "detail-valuation", label: "가격 부담" },
  { id: "detail-financials", label: "재무 요약" },
] as const;

type DetailSectionId = (typeof DETAIL_SECTIONS)[number]["id"];

function compareHrefForStock(data: StockScoreResponse, quote: StockQuoteResponse | undefined, fallbackTicker: string): string {
  const rawSymbol = stringFromUnknown(quote?.symbol) || stringFromUnknown(data.symbol) || stringFromUnknown(data.requested_ticker) || fallbackTicker;
  const symbol = rawSymbol.replace(/^(US|KR):/i, "");
  const market = stringFromUnknown(quote?.market) || stringFromUnknown(data.market) || (fallbackTicker.startsWith("KR:") ? "KR" : "US");
  const ticker = `${market === "KR" ? "KR" : "US"}:${symbol}`;
  const params = new URLSearchParams({ tickers: ticker, origin: ticker });
  return `/compare?${params.toString()}`;
}


type StockDashboardProps = {
  initialDisplayPayload?: StockDisplayPayload;
};

export default function StockDashboard({ initialDisplayPayload }: StockDashboardProps = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tickerParam = dashboardTickerFromSearchParam(searchParams.get("ticker"));
  const initialDisplayData = useMemo(
    () => initialDisplayPayload && initialDisplayPayload.ticker === tickerParam ? stockScoreDataFromDisplayPayload(initialDisplayPayload) : undefined,
    [initialDisplayPayload, tickerParam]
  );
  const initialDisplayComplete = Boolean(
    initialDisplayPayload && initialDisplayPayload.ticker === tickerParam && stockDisplayPayloadIsComplete(initialDisplayPayload),
  );

  const [tickerInput, setTickerInput] = useState(() => (
    tickerParam ? dashboardSearchInputValue(initialDisplayData, undefined, tickerParam) : ""
  ));
  const [isSearchEditing, setIsSearchEditing] = useState(false);
  const {
    state,
    quoteState,
    priceRefreshState,
    judgmentState,
    quoteData,
    data,
    partialData,
    retryLoad,
    refreshPrice,
  } = useStockDashboardQueries(tickerParam);
  const displayData = data || (initialDisplayComplete ? initialDisplayData : undefined);
  const displayPartialData = chooseRicherStockData(partialData, !data ? initialDisplayData : undefined);
  const [activeSection, setActiveSection] = useState<DetailSectionId>("detail-summary");
  const [isSearchCollapsed, setIsSearchCollapsed] = useState(false);
  const lastScrollYRef = useRef(0);
  const isSearchCollapsedRef = useRef(false);
  const previousTickerParamRef = useRef(tickerParam);

  function setSearchCollapsed(nextCollapsed: boolean) {
    if (isSearchCollapsedRef.current === nextCollapsed) return;
    isSearchCollapsedRef.current = nextCollapsed;
    setIsSearchCollapsed(nextCollapsed);
  }

  useEffect(() => {
    let ticking = false;
    lastScrollYRef.current = window.scrollY;

    function updateSearchChrome() {
      const scrollY = window.scrollY;
      const delta = scrollY - lastScrollYRef.current;

      if (scrollY <= 16) {
        setSearchCollapsed(false);
      } else if (delta > 8 && scrollY > 92) {
        setSearchCollapsed(true);
      } else if (delta < -24) {
        setSearchCollapsed(false);
      }

      lastScrollYRef.current = scrollY;
      ticking = false;
    }

    function onScroll() {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(updateSearchChrome);
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const stockData = data || partialData || initialDisplayData;
    const decision = dashboardSearchSyncDecision({
      tickerParam,
      previousTickerParam: previousTickerParamRef.current,
      isSearchEditing,
      data: stockData,
      quote: quoteData,
    });

    previousTickerParamRef.current = decision.previousTickerParam;
    if (decision.action === "none") return;

    setIsSearchEditing(decision.isSearchEditing);
    setTickerInput(decision.value);
  }, [data, initialDisplayData, isSearchEditing, partialData, quoteData, tickerParam]);

  function handleTickerInputChange(value: string) {
    setIsSearchEditing(true);
    setTickerInput(value);
  }

  function selectSymbol(item: SymbolSearchItem) {
    setIsSearchEditing(false);
    router.push(`/?ticker=${encodeURIComponent(symbolRef(item))}`);
  }

  const visibleDetailSections = DETAIL_SECTIONS;
  const compareHref = displayData && tickerParam ? compareHrefForStock(displayData, quoteData, tickerParam) : "";
  const pageIdentity = displayData ? stockHeaderIdentity(displayData, quoteData) : undefined;
  const pageTitle = tickerParam ? `${pageIdentity?.primary || dashboardInputValue(tickerParam)} 주식 상세` : "주식 점수 검색";

  useEffect(() => {
    if (!displayData || !visibleDetailSections.length) return;

    const sectionIds = visibleDetailSections.map((section) => section.id);
    let frame = 0;

    const updateActiveSection = () => {
      if (frame) return;

      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const anchorTop = 190;
        const sectionPositions = sectionIds
          .map((id) => {
            const element = document.getElementById(id);
            return element ? { id, top: element.getBoundingClientRect().top } : undefined;
          })
          .filter((section): section is { id: DetailSectionId; top: number } => !!section);

        if (!sectionPositions.length) return;

        const current = sectionPositions.reduce((candidate, section) => (section.top <= anchorTop ? section : candidate), sectionPositions[0]);
        setActiveSection(current.id);
      });
    };

    updateActiveSection();
    window.addEventListener("scroll", updateActiveSection, { passive: true });
    window.addEventListener("resize", updateActiveSection);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", updateActiveSection);
      window.removeEventListener("resize", updateActiveSection);
    };
  }, [displayData, visibleDetailSections]);

  function scrollToDetailSection(id: DetailSectionId) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const searchSectionClassName = ["stock-search", isSearchCollapsed ? "search-collapsed" : ""].filter(Boolean).join(" ");

  return (
    <main className="stock-app stock-detail-app">
      <h1 className="sr-only">{pageTitle}</h1>
      <section className={searchSectionClassName}>
        <SymbolAutocomplete
          id="ticker"
          value={tickerInput}
          onValueChange={handleTickerInputChange}
          onSelect={selectSymbol}
          placeholder="종목명이나 티커 검색"
          label="국내·미국 주식 검색"
          className="stock-search-form"
          variant="floating"
          formAction="/"
          inputName="ticker"
          isCollapsed={isSearchCollapsed}
          onExpandRequest={() => setSearchCollapsed(false)}
        />
      </section>

      {tickerParam && !displayData && shouldShowStockSkeleton(state.status, Boolean(displayPartialData)) && (
        <StockDetailLoadingSkeleton tickerLabel={dashboardInputValue(tickerParam)} />
      )}
      {tickerParam && state.status === "error" && <StatusCard title="조회할 수 없어요" body={state.error} tone="error" actionLabel="다시 시도" onAction={retryLoad} />}
      {!tickerParam && <DashboardLandingHero />}

      {displayPartialData && !displayData ? (
        <PartialStockFeed data={displayPartialData} quote={quoteData} pending={state.status === "partial" ? state.pending : undefined} onRetry={retryLoad} />
      ) : null}

      {displayData && (
        <>
          <DetailIndex
            sections={visibleDetailSections}
            activeSection={activeSection}
            onSelect={scrollToDetailSection}
            compareHref={compareHref}
          />
          <div className="stock-feed">
            <DetailSection id="detail-summary">
              <StockHeader
                data={displayData}
                quote={quoteData}
                quoteState={quoteState}
                priceRefreshState={priceRefreshState}
                onRefreshPrice={refreshPrice}
                judgmentState={judgmentState}
                compareHref={compareHref}
              />
            </DetailSection>
            <DetailSection id="detail-chart">
              <ChartStory points={displayData.chart_series} patterns={displayData.chart_patterns} technicalAnalysisHref={technicalAnalysisHrefForPayload(displayData)} />
            </DetailSection>
            <DetailSection id="detail-factors">
              <FactorStory components={displayData.components} stock={displayData} eyebrow="품질 점수 이유" title="기초체력과 가격 부담" />
              {displayData.opportunity_components?.length ? (
                <FactorStory components={displayData.opportunity_components} stock={displayData} eyebrow="기회 점수 이유" title="지금 볼 만한 근거" />
              ) : null}
            </DetailSection>
            <DetailSection id="detail-key-metrics">
              <SimpleList title="핵심 숫자" description="처음엔 이 숫자만 봐도 충분해요." items={displayData.key_metrics} stock={displayData} defaultOpen />
            </DetailSection>
            <DetailSection id="detail-news">
              <NewsFeed news={displayData.news} />
            </DetailSection>
            <DetailSection id="detail-profile">
              <SimpleList title="회사 정보" description="어떤 회사인지 빠르게 확인해요." items={displayData.stock_profile} stock={displayData} desktopOpen />
            </DetailSection>
            <DetailSection id="detail-valuation">
              <SimpleList title="가격 부담" description="좋은 회사라도 너무 비싸면 부담이 될 수 있어요." items={displayData.valuation_rows} stock={displayData} desktopOpen />
            </DetailSection>
            <DetailSection id="detail-financials">
              <RecordCard title="재무 요약" description="회사의 체력을 볼 때 참고하는 숫자예요." record={displayData.financials} stock={displayData} desktopOpen />
            </DetailSection>
          </div>
        </>
      )}
    </main>
  );
}

function PartialStockFeed({
  data,
  quote,
  onRetry,
}: {
  data: StockScoreResponse;
  quote: StockQuoteResponse | undefined;
  pending: SnapshotPendingState | undefined;
  onRetry: () => void;
}) {
  const hasChart = usableChartPoints(data.chart_series).length >= 2;
  const hasFactors = Boolean(data.components?.length || data.opportunity_components?.length);
  const hasMetrics = Boolean(data.key_metrics?.length);
  const hasProfile = Boolean(data.stock_profile?.length);
  const hasValuation = Boolean(data.valuation_rows?.length);
  const hasFinancials = Boolean(data.financials && visibleRecordEntries(data.financials).length);

  return (
    <div className="stock-feed partial-stock-feed" role="status" aria-live="polite">
      <DetailSection id="detail-summary">
        <PartialStockSummary data={data} quote={quote} onRetry={onRetry} />
      </DetailSection>
      {hasChart ? (
        <DetailSection id="detail-chart">
          <ChartStory points={data.chart_series} patterns={data.chart_patterns} />
        </DetailSection>
      ) : null}
      {hasFactors ? (
        <DetailSection id="detail-factors">
          {data.components?.length ? <FactorStory components={data.components} stock={data} eyebrow="품질 점수 이유" title="기초체력과 가격 부담" /> : null}
          {data.opportunity_components?.length ? <FactorStory components={data.opportunity_components} stock={data} eyebrow="기회 점수 이유" title="지금 볼 만한 근거" /> : null}
        </DetailSection>
      ) : null}
      {hasMetrics ? (
        <DetailSection id="detail-key-metrics">
          <SimpleList title="핵심 숫자" description="처음엔 이 숫자만 봐도 충분해요." items={data.key_metrics} stock={data} defaultOpen />
        </DetailSection>
      ) : null}
      {hasProfile ? (
        <DetailSection id="detail-profile">
          <SimpleList title="회사 정보" description="어떤 회사인지 빠르게 확인해요." items={data.stock_profile} stock={data} desktopOpen />
        </DetailSection>
      ) : null}
      {hasValuation ? (
        <DetailSection id="detail-valuation">
          <SimpleList title="가격 부담" description="좋은 회사라도 너무 비싸면 부담이 될 수 있어요." items={data.valuation_rows} stock={data} desktopOpen />
        </DetailSection>
      ) : null}
      {hasFinancials ? (
        <DetailSection id="detail-financials">
          <RecordCard title="재무 요약" description="회사의 체력을 볼 때 참고하는 숫자예요." record={data.financials} stock={data} desktopOpen />
        </DetailSection>
      ) : null}
    </div>
  );
}

function PartialStockSummary({
  data,
  quote,
  onRetry,
}: {
  data: StockScoreResponse;
  quote: StockQuoteResponse | undefined;
  onRetry: () => void;
}) {
  const displayData = scoreDataWithQuote(data, quote);
  const identity = stockHeaderIdentity(displayData, quote);
  const daily = dailyChangeText(displayData, quote);
  const latestBarDate = quote?.latest_bar_date || displayData.latest_bar_date || "최근 가격";
  const hasPrice = typeof displayData.latest_price === "number" && Number.isFinite(displayData.latest_price);
  const rawScore = displayData.quality_score ?? displayData.score;
  const qualityScore = typeof rawScore === "number" && Number.isFinite(rawScore) ? clampScore(rawScore) : undefined;
  const { strongest, weakest } = strongestAndWeakest(displayData);
  const marketCap = stockMarketCapDisplay(displayData);
  const summary = displayData.summary || (qualityScore === undefined ? (hasPrice ? "현재 확인된 가격 정보를 먼저 반영했어요." : "종목 정보를 확인했어요.") : "가격과 빠른 점수를 먼저 반영했어요.");

  return (
    <section className="stock-title-card partial-stock-title-card">
      <div className="stock-hero-main">
        <div className="stock-name-row">
          <div>
            <span>{quote?.exchange || displayData.exchange || displayData.market || "시장"} · {latestBarDate}</span>
            <h2 className={identity.primaryKind === "name" ? "name-primary" : "ticker-primary"}>{identity.primary}</h2>
            {identity.secondary ? <p>{identity.secondary}</p> : null}
          </div>
        </div>
        <span className="score-time-chip">{qualityScore === undefined ? (hasPrice ? "현재가 확인" : "종목 확인") : "빠른 점수"}</span>
      </div>
      <div className="price-strip">
        <div className="price-block">
          <strong>{formatPrimaryPrice(displayData)}</strong>
          <span>{formatSecondaryPrice(displayData)}</span>
        </div>
        <em className={`daily-pill ${dailyToneClass(daily)}`}>{daily}</em>
      </div>
      <div className="quick-read">
        <article className="quick-metric-card">
          <span>강점</span>
          <strong>{strongest?.label || (hasPrice ? "가격 확인" : identity.primary)}</strong>
        </article>
        <article className="quick-metric-card">
          <span>먼저 볼 것</span>
          <strong>{weakest?.label || daily}</strong>
        </article>
        <article className="quick-metric-card">
          <span>시가총액</span>
          <strong>{marketCap.primary}</strong>
          {marketCap.secondary ? <small>{marketCap.secondary}</small> : null}
        </article>
        {qualityScore !== undefined ? (
          <article className="score-panel">
            <span>품질 점수</span>
            <strong className="partial-pending-score">{qualityScore.toFixed(1)}</strong>
          </article>
        ) : null}
      </div>
      <div className="hero-verdict neutral partial-verdict">
        <span>오늘의 판단</span>
        <strong>{qualityScore === undefined ? (hasPrice ? "현재 가격 기준으로 먼저 볼 수 있어요." : "종목 정보를 먼저 확인했어요.") : `${qualityScore.toFixed(1)}점 기준으로 먼저 볼 수 있어요.`}</strong>
        <p>{summary}</p>
        <button type="button" className="partial-retry-button" onClick={onRetry}>
          새로고침
        </button>
      </div>
    </section>
  );
}

function DashboardLandingHero() {
  return (
    <section className="dashboard-landing" aria-label="주식 점수 검색 시작">
      <article className="landing-story-section dashboard-landing-hero">
        <div className="landing-copy">
          <span>AI Stock Score</span>
          <h2>종목만 입력하세요</h2>
          <p>검색 한 번으로 투자 후보를 압축합니다.</p>
          <div className="landing-proof-list">
            <span>한글 종목명·해외 티커 모두 검색</span>
            <span>품질 점수와 기회 점수를 동시에 확인</span>
            <span>관심 종목은 상세 분석으로 바로 연결</span>
          </div>
        </div>

        <div className="landing-visual landing-stock-visual" aria-hidden="true">
          <div className="landing-grid" />
          <div className="landing-scanline" />
          <div className="landing-score-stack">
            <div className="landing-score-card">
              <span>QUALITY</span>
              <strong>82</strong>
            </div>
            <div className="landing-score-card secondary">
              <span>OPPORTUNITY</span>
              <strong>74</strong>
            </div>
          </div>
          <div className="landing-stock-loop">
            <div className="landing-loop-window">
              <div className="landing-loop-track">
                <div className="landing-loop-group">
                  <span>NVDA</span>
                  <span>애플</span>
                  <span>TSLA</span>
                  <span>엔비디아</span>
                  <span>삼성전자</span>
                  <span>SK하이닉스</span>
                  <span>현대차</span>
                  <span>네이버</span>
                </div>
                <div className="landing-loop-group" aria-hidden="true">
                  <span>NVDA</span>
                  <span>애플</span>
                  <span>TSLA</span>
                  <span>엔비디아</span>
                  <span>삼성전자</span>
                  <span>SK하이닉스</span>
                  <span>현대차</span>
                  <span>네이버</span>
                </div>
              </div>
            </div>
          </div>
          <div className="landing-console">
            <span>신호 확인</span>
            <i />
            <span>점수 동기화</span>
          </div>
        </div>
      </article>

      <article className="landing-story-section landing-story-info">
        <div className="landing-copy">
          <span>Company Brief</span>
          <h2>종목 정보 확인</h2>
          <p>처음 보는 회사도 핵심 맥락부터 잡습니다.</p>
          <div className="landing-proof-list">
            <span>시총·섹터·재무를 한 화면에서 정리</span>
            <span>뉴스와 밸류에이션 부담을 함께 확인</span>
            <span>국내·해외 종목 표기를 읽기 쉽게 변환</span>
          </div>
        </div>

        <div className="landing-visual landing-info-visual" aria-hidden="true">
          <div className="landing-grid" />
          <div className="landing-info-orbit">
            <span>섹터</span>
            <span>시총</span>
            <span>재무</span>
          </div>
          <div className="landing-info-panel">
            <span>AI 반도체</span>
            <strong>상위 1%</strong>
            <i />
          </div>
          <div className="landing-info-list">
            <span>
              매출
              <b>+18%</b>
            </span>
            <span>
              마진
              <b>개선</b>
            </span>
            <span>
              뉴스
              <b>확인</b>
            </span>
          </div>
        </div>
      </article>

      <article className="landing-story-section landing-story-technical">
        <div className="landing-copy">
          <span>Technical Flow</span>
          <h2>기술적 분석</h2>
          <p>가격 흐름을 점수와 분리해서 봅니다.</p>
          <div className="landing-proof-list">
            <span>추세·변동성·신호를 따로 해석</span>
            <span>차트 패턴과 단기 리스크를 구분</span>
            <span>기술적 분석 화면으로 바로 이동</span>
          </div>
        </div>

        <div className="landing-visual landing-technical-visual" aria-hidden="true">
          <div className="landing-grid" />
          <div className="landing-chart-stage">
            <div className="landing-chart-bars">
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
            </div>
            <div className="landing-chart-line">
              <i />
            </div>
          </div>
          <div className="landing-signal-row">
            <span>추세</span>
            <b>상승</b>
            <span>변동성</span>
            <b>중립</b>
          </div>
        </div>
      </article>

      <article className="landing-story-section landing-story-compare">
        <div className="landing-copy">
          <span>Compare Mode</span>
          <h2>종목별 비교</h2>
          <p>고민 중인 종목을 같은 기준에 올립니다.</p>
          <div className="landing-proof-list">
            <span>후보를 나란히 비교</span>
            <span>점수·재무·밸류에이션을 한 번에 대조</span>
            <span>가장 강한 지표를 자동으로 강조</span>
          </div>
        </div>

        <div className="landing-visual landing-compare-visual" aria-hidden="true">
          <div className="landing-grid" />
          <div className="landing-compare-board">
            <div className="landing-compare-card" style={{ "--landing-line": "86%" } as CSSProperties}>
              <span>AAPL</span>
              <strong>86</strong>
              <i />
            </div>
            <div className="landing-compare-card" style={{ "--landing-line": "78%" } as CSSProperties}>
              <span>삼성전자</span>
              <strong>78</strong>
              <i />
            </div>
            <div className="landing-compare-card" style={{ "--landing-line": "72%" } as CSSProperties}>
              <span>MSFT</span>
              <strong>72</strong>
              <i />
            </div>
          </div>
        </div>
      </article>
    </section>
  );
}

function DetailIndex({
  sections,
  activeSection,
  onSelect,
  compareHref,
}: {
  sections: ReadonlyArray<{ id: DetailSectionId; label: string }>;
  activeSection: DetailSectionId;
  onSelect: (id: DetailSectionId) => void;
  compareHref: string;
}) {
  return (
    <nav className="stock-detail-index" aria-label="상세 화면 목차">
      <span>목차</span>
      <div>
        {sections.map((section) => (
          <button
            key={section.id}
            type="button"
            className={activeSection === section.id ? "active" : undefined}
            aria-current={activeSection === section.id ? "true" : undefined}
            onClick={() => onSelect(section.id)}
          >
            {section.label}
          </button>
        ))}
      </div>
      <a className="stock-detail-index-action" href={compareHref}>
        다른 종목과 비교하기
      </a>
    </nav>
  );
}

function DetailSection({ id, children }: { id: DetailSectionId; children: ReactNode }) {
  return (
    <div id={id} className="stock-feed-section" data-stock-section>
      {children}
    </div>
  );
}

function StatusCard({
  title,
  body,
  tone = "default",
  actionLabel,
  onAction,
}: {
  title: string;
  body: string;
  tone?: "default" | "error";
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <section className={`app-status ${tone}`} role={tone === "error" ? "alert" : "status"}>
      <strong>{title}</strong>
      <p>{body}</p>
      {actionLabel && onAction ? (
        <button type="button" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </section>
  );
}
