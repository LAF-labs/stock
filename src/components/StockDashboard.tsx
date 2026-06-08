"use client";

import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChartStory, FactorStory, NewsFeed, RecordCard, SimpleList } from "@/components/StockDetailSections";
import SkeletonBlock from "@/components/SkeletonBlock";
import StockHeader, { type JudgmentState, type QuoteRefreshState, type QuoteState } from "@/components/StockHeader";
import SymbolAutocomplete from "@/components/SymbolAutocomplete";
import { apiPayloadMessage, readClientApiPayload } from "@/components/clientApi";
import {
  dashboardInputValue,
  dashboardTickerFromSearchParam,
  refreshCooldownMessage,
  snapshotPendingFromPayload,
  stringFromUnknown,
  stockHeaderIdentity,
  stockJudgmentRequestPayload,
  symbolRef,
  type SnapshotPendingState,
} from "@/components/stockDashboardHelpers";
import { usePendingRetry } from "@/components/usePendingRetry";
import { technicalAnalysisHrefForPayload } from "@/lib/technicalAnalysisLinks";
import type { SymbolSearchItem } from "@/lib/symbolTypes";
import type { StockJudgment, StockQuoteResponse, StockScoreResponse } from "@/lib/types";

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

type LoadState =
  | { status: "idle" | "loading"; data?: undefined; error?: undefined }
  | { status: "success"; data: StockScoreResponse; error?: undefined }
  | { status: "pending"; data?: undefined; error?: undefined; pending: SnapshotPendingState }
  | { status: "error"; data?: undefined; error: string };

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
  const [state, setState] = useState<LoadState>({ status: "idle" });
  const [quoteState, setQuoteState] = useState<QuoteState>({ status: "idle" });
  const [quoteRefreshState, setQuoteRefreshState] = useState<QuoteRefreshState>({ status: "idle" });
  const [judgmentState, setJudgmentState] = useState<JudgmentState>({ status: "idle" });
  const [activeSection, setActiveSection] = useState<DetailSectionId>("detail-summary");
  const [reloadVersion, setReloadVersion] = useState(0);
  const [isSearchCollapsed, setIsSearchCollapsed] = useState(false);
  const currentTickerRef = useRef(tickerParam);
  const quoteRefreshControllerRef = useRef<AbortController | null>(null);
  const lastScrollYRef = useRef(0);
  const isSearchCollapsedRef = useRef(false);

  function setSearchCollapsed(nextCollapsed: boolean) {
    if (isSearchCollapsedRef.current === nextCollapsed) return;
    isSearchCollapsedRef.current = nextCollapsed;
    setIsSearchCollapsed(nextCollapsed);
  }

  useEffect(() => {
    currentTickerRef.current = tickerParam;
    quoteRefreshControllerRef.current?.abort();
    setTickerInput(dashboardInputValue(tickerParam));
    if (!tickerParam) {
      setState({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    const query = new URLSearchParams({ ticker: tickerParam });

    setState({ status: "loading" });
    fetch(`/api/score?${query.toString()}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await readClientApiPayload(response);
        const pending = snapshotPendingFromPayload(payload, tickerParam);
        if (pending) {
          setState({ status: "pending", pending });
          return undefined;
        }
        if (!response.ok) {
          throw new Error(apiPayloadMessage(payload, `HTTP ${response.status}`));
        }
        return payload as StockScoreResponse;
      })
      .then((data) => {
        if (data) setState({ status: "success", data });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          error: error instanceof Error ? error.message : "데이터를 불러오지 못했어요.",
        });
      });

    return () => controller.abort();
  }, [tickerParam, reloadVersion]);

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
    if (state.status !== "success") return;
    const identity = stockHeaderIdentity(state.data);
    setTickerInput(identity.primary || dashboardInputValue(tickerParam));
  }, [state, tickerParam]);

  useEffect(() => {
    if (!tickerParam) {
      setQuoteState({ status: "idle" });
      setQuoteRefreshState({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    const query = new URLSearchParams({ ticker: tickerParam });

    setQuoteState({ status: "loading" });
    setQuoteRefreshState({ status: "idle" });
    fetch(`/api/quote?${query.toString()}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = await readClientApiPayload(response);
        const pending = snapshotPendingFromPayload(payload, tickerParam);
        if (pending) {
          setQuoteState({ status: "pending", pending });
          setQuoteRefreshState({ status: "pending", message: pending.message });
          return undefined;
        }
        if (!response.ok) {
          throw new Error(apiPayloadMessage(payload, `HTTP ${response.status}`));
        }
        return payload as StockQuoteResponse;
      })
      .then((data) => {
        if (!data) return;
        setQuoteState({ status: "success", data });
        const nextAllowedAt = stringFromUnknown(data.refresh_cooldown?.next_allowed_at);
        const message = refreshCooldownMessage(nextAllowedAt);
        if (message) {
          setQuoteRefreshState({ status: "cooldown", nextAllowedAt, message });
        }
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setQuoteState({
          status: "error",
          error: error instanceof Error ? error.message : "quote_fetch_failed",
        });
      });

    return () => controller.abort();
  }, [tickerParam, reloadVersion]);

  useEffect(() => {
    const nextAllowedAt = quoteRefreshState.nextAllowedAt;
    if (!nextAllowedAt) return;

    const remainingMs = Date.parse(nextAllowedAt) - Date.now();
    if (remainingMs <= 0) {
      setQuoteRefreshState({ status: "idle" });
      return;
    }

    const timer = window.setTimeout(() => {
      setQuoteRefreshState((current) => (current.nextAllowedAt === nextAllowedAt ? { status: "idle" } : current));
    }, Math.min(remainingMs, 2_147_483_647));

    return () => window.clearTimeout(timer);
  }, [quoteRefreshState.nextAllowedAt]);

  useEffect(() => () => quoteRefreshControllerRef.current?.abort(), []);

  useEffect(() => {
    if (state.status !== "success") {
      setJudgmentState({ status: "idle" });
      return;
    }

    const controller = new AbortController();
    setJudgmentState({ status: "loading" });

    fetch("/api/judgment", {
      method: "POST",
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(stockJudgmentRequestPayload(state.data)),
    })
      .then(async (response) => {
        const payload = await readClientApiPayload(response);
        if (!response.ok || !payload?.ok) {
          throw new Error(apiPayloadMessage(payload, "판단을 불러오지 못했어요."));
        }
        return payload.judgment as StockJudgment;
      })
      .then((judgment) => setJudgmentState({ status: "success", judgment }))
      .catch((error) => {
        if (controller.signal.aborted) return;
        setJudgmentState({
          status: "error",
          error: error instanceof Error ? error.message : "판단을 불러오지 못했어요.",
        });
      });

    return () => controller.abort();
  }, [state]);

  function selectSymbol(item: SymbolSearchItem) {
    router.push(`/?ticker=${encodeURIComponent(symbolRef(item))}`);
  }

  function retryLoad() {
    setReloadVersion((version) => version + 1);
  }

  const scorePending = tickerParam && state.status === "pending" ? state.pending : undefined;
  const quotePending = tickerParam && quoteState.status === "pending" ? quoteState.pending : undefined;
  usePendingRetry({ pending: scorePending, retryKey: `score:${tickerParam}`, onRetry: retryLoad });
  usePendingRetry({ pending: quotePending, retryKey: `quote:${tickerParam}`, onRetry: retryLoad });

  const data = tickerParam && state.status === "success" ? state.data : undefined;
  const visibleDetailSections = DETAIL_SECTIONS;
  const quoteData = quoteState.status === "success" ? quoteState.data : undefined;
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

  function refreshQuote() {
    if (!tickerParam) return;
    if (quoteRefreshState.status === "refreshing" || quoteRefreshState.status === "cooldown" || quoteRefreshState.status === "pending") return;

    const requestedTicker = tickerParam;
    const controller = new AbortController();
    quoteRefreshControllerRef.current?.abort();
    quoteRefreshControllerRef.current = controller;

    const query = new URLSearchParams({ ticker: requestedTicker, refresh: "1" });
    setQuoteRefreshState({ status: "refreshing", message: "최신 현재가 확인 중" });

    fetch(`/api/quote?${query.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await readClientApiPayload(response);
        if (controller.signal.aborted || currentTickerRef.current !== requestedTicker) return undefined;
        const pending = snapshotPendingFromPayload(payload, requestedTicker);
        if (pending) {
          setQuoteState({ status: "pending", pending });
          setQuoteRefreshState({ status: "pending", message: pending.message });
          return undefined;
        }
        if (response.status === 429) {
          const refreshCooldown = payload.refresh_cooldown && typeof payload.refresh_cooldown === "object" && !Array.isArray(payload.refresh_cooldown) ? payload.refresh_cooldown as Record<string, unknown> : undefined;
          const nextAllowedAt = stringFromUnknown(refreshCooldown?.next_allowed_at);
          const message = refreshCooldownMessage(nextAllowedAt);
          if (!message) {
            setQuoteRefreshState({ status: "error", message: "잠시 후 다시 시도해주세요." });
            return undefined;
          }
          setQuoteRefreshState({
            status: "cooldown",
            nextAllowedAt,
            message,
          });
          return undefined;
        }
        if (!response.ok) {
          throw new Error(apiPayloadMessage(payload, `HTTP ${response.status}`));
        }
        return payload as StockQuoteResponse;
      })
      .then((data) => {
        if (!data) return;
        if (controller.signal.aborted || currentTickerRef.current !== requestedTicker) return;
        setQuoteState({ status: "success", data });
        const nextAllowedAt = stringFromUnknown(data.refresh_cooldown?.next_allowed_at);
        const message = refreshCooldownMessage(nextAllowedAt);
        setQuoteRefreshState(message ? { status: "cooldown", nextAllowedAt, message } : { status: "success", message: "현재가가 업데이트됐어요." });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setQuoteRefreshState({
          status: "error",
          message: error instanceof Error ? error.message : "quote_refresh_failed",
        });
      });
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

      {tickerParam && state.status === "loading" && <StockSkeleton />}
      {tickerParam && state.status === "pending" && <StatusCard title="데이터 준비 중" body={state.pending.message} actionLabel="다시 확인" onAction={retryLoad} />}
      {tickerParam && state.status === "error" && <StatusCard title="조회할 수 없어요" body={state.error} tone="error" actionLabel="다시 시도" onAction={retryLoad} />}
      {!tickerParam && <DashboardLandingHero />}

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
                quoteRefreshState={quoteRefreshState}
                onRefreshQuote={refreshQuote}
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

function StockSkeleton() {
  return (
    <div className="stock-feed skeleton-feed" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">주식 데이터를 불러오는 중이에요.</span>
      <section className="stock-title-card skeleton-title-card">
        <div className="stock-hero-main">
          <div className="stock-name-row skeleton-name">
            <SkeletonBlock className="meta" />
            <SkeletonBlock className="ticker" />
            <SkeletonBlock className="company" />
          </div>
          <SkeletonBlock className="pill" />
        </div>
        <div className="price-block skeleton-price">
          <SkeletonBlock className="price" />
          <SkeletonBlock className="krw" />
        </div>
        <div className="quick-read">
          <article>
            <SkeletonBlock className="label" />
            <SkeletonBlock className="value" />
          </article>
          <article>
            <SkeletonBlock className="label" />
            <SkeletonBlock className="value" />
          </article>
          <article>
            <SkeletonBlock className="label" />
            <SkeletonBlock className="value wide" />
          </article>
          <article className="score-panel">
            <SkeletonBlock className="label" />
            <SkeletonBlock className="score" />
            <SkeletonBlock className="medium" />
          </article>
        </div>
        <div className="hero-verdict">
          <SkeletonBlock className="label" />
          <SkeletonBlock className="headline" />
          <SkeletonBlock className="wide" />
          <SkeletonBlock className="medium" />
        </div>
      </section>
      <section className="chart-story">
        <div className="section-title">
          <SkeletonBlock className="label" />
          <SkeletonBlock className="section-heading" />
        </div>
        <SkeletonBlock className="chart-area" />
        <div className="pattern-chips">
          {[0, 1, 2].map((item) => (
            <article key={item}>
              <SkeletonBlock className="value" />
              <SkeletonBlock className="wide" />
            </article>
          ))}
        </div>
      </section>
      <section className="factor-card">
        <div className="section-title">
          <SkeletonBlock className="label" />
          <SkeletonBlock className="section-heading" />
        </div>
        <div className="factor-list">
          {[0, 1, 2].map((item) => (
            <article key={item}>
              <div className="factor-heading">
                <SkeletonBlock className="value" />
                <SkeletonBlock className="small" />
              </div>
              <SkeletonBlock className="bar" />
              <SkeletonBlock className="wide" />
            </article>
          ))}
        </div>
      </section>
      <section className="accordion-card skeleton-accordion">
        <SkeletonBlock className="label" />
        <SkeletonBlock className="section-heading" />
      </section>
    </div>
  );
}
