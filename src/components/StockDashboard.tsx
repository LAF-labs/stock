"use client";

import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChartStory, FactorStory, NewsFeed, RecordCard, SimpleList } from "@/components/StockDetailSections";
import StockHeader, { type JudgmentState, type QuoteRefreshState, type QuoteState } from "@/components/StockHeader";
import SymbolAutocomplete from "@/components/SymbolAutocomplete";
import { apiPayloadMessage, readClientApiPayload } from "@/components/clientApi";
import {
  dashboardClientCacheFromJson,
  dashboardClientCacheJson,
  dashboardClientCacheKey,
  dashboardInputValue,
  dashboardSearchInputValue,
  dashboardTickerFromSearchParam,
  dailyChangeText,
  dailyToneClass,
  formatPrimaryPrice,
  formatSecondaryPrice,
  pendingRetryTargetForDashboard,
  partialStockDataFromQuote,
  partialStockDataFromTicker,
  partialStockDataFromPayload,
  refreshCooldownMessage,
  scoreDataWithQuote,
  shouldPreservePendingViewDuringRetry,
  shouldShowStockSkeleton,
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

const FIRST_USEFUL_DATA_DEADLINE_MS = 4_500;
const DASHBOARD_CLIENT_CACHE_MAX_CHARS = 750_000;

type DetailSectionId = (typeof DETAIL_SECTIONS)[number]["id"];

type LoadState =
  | { status: "idle" | "loading"; data?: undefined; error?: undefined }
  | { status: "success"; data: StockScoreResponse; error?: undefined }
  | { status: "partial"; data: StockScoreResponse; error?: undefined; pending: SnapshotPendingState }
  | { status: "pending"; data?: undefined; error?: undefined; pending: SnapshotPendingState }
  | { status: "error"; data?: undefined; error: string };

function compareHrefForStock(data: StockScoreResponse, quote: StockQuoteResponse | undefined, fallbackTicker: string): string {
  const rawSymbol = stringFromUnknown(quote?.symbol) || stringFromUnknown(data.symbol) || stringFromUnknown(data.requested_ticker) || fallbackTicker;
  const symbol = rawSymbol.replace(/^(US|KR):/i, "");
  const market = stringFromUnknown(quote?.market) || stringFromUnknown(data.market) || (fallbackTicker.startsWith("KR:") ? "KR" : "US");
  return `/compare?tickers=${encodeURIComponent(`${market === "KR" ? "KR" : "US"}:${symbol}`)}`;
}

function pendingBelongsToTicker(pending: unknown, ticker: string | undefined): boolean {
  const pendingTicker =
    pending && typeof pending === "object" && !Array.isArray(pending) && typeof (pending as { ticker?: unknown }).ticker === "string"
      ? (pending as { ticker: string }).ticker
      : undefined;
  return Boolean(ticker && (!pendingTicker || pendingTicker === ticker));
}

function quoteBelongsToTicker(quote: StockQuoteResponse, ticker: string): boolean {
  const requested = stringFromUnknown(quote.requested_ticker);
  if (requested === ticker) return true;
  const symbol = stringFromUnknown(quote.symbol);
  const market = stringFromUnknown(quote.market) || (ticker.startsWith("KR:") ? "KR" : ticker.startsWith("US:") ? "US" : undefined);
  return Boolean(symbol && market && `${market}:${symbol}` === ticker);
}

function scoreBelongsToTicker(score: StockScoreResponse, ticker: string): boolean {
  const requested = dashboardTickerFromSearchParam(stringFromUnknown(score.requested_ticker) || "");
  if (requested === ticker) return true;
  const symbol = stringFromUnknown(score.symbol);
  const market = stringFromUnknown(score.market) || (ticker.startsWith("KR:") ? "KR" : ticker.startsWith("US:") ? "US" : undefined);
  return Boolean(symbol && market && `${market}:${symbol}` === ticker);
}

function readDashboardClientCache(ticker: string) {
  if (typeof window === "undefined") return undefined;
  try {
    return dashboardClientCacheFromJson(window.localStorage.getItem(dashboardClientCacheKey(ticker)), ticker);
  } catch {
    return undefined;
  }
}

function rememberDashboardClientCache(ticker: string, score: StockScoreResponse | undefined, quote: StockQuoteResponse | undefined) {
  if (typeof window === "undefined") return;
  try {
    const raw = dashboardClientCacheJson({ ticker, score, quote });
    if (!raw) return;
    if (raw.length > DASHBOARD_CLIENT_CACHE_MAX_CHARS) return;
    window.localStorage.setItem(dashboardClientCacheKey(ticker), raw);
  } catch {
    // localStorage can be unavailable in private browsing or quota pressure.
  }
}

function optimisticScorePendingFromQuote(ticker: string): SnapshotPendingState {
  return {
    message: "가격 데이터는 먼저 확인했고, 점수와 재무 지표를 이어서 준비하고 있어요.",
    ticker,
    queued: false,
  };
}

function deadlinePendingFromTicker(ticker: string, message?: string, retryAfterSeconds?: number): SnapshotPendingState {
  return {
    message: message || "종목은 먼저 특정했고, 가격과 점수 데이터는 계속 확인하고 있어요.",
    ticker,
    queued: false,
    retryAfterSeconds,
  };
}

export default function StockDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tickerParam = dashboardTickerFromSearchParam(searchParams.get("ticker"));

  const [tickerInput, setTickerInput] = useState(dashboardInputValue(tickerParam));
  const [state, setState] = useState<LoadState>(() =>
    tickerParam
      ? {
          status: "partial",
          data: partialStockDataFromTicker(tickerParam),
          pending: deadlinePendingFromTicker(tickerParam),
        }
      : { status: "idle" }
  );
  const [quoteState, setQuoteState] = useState<QuoteState>({ status: "idle" });
  const [quoteRefreshState, setQuoteRefreshState] = useState<QuoteRefreshState>({ status: "idle" });
  const [judgmentState, setJudgmentState] = useState<JudgmentState>({ status: "idle" });
  const [activeSection, setActiveSection] = useState<DetailSectionId>("detail-summary");
  const [reloadVersion, setReloadVersion] = useState(0);
  const [isSearchCollapsed, setIsSearchCollapsed] = useState(false);
  const [scoreBackgroundPending, setScoreBackgroundPending] = useState<SnapshotPendingState | undefined>(undefined);
  const currentTickerRef = useRef(tickerParam);
  const latestScoreRef = useRef<StockScoreResponse | undefined>(undefined);
  const latestQuoteRef = useRef<StockQuoteResponse | undefined>(undefined);
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
      latestScoreRef.current = undefined;
      latestQuoteRef.current = undefined;
      setScoreBackgroundPending(undefined);
      setState({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    const query = new URLSearchParams({ ticker: tickerParam, partial: "1" });
    const cached = readDashboardClientCache(tickerParam);
    latestScoreRef.current = cached?.score;
    latestQuoteRef.current = cached?.quote;
    setScoreBackgroundPending(undefined);

    setState((current) => {
      if (cached?.score) return { status: "success", data: cached.score };
      if (current.status === "success" && scoreBelongsToTicker(current.data, tickerParam)) return current;
      const pending = current.status === "pending" || current.status === "partial" ? current.pending : undefined;
      if ((current.status === "pending" || current.status === "partial") && pendingBelongsToTicker(pending, tickerParam)) return current;
      if (shouldPreservePendingViewDuringRetry(current.status, reloadVersion > 0 && pendingBelongsToTicker(pending, tickerParam))) return current;
      return {
        status: "partial",
        data: partialStockDataFromTicker(tickerParam),
        pending: deadlinePendingFromTicker(tickerParam),
      };
    });
    fetch(`/api/score?${query.toString()}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = await readClientApiPayload(response);
        const pending = snapshotPendingFromPayload(payload, tickerParam);
        const partialData = pending ? partialStockDataFromPayload(payload, tickerParam) : undefined;
        if (pending && partialData) {
          setScoreBackgroundPending(pending);
          setState((current) => (current.status === "success" && scoreBelongsToTicker(current.data, tickerParam) ? current : { status: "partial", data: partialData, pending }));
          return undefined;
        }
        if (pending) {
          setScoreBackgroundPending(pending);
          setState((current) => {
            if (current.status === "success" && scoreBelongsToTicker(current.data, tickerParam)) return current;
            return current.status === "partial" ? current : { status: "pending", pending };
          });
          return undefined;
        }
        if (!response.ok) {
          throw new Error(apiPayloadMessage(payload, `HTTP ${response.status}`));
        }
        return payload as StockScoreResponse;
      })
      .then((data) => {
        if (!data) return;
        latestScoreRef.current = data;
        setScoreBackgroundPending(undefined);
        setState({ status: "success", data });
        rememberDashboardClientCache(tickerParam, data, latestQuoteRef.current);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setState((current) => {
          if (current.status === "success" || current.status === "partial") return current;
          return {
            status: "error",
            error: error instanceof Error ? error.message : "데이터를 불러오지 못했어요.",
          };
        });
      });

    return () => controller.abort();
  }, [tickerParam, reloadVersion]);

  useEffect(() => {
    if (!tickerParam) return;

    const timer = window.setTimeout(() => {
      setState((current) => {
        if (current.status === "success" || current.status === "partial" || current.status === "error") return current;
        const pending =
          current.status === "pending"
            ? deadlinePendingFromTicker(tickerParam, current.pending.message, current.pending.retryAfterSeconds)
            : deadlinePendingFromTicker(tickerParam);
        return {
          status: "partial",
          data: partialStockDataFromTicker(tickerParam),
          pending,
        };
      });
    }, FIRST_USEFUL_DATA_DEADLINE_MS);

    return () => window.clearTimeout(timer);
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
    if (!tickerParam) return;
    const stockData = state.status === "success" || state.status === "partial" ? state.data : undefined;
    const quoteData = quoteState.status === "success" ? quoteState.data : undefined;
    if (!stockData && !quoteData) return;
    setTickerInput(dashboardSearchInputValue(stockData, quoteData, tickerParam));
  }, [state, quoteState, tickerParam]);

  useEffect(() => {
    if (!tickerParam) {
      setQuoteState({ status: "idle" });
      setQuoteRefreshState({ status: "idle" });
      latestQuoteRef.current = undefined;
      return;
    }
    const controller = new AbortController();
    const query = new URLSearchParams({ ticker: tickerParam });
    const cached = readDashboardClientCache(tickerParam);
    if (cached?.quote) latestQuoteRef.current = cached.quote;

    setQuoteState((current) => {
      if (current.status === "success" && quoteBelongsToTicker(current.data, tickerParam)) return current;
      if (cached?.quote) return { status: "success", data: cached.quote };
      return shouldPreservePendingViewDuringRetry(current.status, reloadVersion > 0 && pendingBelongsToTicker(current.status === "pending" ? current.pending : undefined, tickerParam))
        ? current
        : { status: "loading" };
    });
    setQuoteRefreshState((current) => (reloadVersion > 0 && current.status === "pending" ? current : { status: "idle" }));
    fetch(`/api/quote?${query.toString()}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = await readClientApiPayload(response);
        const pending = snapshotPendingFromPayload(payload, tickerParam);
        if (pending) {
          setQuoteState((current) => (current.status === "success" && quoteBelongsToTicker(current.data, tickerParam) ? current : { status: "pending", pending }));
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
        latestQuoteRef.current = data;
        setQuoteState({ status: "success", data });
        rememberDashboardClientCache(tickerParam, latestScoreRef.current, data);
        const nextAllowedAt = stringFromUnknown(data.refresh_cooldown?.next_allowed_at);
        const message = refreshCooldownMessage(nextAllowedAt);
        if (message) {
          setQuoteRefreshState({ status: "cooldown", nextAllowedAt, message });
        } else {
          setQuoteRefreshState({ status: "idle" });
        }
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setQuoteState((current) =>
          current.status === "success" && quoteBelongsToTicker(current.data, tickerParam)
            ? current
            : {
                status: "error",
                error: error instanceof Error ? error.message : "quote_fetch_failed",
              }
        );
      });

    return () => controller.abort();
  }, [tickerParam, reloadVersion]);

  useEffect(() => {
    if (!tickerParam || quoteState.status !== "success") return;
    if (!quoteBelongsToTicker(quoteState.data, tickerParam)) return;
    const partial = partialStockDataFromQuote(quoteState.data, tickerParam);
    if (!partial) return;
    setState((current) => {
      if (current.status !== "loading") return current;
      return {
        status: "partial",
        data: partial,
        pending: optimisticScorePendingFromQuote(tickerParam),
      };
    });
  }, [quoteState, tickerParam]);

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

  const scorePending = tickerParam
    ? state.status === "pending" || state.status === "partial"
      ? state.pending
      : scoreBackgroundPending && pendingBelongsToTicker(scoreBackgroundPending, tickerParam)
        ? scoreBackgroundPending
        : undefined
    : undefined;
  const quotePending = tickerParam && quoteState.status === "pending" ? quoteState.pending : undefined;
  const pendingRetryTarget = pendingRetryTargetForDashboard(tickerParam, scorePending, quotePending);
  usePendingRetry({ pending: pendingRetryTarget?.pending, retryKey: pendingRetryTarget?.retryKey || "stock:none", onRetry: retryLoad });

  const visibleDetailSections = DETAIL_SECTIONS;
  const quoteData = quoteState.status === "success" ? quoteState.data : undefined;
  const data = tickerParam && state.status === "success" ? state.data : undefined;
  const partialData = tickerParam && state.status === "partial" ? scoreDataWithQuote(state.data, quoteData) : undefined;
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
