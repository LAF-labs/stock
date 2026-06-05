"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import SymbolAutocomplete from "@/components/SymbolAutocomplete";
import { clampScore, formatPercent, formatValue } from "@/lib/format";
import type { SymbolSearchItem } from "@/lib/symbolTypes";
import type { ChartSeriesPoint, JsonValue, ScoreComponent, StockScoreResponse } from "@/lib/types";

const MAX_COMPARE = 5;
const LINE_COLORS = ["#3182f6", "#f04452", "#00a778", "#7c3aed", "#f59f00"];

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
  | { status: "error"; ticker: string; data?: undefined; error: string };

type BatchScoreResult = StockScoreResponse & {
  ok?: boolean;
  status?: number;
  error?: string;
  message?: string;
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

export default function StockCompare() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tickers = useMemo(() => parseTickers(searchParams.get("tickers") || searchParams.get("ticker")), [searchParams]);
  const baseTicker = tickers[0] || "US:KO";
  const baseTickerLabel = displayTickerRef(baseTicker);
  const [input, setInput] = useState("");
  const [states, setStates] = useState<LoadState[]>(tickers.map((ticker) => ({ status: "loading", ticker })));

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
  const suggestions = (SUGGESTIONS[baseTickerLabel] || ["AAPL", "MSFT", "NVDA", "AMZN", "JPM"])
    .map(normalizeTicker)
    .filter((ticker) => !tickers.includes(ticker))
    .slice(0, Math.max(0, MAX_COMPARE - tickers.length));

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

  return (
    <main className="stock-app compare-app">
      <section className="compare-toolbar">
        <a href={`/?ticker=${encodeURIComponent(baseTicker)}`} className="compare-back">
          상세로
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
            {displayTickerRef(ticker)}
            {index === 0 ? <b>기준</b> : <button type="button" onClick={() => removeTicker(ticker)} aria-label={`${displayTickerRef(ticker)} 삭제`}>×</button>}
          </span>
        ))}
      </section>

      {suggestions.length ? (
        <section className="compare-suggestions" aria-label="추천 비교 종목">
          {suggestions.map((ticker) => (
            <button key={ticker} type="button" onClick={() => addTicker(ticker)}>
              + {displayTickerRef(ticker)}
            </button>
          ))}
        </section>
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

      {isLoading && !items.length ? <CompareSkeleton /> : null}

      {items.length ? (
        <div className="compare-feed">
          <CompareBrief items={items} baseTicker={baseTickerLabel} />
          <CompareCards items={items} baseTicker={baseTickerLabel} />
          {items.length >= 2 ? <CompareChart items={items} /> : null}
          {items.length >= 2 ? <CompareMatrix items={items} /> : null}
          {items.length >= 2 ? <ComponentMatrix items={items} /> : null}
        </div>
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

function CompareBrief({ items, baseTicker }: { items: CompareItem[]; baseTicker: string }) {
  const bestScore = bestBy(items, (item) => item.score);
  const bestOpportunity = bestBy(items, (item) => item.opportunityScore);
  const bestMomentum = bestBy(items, (item) => item.return52w ?? item.return6m ?? item.return3m);
  const bestValue = bestBy(items, (item) => componentScore(item, "valuation"));
  const bestProfit = bestBy(items, (item) => componentScore(item, "profitability"));
  const weakestHealth = bestBy(items, (item) => componentScore(item, "health"), "low");
  const base = items.find((item) => item.ticker === baseTicker) || items[0];

  return (
    <section className="compare-section compare-brief">
      <span>먼저 볼 차이</span>
      <h2>{items.length === 1 ? "비교할 종목을 기다리고 있어요" : `${baseTicker} 기준으로 갈리는 부분이에요`}</h2>
      <p>
        {items.length === 1
          ? `${base.ticker}의 점수는 ${base.score.toFixed(1)}점이에요. 비교 종목을 붙이면 가격 흐름, 수익성, 재무 안정성이 같은 기준으로 정리돼요.`
          : `${bestScore?.ticker || base.ticker}가 전체 점수에서 앞서고, ${bestMomentum?.ticker || base.ticker}는 최근 흐름이 가장 강해요. 가격 부담은 ${bestValue?.ticker || base.ticker}, 수익성은 ${bestProfit?.ticker || base.ticker}를 먼저 보면 좋아요.`}
      </p>
      {items.length >= 2 ? (
        <div className="compare-insight-grid">
          <Insight label="전체 균형" ticker={bestScore?.ticker} value={bestScore ? `${bestScore.score.toFixed(1)}점` : "-"} />
          <Insight label="기회 점수" ticker={bestOpportunity?.ticker} value={bestOpportunity?.opportunityScore === undefined ? "-" : `${bestOpportunity.opportunityScore.toFixed(1)}점`} />
          <Insight label="최근 흐름" ticker={bestMomentum?.ticker} value={percentText(bestMomentum?.return52w ?? bestMomentum?.return6m)} />
          <Insight label="가격 부담" ticker={bestValue?.ticker} value={bestValue ? `${ratioText(componentScore(bestValue, "valuation"))}점` : "-"} />
          <Insight label="수익성" ticker={bestProfit?.ticker} value={bestProfit ? `${ratioText(componentScore(bestProfit, "profitability"))}점` : "-"} />
          <Insight label="먼저 확인" ticker={weakestHealth?.ticker} value={weakestHealth ? `${ratioText(componentScore(weakestHealth, "health"))}점` : "-"} />
        </div>
      ) : null}
    </section>
  );
}

function Insight({ label, ticker, value }: { label: string; ticker: string | undefined; value: string }) {
  return (
    <article>
      <span>{label}</span>
      <strong>{ticker || "-"}</strong>
      <p>{value}</p>
    </article>
  );
}

function CompareCards({ items, baseTicker }: { items: CompareItem[]; baseTicker: string }) {
  return (
    <section className="compare-section">
      <span>종목 카드</span>
      <h2>각 종목의 현재 인상이에요</h2>
      <div className="compare-card-grid" style={{ "--compare-count": items.length } as CSSProperties}>
        {items.map((item) => (
          <article className="compare-stock-card" key={item.ticker}>
            <div className="compare-card-top">
              <div>
                <span>{item.ticker === baseTicker ? "기준 종목" : "비교 종목"}</span>
                <strong>{item.ticker}</strong>
              </div>
              <em className={item.daily !== undefined && item.daily < 0 ? "price-down" : "price-up"}>{percentText(item.daily)}</em>
            </div>
            <p>{displayName(item.data)}</p>
            <div className="compare-score-line">
              <strong>{item.score.toFixed(1)}점</strong>
              <span>품질 {scoreWord(item.score)}</span>
            </div>
            <i className="compare-card-scorebar" aria-hidden="true">
              <em style={{ width: `${item.score}%` }} />
            </i>
            <div className="compare-opportunity-line">
              <span>기회</span>
              <strong>{item.opportunityScore === undefined ? "-" : `${item.opportunityScore.toFixed(1)}점`}</strong>
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
    <section className="compare-section">
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
            <span key={entry.item.ticker}>
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

function CompareMatrix({ items }: { items: CompareItem[] }) {
  return (
    <section className="compare-section">
      <span>차이가 나는 숫자</span>
      <h2>판단 기준별로 나눠서 볼게요</h2>
      <div className="compare-group-list">
        {METRIC_GROUPS.map((group) => {
          const rows = METRIC_ROWS.filter((row) => row.group === group.key);
          return (
            <section key={group.key} className="compare-metric-group">
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

function ComponentMatrix({ items }: { items: CompareItem[] }) {
  return (
    <section className="compare-section">
      <span>항목별 점수</span>
      <h2>무엇이 강하고 약한지 보여요</h2>
      <div className="component-compare-list">
        {COMPONENT_ROWS.map((row) => (
          <article key={row.key}>
            <header>
              <strong>{row.label}</strong>
              <span>높을수록 유리해요</span>
            </header>
            <div>
              {(() => {
                const best = bestBy(items, (item) => componentScore(item, row.key));
                return items.map((item) => {
                  const score = componentScore(item, row.key);
                  const isBest = best?.ticker === item.ticker;
                  return (
                    <span key={`${row.key}-${item.ticker}`} className={isBest ? "best" : ""}>
                      <b>{item.ticker}</b>
                      <i>
                        <em style={{ width: `${score ?? 0}%` }} />
                      </i>
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
