"use client";

import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import SymbolAutocomplete from "@/components/SymbolAutocomplete";
import {
  MAX_COMPARE,
  bestBy,
  compareItemSubtitle,
  compareItemSummary,
  compareItemTitle,
  comparePriceTone,
  componentScore,
  displayTickerRef,
  normalizeTicker,
  normalizedPoints,
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
import type { SymbolSearchItem } from "@/lib/symbolTypes";

const LINE_COLORS = ["#3182f6", "#f04452", "#00a778", "#7c3aed", "#f59f00"];

function pushTickers(router: ReturnType<typeof useRouter>, tickers: string[]) {
  router.push(tickers.length ? `/compare?tickers=${encodeURIComponent(tickers.join(","))}` : "/compare");
}

function subjectParticle(value: string): string {
  const last = Array.from(value.trim()).pop();
  if (!last) return "가";
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return "가";
  return (code - 0xac00) % 28 === 0 ? "가" : "이";
}

export default function StockCompare() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tickers = useMemo(() => parseTickers(searchParams.get("tickers") || searchParams.get("ticker")), [searchParams]);
  const baseTicker = tickers[0];
  const baseTickerLabel = baseTicker ? displayTickerRef(baseTicker) : "";
  const [input, setInput] = useState("");
  const { items, partialStates, waitingStates, pendingStates, errorStates, retryCompare } = useStockCompareQueries(tickers);
  const selectedCount = tickers.length;
  const baseItem = useMemo(() => (baseTicker ? items.find((item) => item.ticker === baseTickerLabel) : undefined), [baseTicker, items, baseTickerLabel]);
  const detailHref = baseTicker ? `/?ticker=${encodeURIComponent(baseTicker)}` : "/";

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
    const next = removeCompareTicker(tickers, ticker);
    if (next.length !== tickers.length) pushTickers(router, next);
  }

  return (
    <main className="stock-app compare-app">
      <nav className="compare-side-index" aria-label="비교 화면 이동">
        <a href={detailHref}>{baseTicker ? "상세 분석으로 돌아가기" : "검색으로 돌아가기"}</a>
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
                ? `${baseItem ? compareItemTitle(baseItem) : baseTickerLabel}${subjectParticle(baseItem ? compareItemTitle(baseItem) : baseTickerLabel)} 선택되어 있어요. 비교할 종목을 추가하면 같은 기준으로 차이를 보여드릴게요.`
                : `${selectedCount}개 종목을 점수, 가격 흐름, 재무 지표 기준으로 나란히 정리했어요.`}
            </p>
          </div>
          <div className="compare-count">{selectedCount}/{MAX_COMPARE}</div>
        </section>

        <section className="compare-picks" aria-label="선택된 종목">
          {tickers.length ? tickers.map((ticker, index) => {
            const loaded = items.find((item) => item.ticker === displayTickerRef(ticker));
            const partial = partialStates.find((state) => state.ticker === ticker);
            const partialIdentity = partial ? stockHeaderIdentity(partial.data) : undefined;
            const label = loaded ? compareItemTitle(loaded) : partialIdentity?.primary || displayTickerRef(ticker);
            return (
              <span key={ticker} className={index === 0 ? "base" : ""}>
                {label}
                {index === 0 ? <b>선택됨</b> : <button type="button" onClick={() => removeTicker(ticker)} aria-label={`${label} 삭제`}>×</button>}
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
          placeholder="비교할 종목 검색"
          buttonLabel="추가"
          label="비교할 국내·미국 주식 검색"
          disabled={tickers.length >= MAX_COMPARE}
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

      {pendingStates.length ? (
        <section className="compare-errors compare-pending" role="status" aria-live="polite">
          {pendingStates.map((state) => (
            <p key={state.ticker}>
              <strong>{state.ticker}</strong> {state.message}
            </p>
          ))}
          <button type="button" onClick={retryCompare}>다시 확인</button>
        </section>
      ) : null}

      {items.length || partialStates.length || waitingStates.length ? (
        <div className="compare-feed">
          {items.length ? <CompareBrief items={items} /> : <ComparePendingOverview count={partialStates.length + waitingStates.length} />}
          {items.length ? <CompareCards items={items} baseTicker={baseTickerLabel} showEmptyCard={tickers.length < 2} /> : null}
          {partialStates.length ? <ComparePendingCards states={partialStates} /> : null}
          {waitingStates.length ? <CompareWaitingCards states={waitingStates} /> : null}
          {items.length >= 2 ? <CompareChart items={items} /> : null}
          {items.length >= 2 ? <CompareMatrix items={items} /> : null}
          {items.length >= 2 ? <ComponentMatrix items={items} /> : null}
        </div>
      ) : null}
    </main>
  );
}

function ComparePendingOverview({ count }: { count: number }) {
  return (
    <section className="compare-section compare-brief">
      <div className="section-title">
        <span>비교 준비 중</span>
        <h2>준비된 종목부터 채우고 있어요</h2>
      </div>
      <p>{count}개 종목을 먼저 표시했고, 비교 점수와 가격 데이터는 이어서 준비하고 있어요.</p>
    </section>
  );
}

function ComparePendingCards({ states }: { states: Array<Extract<CompareLoadState, { status: "partial" }>> }) {
  return (
    <section className="compare-section">
      <div className="section-title">
        <span>준비 중</span>
        <h2>점수 계산 대기 종목</h2>
      </div>
      <div className="compare-card-grid" style={{ "--compare-count": states.length } as CSSProperties}>
        {states.map((state) => {
          const identity = stockHeaderIdentity(state.data);
          return (
            <article className="compare-stock-card compare-pending-card" key={state.ticker}>
              <div className="compare-card-top">
                <div>
                  <strong className={identity.primaryKind === "name" ? "name-primary" : "ticker-primary"}>{identity.primary}</strong>
                  {identity.secondary ? <small>{identity.secondary}</small> : null}
                </div>
                <em className="price-neutral">준비 중</em>
              </div>
              <p>{state.message}</p>
              <div className="compare-score-line">
                <span>현재가</span>
                <strong>{formatPrimaryPrice(state.data)}</strong>
              </div>
              <i className="compare-card-scorebar pending" aria-hidden="true" />
            </article>
          );
        })}
      </div>
    </section>
  );
}

function CompareWaitingCards({ states }: { states: Array<Extract<CompareLoadState, { status: "loading" | "pending" }>> }) {
  return (
    <section className="compare-section">
      <div className="section-title">
        <span>대기 중</span>
        <h2>선택한 종목을 확인하고 있어요</h2>
      </div>
      <div className="compare-card-grid" style={{ "--compare-count": states.length } as CSSProperties}>
        {states.map((state) => (
          <article className="compare-stock-card compare-waiting-card" key={state.ticker}>
            <div className="compare-card-top">
              <div>
                <span>선택한 종목</span>
                <strong className="ticker-primary">{displayTickerRef(state.ticker)}</strong>
                <small>{state.ticker}</small>
              </div>
              <em className="price-neutral">대기 중</em>
            </div>
            <p>{state.status === "pending" ? state.message : "가격과 점수 데이터를 확인하고 있어요. 준비된 항목부터 화면에 채워집니다."}</p>
            <div className="compare-score-line">
              <span>점수</span>
              <strong>준비 중</strong>
            </div>
            <i className="compare-card-scorebar pending" aria-hidden="true" />
          </article>
        ))}
      </div>
    </section>
  );
}

function CompareBrief({ items }: { items: CompareItem[] }) {
  const insights = useMemo(() => ({
    bestScore: bestBy(items, (item) => item.score),
    bestOpportunity: bestBy(items, (item) => item.opportunityScore),
    bestMomentum: bestBy(items, (item) => item.return52w ?? item.return6m ?? item.return3m),
    bestValue: bestBy(items, (item) => componentScore(item, "valuation")),
    bestProfit: bestBy(items, (item) => componentScore(item, "profitability")),
    weakestHealth: bestBy(items, (item) => componentScore(item, "health"), "low"),
  }), [items]);
  const { bestScore, bestOpportunity, bestMomentum, bestValue, bestProfit, weakestHealth } = insights;
  const base = items[0];

  return (
    <section className="compare-section compare-brief">
      <span>먼저 볼 차이</span>
      <h2>{items.length === 1 ? "비교할 종목을 기다리고 있어요" : "종목별 차이가 나는 부분이에요"}</h2>
      <p>
        {items.length === 1
          ? `${compareItemTitle(base)}의 점수는 ${base.score.toFixed(1)}점이에요. 비교 종목을 붙이면 가격 흐름, 수익성, 재무 안정성이 같은 기준으로 정리돼요.`
          : `${bestScore ? compareItemTitle(bestScore) : compareItemTitle(base)}가 전체 점수에서 앞서고, ${bestMomentum ? compareItemTitle(bestMomentum) : compareItemTitle(base)}는 최근 흐름이 가장 강해요. 가격 부담은 ${bestValue ? compareItemTitle(bestValue) : compareItemTitle(base)}, 수익성은 ${bestProfit ? compareItemTitle(bestProfit) : compareItemTitle(base)}를 먼저 보면 좋아요.`}
      </p>
      {items.length >= 2 ? (
        <div className="compare-insight-grid">
          <Insight label="전체 균형" ticker={bestScore ? compareItemTitle(bestScore) : undefined} value={bestScore ? `${bestScore.score.toFixed(1)}점` : "-"} />
          <Insight label="기회 점수" ticker={bestOpportunity ? compareItemTitle(bestOpportunity) : undefined} value={bestOpportunity?.opportunityScore === undefined ? "-" : `${bestOpportunity.opportunityScore.toFixed(1)}점`} />
          <Insight label="최근 흐름" ticker={bestMomentum ? compareItemTitle(bestMomentum) : undefined} value={percentText(bestMomentum?.return52w ?? bestMomentum?.return6m)} />
          <Insight label="가격 부담" ticker={bestValue ? compareItemTitle(bestValue) : undefined} value={bestValue ? `${ratioText(componentScore(bestValue, "valuation"))}점` : "-"} />
          <Insight label="수익성" ticker={bestProfit ? compareItemTitle(bestProfit) : undefined} value={bestProfit ? `${ratioText(componentScore(bestProfit, "profitability"))}점` : "-"} />
          <Insight label="먼저 확인" ticker={weakestHealth ? compareItemTitle(weakestHealth) : undefined} value={weakestHealth ? `${ratioText(componentScore(weakestHealth, "health"))}점` : "-"} />
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

function CompareCards({ items, baseTicker, showEmptyCard }: { items: CompareItem[]; baseTicker: string; showEmptyCard: boolean }) {
  const slotCount = showEmptyCard ? Math.max(2, items.length) : Math.max(1, items.length);
  return (
    <section className="compare-section">
      <span>종목 카드</span>
      <h2>각 종목의 현재 인상이에요</h2>
      <div className="compare-card-grid" style={{ "--compare-count": slotCount } as CSSProperties}>
        {items.map((item) => (
          <article className="compare-stock-card" key={item.ticker}>
            <div className="compare-card-top">
              <div>
                <span>{item.ticker === baseTicker ? "선택한 종목" : "비교 종목"}</span>
                <strong className={item.identity.primaryKind === "name" ? "name-primary" : "ticker-primary"}>{compareItemTitle(item)}</strong>
                {compareItemSubtitle(item) ? <small>{compareItemSubtitle(item)}</small> : null}
              </div>
              <em className={comparePriceTone(item.daily)}>{percentText(item.daily)}</em>
            </div>
            <p>{compareItemSummary(item)}</p>
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
        {showEmptyCard && items.length < 2 ? <EmptyCompareCard /> : null}
      </div>
    </section>
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
  const series = items
    .map((item, index) => ({
      item,
      color: LINE_COLORS[index % LINE_COLORS.length],
      points: normalizedPoints(item),
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
  const maxLength = Math.max(...series.map((entry) => entry.points.length));
  const x = (index: number) => padX + (width - padX * 2) * (index / Math.max(1, maxLength - 1));
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
              <div className="compare-metric-list">
                {rows.map((prepared) => {
                  const { row, best, min, max, values } = prepared;
                  return (
                    <article key={row.label} className="compare-metric-row">
                      <header>
                        <strong>{row.label}</strong>
                        <span>{row.description}</span>
                      </header>
                      <div className="compare-metric-values">
                        {items.map((item) => {
                          const value = values.get(item.ticker);
                          const isBest = best?.ticker === item.ticker;
                          return (
                            <div
                              key={`${row.label}-${item.ticker}`}
                              className={`${isBest ? "best" : ""} ${typeof value === "number" && value < 0 ? "negative" : ""}`}
                            >
                              <span>{compareItemTitle(item)}</span>
                              <strong>{row.display(value)}</strong>
                              <i aria-hidden="true">
                                <em style={{ width: `${metricFill(value, row, min, max)}%` }} />
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
              <span>높을수록 유리해요</span>
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
