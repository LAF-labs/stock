import { clampScore, formatPercent, formatValue } from "@/lib/format";
import type { SymbolSearchItem } from "@/lib/symbolTypes";
import type { ChartSeriesPoint, JsonValue, ScoreComponent, StockScoreResponse } from "@/lib/types";

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

export function normalizeTicker(value: string): string {
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

export function displayTickerRef(value: string): string {
  return value.replace(/^(US|KR):/i, "");
}

export function symbolRef(item: SymbolSearchItem): string {
  return `${item.market}:${item.ticker}`;
}

export function parseTickers(raw: string | null): string[] {
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

export function ratioText(value: number | undefined, suffix = ""): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(value)}${suffix}`;
}

export function strongestAndWeakest(data: StockScoreResponse) {
  const components = [...(data.components || [])];
  return {
    strongest: components.sort((a, b) => (b.score ?? -1) - (a.score ?? -1))[0],
    weakest: [...components].sort((a, b) => (a.score ?? 101) - (b.score ?? 101))[0],
  };
}

export function toCompareItem(data: StockScoreResponse, requestedTicker: string): CompareItem {
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

export function bestBy(items: CompareItem[], value: (item: CompareItem) => number | undefined, direction: "high" | "low" = "high") {
  const usable = items.filter((item) => typeof value(item) === "number");
  if (!usable.length) return undefined;
  return usable.sort((a, b) => {
    const left = value(a) ?? 0;
    const right = value(b) ?? 0;
    return direction === "high" ? right - left : left - right;
  })[0];
}

export function componentScore(item: CompareItem, key: string): number | undefined {
  const score = componentByKey(item.data, key)?.score;
  return typeof score === "number" ? clampScore(score) : undefined;
}

export function displayName(data: StockScoreResponse): string {
  return data.name || data.symbol || data.requested_ticker || "-";
}

export function isSnapshotPending(result: BatchScoreResult | undefined): boolean {
  return result?.error === "snapshot_pending" || result?.error === "snapshot_unavailable";
}

export function pendingMessage(result: BatchScoreResult | undefined): string {
  const retryAfter = typeof result?.retry_after_seconds === "number" && Number.isFinite(result.retry_after_seconds) ? result.retry_after_seconds : undefined;
  const message = "데이터를 준비하고 있어요. 수집이 끝나면 비교 점수가 표시됩니다.";
  return retryAfter ? `${message} 보통 ${retryAfter}초 안에 다시 확인할 수 있어요.` : message;
}

export function normalizedPoints(item: CompareItem) {
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
