import { clampScore, formatPercent, formatValue } from "@/lib/format";
import {
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
  per?: number;
  forwardPer?: number;
  marketCap: string;
  strongest?: ScoreComponent;
  weakest?: ScoreComponent;
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
  return tickers.filter((item, index) => index === 0 || item !== ticker);
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
  for (const component of data.components || []) {
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
    weakest,
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
  const score = componentByKey(item.data, key)?.score;
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

export function compareItemSummary(item: CompareItem): string {
  const title = compareItemTitle(item);
  let summary = item.data.summary || displayName(item.data);
  if (!summary || !/[가-힣]/.test(title)) return summary;

  summary = replaceTickerPrefix(summary, title, [
    item.ticker,
    item.identity.secondary,
    item.data.symbol,
    item.data.requested_ticker,
    item.data.requested_ticker ? displayTickerRef(item.data.requested_ticker) : undefined,
  ]);

  return fixKoreanTopicParticle(summary, title);
}

function replaceTickerPrefix(summary: string, title: string, candidates: Array<string | undefined>): string {
  for (const candidate of uniqueCandidates(candidates)) {
    if (candidate === title) continue;
    if (summary.startsWith(`${candidate}은`) || summary.startsWith(`${candidate}는`)) {
      return `${title}${topicParticle(title)}${summary.slice(candidate.length + 1)}`;
    }
    if (summary.startsWith(`${candidate}이`) || summary.startsWith(`${candidate}가`)) {
      return `${title}${subjectParticle(title)}${summary.slice(candidate.length + 1)}`;
    }
    if (summary.startsWith(`${candidate}을`) || summary.startsWith(`${candidate}를`)) {
      return `${title}${objectParticle(title)}${summary.slice(candidate.length + 1)}`;
    }
    if (summary.startsWith(`${candidate} `)) {
      return `${title} ${summary.slice(candidate.length + 1)}`;
    }
  }
  return summary;
}

function fixKoreanTopicParticle(summary: string, title: string): string {
  const correctParticle = topicParticle(title);
  const wrongParticle = correctParticle === "은" ? "는" : "은";
  if (summary.startsWith(`${title}${wrongParticle}`)) {
    return `${title}${correctParticle}${summary.slice(title.length + wrongParticle.length)}`;
  }
  return summary;
}

function uniqueCandidates(candidates: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const candidate of candidates) {
    const value = typeof candidate === "string" ? candidate.trim() : "";
    if (!value || seen.has(value)) continue;
    seen.add(value);
    values.push(value);
  }
  return values;
}

function subjectParticle(value: string): string {
  const last = Array.from(value.trim()).pop();
  if (!last) return "가";
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return "가";
  return (code - 0xac00) % 28 === 0 ? "가" : "이";
}

function topicParticle(value: string): string {
  const last = Array.from(value.trim()).pop();
  if (!last) return "는";
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return "는";
  return (code - 0xac00) % 28 === 0 ? "는" : "은";
}

function objectParticle(value: string): string {
  const last = Array.from(value.trim()).pop();
  if (!last) return "를";
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return "를";
  return (code - 0xac00) % 28 === 0 ? "를" : "을";
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
