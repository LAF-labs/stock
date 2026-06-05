"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppTopbar, useThemePreference } from "@/components/AppChrome";
import SymbolAutocomplete from "@/components/SymbolAutocomplete";
import { clampScore, formatPercent, formatValue } from "@/lib/format";
import type { SymbolSearchItem } from "@/lib/symbolTypes";
import type { ChartSeriesPoint, JsonValue, ScoreComponent, StockScoreResponse } from "@/lib/types";

const MAX_COMPARE = 5;
const LINE_COLORS = ["#3182f6", "#f04452", "#00a778", "#7c3aed", "#f59f00"];

const COMPARE_SECTIONS = [
  { id: "compare-summary", label: "요약" },
  { id: "compare-score-map", label: "점수 맵" },
  { id: "compare-board", label: "종목 보드" },
  { id: "compare-performance", label: "가격 흐름" },
  { id: "compare-factors", label: "팩터 히트맵" },
  { id: "compare-metrics", label: "지표 매트릭스" },
  { id: "compare-risk", label: "리스크/메모" },
] as const;

const SUGGESTIONS: Record<string, string[]> = {
  KO: ["PEP", "MNST", "KDP", "PG"],
  PEP: ["KO", "MNST", "KDP", "PG"],
  NVDA: ["AMD", "AVGO", "TSM", "INTC"],
  AMD: ["NVDA", "AVGO", "INTC", "QCOM"],
  AAPL: ["MSFT", "GOOGL", "AMZN", "META"],
  MSFT: ["AAPL", "GOOGL", "ORCL", "AMZN"],
  TSLA: ["GM", "F", "RIVN", "NIO"],
  AMZN: ["WMT", "COST", "SHOP", "MELI"],
  META: ["GOOGL", "SNAP", "PINS", "NFLX"],
  JPM: ["BAC", "WFC", "C", "MS"],
};

type LoadState =
  | { status: "loading"; ticker: string; data?: undefined; error?: undefined }
  | { status: "success"; ticker: string; data: StockScoreResponse; error?: undefined }
  | { status: "pending"; ticker: string; data?: undefined; error?: undefined; message: string }
  | { status: "error"; ticker: string; data?: undefined; error: string };

type BatchScoreResult = StockScoreResponse & {
  ok?: boolean;
  status?: number;
  error?: string;
  message?: string;
  retry_after_seconds?: number;
};

type BatchScorePayload = {
  ok?: boolean;
  results?: BatchScoreResult[];
  error?: string;
  message?: string;
};

type CompareItem = {
  ticker: string;
  data: StockScoreResponse;
  score: number;
  opportunityScore?: number;
  daily?: number;
  return1m?: number;
  return3m?: number;
  return6m?: number;
  return52w?: number;
  netMargin?: number;
  revenueGrowth?: number;
  debtToEquity?: number;
  currentRatio?: number;
  per?: number;
  forwardPer?: number;
  marketCap: string;
  strongest?: ScoreComponent;
  weakest?: ScoreComponent;
};

type CompareSectionId = (typeof COMPARE_SECTIONS)[number]["id"];
type CompareHighlightKey = string | null;
type DecisionTarget = {
  sectionId: CompareSectionId;
  highlightKey?: CompareHighlightKey;
};

function normalizeTicker(value: string): string {
  const text = value.trim().replace(/^!/, "").toUpperCase();
  if (text.includes(":")) {
    const [market, rawSymbol] = text.split(":", 2);
    const symbol = rawSymbol.replace(/[^A-Z0-9.-]/g, "");
    if ((market === "US" || market === "KR") && symbol) return `${market}:${symbol}`;
  }
  const symbol = text.replace(/[^A-Z0-9.-]/g, "");
  if (/^(?:\d{6}|Q\d{6})$/.test(symbol)) return `KR:${symbol}`;
  return symbol ? `US:${symbol}` : "";
}

function displayTickerRef(value: string): string {
  return value.replace(/^(US|KR):/i, "");
}

function symbolRef(item: SymbolSearchItem): string {
  return `${item.market}:${item.ticker}`;
}

function parseTickers(raw: string | null): string[] {
  const source = raw || "KO";
  const unique: string[] = [];
  source
    .split(",")
    .map(normalizeTicker)
    .filter(Boolean)
    .forEach((ticker) => {
      if (!unique.includes(ticker)) unique.push(ticker);
    });
  return unique.slice(0, MAX_COMPARE);
}

function pushTickers(router: ReturnType<typeof useRouter>, tickers: string[]) {
  router.push(`/compare?tickers=${encodeURIComponent(tickers.join(","))}`);
}

function numberFromRecord(record: Record<string, JsonValue> | undefined, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function componentByKey(data: StockScoreResponse, key: string): ScoreComponent | undefined {
  return data.components?.find((component) => component.key === key);
}

function metricByLabel(data: StockScoreResponse, label: string): string {
  return formatValue(data.key_metrics?.find((item) => item.label === label)?.value);
}

function valuationByLabel(data: StockScoreResponse, label: string): number | undefined {
  const raw = data.valuation_rows?.find((item) => item.label === label)?.value;
  if (typeof raw === "number") return raw;
  if (typeof raw !== "string") return undefined;
  const parsed = Number(raw.replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function scoreWord(score: number): string {
  if (score >= 80) return "좋아요";
  if (score >= 65) return "괜찮아요";
  if (score >= 50) return "애매해요";
  return "조심해요";
}

function percentText(value: number | undefined): string {
  return typeof value === "number" ? formatPercent(value) : "-";
}

function ratioText(value: number | undefined, suffix = ""): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(value)}${suffix}`;
}

function strongestAndWeakest(data: StockScoreResponse) {
  const components = [...(data.components || [])];
  return {
    strongest: components.sort((a, b) => (b.score ?? -1) - (a.score ?? -1))[0],
    weakest: [...components].sort((a, b) => (a.score ?? 101) - (b.score ?? 101))[0],
  };
}

function toCompareItem(data: StockScoreResponse, requestedTicker: string): CompareItem {
  const ticker = displayTickerRef(requestedTicker) || data.symbol || data.requested_ticker || "UNKNOWN";
  const { strongest, weakest } = strongestAndWeakest(data);
  return {
    ticker,
    data,
    score: clampScore(data.quality_score ?? data.score),
    opportunityScore: typeof data.opportunity_score === "number" ? clampScore(data.opportunity_score) : undefined,
    daily: numberFromRecord(data.price_metrics, "latest_change"),
    return1m: numberFromRecord(data.price_metrics, "return_1m"),
    return3m: numberFromRecord(data.price_metrics, "return_3m"),
    return6m: numberFromRecord(data.price_metrics, "return_6m"),
    return52w: numberFromRecord(data.price_metrics, "return_52w"),
    netMargin: numberFromRecord(data.financials, "profitMargins"),
    revenueGrowth: numberFromRecord(data.financials, "revenueGrowth"),
    debtToEquity: numberFromRecord(data.financials, "debtToEquity"),
    currentRatio: numberFromRecord(data.financials, "currentRatio"),
    per: valuationByLabel(data, "PER"),
    forwardPer: valuationByLabel(data, "Forward PER"),
    marketCap: metricByLabel(data, "시가총액"),
    strongest,
    weakest,
  };
}

function bestBy(items: CompareItem[], value: (item: CompareItem) => number | undefined, direction: "high" | "low" = "high") {
  const usable = items.filter((item) => typeof value(item) === "number");
  if (!usable.length) return undefined;
  return usable.sort((a, b) => {
    const left = value(a) ?? 0;
    const right = value(b) ?? 0;
    return direction === "high" ? right - left : left - right;
  })[0];
}

function componentScore(item: CompareItem, key: string): number | undefined {
  const score = componentByKey(item.data, key)?.score;
  return typeof score === "number" ? clampScore(score) : undefined;
}

function displayName(data: StockScoreResponse): string {
  return data.name || data.symbol || data.requested_ticker || "-";
}

function compactDisplayName(data: StockScoreResponse | undefined, fallback: string): string {
  if (!data) return displayTickerRef(fallback);
  const name = displayName(data);
  if (!name || name === "-") return displayTickerRef(fallback);
  return name.length > 18 ? data.symbol || displayTickerRef(fallback) : name;
}

function stateDataByTicker(states: LoadState[], ticker: string): StockScoreResponse | undefined {
  return states.find((state): state is Extract<LoadState, { status: "success" }> => state.ticker === ticker && state.status === "success")?.data;
}

function isSnapshotPending(result: BatchScoreResult | undefined): boolean {
  return result?.error === "snapshot_pending" || result?.error === "snapshot_unavailable";
}

function pendingMessage(result: BatchScoreResult | undefined): string {
  const retryAfter = typeof result?.retry_after_seconds === "number" && Number.isFinite(result.retry_after_seconds) ? result.retry_after_seconds : undefined;
  const message = "데이터를 준비하고 있어요. 수집이 끝나면 비교 점수가 표시됩니다.";
  return retryAfter ? `${message} 보통 ${retryAfter}초 안에 다시 확인할 수 있어요.` : message;
}

export default function StockCompare() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tickers = useMemo(() => parseTickers(searchParams.get("tickers") || searchParams.get("ticker")), [searchParams]);
  const baseTicker = tickers[0] || "US:KO";
  const baseTickerLabel = displayTickerRef(baseTicker);
  const { theme, setTheme } = useThemePreference();
  const [input, setInput] = useState("");
  const [states, setStates] = useState<LoadState[]>(tickers.map((ticker) => ({ status: "loading", ticker })));
  const [activeSection, setActiveSection] = useState<CompareSectionId>("compare-summary");
  const [highlightKey, setHighlightKey] = useState<CompareHighlightKey>(null);
  const highlightTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    setStates(tickers.map((ticker) => ({ status: "loading", ticker })));

    fetch(`/api/score/batch?tickers=${encodeURIComponent(tickers.join(","))}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as BatchScorePayload;
        if (!response.ok) {
          throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
        }
        return payload.results || [];
      })
      .then((results) => {
        if (controller.signal.aborted) return;
        setStates(
          tickers.map((ticker, index) => {
            const result = results[index];
            if (isSnapshotPending(result)) {
              return {
                status: "pending" as const,
                ticker,
                message: pendingMessage(result),
              };
            }
            if (!result || result.ok === false) {
              return {
                status: "error" as const,
                ticker,
                error: result?.message || result?.error || "데이터를 불러오지 못했어요.",
              };
            }
            return { status: "success" as const, ticker, data: result as StockScoreResponse };
          })
        );
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setStates(
          tickers.map((ticker) => ({
            status: "error" as const,
            ticker,
            error: error instanceof Error ? error.message : "데이터를 불러오지 못했어요.",
          }))
        );
      });

    return () => controller.abort();
  }, [tickers]);

  const items = useMemo(
    () => states.filter((state): state is Extract<LoadState, { status: "success" }> => state.status === "success").map((state) => toCompareItem(state.data, state.ticker)),
    [states]
  );
  const isLoading = states.some((state) => state.status === "loading");
  const pendingStates = states.filter((state): state is Extract<LoadState, { status: "pending" }> => state.status === "pending");
  const suggestions = (SUGGESTIONS[baseTickerLabel] || ["AAPL", "MSFT", "NVDA", "AMZN", "JPM"])
    .map(normalizeTicker)
    .filter((ticker) => !tickers.includes(ticker))
    .slice(0, Math.max(0, MAX_COMPARE - tickers.length));

  useEffect(() => {
    const sectionIds = COMPARE_SECTIONS.map((section) => section.id);
    let frame = 0;

    const updateActiveSection = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const anchorTop = 190;
        const positions = sectionIds
          .map((id) => {
            const element = document.getElementById(id);
            return element ? { id, top: element.getBoundingClientRect().top } : undefined;
          })
          .filter((section): section is { id: CompareSectionId; top: number } => !!section);
        if (!positions.length) return;
        const current = positions.reduce((candidate, section) => (section.top <= anchorTop ? section : candidate), positions[0]);
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
  }, [items.length]);

  useEffect(() => () => {
    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
  }, []);

  function addTicker(value: string) {
    const ticker = normalizeTicker(value);
    if (!ticker || tickers.includes(ticker) || tickers.length >= MAX_COMPARE) return;
    setInput("");
    pushTickers(router, [...tickers, ticker]);
  }

  function addSymbol(item: SymbolSearchItem) {
    addTicker(symbolRef(item));
  }

  function removeTicker(ticker: string) {
    const next = tickers.filter((item, index) => index === 0 || item !== ticker);
    pushTickers(router, next);
  }

  function focusCompareSection(target: DecisionTarget) {
    document.getElementById(target.sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveSection(target.sectionId);
    setHighlightKey(target.highlightKey || target.sectionId);
    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = window.setTimeout(() => setHighlightKey(null), 1800);
  }

  return (
    <main className="stock-app compare-app">
      <section className="compare-search-shell">
        <AppTopbar active="compare" theme={theme} onThemeChange={setTheme} />
        <div className="compare-toolbar">
          <a href={`/?ticker=${encodeURIComponent(baseTicker)}`} className="compare-back">
            상세
          </a>
          <SymbolAutocomplete
            id="compare-ticker"
            value={input}
            onValueChange={setInput}
            onSelect={addSymbol}
            placeholder="비교할 종목 검색"
            buttonLabel="추가"
            label="비교할 국내·미국 주식 검색"
            disabled={tickers.length >= MAX_COMPARE}
            className="compare-add-form"
          />
        </div>
      </section>

      <section className="compare-hero">
        <div>
          <span>비교하기</span>
          <h1>{baseTickerLabel}와 나란히 보기</h1>
          <p>{tickers.length === 1 ? "한 종목을 더 붙이면 차이가 보이기 시작해요." : `${tickers.length}개 종목을 같은 기준으로 맞춰봤어요.`}</p>
        </div>
        <div className="compare-count">{tickers.length}/{MAX_COMPARE}</div>
      </section>

      <section className="compare-picks" aria-label="선택된 종목">
        {tickers.map((ticker, index) => (
          <span key={ticker} className={index === 0 ? "base" : ""}>
            <strong>{compactDisplayName(stateDataByTicker(states, ticker), ticker)}</strong>
            <small>{displayTickerRef(ticker)}</small>
            {index === 0 ? <b>기준</b> : <button type="button" onClick={() => removeTicker(ticker)} aria-label={`${displayTickerRef(ticker)} 삭제`}>×</button>}
          </span>
        ))}
      </section>

      {suggestions.length ? (
        <details className="compare-suggestions-panel">
          <summary>추천 비교 종목</summary>
          <section className="compare-suggestions" aria-label="추천 비교 종목">
            {suggestions.map((ticker) => (
              <button key={ticker} type="button" onClick={() => addTicker(ticker)}>
                + {displayTickerRef(ticker)}
              </button>
            ))}
          </section>
        </details>
      ) : null}

      {states.some((state) => state.status === "error") ? (
        <section className="compare-errors">
          {states
            .filter((state): state is Extract<LoadState, { status: "error" }> => state.status === "error")
            .map((state) => (
              <p key={state.ticker}>
                <strong>{state.ticker}</strong> {state.error}
              </p>
            ))}
        </section>
      ) : null}

      {pendingStates.length ? (
        <section className="compare-state-modules" aria-label="준비 중인 종목">
          {pendingStates.map((state) => (
            <article key={state.ticker} className="compare-pending-module">
              <span>{displayTickerRef(state.ticker)}</span>
              <strong>준비 중</strong>
              <p>{state.message}</p>
              <i aria-hidden="true" />
            </article>
          ))}
        </section>
      ) : null}

      {isLoading && !items.length ? <CompareSkeleton /> : null}

      {items.length ? (
        <>
          <CompareIndex sections={COMPARE_SECTIONS} activeSection={activeSection} onSelect={(id) => focusCompareSection({ sectionId: id })} />
          <div className="compare-feed">
            <CompareBrief items={items} baseTicker={baseTickerLabel} onDecision={focusCompareSection} />
            {items.length >= 2 ? <QualityOpportunityMap items={items} highlightKey={highlightKey} /> : null}
            <CompareCards items={items} baseTicker={baseTickerLabel} highlightKey={highlightKey} />
            {items.length >= 2 ? <CompareChart items={items} /> : null}
            {items.length >= 2 ? <ComponentMatrix items={items} highlightKey={highlightKey} /> : null}
            {items.length >= 2 ? <CompareMatrix items={items} highlightKey={highlightKey} /> : null}
            {items.length >= 2 ? <RiskMemo items={items} highlightKey={highlightKey} /> : null}
          </div>
        </>
      ) : null}
    </main>
  );
}

function CompareSkeleton() {
  return (
    <div className="compare-feed skeleton-feed" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">비교 데이터를 불러오는 중이에요.</span>
      <section className="compare-section">
        <span className="skeleton-block label" />
        <span className="skeleton-block section-heading" />
        <div className="compare-card-grid">
          {[0, 1].map((item) => (
            <article className="compare-stock-card" key={item}>
              <span className="skeleton-block value" />
              <span className="skeleton-block score" />
              <span className="skeleton-block wide" />
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function CompareIndex({
  sections,
  activeSection,
  onSelect,
}: {
  sections: ReadonlyArray<{ id: CompareSectionId; label: string }>;
  activeSection: CompareSectionId;
  onSelect: (id: CompareSectionId) => void;
}) {
  return (
    <nav className="stock-detail-index compare-index" aria-label="비교 화면 목차">
      <span>목차</span>
      <div>
        {sections.map((section) => (
          <button key={section.id} type="button" className={activeSection === section.id ? "active" : undefined} onClick={() => onSelect(section.id)}>
            {section.label}
          </button>
        ))}
      </div>
    </nav>
  );
}

function CompareBrief({ items, baseTicker, onDecision }: { items: CompareItem[]; baseTicker: string; onDecision: (target: DecisionTarget) => void }) {
  const bestScore = bestBy(items, (item) => item.score);
  const bestOpportunity = bestBy(items, (item) => item.opportunityScore);
  const bestMomentum = bestBy(items, (item) => item.return52w ?? item.return6m ?? item.return3m);
  const bestValue = bestBy(items, (item) => componentScore(item, "valuation"));
  const bestProfit = bestBy(items, (item) => componentScore(item, "profitability"));
  const weakestHealth = bestBy(items, (item) => componentScore(item, "health"), "low");
  const base = items.find((item) => item.ticker === baseTicker) || items[0];
  const decisionModules = [
    {
      label: "품질 1위",
      item: bestScore,
      value: bestScore ? `${bestScore.score.toFixed(1)}점` : "-",
      reason: "기초 체력 균형",
      target: { sectionId: "compare-board", highlightKey: bestScore ? `card-${bestScore.ticker}` : undefined },
      fill: bestScore?.score,
    },
    {
      label: "기회 1위",
      item: bestOpportunity,
      value: bestOpportunity?.opportunityScore === undefined ? "-" : `${bestOpportunity.opportunityScore.toFixed(1)}점`,
      reason: "성장·밸류 조합",
      target: { sectionId: "compare-score-map", highlightKey: bestOpportunity ? `map-${bestOpportunity.ticker}` : undefined },
      fill: bestOpportunity?.opportunityScore,
    },
    {
      label: "최근 흐름",
      item: bestMomentum,
      value: percentText(bestMomentum?.return52w ?? bestMomentum?.return6m),
      reason: "가격 추세 우위",
      target: { sectionId: "compare-performance", highlightKey: bestMomentum ? `legend-${bestMomentum.ticker}` : undefined },
      fill: bestMomentum ? Math.min(100, Math.max(8, (bestMomentum.return52w ?? bestMomentum.return6m ?? 0) + 50)) : undefined,
    },
    {
      label: "부담 낮음",
      item: bestValue,
      value: bestValue ? `${ratioText(componentScore(bestValue, "valuation"))}점` : "-",
      reason: "밸류에이션 상대 우위",
      target: { sectionId: "compare-factors", highlightKey: "factor-valuation" },
      fill: bestValue ? componentScore(bestValue, "valuation") : undefined,
    },
    {
      label: "수익성",
      item: bestProfit,
      value: bestProfit ? `${ratioText(componentScore(bestProfit, "profitability"))}점` : "-",
      reason: "이익 체력 우위",
      target: { sectionId: "compare-factors", highlightKey: "factor-profitability" },
      fill: bestProfit ? componentScore(bestProfit, "profitability") : undefined,
    },
    {
      label: "리스크",
      item: weakestHealth,
      value: weakestHealth ? `${ratioText(componentScore(weakestHealth, "health"))}점` : "-",
      reason: "먼저 확인",
      target: { sectionId: "compare-risk", highlightKey: weakestHealth ? `risk-${weakestHealth.ticker}` : undefined },
      fill: weakestHealth ? componentScore(weakestHealth, "health") : undefined,
    },
  ] satisfies Array<{
    label: string;
    item: CompareItem | undefined;
    value: string;
    reason: string;
    target: DecisionTarget;
    fill?: number;
  }>;

  return (
    <section id="compare-summary" className="compare-section compare-brief">
      <span>먼저 볼 차이</span>
      <h2>{items.length === 1 ? "비교할 종목을 기다리고 있어요" : `${baseTicker} 기준으로 갈리는 부분이에요`}</h2>
      <p>
        {items.length === 1
          ? `${base.ticker}의 점수는 ${base.score.toFixed(1)}점이에요. 비교 종목을 붙이면 가격 흐름, 수익성, 재무 안정성이 같은 기준으로 정리돼요.`
          : `${bestScore?.ticker || base.ticker}가 전체 점수에서 앞서고, ${bestMomentum?.ticker || base.ticker}는 최근 흐름이 가장 강해요. 가격 부담은 ${bestValue?.ticker || base.ticker}, 수익성은 ${bestProfit?.ticker || base.ticker}를 먼저 보면 좋아요.`}
      </p>
      {items.length >= 2 ? (
        <div className="compare-decision-strip">
          {decisionModules.map((module) => (
            <button key={module.label} type="button" onClick={() => onDecision(module.target)} style={{ "--decision-fill": `${Math.max(6, Math.min(100, module.fill ?? 0))}%` } as CSSProperties}>
              <span>{module.label}</span>
              <strong>{module.item?.ticker || "-"}</strong>
              <p>{module.value}</p>
              <small>{module.reason}</small>
              <i aria-hidden="true" />
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function QualityOpportunityMap({ items, highlightKey }: { items: CompareItem[]; highlightKey: CompareHighlightKey }) {
  return (
    <section id="compare-score-map" className={`compare-section compare-score-map ${highlightKey === "compare-score-map" ? "highlight-pulse" : ""}`}>
      <span>점수 맵</span>
      <h2>품질과 기회를 같은 축에 놓고 봐요</h2>
      <p>오른쪽 위에 가까울수록 기초 체력과 지금 볼 이유가 함께 있는 종목이에요.</p>
      <div className="quality-opportunity-map" role="img" aria-label="품질 점수와 기회 점수 비교 지도">
        <div className="map-quadrant top-right">우선 검토</div>
        <div className="map-quadrant top-left">기회 우세</div>
        <div className="map-quadrant bottom-right">품질 우세</div>
        <div className="map-axis x-axis">품질</div>
        <div className="map-axis y-axis">기회</div>
        {items.map((item) => {
          const opportunity = item.opportunityScore ?? item.score;
          const x = Math.max(4, Math.min(96, item.score));
          const y = 100 - Math.max(4, Math.min(96, opportunity));
          const isHighlighted = highlightKey === `map-${item.ticker}`;
          return (
            <span
              key={item.ticker}
              className={`score-map-dot ${item.daily !== undefined && item.daily < 0 ? "down" : "up"} ${isHighlighted ? "highlight-pulse" : ""}`}
              style={{ left: `${x}%`, top: `${y}%` }}
            >
              <strong>{item.ticker}</strong>
              <small>
                {item.score.toFixed(0)} / {opportunity.toFixed(0)}
              </small>
            </span>
          );
        })}
      </div>
    </section>
  );
}

function CompareCards({ items, baseTicker, highlightKey }: { items: CompareItem[]; baseTicker: string; highlightKey: CompareHighlightKey }) {
  return (
    <section id="compare-board" className="compare-section compare-board-section">
      <span>종목 카드</span>
      <h2>최대 5개 종목을 한 보드에서 봐요</h2>
      <div className="compare-card-grid" style={{ "--compare-count": items.length } as CSSProperties}>
        {items.map((item) => (
          <article className={`compare-stock-card ${highlightKey === `card-${item.ticker}` ? "highlight-pulse" : ""}`} key={item.ticker}>
            <div className="compare-card-top">
              <div>
                <span>{item.ticker === baseTicker ? "기준 종목" : "비교 종목"}</span>
                <strong>{item.ticker}</strong>
              </div>
              <em className={item.daily !== undefined && item.daily < 0 ? "price-down" : "price-up"}>{percentText(item.daily)}</em>
            </div>
            <p>{displayName(item.data)}</p>
            <div className="compare-donut-row">
              <ScoreDonut label="품질" value={item.score} tone="quality" />
              <ScoreDonut label="기회" value={item.opportunityScore} tone="opportunity" />
            </div>
            <dl>
              <div>
                <dt>시가총액</dt>
                <dd>{item.marketCap}</dd>
              </div>
              <div>
                <dt>강점</dt>
                <dd>{item.strongest?.label || "-"}</dd>
              </div>
              <div>
                <dt>먼저 볼 것</dt>
                <dd>{item.weakest?.label || "-"}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}

function ScoreDonut({ label, value, tone }: { label: string; value: number | undefined; tone: "quality" | "opportunity" }) {
  const score = typeof value === "number" && Number.isFinite(value) ? clampScore(value) : undefined;
  return (
    <div className={`compare-score-donut ${tone}`} style={{ "--score": `${score ?? 0}` } as CSSProperties}>
      <i aria-hidden="true" />
      <span>{label}</span>
      <strong>{score === undefined ? "-" : score.toFixed(1)}</strong>
      <small>{score === undefined ? "대기" : scoreWord(score)}</small>
    </div>
  );
}

function normalizedPoints(item: CompareItem) {
  const usable = (item.data.chart_series || []).filter(
    (point): point is ChartSeriesPoint & { close: number; date: string } =>
      typeof point.close === "number" && Number.isFinite(point.close) && typeof point.date === "string"
  );
  if (usable.length < 2) return [];
  const first = usable[0].close;
  if (!Number.isFinite(first) || first === 0) return [];
  return usable.map((point) => ({
    date: point.date,
    value: (point.close / first) * 100,
  }));
}

function CompareChart({ items }: { items: CompareItem[] }) {
  const series = items
    .map((item, index) => ({
      item,
      color: LINE_COLORS[index % LINE_COLORS.length],
      points: normalizedPoints(item),
    }))
    .filter((entry) => entry.points.length >= 2);

  if (!series.length) return null;

  const width = 860;
  const height = 310;
  const padX = 24;
  const padTop = 24;
  const padBottom = 48;
  const values = series.flatMap((entry) => entry.points.map((point) => point.value));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const maxLength = Math.max(...series.map((entry) => entry.points.length));
  const x = (index: number) => padX + (width - padX * 2) * (index / Math.max(1, maxLength - 1));
  const y = (value: number) => height - padBottom - (height - padTop - padBottom) * ((value - min) / span);

  return (
    <section id="compare-performance" className="compare-section">
      <span>가격 흐름</span>
      <h2>1년 전을 100으로 맞춰봤어요</h2>
      <div className="compare-chart">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="비교 가격 흐름">
          <line x1={padX} y1={y(100)} x2={width - padX} y2={y(100)} className="compare-base-line" />
          {series.map((entry) => (
            <polyline
              key={entry.item.ticker}
              points={entry.points.map((point, index) => `${x(index)},${y(point.value)}`).join(" ")}
              fill="none"
              stroke={entry.color}
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </svg>
      </div>
      <div className="compare-legend">
        {series.map((entry) => {
          const latest = entry.points[entry.points.length - 1]?.value;
          return (
            <span key={entry.item.ticker} id={`compare-legend-${entry.item.ticker}`}>
              <i style={{ background: entry.color }} />
              {entry.item.ticker}
              <b>{Number.isFinite(latest) ? `${(latest - 100).toFixed(1)}%` : "-"}</b>
            </span>
          );
        })}
      </div>
    </section>
  );
}

type MetricRow = {
  group: "price" | "business" | "risk" | "valuation";
  label: string;
  description: string;
  value: (item: CompareItem) => number | undefined;
  display: (value: number | undefined) => string;
  best?: "high" | "low";
};

const METRIC_GROUPS = [
  {
    key: "price",
    title: "가격 흐름",
    description: "오늘 움직임과 기간별 수익률을 같은 기준으로 봐요.",
  },
  {
    key: "business",
    title: "사업 체력",
    description: "돈을 얼마나 잘 벌고, 사업이 얼마나 커지는지 봐요.",
  },
  {
    key: "risk",
    title: "재무 부담",
    description: "빚 부담과 단기 체력을 분리해서 확인해요.",
  },
  {
    key: "valuation",
    title: "가격 부담",
    description: "좋은 회사라도 가격이 부담스러운지 비교해요.",
  },
] as const;

const METRIC_ROWS: MetricRow[] = [
  { group: "price", label: "전일 대비", description: "오늘 움직임", value: (item) => item.daily, display: percentText, best: "high" },
  { group: "price", label: "1개월", description: "짧은 흐름", value: (item) => item.return1m, display: percentText, best: "high" },
  { group: "price", label: "6개월", description: "중기 흐름", value: (item) => item.return6m, display: percentText, best: "high" },
  { group: "price", label: "52주", description: "긴 흐름", value: (item) => item.return52w, display: percentText, best: "high" },
  { group: "business", label: "순이익률", description: "매출에서 이익이 남는 힘", value: (item) => item.netMargin, display: percentText, best: "high" },
  { group: "business", label: "매출 성장률", description: "사업이 커지는 속도", value: (item) => item.revenueGrowth, display: percentText, best: "high" },
  { group: "risk", label: "부채/자본", description: "낮을수록 부담이 덜해요", value: (item) => item.debtToEquity, display: (value) => ratioText(value, "%"), best: "low" },
  { group: "risk", label: "유동비율", description: "높을수록 단기 체력이 좋아요", value: (item) => item.currentRatio, display: ratioText, best: "high" },
  { group: "valuation", label: "PER", description: "낮을수록 현재 이익 대비 부담이 덜해요", value: (item) => item.per, display: ratioText, best: "low" },
  { group: "valuation", label: "Forward PER", description: "낮을수록 예상 이익 대비 부담이 덜해요", value: (item) => item.forwardPer, display: ratioText, best: "low" },
];

function metricFill(items: CompareItem[], row: MetricRow, item: CompareItem): number {
  const current = row.value(item);
  const values = items.map(row.value).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (typeof current !== "number" || !Number.isFinite(current) || !values.length) return 0;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return 100;
  const fill = row.best === "low" ? ((max - current) / (max - min)) * 100 : ((current - min) / (max - min)) * 100;
  return Math.max(6, Math.min(100, fill));
}

function CompareMatrix({ items, highlightKey }: { items: CompareItem[]; highlightKey: CompareHighlightKey }) {
  return (
    <section id="compare-metrics" className={`compare-section ${highlightKey === "compare-metrics" ? "highlight-pulse" : ""}`}>
      <span>차이가 나는 숫자</span>
      <h2>판단 기준별로 나눠서 볼게요</h2>
      <div className="compare-group-list">
        {METRIC_GROUPS.map((group) => {
          const rows = METRIC_ROWS.filter((row) => row.group === group.key);
          return (
            <section key={group.key} className={`compare-metric-group ${highlightKey === `metric-${group.key}` ? "highlight-pulse" : ""}`}>
              <div className="compare-group-heading">
                <strong>{group.title}</strong>
                <span>{group.description}</span>
              </div>
              <div className="compare-metric-list">
                {rows.map((row) => {
                  const best = row.best ? bestBy(items, row.value, row.best) : undefined;
                  return (
                    <article key={row.label} className="compare-metric-row">
                      <header>
                        <strong>{row.label}</strong>
                        <span>{row.description}</span>
                      </header>
                      <div className="compare-metric-values">
                        {items.map((item) => {
                          const value = row.value(item);
                          const isBest = best?.ticker === item.ticker;
                          return (
                            <div
                              key={`${row.label}-${item.ticker}`}
                              className={`${isBest ? "best" : ""} ${typeof value === "number" && value < 0 ? "negative" : ""}`}
                            >
                              <span>{item.ticker}</span>
                              <strong>{row.display(value)}</strong>
                              <i aria-hidden="true">
                                <em style={{ width: `${metricFill(items, row, item)}%` }} />
                              </i>
                              {isBest ? <small>{row.best === "low" ? "부담 낮음" : "가장 높음"}</small> : null}
                            </div>
                          );
                        })}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}

const COMPONENT_ROWS = [
  { key: "profitability", label: "수익성" },
  { key: "growth", label: "성장성" },
  { key: "health", label: "재무 안정성" },
  { key: "momentum", label: "가격 흐름" },
  { key: "valuation", label: "가격 부담" },
];

function scoreBand(score: number | undefined): string {
  if (typeof score !== "number") return "missing";
  if (score >= 80) return "strong";
  if (score >= 60) return "good";
  if (score >= 45) return "watch";
  return "weak";
}

function ComponentMatrix({ items, highlightKey }: { items: CompareItem[]; highlightKey: CompareHighlightKey }) {
  return (
    <section id="compare-factors" className="compare-section compare-factor-section">
      <span>항목별 점수</span>
      <h2>팩터 히트맵으로 강약을 봐요</h2>
      <div className="factor-heatmap" role="table" aria-label="종목별 팩터 점수 히트맵">
        {COMPONENT_ROWS.map((row) => (
          <article key={row.key} className={highlightKey === `factor-${row.key}` ? "highlight-pulse" : ""} role="row">
            <header role="rowheader">
              <strong>{row.label}</strong>
              <span>높을수록 유리해요</span>
            </header>
            <div role="cell">
              {(() => {
                const best = bestBy(items, (item) => componentScore(item, row.key));
                return items.map((item) => {
                  const score = componentScore(item, row.key);
                  const isBest = best?.ticker === item.ticker;
                  return (
                    <span key={`${row.key}-${item.ticker}`} className={`${isBest ? "best" : ""} ${scoreBand(score)}`}>
                      <b>{item.ticker}</b>
                      <strong>{score === undefined ? "-" : score.toFixed(1)}</strong>
                      {isBest ? <small>최고</small> : null}
                    </span>
                  );
                });
              })()}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function RiskMemo({ items, highlightKey }: { items: CompareItem[]; highlightKey: CompareHighlightKey }) {
  const weakestHealth = bestBy(items, (item) => componentScore(item, "health"), "low");
  const weakestValuation = bestBy(items, (item) => componentScore(item, "valuation"), "low");
  const weakestMomentum = bestBy(items, (item) => componentScore(item, "momentum"), "low");
  const negativeMovers = items.filter((item) => typeof item.daily === "number" && item.daily < 0).sort((a, b) => (a.daily ?? 0) - (b.daily ?? 0)).slice(0, 2);
  const notes = [
    {
      key: weakestHealth ? `risk-${weakestHealth.ticker}` : "risk-health",
      label: "재무 안정성",
      item: weakestHealth,
      value: weakestHealth ? `${ratioText(componentScore(weakestHealth, "health"))}점` : "-",
      body: "부채와 단기 체력이 비교군 안에서 가장 약한지 확인해요.",
    },
    {
      key: weakestValuation ? `risk-valuation-${weakestValuation.ticker}` : "risk-valuation",
      label: "가격 부담",
      item: weakestValuation,
      value: weakestValuation ? `${ratioText(componentScore(weakestValuation, "valuation"))}점` : "-",
      body: "좋은 종목이라도 밸류에이션 부담이 크면 진입 판단을 보수적으로 둬요.",
    },
    {
      key: weakestMomentum ? `risk-momentum-${weakestMomentum.ticker}` : "risk-momentum",
      label: "흐름 둔화",
      item: weakestMomentum,
      value: weakestMomentum ? `${ratioText(componentScore(weakestMomentum, "momentum"))}점` : "-",
      body: "가격 흐름이 약한 종목은 실적과 뉴스 확인을 먼저 붙여요.",
    },
  ];

  return (
    <section id="compare-risk" className="compare-section compare-risk-section">
      <span>리스크/메모</span>
      <h2>좋은 쪽만 보지 않도록 마지막으로 걸러요</h2>
      <div className="compare-risk-grid">
        {notes.map((note) => (
          <article key={note.key} className={highlightKey === note.key ? "highlight-pulse" : ""}>
            <span>{note.label}</span>
            <strong>{note.item?.ticker || "-"}</strong>
            <p>{note.value}</p>
            <small>{note.body}</small>
          </article>
        ))}
        <article>
          <span>오늘 약세</span>
          <strong>{negativeMovers.map((item) => item.ticker).join(", ") || "-"}</strong>
          <p>{negativeMovers[0] ? percentText(negativeMovers[0].daily) : "-"}</p>
          <small>단기 하락은 기회와 위험을 함께 만들어요.</small>
        </article>
      </div>
    </section>
  );
}
