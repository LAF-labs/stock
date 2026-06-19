import type { StockScoreResponse } from "@/lib/types";

export function stockJudgmentRequestPayload(data: StockScoreResponse | Record<string, unknown>): Record<string, unknown> {
  const source = stockPayloadRecord(data);
  return compactRecord({
    requested_ticker: source.requested_ticker,
    market: source.market,
    symbol: source.symbol,
    name: source.name,
    latest_bar_date: source.latest_bar_date,
    score: source.score,
    quality_score: source.quality_score,
    opportunity_score: source.opportunity_score,
    sector: typeof source.sector === "string" ? source.sector : undefined,
    industry: typeof source.industry === "string" ? source.industry : undefined,
    sia_snapshot: compactSignalSnapshot(source.sia_snapshot),
    key_metrics: compactMetrics(source.key_metrics, 12),
    valuation_rows: compactMetrics(source.valuation_rows, 8),
    stock_profile: compactMetrics(source.stock_profile, 16),
    components: compactComponents(source.components),
  });
}

function stockPayloadRecord(data: StockScoreResponse | Record<string, unknown>): Record<string, unknown> {
  const record = data as Record<string, unknown>;
  return recordFromUnknown(record.stock) || record;
}

function compactSignalSnapshot(value: unknown): Record<string, unknown> | undefined {
  const record = recordFromUnknown(value);
  if (!record) return undefined;
  return compactRecord({
    raw_signal: record.raw_signal,
    risk_level: record.risk_level,
  });
}

function compactComponents(value: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return value.slice(0, 5).map((item) => {
    const component = recordFromUnknown(item) || {};
    return compactRecord({
      key: component.key,
      label: component.label,
      score: component.score,
      metrics: compactMetrics(component.metrics, 2),
    });
  });
}

function compactMetrics(value: unknown, count: number): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return value.slice(0, count).map((item) => {
    const metric = recordFromUnknown(item) || {};
    return compactRecord({
      label: metric.label,
      value: metric.value,
      note: metric.note,
    });
  });
}

function compactRecord<T extends Record<string, unknown>>(record: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

function recordFromUnknown(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}
