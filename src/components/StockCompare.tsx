"use client";

import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import SymbolAutocomplete from "@/components/SymbolAutocomplete";
import { ComparePendingOverviewSkeleton } from "@/components/StockLoadingSkeletons";
import {
  MAX_COMPARE,
  bestBy,
  compareDateAlignedSeries,
  compareItemSubtitle,
  compareItemTitle,
  comparePriceTone,
  componentScore,
  displayTickerRef,
  normalizeTicker,
  parseTickers,
  percentText,
  removeCompareTicker,
  ratioText,
  scoreWord,
  semanticMetricRows,
  symbolRef,
  type CompareItem,
} from "@/components/stockCompareHelpers";
import { formatPrimaryPrice, stockHeaderIdentity } from "@/components/stockDashboardHelpers";
import { useStockCompareQueries, type CompareLoadState } from "@/components/useStockCompareQueries";
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
  const { states, items, partialStates, errorStates, retryCompare } = useStockCompareQueries(tickers, initialDisplayPayloads);
  const selectedCount = tickers.length;
  const compareLimitReached = tickers.length >= MAX_COMPARE;
  const firstItem = useMemo(() => (firstTicker ? items.find((item) => item.ticker === firstTickerLabel) : undefined), [firstTicker, items, firstTickerLabel]);
  const hasCompareChart = useMemo(() => compareDateAlignedSeries(items).series.some((entry) => entry.points.length >= 2), [items]);
  const detailHref = originTicker ? `/?ticker=${encodeURIComponent(originTicker)}` : "/";

  function addTicker(value: string) {
    const ticker = normalizeTicker(value);
    if (!ticker || tickers.includes(ticker) || compareLimitReached) return;
    setInput("");
    pushTickers(router, [...tickers, ticker], originTicker);
  }

  function addSymbol(item: SymbolSearchItem) {
    addTicker(symbolRef(item));
  }

  function removeTicker(ticker: string) {
    if (tickers.length <= 1) return;
    const next = removeCompareTicker(tickers, ticker);
    if (next.length !== tickers.length) pushTickers(router, next, originTicker);
  }

  return (
    <main className="stock-app compare-app">
      <nav className="compare-side-index" aria-label="비교 화면 이동">
        <a href="/">홈으로 돌아가기</a>
        <a href={detailHref}>{originTicker ? "상세 분석으로 돌아가기" : "검색으로 돌아가기"}</a>
      </nav>

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

        <section className="compare-picks" aria-label="선택된 종목">
          {tickers.length ? tickers.map((ticker) => {
            const loaded = items.find((item) => item.ticker === displayTickerRef(ticker));
            const partial = partialStates.find((state) => state.ticker === ticker);
            const partialIdentity = partial ? stockHeaderIdentity(partial.data) : undefined;
            const label = loaded ? compareItemTitle(loaded) : partialIdentity?.primary || displayTickerRef(ticker);
            const removeDisabled = tickers.length <= 1;
            return (
              <span key={ticker}>
                {label}
                <button
                  type="button"
                  onClick={() => removeTicker(ticker)}
                  aria-label={`${label} 삭제`}
                  disabled={removeDisabled}
                >
                  ×
                </button>
              </span>
            );
          }) : <span>비교할 종목을 추가해주세요</span>}
        </section>
      </section>

      <section className="compare-toolbar">
        <SymbolAutocomplete
          id="compare-ticker"
          value={input}
          onValueChange={setInput}
          onSelect={addSymbol}
          placeholder={compareLimitReached ? "최대 5개입니다" : "비교할 종목 검색"}
          buttonLabel={compareLimitReached ? "완료" : "추가"}
          label="비교할 국내·미국 주식 검색"
          disabled={compareLimitReached}
          className="compare-add-form"
        />
      </section>

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
          {!items.length ? <ComparePendingOverviewSkeleton /> : null}
          <CompareCards states={states} items={items} showEmptyCard={tickers.length < 2} />
          {items.length >= 2 && hasCompareChart ? <CompareChart items={items} /> : null}
          {items.length >= 2 ? <CompareMatrix items={items} /> : null}
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
    <section className="compare-section">
      <span>종목 카드</span>
      <h2>각 종목의 현재 인상이에요</h2>
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
    </section>
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
      <div className="compare-score-line">
        <strong>{item.score.toFixed(1)}점</strong>
        <span>{item.provisional ? item.provisionalLabel || "현재 점수" : `품질 ${scoreWord(item.score)}`}</span>
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
  );
}

function ComparePartialCard({ state }: { state: Extract<CompareLoadState, { status: "partial" }> }) {
  const identity = stockHeaderIdentity(state.data);
  return (
    <article className="compare-stock-card compare-pending-card">
      <div className="compare-card-top">
        <div>
          <span>비교 종목</span>
          <strong className={identity.primaryKind === "name" ? "name-primary" : "ticker-primary"}>{identity.primary}</strong>
          {identity.secondary ? <small>{identity.secondary}</small> : null}
        </div>
        <em className="price-neutral">{formatPrimaryPrice(state.data) || "종목 확인"}</em>
      </div>
      <div className="compare-score-line">
        <span>현재가</span>
        <strong>{formatPrimaryPrice(state.data)}</strong>
      </div>
      <i className="compare-card-scorebar pending" aria-hidden="true" />
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
      <div className="compare-score-line">
        <span className="skeleton-block small" />
        <span className="skeleton-block score" />
      </div>
      <i className="compare-card-scorebar pending" aria-hidden="true" />
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

function CompareChart({ items }: { items: CompareItem[] }) {
  const aligned = compareDateAlignedSeries(items);
  const series = aligned.series
    .map((entry, index) => ({
      ...entry,
      color: LINE_COLORS[index % LINE_COLORS.length],
    }))
    .filter((entry) => entry.points.length >= 2);

  if (!series.length) {
    return (
      <section className="compare-section">
        <span>가격 흐름</span>
        <h2>비교할 가격 차트가 아직 없어요</h2>
        <p className="compare-empty-note" role="status">선택한 종목의 가격 기록이 충분히 모이면 1년 기준 흐름을 보여드릴게요.</p>
      </section>
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
    <section className="compare-section">
      <span>가격 흐름</span>
      <h2>1년 전을 100으로 맞춰봤어요</h2>
      <p id={summaryId} className="sr-only">비교 가격 흐름 요약: {chartSummary}</p>
      <div className="compare-chart">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="비교 가격 흐름" aria-describedby={summaryId}>
          <line x1={padX} y1={y(100)} x2={width - padX} y2={y(100)} className="compare-base-line" />
          {series.map((entry) => (
            <polyline
              key={entry.item.ticker}
              points={entry.points.map((point) => `${x(point.dateIndex)},${y(point.value)}`).join(" ")}
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
              {compareItemTitle(entry.item)}
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

type PreparedMetricRow = {
  row: MetricRow;
  best?: CompareItem;
  min?: number;
  max?: number;
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
  { group: "valuation", label: "PER", description: "낮을수록 현재 이익 대비 부담이 덜해요", value: (item) => item.per, display: ratioText, best: "low" },
  { group: "valuation", label: "Forward PER", description: "낮을수록 예상 이익 대비 부담이 덜해요", value: (item) => item.forwardPer, display: ratioText, best: "low" },
];

function prepareMetricRow(items: CompareItem[], row: MetricRow): PreparedMetricRow {
  const values = new Map<string, number | undefined>();
  let best: CompareItem | undefined;
  let bestValue: number | undefined;
  let min: number | undefined;
  let max: number | undefined;

  for (const item of items) {
    const current = row.value(item);
    values.set(item.ticker, current);
    if (typeof current !== "number" || !Number.isFinite(current)) continue;
    if (min === undefined || current < min) min = current;
    if (max === undefined || current > max) max = current;
    if (row.best && (bestValue === undefined || (row.best === "low" ? current < bestValue : current > bestValue))) {
      best = item;
      bestValue = current;
    }
  }

  return { row, best, min, max, values };
}

function metricFill(value: number | undefined, row: MetricRow, min: number | undefined, max: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || min === undefined || max === undefined) return 0;
  if (max === min) return 100;
  const fill = row.best === "low" ? ((max - value) / (max - min)) * 100 : ((value - min) / (max - min)) * 100;
  return Math.max(6, Math.min(100, fill));
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
    <section className="compare-section">
      <span>차이가 나는 숫자</span>
      <h2>판단 기준별로 나눠서 볼게요</h2>
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
                  const { row, best, min, max, values } = prepared;
                  return (
                    <article key={row.label} className="compare-metric-row">
                      <header>
                        <strong>{row.label}</strong>
                        <span>{row.description}</span>
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
                              <em style={{ width: `${metricFill(value, row, min, max)}%` }} />
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
    </section>
  );
}

const COMPONENT_ROWS = [
  { key: "profitability", label: "수익성", description: "매출을 이익으로 바꾸는 힘을 비교합니다." },
  { key: "growth", label: "성장성", description: "매출과 이익이 커지는 속도를 봅니다." },
  { key: "health", label: "재무 안정성", description: "빚 부담과 단기 체력을 함께 봅니다." },
  { key: "momentum", label: "가격 흐름", description: "최근 가격 움직임과 추세의 힘을 봅니다." },
  { key: "valuation", label: "가격 부담", description: "실적과 자산 대비 현재 가격 부담을 봅니다." },
];

function ComponentMatrix({ items }: { items: CompareItem[] }) {
  const componentMetricRows = useMemo(
    () => COMPONENT_ROWS.map((row) => ({
      label: row.label,
      value: (item: CompareItem) => componentScore(item, row.key),
      display: (value: number | undefined) => (value === undefined ? "-" : value.toFixed(1)),
    })),
    []
  );
  const rows = useMemo(() => semanticMetricRows(items, componentMetricRows), [items, componentMetricRows]);
  const visualRows = useMemo(
    () => COMPONENT_ROWS.map((row) => ({
      ...row,
      best: bestBy(items, (item) => componentScore(item, row.key)),
      values: new Map(items.map((item) => [item.ticker, componentScore(item, row.key)])),
    })),
    [items]
  );
  return (
    <section className="compare-section">
      <span>항목별 점수</span>
      <h2>무엇이 강하고 약한지 보여요</h2>
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
    </section>
  );
}
