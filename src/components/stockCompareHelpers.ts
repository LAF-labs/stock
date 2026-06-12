import { clampScore, formatPercent, formatValue } from "@/lib/format";
import {
  componentHasDisplayableScore,
  isPartialStockSnapshotPayload,
  partialStockDataFromPayload,
  stockHeaderIdentity,
  stockMarketCapDisplay,
  usableChartPoints,
  type StockHeaderIdentity,
} from "@/components/stockDashboardHelpers";
import type { SymbolSearchItem } from "@/lib/symbolTypes";
import { resolveTickerAlias } from "@/lib/tickerRef";
import type { JsonValue, ScoreComponent, StockScoreResponse } from "@/lib/types";

export const MAX_COMPARE = 5;

export type BatchScoreResult = StockScoreResponse & {
  ok?: boolean;
  status?: number;
  error?: string;
  message?: string;
  retry_after_seconds?: number;
};

export type BatchScorePayload = {
  ok?: boolean;
  results?: BatchScoreResult[];
  error?: string;
  message?: string;
};

export type CompareItem = {
  ticker: string;
  identity: StockHeaderIdentity;
  data: StockScoreResponse;
  score: number;
  provisional?: boolean;
  provisionalLabel?: string;
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
  beta?: number;
  per?: number;
  forwardPer?: number;
  marketCap: string;
  strongest?: ScoreComponent;
  weakest?: ScoreComponent;
};

export type CompareAlignedPoint = {
  date: string;
  value: number;
  dateIndex: number;
};

export type CompareAlignedSeries = {
  item: CompareItem;
  ticker: string;
  points: CompareAlignedPoint[];
};

const KO_KR_RATIO_FORMATTER = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 });

export function normalizeTicker(value: string): string {
  const parsed = resolveTickerAlias(value.trim().replace(/^!\s*/, ""));
  return parsed.ok ? parsed.ticker : "";
}

export function displayTickerRef(value: string): string {
  return value.replace(/^(US|KR):/i, "");
}

export function symbolRef(item: SymbolSearchItem): string {
  return `${item.market}:${item.ticker}`;
}

export function parseTickers(raw: string | null): string[] {
  const source = raw || "";
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

export function removeCompareTicker(tickers: string[], ticker: string): string[] {
  if (tickers.length <= 1) return tickers;
  const next = tickers.filter((item) => item !== ticker);
  return next.length ? next : tickers;
}

export function numberFromRecord(record: Record<string, JsonValue> | undefined, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function componentByKey(data: StockScoreResponse, key: string): ScoreComponent | undefined {
  return data.components?.find((component) => component.key === key);
}

export function metricByLabel(data: StockScoreResponse, label: string): string {
  return formatValue(data.key_metrics?.find((item) => item.label === label)?.value);
}

export function valuationByLabel(data: StockScoreResponse, label: string): number | undefined {
  const raw = data.valuation_rows?.find((item) => item.label === label)?.value;
  if (typeof raw === "number") return raw;
  if (typeof raw !== "string") return undefined;
  const parsed = Number(raw.replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function metricNumberByLabel(data: StockScoreResponse, labels: string[]): number | undefined {
  const normalizedLabels = new Set(labels.map((label) => label.toLowerCase()));
  for (const item of data.key_metrics || []) {
    const label = item.label?.trim().toLowerCase();
    if (!label || !normalizedLabels.has(label)) continue;
    const parsed = numberFromMetricValue(item.value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function numberFromMetricValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const match = value.trim().replaceAll(",", "").match(/[-+]?\d+(?:\.\d+)?/);
  if (!match) return undefined;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function betaForCompare(data: StockScoreResponse): number | undefined {
  return (
    numberFromRecord(data.financials, "beta")
    ?? numberFromRecord(data.price_metrics, "beta")
    ?? metricNumberByLabel(data, ["베타", "Beta"])
  );
}

export function scoreWord(score: number): string {
  if (score >= 80) return "좋아요";
  if (score >= 65) return "괜찮아요";
  if (score >= 50) return "애매해요";
  return "조심해요";
}

export function percentText(value: number | undefined): string {
  return typeof value === "number" ? formatPercent(value) : "-";
}

export function comparePriceTone(value: number | undefined): "price-up" | "price-down" | "price-neutral" {
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0) return "price-neutral";
  return value < 0 ? "price-down" : "price-up";
}

export function ratioText(value: number | undefined, suffix = ""): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `${KO_KR_RATIO_FORMATTER.format(value)}${suffix}`;
}

export function averageAnchoredFill(value: number | undefined, values: Array<number | undefined>): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  const finiteValues = values.filter((item): item is number => typeof item === "number" && Number.isFinite(item));
  if (!finiteValues.length) return 0;

  const average = finiteValues.reduce((sum, item) => sum + item, 0) / finiteValues.length;
  const min = Math.min(...finiteValues);
  const max = Math.max(...finiteValues);
  const largestDistance = Math.max(Math.abs(max - average), Math.abs(average - min));
  if (largestDistance === 0) return 50;

  const fill = 50 + ((value - average) / largestDistance) * 50;
  if (fill <= 1e-9) return 0;
  if (fill >= 100 - 1e-9) return 100;
  return Math.max(0, Math.min(100, fill));
}

export type SemanticMetricRow<T> = {
  label: string;
  value: (item: T) => number | undefined;
  display: (value: number | undefined) => string;
};

export function semanticMetricRows<T extends { ticker: string }>(items: T[], rows: Array<SemanticMetricRow<T>>) {
  return rows.map((row) => ({
    label: row.label,
    values: items.map((item) => ({
      ticker: item.ticker,
      value: row.display(row.value(item)),
    })),
  }));
}

export function strongestAndWeakest(data: StockScoreResponse) {
  let strongest: ScoreComponent | undefined;
  let weakest: ScoreComponent | undefined;
  let strongestScore = -1;
  let weakestScore = 101;
  let count = 0;
  for (const component of data.components || []) {
    if (!componentHasDisplayableScore(component)) continue;
    count += 1;
    const strongScore = component.score ?? -1;
    const weakScore = component.score ?? 101;
    if (!strongest || strongScore > strongestScore) {
      strongest = component;
      strongestScore = strongScore;
    }
    if (!weakest || weakScore < weakestScore) {
      weakest = component;
      weakestScore = weakScore;
    }
  }
  return {
    strongest,
    weakest: count > 1 ? weakest : undefined,
  };
}

export function toCompareItem(data: StockScoreResponse, requestedTicker: string, options: { provisional?: boolean; provisionalLabel?: string } = {}): CompareItem {
  const ticker = displayTickerRef(requestedTicker) || data.symbol || data.requested_ticker || "UNKNOWN";
  const { strongest, weakest } = strongestAndWeakest(data);
  const marketCap = stockMarketCapDisplay(data);
  return {
    ticker,
    identity: stockHeaderIdentity(data),
    data,
    score: clampScore(data.quality_score ?? data.score),
    provisional: options.provisional,
    provisionalLabel: options.provisionalLabel,
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
    beta: betaForCompare(data),
    per: valuationByLabel(data, "PER"),
    forwardPer: valuationByLabel(data, "Forward PER"),
    marketCap: [marketCap.primary, marketCap.secondary].filter(Boolean).join(" "),
    strongest,
    weakest,
  };
}

export function bestBy(items: CompareItem[], value: (item: CompareItem) => number | undefined, direction: "high" | "low" = "high") {
  let best: CompareItem | undefined;
  let bestValue: number | undefined;
  for (const item of items) {
    const current = value(item);
    if (typeof current !== "number" || !Number.isFinite(current)) continue;
    if (bestValue === undefined || (direction === "high" ? current > bestValue : current < bestValue)) {
      best = item;
      bestValue = current;
    }
  }
  return best;
}

export function componentScore(item: CompareItem, key: string): number | undefined {
  const component = componentByKey(item.data, key);
  if (!component || !componentHasDisplayableScore(component)) return undefined;
  const score = component.score;
  return typeof score === "number" ? clampScore(score) : undefined;
}

export function opportunityComponentScore(item: CompareItem, key: string): number | undefined {
  const component = item.data.opportunity_components?.find((itemComponent) => itemComponent.key === key);
  if (!component || !componentHasDisplayableScore(component)) return undefined;
  const score = component.score;
  return typeof score === "number" ? clampScore(score) : undefined;
}

export function displayName(data: StockScoreResponse): string {
  return stockHeaderIdentity(data).primary || data.name || data.symbol || data.requested_ticker || "-";
}

export function compareItemTitle(item: CompareItem): string {
  return item.identity.primary || displayName(item.data) || item.ticker;
}

export function compareItemSubtitle(item: CompareItem): string | undefined {
  const subtitle = item.identity.secondary;
  return subtitle && subtitle !== compareItemTitle(item) ? subtitle : undefined;
}

export function isSnapshotPending(result: BatchScoreResult | undefined): boolean {
  return result?.error === "snapshot_pending" || result?.error === "snapshot_unavailable";
}

export function isPartialCompareResult(result: BatchScoreResult | undefined): boolean {
  return isPartialStockSnapshotPayload(result);
}

export function comparePartialData(result: BatchScoreResult | undefined, fallbackTicker: string): StockScoreResponse | undefined {
  return partialStockDataFromPayload(result, fallbackTicker);
}

export function pendingMessage(result: BatchScoreResult | undefined): string {
  void result;
  return "선택한 종목을 같은 기준으로 비교합니다.";
}

export function normalizedPoints(item: CompareItem) {
  const usable = usableChartPoints(item.data.chart_series);
  if (usable.length < 2) return [];
  const first = usable[0].close;
  if (!Number.isFinite(first) || first === 0) return [];
  return usable.map((point) => ({
    date: point.date,
    value: (point.close / first) * 100,
  }));
}

export function compareDateAlignedSeries(items: readonly CompareItem[]): { dates: string[]; series: CompareAlignedSeries[] } {
  const dateSet = new Set<string>();
  const rawSeries = items.map((item) => {
    const points = normalizedPoints(item);
    points.forEach((point) => dateSet.add(point.date));
    return { item, ticker: item.ticker, points };
  });
  const dates = Array.from(dateSet).sort();
  const dateIndex = new Map(dates.map((date, index) => [date, index]));
  const series = rawSeries.map((entry) => ({
    ...entry,
    points: entry.points.flatMap((point) => {
      const index = dateIndex.get(point.date);
      return index === undefined ? [] : [{ ...point, dateIndex: index }];
    }),
  }));
  return { dates, series };
}
