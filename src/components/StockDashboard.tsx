"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChartStory, FactorStory, NewsFeed, RecordCard, SimpleList } from "@/components/StockDetailSections";
import SkeletonBlock from "@/components/SkeletonBlock";
import StockHeader, { type JudgmentState, type QuoteRefreshState, type QuoteState } from "@/components/StockHeader";
import SymbolAutocomplete from "@/components/SymbolAutocomplete";
import {
  displayTickerInput,
  refreshCooldownMessage,
  snapshotPendingFromPayload,
  stringFromUnknown,
  stockJudgmentRequestPayload,
  symbolRef,
  type SnapshotPendingState,
} from "@/components/stockDashboardHelpers";
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

type ApiPayload = Record<string, unknown>;

async function readApiPayload(response: Response): Promise<ApiPayload> {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error(response.ok ? "서버 응답이 비어 있어요." : `서버 응답이 비어 있어요. (HTTP ${response.status})`);
  }

  try {
    const payload = JSON.parse(text) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("non_object_payload");
    }
    return payload as ApiPayload;
  } catch {
    throw new Error(response.ok ? "서버 응답 형식이 올바르지 않아요." : `서버 오류 응답을 읽지 못했어요. (HTTP ${response.status})`);
  }
}

function apiPayloadMessage(payload: ApiPayload, fallback: string): string {
  return stringFromUnknown(payload.message) || stringFromUnknown(payload.error) || fallback;
}

function compareHrefForStock(data: StockScoreResponse, quote: StockQuoteResponse | undefined, fallbackTicker: string): string {
  const rawSymbol = stringFromUnknown(quote?.symbol) || stringFromUnknown(data.symbol) || stringFromUnknown(data.requested_ticker) || fallbackTicker;
  const symbol = rawSymbol.replace(/^(US|KR):/i, "");
  const market = stringFromUnknown(quote?.market) || stringFromUnknown(data.market) || (fallbackTicker.startsWith("KR:") ? "KR" : "US");
  return `/compare?tickers=${encodeURIComponent(`${market === "KR" ? "KR" : "US"}:${symbol}`)}`;
}

export default function StockDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tickerParam = (searchParams.get("ticker") || "US:KO").trim().toUpperCase();

  const [tickerInput, setTickerInput] = useState(displayTickerInput(tickerParam));
  const [state, setState] = useState<LoadState>({ status: "idle" });
  const [quoteState, setQuoteState] = useState<QuoteState>({ status: "idle" });
  const [quoteRefreshState, setQuoteRefreshState] = useState<QuoteRefreshState>({ status: "idle" });
  const [judgmentState, setJudgmentState] = useState<JudgmentState>({ status: "idle" });
  const [activeSection, setActiveSection] = useState<DetailSectionId>("detail-summary");
  const [reloadVersion, setReloadVersion] = useState(0);
  const currentTickerRef = useRef(tickerParam);
  const quoteRefreshControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    currentTickerRef.current = tickerParam;
    quoteRefreshControllerRef.current?.abort();
    setTickerInput(displayTickerInput(tickerParam));
    const controller = new AbortController();
    const query = new URLSearchParams({ ticker: tickerParam || "US:KO" });

    setState({ status: "loading" });
    fetch(`/api/score?${query.toString()}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await readApiPayload(response);
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
    const controller = new AbortController();
    const query = new URLSearchParams({ ticker: tickerParam || "US:KO" });

    setQuoteState({ status: "loading" });
    setQuoteRefreshState({ status: "idle" });
    fetch(`/api/quote?${query.toString()}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = await readApiPayload(response);
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
        const payload = await readApiPayload(response);
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

  const data = state.status === "success" ? state.data : undefined;
  const visibleDetailSections = DETAIL_SECTIONS;
  const quoteData = quoteState.status === "success" ? quoteState.data : undefined;
  const compareHref = data ? compareHrefForStock(data, quoteData, tickerParam) : "";

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
    if (quoteRefreshState.status === "refreshing" || quoteRefreshState.status === "cooldown" || quoteRefreshState.status === "pending") return;

    const requestedTicker = tickerParam || "US:KO";
    const controller = new AbortController();
    quoteRefreshControllerRef.current?.abort();
    quoteRefreshControllerRef.current = controller;

    const query = new URLSearchParams({ ticker: requestedTicker, refresh: "1" });
    setQuoteRefreshState({ status: "refreshing", message: "최신 현재가 확인 중" });

    fetch(`/api/quote?${query.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await readApiPayload(response);
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

  return (
    <main className="stock-app stock-detail-app">
      <h1 className="sr-only">{displayTickerInput(tickerParam || "US:KO")} 주식 상세</h1>
      <section className="stock-search">
        <SymbolAutocomplete
          id="ticker"
          value={tickerInput}
          onValueChange={setTickerInput}
          onSelect={selectSymbol}
          placeholder="종목명이나 티커 검색"
          buttonLabel="검색"
          label="국내·미국 주식 검색"
          className="stock-search-form"
        />
      </section>

      {state.status === "loading" && <StockSkeleton />}
      {state.status === "pending" && <StatusCard title="데이터 준비 중" body={state.pending.message} actionLabel="다시 확인" onAction={retryLoad} />}
      {state.status === "error" && <StatusCard title="조회할 수 없어요" body={state.error} tone="error" actionLabel="다시 시도" onAction={retryLoad} />}

      {data && (
        <>
          <DetailIndex
            sections={visibleDetailSections}
            activeSection={activeSection}
            onSelect={scrollToDetailSection}
            compareHref={compareHref}
          />
          <a className="stock-mobile-action" href={compareHref}>
            다른 종목과 비교하기
          </a>
          <div className="stock-feed">
            <DetailSection id="detail-summary">
              <StockHeader
                data={data}
                quote={quoteData}
                quoteState={quoteState}
                quoteRefreshState={quoteRefreshState}
                onRefreshQuote={refreshQuote}
                judgmentState={judgmentState}
              />
            </DetailSection>
            <DetailSection id="detail-chart">
              <ChartStory points={data.chart_series} patterns={data.chart_patterns} />
            </DetailSection>
            <DetailSection id="detail-factors">
              <FactorStory components={data.components} eyebrow="품질 점수 이유" title="기초체력과 가격 부담" />
              {data.opportunity_components?.length ? (
                <FactorStory components={data.opportunity_components} eyebrow="기회 점수 이유" title="지금 볼 만한 근거" />
              ) : null}
            </DetailSection>
            <DetailSection id="detail-key-metrics">
              <SimpleList title="핵심 숫자" description="처음엔 이 숫자만 봐도 충분해요." items={data.key_metrics} defaultOpen />
            </DetailSection>
            <DetailSection id="detail-news">
              <NewsFeed news={data.news} />
            </DetailSection>
            <DetailSection id="detail-profile">
              <SimpleList title="회사 정보" description="어떤 회사인지 빠르게 확인해요." items={data.stock_profile} desktopOpen />
            </DetailSection>
            <DetailSection id="detail-valuation">
              <SimpleList title="가격 부담" description="좋은 회사라도 너무 비싸면 부담이 될 수 있어요." items={data.valuation_rows} desktopOpen />
            </DetailSection>
            <DetailSection id="detail-financials">
              <RecordCard title="재무 요약" description="회사의 체력을 볼 때 참고하는 숫자예요." record={data.financials} desktopOpen />
            </DetailSection>
          </div>
        </>
      )}
    </main>
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
