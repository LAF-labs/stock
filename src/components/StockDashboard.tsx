"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChartStory, FactorStory, NewsFeed, RecordCard, SimpleList } from "@/components/StockDetailSections";
import SearchChromeWithNavigation from "@/components/SearchChromeWithNavigation";
import StockHeader from "@/components/StockHeader";
import { SkeletonSectionTitle, StockDetailLoadingSkeleton } from "@/components/StockLoadingSkeletons";
import SkeletonBlock from "@/components/SkeletonBlock";
import SymbolAutocomplete from "@/components/SymbolAutocomplete";
import StockLanding from "@/components/landing/StockLanding";
import DetailSectionIndex from "@/components/stock-detail/DetailSectionIndex";
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
  hasDisplayableScoreComponents,
  hasDisplayableStockPartialData,
  PARTIAL_SECTION_SKELETON_DEADLINE_MS,
  partialStockDataFromTicker,
  partialSectionDisplayState,
  partialStockStatusSummary,
  priceVolatilitySummaryItems,
  scoreDataWithQuote,
  shouldShowStockSkeleton,
  stockMarketCapDisplay,
  strongestAndWeakest,
  stringFromUnknown,
  stockHeaderIdentity,
  stockRecoveringParts,
  symbolRef,
  usableChartPoints,
  visibleRecordEntries,
  type SnapshotPendingState,
} from "@/components/stockDashboardHelpers";
import { useStockDashboardQueries } from "@/components/useStockDashboardQueries";
import { detailSearchScrollDecision, useCollapsibleSearchChrome } from "@/components/useCollapsibleSearchChrome";
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

type PartialLoadingWindow = {
  ticker: string;
  startedAtMs: number;
  nowMs: number;
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
    hasDetailViewResponse,
    retryLoad,
    refreshPrice,
  } = useStockDashboardQueries(tickerParam, initialDisplayPayload);
  const displayData = data || (initialDisplayComplete ? initialDisplayData : undefined);
  const displayPartialData = chooseRicherStockData(partialData, !data ? initialDisplayData : undefined);
  const hasDisplayablePartialData = hasDisplayableStockPartialData(displayPartialData);
  const showStockSkeleton = Boolean(tickerParam && !displayData && shouldShowStockSkeleton(state.status, hasDisplayablePartialData, hasDetailViewResponse));
  const isPartialFeedVisible = Boolean(tickerParam && !showStockSkeleton && displayPartialData && (hasDisplayablePartialData || hasDetailViewResponse) && !displayData);
  const skeletonTickerLabel =
    displayPartialData || quoteData
      ? stockHeaderIdentity(displayPartialData || scoreDataWithQuote(partialStockDataFromTicker(tickerParam || ""), quoteData), quoteData).primary
      : tickerParam
        ? dashboardInputValue(tickerParam)
        : undefined;
  const [partialLoadingWindow, setPartialLoadingWindow] = useState<PartialLoadingWindow | undefined>(undefined);
  const [activeSection, setActiveSection] = useState<DetailSectionId>("detail-summary");
  const searchChrome = useCollapsibleSearchChrome({ scrollDecision: detailSearchScrollDecision });
  const detailAppRef = useRef<HTMLElement | null>(null);
  const detailFirstSectionHeightRef = useRef(0);
  const previousTickerParamRef = useRef(tickerParam);

  useEffect(() => {
    if (!tickerParam || !isPartialFeedVisible) {
      setPartialLoadingWindow(undefined);
      return;
    }
    const nowMs = Date.now();
    setPartialLoadingWindow((previous) => (
      previous?.ticker === tickerParam
        ? { ...previous, nowMs }
        : { ticker: tickerParam, startedAtMs: nowMs, nowMs }
    ));
  }, [isPartialFeedVisible, tickerParam]);

  useEffect(() => {
    if (!partialLoadingWindow || !isPartialFeedVisible) return undefined;
    const remainingMs = partialLoadingWindow.startedAtMs + PARTIAL_SECTION_SKELETON_DEADLINE_MS - Date.now();
    if (remainingMs <= 0) return undefined;
    const timer = window.setTimeout(() => {
      setPartialLoadingWindow((previous) => previous ? { ...previous, nowMs: Date.now() } : previous);
    }, Math.min(remainingMs, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [isPartialFeedVisible, partialLoadingWindow]);

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

    if (isSearchEditing !== decision.isSearchEditing) {
      setIsSearchEditing(decision.isSearchEditing);
    }
    if (tickerInput !== decision.value) {
      setTickerInput(decision.value);
    }
  }, [data, initialDisplayData, isSearchEditing, partialData, quoteData, tickerInput, tickerParam]);

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
        setActiveSection((previous) => (previous === current.id ? previous : current.id));
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

  useEffect(() => {
    const root = detailAppRef.current;
    if (!root) return;

    if (!displayData) {
      detailFirstSectionHeightRef.current = 0;
      root.style.removeProperty("--detail-first-section-height");
      return;
    }

    const firstSection = root.querySelector<HTMLElement>("#detail-summary");
    if (!firstSection) return;

    let frame = 0;
    const updateFirstSectionHeight = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const nextHeight = Math.ceil(firstSection.getBoundingClientRect().height);
        if (nextHeight <= 0 || nextHeight === detailFirstSectionHeightRef.current) return;
        detailFirstSectionHeightRef.current = nextHeight;
        root.style.setProperty("--detail-first-section-height", `${nextHeight}px`);
      });
    };

    updateFirstSectionHeight();
    const observer = new ResizeObserver(updateFirstSectionHeight);
    observer.observe(firstSection);
    window.addEventListener("resize", updateFirstSectionHeight);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", updateFirstSectionHeight);
    };
  }, [displayData]);

  function scrollToDetailSection(id: DetailSectionId) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const detailAppClassName = ["stock-app", "stock-detail-app", tickerParam ? "has-detail-context" : ""].filter(Boolean).join(" ");
  const indexSections = displayData || isPartialFeedVisible ? visibleDetailSections : [];

  return (
    <main ref={detailAppRef} className={detailAppClassName}>
      <h1 className="sr-only">{pageTitle}</h1>
      <SearchChromeWithNavigation
        className="stock-search"
        context={tickerParam ? { page: "detail", ticker: tickerParam, compareHref: compareHref || undefined } : { page: "home" }}
        searchChrome={searchChrome}
      >
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
          isCollapsed={searchChrome.isCollapsed}
          onExpandRequest={searchChrome.expandSearch}
        />
      </SearchChromeWithNavigation>

      {showStockSkeleton && (
        <StockDetailLoadingSkeleton tickerLabel={skeletonTickerLabel} />
      )}
      {tickerParam && state.status === "error" && <StatusCard title="조회할 수 없어요" body={state.error} tone="error" actionLabel="다시 시도" onAction={retryLoad} />}
      {!tickerParam && <StockLanding />}
      {tickerParam ? <DetailSectionIndex sections={indexSections} activeSection={activeSection} onSelect={scrollToDetailSection} /> : null}

      {isPartialFeedVisible && displayPartialData ? (
        <PartialStockFeed
          data={displayPartialData}
          quote={quoteData}
          pending={state.status === "partial" ? state.pending : undefined}
          loadingWindow={partialLoadingWindow?.ticker === tickerParam ? partialLoadingWindow : undefined}
          onRetry={retryLoad}
        />
      ) : null}

      {displayData && (
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
              <SimpleList title="가격·변동성 요약" description="가격 흐름을 볼 때 함께 참고하는 숫자예요." items={priceVolatilitySummaryItems(displayData)} stock={displayData} desktopOpen />
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
      )}
    </main>
  );
}

function PartialStockFeed({
  data,
  quote,
  pending,
  loadingWindow,
  onRetry,
}: {
  data: StockScoreResponse;
  quote: StockQuoteResponse | undefined;
  pending: SnapshotPendingState | undefined;
  loadingWindow: PartialLoadingWindow | undefined;
  onRetry: () => void;
}) {
  const hasChart = usableChartPoints(data.chart_series).length >= 1;
  const hasFactors = hasDisplayableScoreComponents(data.components) || hasDisplayableScoreComponents(data.opportunity_components);
  const hasMetrics = Boolean(data.key_metrics?.length);
  const hasProfile = Boolean(data.stock_profile?.length);
  const hasValuation = Boolean(data.valuation_rows?.length);
  const hasFinancials = Boolean(data.financials && visibleRecordEntries(data.financials).length);
  const recoveringParts = stockRecoveringParts(data);
  const chartRecovering = !hasChart && recoveringParts.includes("chart");
  const scoreRecovering = !hasFactors && (recoveringParts.includes("score") || recoveringParts.includes("technical"));
  const valuationRecovering = !hasValuation && recoveringParts.some((part) => part === "fundamentals" || part === "industryBenchmark" || part === "financials" || part === "score");
  const fundamentalsRecovering = !hasFinancials && recoveringParts.some((part) => part === "fundamentals" || part === "industryBenchmark" || part === "financials");
  const startedAtMs = loadingWindow?.startedAtMs ?? 0;
  const nowMs = loadingWindow?.nowMs ?? startedAtMs;
  const chartState = partialSectionDisplayState({ hasContent: hasChart, isRecovering: chartRecovering, startedAtMs, nowMs });
  const factorState = partialSectionDisplayState({ hasContent: hasFactors, isRecovering: scoreRecovering, startedAtMs, nowMs });
  const valuationState = partialSectionDisplayState({ hasContent: hasValuation, isRecovering: valuationRecovering, startedAtMs, nowMs });
  const financialState = partialSectionDisplayState({ hasContent: hasFinancials, isRecovering: fundamentalsRecovering, startedAtMs, nowMs });

  return (
    <div className="stock-feed partial-stock-feed" role="status" aria-live="polite">
      <DetailSection id="detail-summary">
        <PartialStockSummary data={data} quote={quote} pending={pending} onRetry={onRetry} />
      </DetailSection>
      {chartState === "content" ? (
        <DetailSection id="detail-chart">
          <ChartStory points={data.chart_series} patterns={data.chart_patterns} />
          <SimpleList title="가격·변동성 요약" description="가격 흐름을 볼 때 함께 참고하는 숫자예요." items={priceVolatilitySummaryItems(data)} stock={data} desktopOpen />
        </DetailSection>
      ) : chartState === "loading" ? (
        <DetailSection id="detail-chart">
          <PartialSectionSkeleton title="가격 흐름" />
        </DetailSection>
      ) : chartState === "unavailable" ? (
        <DetailSection id="detail-chart">
          <PartialUnavailableSection
            title="가격 흐름"
            heading="가격 기록이 아직 부족해요"
            body="현재가처럼 확인된 정보는 먼저 보여드리고, 가격 기록이 더 확인되면 차트로 이어서 보여드릴게요."
          />
        </DetailSection>
      ) : null}
      {factorState === "content" ? (
        <DetailSection id="detail-factors">
          {data.components?.length ? <FactorStory components={data.components} stock={data} eyebrow="품질 점수 이유" title="기초체력과 가격 부담" /> : null}
          {data.opportunity_components?.length ? <FactorStory components={data.opportunity_components} stock={data} eyebrow="기회 점수 이유" title="지금 볼 만한 근거" /> : null}
        </DetailSection>
      ) : factorState === "loading" ? (
        <DetailSection id="detail-factors">
          <PartialSectionSkeleton title="점수 이유" />
        </DetailSection>
      ) : factorState === "unavailable" ? (
        <DetailSection id="detail-factors">
          <PartialUnavailableSection
            title="점수 이유"
            heading="아직 점수로 판단할 자료가 부족해요"
            body="가격만으로 점수를 단정하지 않고, 실적과 거래 기록이 충분할 때 세부 점수를 보여드려요."
          />
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
      {valuationState === "content" ? (
        <DetailSection id="detail-valuation">
          <SimpleList title="가격 부담" description="좋은 회사라도 너무 비싸면 부담이 될 수 있어요." items={data.valuation_rows} stock={data} desktopOpen />
        </DetailSection>
      ) : valuationState === "loading" ? (
        <DetailSection id="detail-valuation">
          <PartialSectionSkeleton title="가격 부담" />
        </DetailSection>
      ) : valuationState === "unavailable" ? (
        <DetailSection id="detail-valuation">
          <PartialUnavailableSection
            title="가격 부담"
            heading="아직 실적 기준 가격 부담은 판단하기 어려워요"
            body="PER, PBR, P/S처럼 실적이나 자산이 필요한 값이 확인되면 여기에 표시해요."
          />
        </DetailSection>
      ) : null}
      {financialState === "content" ? (
        <DetailSection id="detail-financials">
          <RecordCard title="재무 요약" description="회사의 체력을 볼 때 참고하는 숫자예요." record={data.financials} stock={data} desktopOpen />
        </DetailSection>
      ) : financialState === "loading" ? (
        <DetailSection id="detail-financials">
          <PartialSectionSkeleton title="재무 요약" />
        </DetailSection>
      ) : financialState === "unavailable" ? (
        <DetailSection id="detail-financials">
          <PartialUnavailableSection
            title="재무 요약"
            heading="아직 실적 자료가 부족해요"
            body="매출, 이익, 현금흐름처럼 확인된 재무 숫자가 들어오면 바로 표시해요."
          />
        </DetailSection>
      ) : null}
    </div>
  );
}

function PartialSectionSkeleton({ title }: { title: string }) {
  return (
    <section className="partial-pending-section" aria-label={`${title} 준비 중`}>
      <SkeletonSectionTitle />
      <SkeletonBlock className="wide" />
      <SkeletonBlock className="medium" />
    </section>
  );
}

function PartialUnavailableSection({ title, heading, body }: { title: string; heading: string; body: string }) {
  return (
    <section className="partial-pending-section" role="status" aria-label={`${title} 자료 부족`}>
      <div className="section-title">
        <span>{title}</span>
        <h2>{heading}</h2>
      </div>
      <p>{body}</p>
    </section>
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
  const rawScore = displayData.quality_score ?? displayData.score;
  const qualityScore = hasDisplayableScoreComponents(displayData.components) && typeof rawScore === "number" && Number.isFinite(rawScore) ? clampScore(rawScore) : undefined;
  const { strongest, weakest } = strongestAndWeakest(displayData);
  const marketCap = stockMarketCapDisplay(displayData);
  const defaultSummary = displayData.summary || (qualityScore === undefined ? (hasPrice ? "현재 확인된 가격 정보를 먼저 반영했어요." : "종목 정보를 확인했어요.") : "현재가와 참고 지표를 먼저 반영했어요.");
  const summary = partialStockStatusSummary(defaultSummary, pending);
  const isUpdating = pending?.queued === true;
  const statusChip = isUpdating
    ? "자동 업데이트 중"
    : qualityScore === undefined
      ? (hasPrice ? "현재가 확인" : "종목 확인")
      : "가격 기준 참고값";
  const retryLabel = isUpdating ? "업데이트 확인" : "다시 조회";

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
        <span className="score-time-chip">{statusChip}</span>
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
          {retryLabel}
        </button>
      </div>
    </section>
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
