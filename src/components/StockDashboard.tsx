"use client";

import type { MouseEvent, ReactNode } from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import SkeletonBlock from "@/components/SkeletonBlock";
import StockHeader, { type JudgmentState, type QuoteRefreshState, type QuoteState } from "@/components/StockHeader";
import SymbolAutocomplete from "@/components/SymbolAutocomplete";
import TradingPriceChart from "@/components/TradingPriceChart";
import {
  SOURCE_VENDOR_TEXT,
  componentWord,
  displayTickerInput,
  easySentence,
  factorSummary,
  formatMonthLabel,
  formatNote,
  formatRecordValue,
  humanizeRecordKey,
  isRecordValue,
  isSourceOnlyLabel,
  refreshCooldownMessage,
  snapshotPendingFromPayload,
  stringFromUnknown,
  symbolRef,
  termTipFor,
  usableChartPoints,
  visibleRecordEntries,
  type SnapshotPendingState,
} from "@/components/stockDashboardHelpers";
import { clampScore, formatDateTimeFromEpoch, formatValue } from "@/lib/format";
import type { SymbolSearchItem } from "@/lib/symbolTypes";
import type {
  StockJudgment,
  ChartPattern,
  ChartSeriesPoint,
  JsonValue,
  LabeledValue,
  NewsItem,
  ScoreComponent,
  StockScoreResponse,
  StockQuoteResponse,
} from "@/lib/types";

const EXAMPLES = [
  { key: "US:KO", label: "코카콜라" },
  { key: "US:NVDA", label: "엔비디아" },
  { key: "US:AAPL", label: "애플" },
  { key: "US:MSFT", label: "마이크로소프트" },
  { key: "KR:005930", label: "삼성전자" },
  { key: "KR:000660", label: "SK하이닉스" },
  { key: "KR:035420", label: "NAVER" },
  { key: "KR:005380", label: "현대차" },
];

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
        const payload = await response.json();
        const pending = snapshotPendingFromPayload(payload, tickerParam);
        if (pending) {
          setState({ status: "pending", pending });
          return undefined;
        }
        if (!response.ok) {
          throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
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
  }, [tickerParam]);

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
        const payload = await response.json();
        const pending = snapshotPendingFromPayload(payload, tickerParam);
        if (pending) {
          setQuoteState({ status: "pending", pending });
          setQuoteRefreshState({ status: "pending", message: pending.message });
          return undefined;
        }
        if (!response.ok) {
          throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
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
  }, [tickerParam]);

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
      body: JSON.stringify(state.data),
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.message || "판단을 불러오지 못했어요.");
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

  const data = state.status === "success" ? state.data : undefined;
  const visibleDetailSections = DETAIL_SECTIONS;

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
        const payload = await response.json();
        if (controller.signal.aborted || currentTickerRef.current !== requestedTicker) return undefined;
        const pending = snapshotPendingFromPayload(payload, requestedTicker);
        if (pending) {
          setQuoteState({ status: "pending", pending });
          setQuoteRefreshState({ status: "pending", message: pending.message });
          return undefined;
        }
        if (response.status === 429) {
          const nextAllowedAt = stringFromUnknown(payload?.refresh_cooldown?.next_allowed_at);
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
          throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
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
        <div className="ticker-chips" aria-label="예시 티커">
          {EXAMPLES.map((example) => (
            <button key={example.key} type="button" onClick={() => router.push(`/?ticker=${encodeURIComponent(example.key)}`)}>
              {example.label}
            </button>
          ))}
        </div>
      </section>

      {state.status === "loading" && <StockSkeleton />}
      {state.status === "pending" && <StatusCard title="데이터 준비 중" body={state.pending.message} />}
      {state.status === "error" && <StatusCard title="조회할 수 없어요" body={state.error} tone="error" />}

      {data && (
        <>
          <DetailIndex sections={visibleDetailSections} activeSection={activeSection} onSelect={scrollToDetailSection} />
          <div className="stock-feed">
            <DetailSection id="detail-summary">
              <StockHeader
                data={data}
                quote={quoteState.status === "success" ? quoteState.data : undefined}
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
}: {
  sections: ReadonlyArray<{ id: DetailSectionId; label: string }>;
  activeSection: DetailSectionId;
  onSelect: (id: DetailSectionId) => void;
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

function StatusCard({ title, body, tone = "default" }: { title: string; body: string; tone?: "default" | "error" }) {
  return (
    <section className={`app-status ${tone}`} role={tone === "error" ? "alert" : "status"}>
      <strong>{title}</strong>
      <p>{body}</p>
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

function ChartStory({
  points,
  patterns,
}: {
  points: ChartSeriesPoint[] | undefined;
  patterns: ChartPattern[] | undefined;
}) {
  const usable = useMemo(() => usableChartPoints(points), [points]);
  const [chartMode, setChartMode] = useState<"line" | "candle">("line");

  if (usable.length < 2) {
    return <EmptyCard title="가격 흐름" body="표시할 차트 데이터가 없어요." />;
  }

  return (
    <section className="chart-story">
      <div className="chart-title-row">
        <div className="section-title">
          <span>가격 흐름</span>
          <h2>최근 1년은 이렇게 움직였어요</h2>
        </div>
        <div className="chart-mode-tabs" role="tablist" aria-label="차트 표시 방식">
          <button type="button" role="tab" aria-selected={chartMode === "line"} className={chartMode === "line" ? "active" : undefined} onClick={() => setChartMode("line")}>
            쉽게
          </button>
          <button type="button" role="tab" aria-selected={chartMode === "candle"} className={chartMode === "candle" ? "active" : undefined} onClick={() => setChartMode("candle")}>
            캔들
          </button>
        </div>
      </div>
      <TradingPriceChart points={usable} mode={chartMode} />
      <div className="pattern-chips">
        {(patterns || []).slice(0, 3).map((pattern) => (
          <article key={pattern.name}>
            <strong>
              {pattern.name}
              <TermHelp label={`${pattern.name || ""} ${pattern.evidence || ""} ${pattern.interpretation || ""}`} />
            </strong>
            <span>{pattern.status}</span>
            <p>{easySentence(pattern.interpretation)}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function FactorStory({
  components,
  eyebrow = "점수 이유",
  title = "좋은 점과 아쉬운 점",
}: {
  components: ScoreComponent[] | undefined;
  eyebrow?: string;
  title?: string;
}) {
  if (!components?.length) return <EmptyCard title={eyebrow} body="표시할 점수 데이터가 없어요." />;
  return (
    <section className="factor-card">
      <div className="section-title">
        <span>{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      <div className="factor-list">
        {components.map((component) => {
          const score = clampScore(component.score);
          return (
            <article key={component.key || component.label}>
              <div className="factor-heading">
                <div className="factor-title">
                  <strong>{component.label || component.key}</strong>
                  <TermHelp label={component.label || component.key || ""} />
                </div>
                <span className="factor-score">
                  {score.toFixed(1)} · {componentWord(score)}
                </span>
              </div>
              <i>
                <b style={{ width: `${score}%` }} />
              </i>
              <p>{factorSummary(component)}</p>
              <ul>
                {(component.metrics || []).map((metric) => (
                  <li key={`${component.key}-${metric.label}`}>
                    <span>
                      <LabelWithTerm label={metric.label || "항목"} />
                    </span>
                    <strong>{formatValue(metric.value)}</strong>
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function SimpleList({
  title,
  description,
  items,
  defaultOpen = false,
  desktopOpen = false,
}: {
  title: string;
  description: string;
  items: LabeledValue[] | undefined;
  defaultOpen?: boolean;
  desktopOpen?: boolean;
}) {
  const visibleItems = (items || []).filter((item) => !isSourceOnlyLabel(item.label));
  if (!visibleItems.length) return <EmptyCard title={title} body="표시할 데이터가 없어요." />;
  return (
    <AccordionCard title={title} description={description} defaultOpen={defaultOpen} desktopOpen={desktopOpen}>
      <dl>
        {visibleItems.map((item, index) => (
          <div key={`${item.label}-${index}`}>
            <dt>
              <LabelWithTerm label={item.label || `항목 ${index + 1}`} />
            </dt>
            <dd>
              <strong>{formatValue(item.value)}</strong>
              {formatNote(item.note) ? <span>{formatNote(item.note)}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
    </AccordionCard>
  );
}

function RecordCard({
  title,
  description,
  record,
  desktopOpen = false,
}: {
  title: string;
  description: string;
  record: Record<string, JsonValue> | undefined;
  desktopOpen?: boolean;
}) {
  if (!record || !visibleRecordEntries(record).length) return <EmptyCard title={title} body="표시할 데이터가 없어요." />;
  return (
    <AccordionCard title={title} description={description} desktopOpen={desktopOpen}>
      <RecordRows record={record} />
    </AccordionCard>
  );
}

function RecordRows({ record }: { record: Record<string, JsonValue> | undefined }) {
  if (!record) return null;
  return (
    <dl className="record-feed">
      {visibleRecordEntries(record).map(([key, value]) => (
        <div key={key}>
          <dt>
            <LabelWithTerm label={humanizeRecordKey(key)} />
          </dt>
          <dd>
            {isRecordValue(value) ? (
              <dl className="record-feed nested">
                {visibleRecordEntries(value).map(([nestedKey, nestedValue]) => (
                  <div key={nestedKey}>
                    <dt>
                      <LabelWithTerm label={humanizeRecordKey(nestedKey)} />
                    </dt>
                    <dd>{formatRecordValue(nestedKey, nestedValue)}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              formatRecordValue(key, value)
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function NewsFeed({ news }: { news: NewsItem[] | undefined }) {
  return (
    <section className="static-card">
      <header>
        <span>관련 소식을 최신순으로 보여줘요.</span>
        <strong>최근 뉴스</strong>
      </header>
      <div className="accordion-body">
        {news?.length ? (
          <div className="news-list">
            {news.map((item, index) => {
              const publishedAt = formatDateTimeFromEpoch(item.provider_publish_time);
              const publisher = item.publisher && !item.publisher.includes(SOURCE_VENDOR_TEXT) ? item.publisher : "News";
              return (
                <a href={item.link || "#"} target="_blank" rel="noreferrer" key={`${item.title}-${index}`}>
                  <span>{publisher}</span>
                  <strong>{item.title || "-"}</strong>
                  {publishedAt !== "-" ? <small>{publishedAt}</small> : null}
                </a>
              );
            })}
          </div>
        ) : (
          <p className="static-empty">표시할 뉴스가 없어요.</p>
        )}
      </div>
    </section>
  );
}

function AccordionCard({
  title,
  description,
  children,
  defaultOpen = false,
  desktopOpen = false,
}: {
  title: string;
  description: string;
  children: ReactNode;
  defaultOpen?: boolean;
  desktopOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [isDesktop, setIsDesktop] = useState(false);
  const lockedOpen = desktopOpen && isDesktop;

  useEffect(() => {
    if (!desktopOpen) return;

    const query = window.matchMedia("(min-width: 900px)");
    const syncDesktop = () => setIsDesktop(query.matches);

    syncDesktop();
    query.addEventListener("change", syncDesktop);

    return () => query.removeEventListener("change", syncDesktop);
  }, [desktopOpen]);

  useEffect(() => {
    if (desktopOpen && !isDesktop) setIsOpen(false);
  }, [desktopOpen, isDesktop]);

  function handleSummaryClick(event: MouseEvent<HTMLElement>) {
    if (!desktopOpen) return;

    event.preventDefault();
    if (lockedOpen) return;

    setIsOpen((current) => !current);
  }

  return (
    <details
      className={`accordion-card${desktopOpen ? " desktop-open" : ""}`}
      open={lockedOpen || isOpen}
      onToggle={(event) => {
        if (!desktopOpen) setIsOpen(event.currentTarget.open);
      }}
    >
      <summary onClick={handleSummaryClick}>
        <span>{description}</span>
        <strong>{title}</strong>
        <i aria-hidden="true" />
      </summary>
      <div className="accordion-body">{children}</div>
    </details>
  );
}

function LabelWithTerm({ label }: { label: string }) {
  return (
    <span className="label-with-term">
      {label}
      <TermHelp label={label} />
    </span>
  );
}

function TermHelp({ label }: { label: string }) {
  const tip = termTipFor(label);
  if (!tip) return null;
  return <InfoTip label={`${tip.term} 설명`} body={tip.body} />;
}

function InfoTip({ label, body }: { label: string; body: string }) {
  const id = useId();
  return (
    <span className="info-tip-wrap">
      <button type="button" className="info-tip" aria-label={label} aria-describedby={id} onClick={(event) => event.stopPropagation()}>
        ?
      </button>
      <span id={id} className="info-bubble" role="tooltip">
        {body}
      </span>
    </span>
  );
}

function EmptyCard({ title, body }: { title: string; body: string }) {
  return (
    <section className="empty-card">
      <strong>{title}</strong>
      <p>{body}</p>
    </section>
  );
}
