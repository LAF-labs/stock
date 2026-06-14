"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AppNavigationMenu from "@/components/AppNavigationMenu";
import CompareEditSheet from "@/components/compare/CompareEditSheet";
import CompareSection from "@/components/compare/CompareSection";
import CompareSideIndex from "@/components/compare/CompareSideIndex";
import type { CompareSelectedTickerEntry } from "@/components/compare/CompareSelectedTickerList";
import { ComparePendingOverviewSkeleton, SkeletonSectionTitle } from "@/components/StockLoadingSkeletons";
import SkeletonBlock from "@/components/SkeletonBlock";
import {
  MAX_COMPARE,
  averageAnchoredFill,
  bestBy,
  compareCollapsedTickerLabel,
  compareDateAlignedSeries,
  compareItemSubtitle,
  compareItemTitle,
  comparePriceTone,
  componentScore,
  displayTickerRef,
  normalizeTicker,
  opportunityComponentScore,
  parseTickers,
  percentText,
  removeCompareTicker,
  ratioText,
  scoreWord,
  semanticMetricRows,
  symbolRef,
  type CompareItem,
} from "@/components/stockCompareHelpers";
import { PARTIAL_SECTION_SKELETON_DEADLINE_MS, formatPrimaryPrice, stockHeaderIdentity } from "@/components/stockDashboardHelpers";
import { shouldShowCompareChartSkeleton, shouldShowCompareOverviewSkeleton, useStockCompareQueries, type CompareChartItem, type CompareLoadState } from "@/components/useStockCompareQueries";
import type { StockDisplayPayload } from "@/lib/stockDisplayTypes";
import type { SymbolSearchItem } from "@/lib/symbolTypes";

const LINE_COLORS = ["#3182f6", "#f04452", "#00a778", "#7c3aed", "#f59f00"];
const COMPARE_EMPTY_SAMPLES = [
  { label: "엔비디아", ticker: "US:NVDA" },
  { label: "애플", ticker: "US:AAPL" },
  { label: "삼성전자", ticker: "KR:005930" },
];

function compareHrefForTickers(tickers: string[], originTicker: string) {
  const params = new URLSearchParams();
  if (tickers.length) params.set("tickers", tickers.join(","));
  if (originTicker) params.set("origin", originTicker);
  const query = params.toString();
  return query ? `/compare?${query}` : "/compare";
}

function pushTickers(router: ReturnType<typeof useRouter>, tickers: string[], originTicker: string) {
  router.push(compareHrefForTickers(tickers, originTicker));
}

function subjectParticle(value: string): string {
  const last = Array.from(value.trim()).pop();
  if (!last) return "가";
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return "가";
  return (code - 0xac00) % 28 === 0 ? "가" : "이";
}

type StockCompareProps = {
  initialDisplayPayloads?: StockDisplayPayload[];
};

export default function StockCompare({ initialDisplayPayloads = [] }: StockCompareProps = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tickers = useMemo(() => parseTickers(searchParams.get("tickers") || searchParams.get("ticker")), [searchParams]);
  const firstTicker = tickers[0] || "";
  const firstTickerLabel = firstTicker ? displayTickerRef(firstTicker) : "";
  const originTicker = useMemo(() => normalizeTicker(searchParams.get("origin") || "") || firstTicker, [firstTicker, searchParams]);
  const [input, setInput] = useState("");
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
  const mobileEditActionRef = useRef<HTMLButtonElement>(null);
  const { states, items, chartItems, partialStates, errorStates, retryCompare } = useStockCompareQueries(tickers, initialDisplayPayloads);
  const selectedCount = tickers.length;
  const compareLimitReached = tickers.length >= MAX_COMPARE;
  const firstItem = useMemo(() => (firstTicker ? items.find((item) => item.ticker === firstTickerLabel) : undefined), [firstTicker, items, firstTickerLabel]);
  const hasCompareChart = useMemo(() => compareDateAlignedSeries(chartItems).series.some((entry) => entry.points.length >= 1), [chartItems]);
  const detailHref = originTicker ? `/?ticker=${encodeURIComponent(originTicker)}` : undefined;
  const [compareLoadingWindow, setCompareLoadingWindow] = useState<{ key: string; startedAtMs: number; nowMs: number } | undefined>(undefined);
  const tickersKey = tickers.join("|");
  const hasRecoveringCompareWork = selectedCount > 0 && states.some((state) => state.status === "loading" || state.status === "pending" || state.status === "partial");
  const compareLoadingExpired = Boolean(compareLoadingWindow && compareLoadingWindow.nowMs - compareLoadingWindow.startedAtMs >= PARTIAL_SECTION_SKELETON_DEADLINE_MS);
  const showCompareOverviewSkeleton = shouldShowCompareOverviewSkeleton(states, items, compareLoadingExpired);
  const showCompareChartSkeleton = shouldShowCompareChartSkeleton(states, items, hasCompareChart, compareLoadingExpired);
  const showCompareChartUnavailable =
    !showCompareChartSkeleton &&
    compareLoadingExpired &&
    items.length >= 2 &&
    !hasCompareChart &&
    states.some((state) => state.status === "partial" || state.status === "pending" || state.status === "loading");
  const selectedTickerEntries = useMemo<CompareSelectedTickerEntry[]>(() => tickers.map((ticker) => {
    const loaded = items.find((item) => item.ticker === displayTickerRef(ticker));
    const partial = partialStates.find((state) => state.ticker === ticker);
    const partialIdentity = partial ? stockHeaderIdentity(partial.data) : undefined;
    return {
      ticker,
      label: loaded ? compareItemTitle(loaded) : partialIdentity?.primary || displayTickerRef(ticker),
      removeDisabled: false,
    };
  }), [items, partialStates, tickers]);
  const compactSelectionLabel = compareCollapsedTickerLabel(selectedTickerEntries);

  useEffect(() => {
    if (!hasRecoveringCompareWork || !tickersKey) {
      setCompareLoadingWindow(undefined);
      return;
    }
    const nowMs = Date.now();
    setCompareLoadingWindow((previous) => (
      previous?.key === tickersKey
        ? { ...previous, nowMs }
        : { key: tickersKey, startedAtMs: nowMs, nowMs }
    ));
  }, [hasRecoveringCompareWork, tickersKey]);

  useEffect(() => {
    if (!compareLoadingWindow || !hasRecoveringCompareWork) return undefined;
    const remainingMs = compareLoadingWindow.startedAtMs + PARTIAL_SECTION_SKELETON_DEADLINE_MS - Date.now();
    if (remainingMs <= 0) return undefined;
    const timer = window.setTimeout(() => {
      setCompareLoadingWindow((previous) => previous ? { ...previous, nowMs: Date.now() } : previous);
    }, Math.min(remainingMs, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [compareLoadingWindow, hasRecoveringCompareWork]);

  useEffect(() => {
    if (!isMobileSearchOpen) return undefined;
    document.documentElement.classList.add("compare-search-open");
    document.body.classList.add("compare-search-open");
    return () => {
      document.documentElement.classList.remove("compare-search-open");
      document.body.classList.remove("compare-search-open");
    };
  }, [isMobileSearchOpen]);

  function addTicker(value: string) {
    const ticker = normalizeTicker(value);
    if (!ticker || tickers.includes(ticker) || compareLimitReached) return;
    const nextTickers = [...tickers, ticker];
    setInput("");
    pushTickers(router, nextTickers, originTicker);
  }

  function addSymbol(item: SymbolSearchItem) {
    addTicker(symbolRef(item));
  }

  function removeTicker(ticker: string) {
    const next = removeCompareTicker(tickers, ticker);
    if (next.length !== tickers.length) pushTickers(router, next, originTicker);
  }

  return (
    <main className="stock-app compare-app">
      <AppNavigationMenu
        context={{ page: "compare", originTicker, detailHref }}
        suppressMobileChrome={isMobileSearchOpen}
        mobileContextAction={{
          label: compactSelectionLabel === "비교 종목" ? "종목 편집" : compactSelectionLabel,
          ariaLabel: "비교 종목 편집",
          icon: "edit",
          controlRef: mobileEditActionRef,
          onClick: () => setIsMobileSearchOpen(true),
        }}
      />

      <CompareSideIndex
        value={input}
        onValueChange={setInput}
        onSelect={addSymbol}
        compareLimitReached={compareLimitReached}
        selectedCount={selectedCount}
        maxCompare={MAX_COMPARE}
        selectedTickers={selectedTickerEntries}
        onRemoveTicker={removeTicker}
      />

      <section className="compare-landing">
        <section className="compare-hero">
          <div>
            <span>종목 비교</span>
            <h1>선택한 종목을 함께 보기</h1>
            <p>
              {selectedCount === 0
                ? "비교할 종목을 검색해서 추가해주세요. 최대 5개까지 같은 기준으로 볼 수 있어요."
                : selectedCount === 1
                ? `${firstItem ? compareItemTitle(firstItem) : firstTickerLabel}${subjectParticle(firstItem ? compareItemTitle(firstItem) : firstTickerLabel)} 선택되어 있어요. 비교할 종목을 추가하면 같은 기준으로 차이를 보여드릴게요.`
                : `${selectedCount}개 종목을 점수, 가격 흐름, 재무 지표 기준으로 나란히 정리했어요.`}
            </p>
          </div>
          <div className="compare-count">{selectedCount}/{MAX_COMPARE}</div>
        </section>
      </section>

      <CompareEditSheet
        isOpen={isMobileSearchOpen}
        value={input}
        onValueChange={setInput}
        onSelect={addSymbol}
        onClose={() => setIsMobileSearchOpen(false)}
        compareLimitReached={compareLimitReached}
        selectedCount={selectedCount}
        selectedTickers={selectedTickerEntries}
        onRemoveTicker={removeTicker}
        closeLabel={compareLimitReached ? "완료" : "닫기"}
        returnFocusRef={mobileEditActionRef}
      />

      {errorStates.length ? (
        <section className="compare-errors" role="alert" aria-live="assertive">
          {errorStates.map((state) => (
            <p key={state.ticker}>
              <strong>{state.ticker}</strong> {state.error}
            </p>
          ))}
          <button type="button" onClick={retryCompare}>다시 시도</button>
        </section>
      ) : null}

      {!states.length ? <CompareEmptyState onSelect={addTicker} /> : null}

      {states.length ? (
        <div className="compare-feed">
          {showCompareOverviewSkeleton ? <ComparePendingOverviewSkeleton /> : null}
          <CompareCards states={states} items={items} showEmptyCard={tickers.length < 2} />
          {chartItems.length ? <CompareChart items={chartItems} /> : null}
          {showCompareChartSkeleton ? <CompareChartPendingSkeleton /> : null}
          {showCompareChartUnavailable ? <CompareChartUnavailable /> : null}
          {items.length >= 2 ? <CompareMatrix items={items} /> : null}
          {items.length >= 2 ? <OpportunityComponentMatrix items={items} /> : null}
          {items.length >= 2 ? <ComponentMatrix items={items} /> : null}
        </div>
      ) : null}
    </main>
  );
}

function CompareEmptyState({ onSelect }: { onSelect: (ticker: string) => void }) {
  return (
    <section className="compare-empty-state">
      <span>빠른 비교</span>
      <h2>관심 종목을 골라보세요</h2>
      <div>
        {COMPARE_EMPTY_SAMPLES.map((sample) => (
          <button key={sample.ticker} type="button" onClick={() => onSelect(sample.ticker)}>
            {sample.label}
          </button>
        ))}
      </div>
    </section>
  );
}

function CompareCards({ states, items, showEmptyCard }: { states: CompareLoadState[]; items: CompareItem[]; showEmptyCard: boolean }) {
  const itemByTicker = new Map(items.map((item) => [item.ticker, item]));
  return (
    <CompareSection eyebrow="종목 카드" title="각 종목의 현재 인상이에요">
      <div className="compare-card-grid">
        {states.map((state) => {
          const item = itemByTicker.get(displayTickerRef(state.ticker));
          if (item) return <CompareReadyCard item={item} key={state.ticker} />;
          if (state.status === "partial") return <ComparePartialCard state={state} key={state.ticker} />;
          if (state.status === "loading" || state.status === "pending") return <CompareSkeletonCard ticker={state.ticker} key={state.ticker} />;
          return null;
        })}
        {showEmptyCard && items.length < 2 ? <EmptyCompareCard /> : null}
      </div>
    </CompareSection>
  );
}

function CompareReadyCard({ item }: { item: CompareItem }) {
  return (
    <article className="compare-stock-card">
      <div className="compare-card-top">
        <div>
          <span>비교 종목</span>
          <strong className={item.identity.primaryKind === "name" ? "name-primary" : "ticker-primary"}>{compareItemTitle(item)}</strong>
          {compareItemSubtitle(item) ? <small>{compareItemSubtitle(item)}</small> : null}
        </div>
        <em className={comparePriceTone(item.daily)}>{percentText(item.daily)}</em>
      </div>
      <div className="compare-score-grid" aria-label={`${compareItemTitle(item)} 점수`}>
        <CompareScoreTile
          label="품질"
          value={`${item.score.toFixed(1)}점`}
          caption={item.provisional ? item.provisionalLabel || "현재 점수" : `품질 ${scoreWord(item.score)}`}
          score={item.score}
        />
        <CompareScoreTile
          label="기회"
          value={item.opportunityScore === undefined ? "-" : `${item.opportunityScore.toFixed(1)}점`}
          caption={item.opportunityScore === undefined ? "확인 중" : `기회 ${scoreWord(item.opportunityScore)}`}
          score={item.opportunityScore}
          tone="opportunity"
        />
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
  );
}

function CompareScoreTile({
  label,
  value,
  caption,
  score,
  tone = "quality",
}: {
  label: string;
  value: string;
  caption: string;
  score?: number;
  tone?: "quality" | "opportunity";
}) {
  const width = typeof score === "number" && Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0;
  return (
    <div className={`compare-score-tile ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{caption}</small>
      <i className={score === undefined ? "pending" : undefined} aria-hidden="true">
        <em style={{ width: `${width}%` }} />
      </i>
    </div>
  );
}

function ComparePartialCard({ state }: { state: Extract<CompareLoadState, { status: "partial" }> }) {
  const identity = stockHeaderIdentity(state.data);
  const price = formatPrimaryPrice(state.data);
  return (
    <article className="compare-stock-card compare-pending-card">
      <div className="compare-card-top">
        <div>
          <span>비교 종목</span>
          <strong className={identity.primaryKind === "name" ? "name-primary" : "ticker-primary"}>{identity.primary}</strong>
          {identity.secondary ? <small>{identity.secondary}</small> : null}
        </div>
        <em className="price-neutral">{price || "종목 확인"}</em>
      </div>
      <div className="compare-score-grid compare-score-grid-single">
        <CompareScoreTile label="현재가" value={price || "-"} caption="확인된 가격" />
      </div>
    </article>
  );
}

function CompareSkeletonCard({ ticker }: { ticker: string }) {
  return (
    <article className="compare-stock-card compare-waiting-card" aria-label={`${displayTickerRef(ticker)} 비교 카드 구성 중`}>
      <div className="compare-card-top">
        <div>
          <span>비교 종목</span>
          <strong>{displayTickerRef(ticker)}</strong>
        </div>
        <em className="price-neutral">확인 중</em>
      </div>
      <div className="compare-score-grid compare-score-grid-single">
        <div className="compare-score-tile skeleton">
          <span className="skeleton-block small" />
          <strong><span className="skeleton-block score" /></strong>
          <small className="skeleton-block small" />
          <i className="pending" aria-hidden="true" />
        </div>
      </div>
    </article>
  );
}

function EmptyCompareCard() {
  return (
    <article className="compare-stock-card compare-empty-card" aria-label="비교할 종목 선택 안내">
      <div>
        <span>비교 종목</span>
        <strong>종목을 선택해주세요</strong>
        <p>아래 검색창에서 국내·미국 종목을 추가하면 같은 기준으로 나란히 볼 수 있어요.</p>
      </div>
    </article>
  );
}

function CompareChartPendingSkeleton() {
  return (
    <section className="compare-section compare-pending">
      <SkeletonSectionTitle />
      <SkeletonBlock className="chart-area" />
    </section>
  );
}

function CompareChartUnavailable() {
  return (
    <CompareSection
      eyebrow="가격 흐름"
      title="비교할 가격 기록이 아직 부족해요"
      description="현재가처럼 확인된 정보는 먼저 보여드리고, 같은 날짜의 가격 기록이 더 확인되면 차트로 비교해드릴게요."
      className="compare-chart-section"
      role="status"
    />
  );
}

function CompareChart({ items }: { items: CompareChartItem[] }) {
  const aligned = compareDateAlignedSeries(items);
  const series = aligned.series
    .map((entry, index) => ({
      ...entry,
      color: LINE_COLORS[index % LINE_COLORS.length],
    }))
    .filter((entry) => entry.points.length >= 1);

  if (!series.length) {
    return (
      <CompareSection eyebrow="가격 흐름" title="비교할 가격 차트가 아직 없어요">
        <p className="compare-empty-note" role="status">선택한 종목의 가격 기록이 충분히 모이면 1년 기준 흐름을 보여드릴게요.</p>
      </CompareSection>
    );
  }

  const width = 860;
  const height = 310;
  const padX = 24;
  const padTop = 24;
  const padBottom = 48;
  const values = series.flatMap((entry) => entry.points.map((point) => point.value));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const x = (dateIndex: number) => padX + (width - padX * 2) * (dateIndex / Math.max(1, aligned.dates.length - 1));
  const y = (value: number) => height - padBottom - (height - padTop - padBottom) * ((value - min) / span);
  const chartSummary = series
    .map((entry) => {
      const latest = entry.points[entry.points.length - 1]?.value;
      return `${compareItemTitle(entry.item)} ${Number.isFinite(latest) ? `${(latest - 100).toFixed(1)}%` : "-"}`;
    })
    .join(", ");
  const summaryId = "compare-chart-summary";

  return (
    <CompareSection
      eyebrow="가격 흐름"
      title={series.some((entry) => entry.points.length >= 2) ? "1년 전을 100으로 맞춰봤어요" : "확인된 가격을 100으로 맞춰봤어요"}
    >
      <p id={summaryId} className="sr-only">비교 가격 흐름 요약: {chartSummary}</p>
      <div className="compare-chart">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="비교 가격 흐름" aria-describedby={summaryId}>
          <line x1={padX} y1={y(100)} x2={width - padX} y2={y(100)} className="compare-base-line" />
          {series.map((entry) => (
            <g key={entry.item.ticker}>
              {entry.points.length >= 2 ? (
                <polyline
                  points={entry.points.map((point) => `${x(point.dateIndex)},${y(point.value)}`).join(" ")}
                  fill="none"
                  stroke={entry.color}
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : null}
              {entry.points.map((point) => (
                <circle key={`${entry.item.ticker}-${point.date}`} cx={x(point.dateIndex)} cy={y(point.value)} r="5" fill={entry.color} />
              ))}
            </g>
          ))}
        </svg>
      </div>
      <div className="compare-legend">
        {series.map((entry) => {
          const latest = entry.points[entry.points.length - 1]?.value;
          return (
            <span key={entry.item.ticker}>
              <i style={{ background: entry.color }} />
              {compareItemTitle(entry.item)}
              <b>{Number.isFinite(latest) ? `${(latest - 100).toFixed(1)}%` : "-"}</b>
            </span>
          );
        })}
      </div>
    </CompareSection>
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

type PreparedMetricRow = {
  row: MetricRow;
  best?: CompareItem;
  values: Map<string, number | undefined>;
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
  { group: "risk", label: "베타", description: "낮을수록 시장 대비 가격 흔들림이 작아요", value: (item) => item.beta, display: ratioText, best: "low" },
  { group: "valuation", label: "PER", description: "낮을수록 현재 이익 대비 부담이 덜해요", value: (item) => item.per, display: ratioText, best: "low" },
  { group: "valuation", label: "Forward PER", description: "낮을수록 예상 이익 대비 부담이 덜해요", value: (item) => item.forwardPer, display: ratioText, best: "low" },
  { group: "valuation", label: "PBR", description: "낮을수록 장부가치 대비 가격 부담이 덜해요", value: (item) => item.priceToBook, display: ratioText, best: "low" },
  { group: "valuation", label: "EV/Revenue", description: "낮을수록 매출 대비 기업가치 부담이 덜해요", value: (item) => item.evToRevenue, display: ratioText, best: "low" },
  { group: "valuation", label: "P/S", description: "낮을수록 매출 대비 시가총액 부담이 덜해요", value: (item) => item.priceToSales, display: ratioText, best: "low" },
];

function prepareMetricRow(items: CompareItem[], row: MetricRow): PreparedMetricRow {
  const values = new Map<string, number | undefined>();
  let best: CompareItem | undefined;
  let bestValue: number | undefined;

  for (const item of items) {
    const current = row.value(item);
    values.set(item.ticker, current);
    if (typeof current !== "number" || !Number.isFinite(current)) continue;
    if (row.best && (bestValue === undefined || (row.best === "low" ? current < bestValue : current > bestValue))) {
      best = item;
      bestValue = current;
    }
  }

  return { row, best, values };
}

function metricFill(value: number | undefined, values: Map<string, number | undefined>): number {
  return averageAnchoredFill(value, Array.from(values.values()));
}

function CompareMatrix({ items }: { items: CompareItem[] }) {
  const rows = useMemo(() => semanticMetricRows(items, METRIC_ROWS), [items]);
  const groupedRows = useMemo(
    () => METRIC_GROUPS.map((group) => ({
      group,
      rows: METRIC_ROWS.filter((row) => row.group === group.key).map((row) => prepareMetricRow(items, row)),
    })),
    [items]
  );
  return (
    <CompareSection eyebrow="차이가 나는 숫자" title="판단 기준별로 나눠서 볼게요">
      <div className="sr-only">
        <table>
          <caption>종목별 주요 비교 지표</caption>
          <thead>
            <tr>
              <th scope="col">지표</th>
              {items.map((item) => (
                <th key={item.ticker} scope="col">{compareItemTitle(item)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                {row.values.map((value) => (
                  <td key={`${row.label}-${value.ticker}`}>{value.value}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="compare-group-list">
        {groupedRows.map(({ group, rows }) => {
          return (
            <section key={group.key} className="compare-metric-group">
              <div className="compare-group-heading">
                <strong>{group.title}</strong>
                <span>{group.description}</span>
              </div>
              <div className="compare-metric-table" style={{ "--compare-cols": items.length } as CSSProperties}>
                <div className="compare-metric-column-head">
                  <span>지표</span>
                  {items.map((item) => (
                    <strong key={item.ticker}>{compareItemTitle(item)}</strong>
                  ))}
                </div>
                {rows.map((prepared) => {
                  const { row, best, values } = prepared;
                  return (
                    <article key={row.label} className="compare-metric-row">
                      <header>
                        <div className="compare-metric-label">
                          <strong>{row.label}</strong>
                          <details className="compare-metric-help">
                            <summary aria-label={`${row.label} 설명 보기`}>?</summary>
                            <span>{row.description}</span>
                          </details>
                        </div>
                      </header>
                      {items.map((item) => {
                        const value = values.get(item.ticker);
                        const isBest = best?.ticker === item.ticker;
                        return (
                          <div
                            key={`${row.label}-${item.ticker}`}
                            className={`compare-metric-cell ${isBest ? "best" : ""} ${typeof value === "number" && value < 0 ? "negative" : ""}`}
                          >
                            <strong>{row.display(value)}</strong>
                            <i aria-hidden="true">
                              <em style={{ width: `${metricFill(value, values)}%` }} />
                            </i>
                            {isBest ? <small>{row.best === "low" ? "부담 낮음" : "가장 높음"}</small> : null}
                          </div>
                        );
                      })}
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </CompareSection>
  );
}

const COMPONENT_ROWS = [
  { key: "profitability", label: "수익성", description: "매출을 이익으로 바꾸는 힘을 비교합니다." },
  { key: "growth", label: "성장성", description: "매출과 이익이 커지는 속도를 봅니다." },
  { key: "health", label: "재무 안정성", description: "빚 부담과 단기 체력을 함께 봅니다." },
  { key: "momentum", label: "가격 흐름", description: "최근 가격 움직임과 추세의 힘을 봅니다." },
  { key: "valuation", label: "가격 부담", description: "실적과 자산 대비 현재 가격 부담을 봅니다." },
];

const OPPORTUNITY_COMPONENT_ROWS = [
  { key: "opportunity_momentum", label: "기회 모멘텀", description: "최근 가격 흐름이 기회로 이어지는지 봅니다." },
  { key: "opportunity_growth", label: "성장 기대", description: "성장 지표와 중기 흐름을 함께 봅니다." },
  { key: "opportunity_analyst", label: "목표가 여지", description: "목표가와 투자의견 근거를 봅니다." },
  { key: "opportunity_liquidity", label: "유동성", description: "거래량 체력과 관심 증가를 봅니다." },
  { key: "opportunity_risk", label: "위험 제어", description: "변동성, 과열, 베타 부담을 봅니다." },
];

type ComponentMatrixRow = {
  key: string;
  label: string;
  description: string;
};

function ComponentMatrix({
  items,
  matrixRows = COMPONENT_ROWS,
  eyebrow = "항목별 점수",
  title = "무엇이 강하고 약한지 보여요",
  scoreFor = componentScore,
}: {
  items: CompareItem[];
  matrixRows?: ComponentMatrixRow[];
  eyebrow?: string;
  title?: string;
  scoreFor?: (item: CompareItem, key: string) => number | undefined;
}) {
  const componentMetricRows = useMemo(
    () => matrixRows.map((row) => ({
      label: row.label,
      value: (item: CompareItem) => scoreFor(item, row.key),
      display: (value: number | undefined) => (value === undefined ? "-" : value.toFixed(1)),
    })),
    [matrixRows, scoreFor]
  );
  const rows = useMemo(() => semanticMetricRows(items, componentMetricRows), [items, componentMetricRows]);
  const visualRows = useMemo(
    () => matrixRows.map((row) => ({
      ...row,
      best: bestBy(items, (item) => scoreFor(item, row.key)),
      values: new Map(items.map((item) => [item.ticker, scoreFor(item, row.key)])),
    })),
    [items, matrixRows, scoreFor]
  );
  return (
    <CompareSection eyebrow={eyebrow} title={title}>
      <div className="sr-only">
        <table>
          <caption>종목별 항목 점수</caption>
          <thead>
            <tr>
              <th scope="col">항목</th>
              {items.map((item) => (
                <th key={item.ticker} scope="col">{compareItemTitle(item)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                {row.values.map((value) => (
                  <td key={`${row.label}-${value.ticker}`}>{value.value}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="component-compare-list">
        {visualRows.map((row) => (
          <article key={row.key}>
            <header>
              <strong>{row.label}</strong>
              <span>{row.description}</span>
            </header>
            <div>
              {items.map((item) => {
                const score = row.values.get(item.ticker);
                const isBest = row.best?.ticker === item.ticker;
                return (
                  <span key={`${row.key}-${item.ticker}`} className={isBest ? "best" : ""}>
                    <b>{compareItemTitle(item)}</b>
                    <i>
                      <em style={{ width: `${score ?? 0}%` }} />
                    </i>
                    <strong>{score === undefined ? "-" : score.toFixed(1)}</strong>
                    {isBest ? <small>최고</small> : null}
                  </span>
                );
              })}
            </div>
          </article>
        ))}
      </div>
    </CompareSection>
  );
}

function OpportunityComponentMatrix({ items }: { items: CompareItem[] }) {
  return (
    <ComponentMatrix
      items={items}
      matrixRows={OPPORTUNITY_COMPONENT_ROWS}
      eyebrow="기회 점수 이유"
      title="지금 볼 만한 이유를 나눠봤어요"
      scoreFor={opportunityComponentScore}
    />
  );
}
