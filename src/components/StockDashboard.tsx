"use client";

import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChartStory, FactorStory, NewsFeed, RecordCard, SimpleList } from "@/components/StockDetailSections";
import StockHeader from "@/components/StockHeader";
import SymbolAutocomplete from "@/components/SymbolAutocomplete";
import {
  dashboardInputValue,
  dashboardSearchInputValue,
  dashboardTickerFromSearchParam,
  dailyChangeText,
  dailyToneClass,
  formatPrimaryPrice,
  formatSecondaryPrice,
  scoreDataWithQuote,
  shouldShowStockSkeleton,
  stringFromUnknown,
  stockHeaderIdentity,
  symbolRef,
  type SnapshotPendingState,
} from "@/components/stockDashboardHelpers";
import { useStockDashboardQueries } from "@/components/useStockDashboardQueries";
import { technicalAnalysisHrefForPayload } from "@/lib/technicalAnalysisLinks";
import type { SymbolSearchItem } from "@/lib/symbolTypes";
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
  return `/compare?tickers=${encodeURIComponent(`${market === "KR" ? "KR" : "US"}:${symbol}`)}`;
}


export default function StockDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tickerParam = dashboardTickerFromSearchParam(searchParams.get("ticker"));

  const [tickerInput, setTickerInput] = useState(dashboardInputValue(tickerParam));
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
  const [activeSection, setActiveSection] = useState<DetailSectionId>("detail-summary");
  const [isSearchCollapsed, setIsSearchCollapsed] = useState(false);
  const lastScrollYRef = useRef(0);
  const isSearchCollapsedRef = useRef(false);

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
    if (!tickerParam) {
      setTickerInput("");
      return;
    }
    const stockData = data || partialData;
    if (!stockData && !quoteData) return;
    setTickerInput(dashboardSearchInputValue(stockData, quoteData, tickerParam));
  }, [data, partialData, quoteData, tickerParam]);

  function selectSymbol(item: SymbolSearchItem) {
    router.push(`/?ticker=${encodeURIComponent(symbolRef(item))}`);
  }

  const visibleDetailSections = DETAIL_SECTIONS;
  const compareHref = data && tickerParam ? compareHrefForStock(data, quoteData, tickerParam) : "";
  const pageIdentity = data ? stockHeaderIdentity(data, quoteData) : undefined;
  const pageTitle = tickerParam ? `${pageIdentity?.primary || dashboardInputValue(tickerParam)} 주식 상세` : "주식 점수 검색";

  useEffect(() => {
    if (!data || !visibleDetailSections.length) return;

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
  }, [data, visibleDetailSections]);

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
          onValueChange={setTickerInput}
          onSelect={selectSymbol}
          placeholder="종목명이나 티커 검색"
          label="국내·미국 주식 검색"
          className="stock-search-form"
          variant="floating"
          isCollapsed={isSearchCollapsed}
          onExpandRequest={() => setSearchCollapsed(false)}
        />
      </section>

      {tickerParam && shouldShowStockSkeleton(state.status, Boolean(partialData)) && (
        <StockSkeleton ticker={tickerParam} pendingMessage={state.status === "pending" ? state.pending.message : undefined} onRetry={retryLoad} />
      )}
      {tickerParam && state.status === "error" && <StatusCard title="조회할 수 없어요" body={state.error} tone="error" actionLabel="다시 시도" onAction={retryLoad} />}
      {!tickerParam && <DashboardLandingHero />}

      {partialData && !data ? (
        <PartialStockFeed data={partialData} quote={quoteData} pending={state.status === "partial" ? state.pending : undefined} onRetry={retryLoad} />
      ) : null}

      {data && (
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
                data={data}
                quote={quoteData}
                quoteState={quoteState}
                priceRefreshState={priceRefreshState}
                onRefreshPrice={refreshPrice}
                judgmentState={judgmentState}
                compareHref={compareHref}
              />
            </DetailSection>
            <DetailSection id="detail-chart">
              <ChartStory points={data.chart_series} patterns={data.chart_patterns} technicalAnalysisHref={technicalAnalysisHrefForPayload(data)} />
            </DetailSection>
            <DetailSection id="detail-factors">
              <FactorStory components={data.components} stock={data} eyebrow="품질 점수 이유" title="기초체력과 가격 부담" />
              {data.opportunity_components?.length ? (
                <FactorStory components={data.opportunity_components} stock={data} eyebrow="기회 점수 이유" title="지금 볼 만한 근거" />
              ) : null}
            </DetailSection>
            <DetailSection id="detail-key-metrics">
              <SimpleList title="핵심 숫자" description="처음엔 이 숫자만 봐도 충분해요." items={data.key_metrics} stock={data} defaultOpen />
            </DetailSection>
            <DetailSection id="detail-news">
              <NewsFeed news={data.news} />
            </DetailSection>
            <DetailSection id="detail-profile">
              <SimpleList title="회사 정보" description="어떤 회사인지 빠르게 확인해요." items={data.stock_profile} stock={data} desktopOpen />
            </DetailSection>
            <DetailSection id="detail-valuation">
              <SimpleList title="가격 부담" description="좋은 회사라도 너무 비싸면 부담이 될 수 있어요." items={data.valuation_rows} stock={data} desktopOpen />
            </DetailSection>
            <DetailSection id="detail-financials">
              <RecordCard title="재무 요약" description="회사의 체력을 볼 때 참고하는 숫자예요." record={data.financials} stock={data} desktopOpen />
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
  pending,
  onRetry,
}: {
  data: StockScoreResponse;
  quote: StockQuoteResponse | undefined;
  pending: SnapshotPendingState | undefined;
  onRetry: () => void;
}) {
  return (
    <div className="stock-feed partial-stock-feed" role="status" aria-live="polite">
      <DetailSection id="detail-summary">
        <PartialStockSummary data={data} quote={quote} pending={pending} onRetry={onRetry} />
      </DetailSection>
      <DetailSection id="detail-chart">
        <ChartStory points={data.chart_series} patterns={undefined} />
      </DetailSection>
      <PendingDetailSection title="품질 점수 이유" eyebrow="점수 이유" />
      <PendingDetailSection title="핵심 숫자" eyebrow="핵심 숫자" compact />
    </div>
  );
}

function PartialStockSummary({
  data,
  quote,
  pending,
  onRetry,
}: {
  data: StockScoreResponse;
  quote: StockQuoteResponse | undefined;
  pending: SnapshotPendingState | undefined;
  onRetry: () => void;
}) {
  const displayData = scoreDataWithQuote(data, quote);
  const identity = stockHeaderIdentity(displayData, quote);
  const daily = dailyChangeText(displayData, quote);
  const latestBarDate = quote?.latest_bar_date || displayData.latest_bar_date || "최근 가격";
  const hasPrice = typeof displayData.latest_price === "number" && Number.isFinite(displayData.latest_price);

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
        <span className="score-time-chip">점수 준비 중</span>
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
          <strong className="partial-pending-value">준비 중</strong>
        </article>
        <article className="quick-metric-card">
          <span>먼저 볼 것</span>
          <strong className="partial-pending-value">준비 중</strong>
        </article>
        <article className="quick-metric-card">
          <span>시가총액</span>
          <strong className="partial-pending-value">준비 중</strong>
        </article>
        <article className="score-panel">
          <span>품질 점수</span>
          <strong className="partial-pending-score">--</strong>
        </article>
      </div>
      <div className="hero-verdict neutral partial-verdict">
        <span>오늘의 판단</span>
        <strong>{hasPrice ? "가격 데이터부터 먼저 보여드려요." : "종목부터 먼저 보여드려요."}</strong>
        <p>{pending?.message || "점수와 재무 지표를 준비하는 중이에요. 준비가 끝나면 이 영역이 자동으로 채워집니다."}</p>
        <button type="button" className="partial-retry-button" onClick={onRetry}>
          다시 확인
        </button>
      </div>
    </section>
  );
}

function PendingDetailSection({ title, eyebrow, compact = false }: { title: string; eyebrow: string; compact?: boolean }) {
  return (
    <section className={compact ? "accordion-card partial-pending-section" : "factor-card partial-pending-section"}>
      <div className="section-title">
        <span>{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      {compact ? (
        <p>재무 지표를 이어서 준비하고 있어요.</p>
      ) : (
        <div className="factor-list partial-factor-list">
          {["품질", "기회", "리스크"].map((label) => (
            <article key={label}>
              <div className="factor-heading">
                <strong>{label}</strong>
                <span>준비 중</span>
              </div>
              <p>점수 계산이 끝나면 근거를 표시합니다.</p>
            </article>
          ))}
        </div>
      )}
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
            <span>signal.ready</span>
            <i />
            <span>score.synced</span>
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

function StockSkeleton({ ticker, pendingMessage, onRetry }: { ticker?: string; pendingMessage?: string; onRetry?: () => void }) {
  const tickerLabel = ticker ? dashboardInputValue(ticker) : undefined;
  return (
    <div className="stock-feed loading-status-feed" role="status" aria-live="polite">
      <section className="stock-title-card partial-stock-title-card">
        <div className="stock-hero-main">
          <div className="stock-name-row">
            <div>
              <span>종목 데이터</span>
              <h2>{tickerLabel || "확인 중"}</h2>
              <p>{pendingMessage || "가격과 점수 데이터를 확인하고 있어요."}</p>
            </div>
          </div>
          <span className="score-time-chip">준비 중</span>
        </div>
        <div className="price-strip">
          <div className="price-block">
            <strong>-</strong>
            <span>가격 확인 중</span>
          </div>
          <em className="daily-pill price-neutral">대기 중</em>
        </div>
        <div className="quick-read">
          <article>
            <span>강점</span>
            <strong className="partial-pending-value">준비 중</strong>
          </article>
          <article>
            <span>먼저 볼 것</span>
            <strong className="partial-pending-value">준비 중</strong>
          </article>
          <article>
            <span>시가총액</span>
            <strong className="partial-pending-value">준비 중</strong>
          </article>
          <article className="score-panel">
            <span>품질 점수</span>
            <strong className="partial-pending-score">--</strong>
          </article>
        </div>
        <div className="hero-verdict neutral partial-verdict">
          <span>진행 상태</span>
          <strong>요청을 확인하고 있어요.</strong>
          <p>{pendingMessage || "가격 데이터가 먼저 준비되면 이 화면에 바로 채워집니다."}</p>
          {pendingMessage && onRetry ? (
            <button type="button" className="partial-retry-button" onClick={onRetry}>
              다시 확인
            </button>
          ) : null}
        </div>
      </section>
      <section className="chart-story partial-pending-section">
        <div className="section-title">
          <span>가격 흐름</span>
          <h2>데이터 확인 중</h2>
        </div>
        <p>응답 가능한 데이터부터 순서대로 표시합니다.</p>
      </section>
      <section className="factor-card partial-pending-section">
        <div className="section-title">
          <span>점수 이유</span>
          <h2>근거 준비 중</h2>
        </div>
        <div className="factor-list partial-factor-list">
          {[0, 1, 2].map((item) => (
            <article key={item}>
              <div className="factor-heading">
                <strong>{["품질", "기회", "리스크"][item]}</strong>
                <span>준비 중</span>
              </div>
              <p>점수 계산이 끝나면 근거를 표시합니다.</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
