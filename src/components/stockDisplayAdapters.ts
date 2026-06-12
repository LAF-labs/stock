import type { StockDisplayPayload } from "@/lib/stockDisplayTypes";
import type { StockDetailViewModel } from "@/lib/stockDetailViewTypes";
import type { ChartSeriesPoint, StockScoreResponse } from "@/lib/types";

export function stockDisplayPayloadIsComplete(payload: StockDisplayPayload): boolean {
  return (
    payload.refresh.active !== true &&
    payload.completion.missingParts.length === 0 &&
    payload.completion.recoveringParts.length === 0
  );
}

export function stockScoreDataFromDisplayPayload(payload: StockDisplayPayload): StockScoreResponse {
  const identity = payload.identity.value;
  const price = payload.price?.value || {};
  const chart = payload.chart?.value || {};
  const score = payload.score?.value || {};
  const technical = payload.technical?.value || score.technical_analysis;
  const financials = mergeSectionRecords(payload.fundamentals?.value, payload.industryBenchmark?.value);
  const analyst = mergeSectionRecords(payload.judgment?.value, normalizedNewsSection(payload.news?.value));

  return stockScoreDataFromSections({
    ticker: payload.ticker,
    identity,
    generatedAt: payload.generatedAt,
    source: "display",
    refreshActive: payload.refresh.active,
    recoveringParts: payload.refresh.recoveringParts,
    price,
    chart,
    score,
    technical,
    financials,
    analyst,
  });
}

export function stockScoreDataFromDetailView(view: StockDetailViewModel): StockScoreResponse {
  return stockScoreDataFromSections({
    ticker: view.ticker,
    identity: view.identity,
    generatedAt: view.generatedAt,
    source: "detail-view",
    refreshActive: view.mode === "partial",
    recoveringParts: Object.entries(view.parts)
      .filter(([, status]) => status.state === "refreshing" || status.state === "failed_retrying")
      .map(([part]) => part),
    price: view.sections.price || {},
    chart: view.sections.chart || {},
    score: view.sections.score || {},
    financials: view.sections.financials,
    analyst: view.sections.analyst,
  });
}

function stockScoreDataFromSections(input: {
  ticker: string;
  identity: StockDetailViewModel["identity"];
  generatedAt: string;
  source: "display" | "detail-view";
  refreshActive: boolean;
  recoveringParts: string[];
  price: Record<string, unknown>;
  chart: Record<string, unknown>;
  score: Record<string, unknown>;
  technical?: unknown;
  financials?: Record<string, unknown>;
  analyst?: Record<string, unknown>;
}): StockScoreResponse {
  const { ticker, identity, generatedAt, source, refreshActive, recoveringParts, price, chart, score } = input;
  const financials = input.financials || {};
  const analyst = input.analyst || {};
  const technical = input.technical || score.technical_analysis;
  const chartSeries = arrayValue(chart.chart_series) || arrayValue(score.chart_series);
  const market = identity.market;
  const symbol = identity.symbol;

  return {
    ...score,
    requested_ticker: ticker,
    market,
    symbol,
    name: stringValue(score.name) || stringValue(price.name) || identity.name,
    display_name: stringValue(score.display_name) || identity.name,
    korean_name: identity.koreanName,
    english_name: identity.englishName,
    instrument_type: identity.instrumentType,
    exchange: stringValue(score.exchange) || stringValue(price.exchange) || identity.exchange,
    currency: stringValue(score.currency) || stringValue(price.currency) || (market === "KR" ? "KRW" : "USD"),
    latest_price: numberValue(price.latest_price) ?? numberValue(score.latest_price),
    latest_price_label: stringValue(price.latest_price_label) || stringValue(score.latest_price_label),
    latest_bar_date: stringValue(price.latest_bar_date) || stringValue(chart.latest_bar_date) || stringValue(score.latest_bar_date),
    usd_krw_rate: numberValue(price.usd_krw_rate) ?? numberValue(score.usd_krw_rate),
    usd_krw_label: stringValue(price.usd_krw_label) || stringValue(score.usd_krw_label),
    market_cap: numberValue(price.market_cap) ?? numberValue(financials.market_cap) ?? numberValue(score.market_cap),
    market_cap_label: stringValue(price.market_cap_label) || stringValue(financials.market_cap_label) || stringValue(score.market_cap_label),
    chart_series: chartSeries as ChartSeriesPoint[] | undefined,
    chart_patterns: arrayValue(score.chart_patterns) as StockScoreResponse["chart_patterns"],
    components: arrayValue(score.components) as StockScoreResponse["components"],
    opportunity_components: arrayValue(score.opportunity_components) as StockScoreResponse["opportunity_components"],
    key_metrics: arrayValue(financials.key_metrics) as StockScoreResponse["key_metrics"] || arrayValue(score.key_metrics) as StockScoreResponse["key_metrics"],
    stock_profile: arrayValue(financials.stock_profile) as StockScoreResponse["stock_profile"] || arrayValue(score.stock_profile) as StockScoreResponse["stock_profile"],
    valuation_rows: arrayValue(financials.valuation_rows) as StockScoreResponse["valuation_rows"] || arrayValue(score.valuation_rows) as StockScoreResponse["valuation_rows"],
    news: arrayValue(analyst.news) as StockScoreResponse["news"] || arrayValue(analyst.items) as StockScoreResponse["news"] || arrayValue(score.news) as StockScoreResponse["news"],
    price_metrics: (recordValue(price.price_metrics) || recordValue(chart.price_metrics) || recordValue(score.price_metrics)) as StockScoreResponse["price_metrics"],
    financials: (financialRecord(financials) || recordValue(score.financials)) as StockScoreResponse["financials"],
    financial_statement: (recordValue(financials.financial_statement) || recordValue(score.financial_statement)) as StockScoreResponse["financial_statement"],
    technical_analysis: recordValue(technical) as StockScoreResponse["technical_analysis"],
    industry_benchmarks: arrayValue(financials.industry_benchmarks) || arrayValue(score.industry_benchmarks),
    server_cache: {
      state: refreshActive ? "recovering" : "ready",
      source,
      fetched_at: generatedAt,
      refresh_started: refreshActive,
      recovering_parts: recoveringParts,
    },
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function arrayValue(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function normalizedNewsSection(value: unknown): Record<string, unknown> | undefined {
  const record = recordValue(value);
  if (!record) return undefined;
  return Array.isArray(record.items) ? { news: record.items } : record;
}

function mergeSectionRecords(...values: Array<unknown>): Record<string, unknown> | undefined {
  const merged: Record<string, unknown> = {};
  for (const value of values) {
    const record = recordValue(value);
    if (!record) continue;
    for (const [key, nextValue] of Object.entries(record)) {
      if (nextValue === undefined || nextValue === null) continue;
      const previousValue = merged[key];
      if (Array.isArray(previousValue) && Array.isArray(nextValue)) {
        merged[key] = dedupeArrayValues([...previousValue, ...nextValue]);
      } else {
        merged[key] = nextValue;
      }
    }
  }
  return Object.keys(merged).length ? merged : undefined;
}

function financialRecord(section: Record<string, unknown>): Record<string, unknown> | undefined {
  const nested = recordValue(section.financials);
  if (nested) return nested;
  const groupedKeys = new Set([
    "key_metrics",
    "stock_profile",
    "valuation_rows",
    "financial_statement",
    "industry_benchmarks",
    "market_cap",
    "market_cap_label",
  ]);
  const hasGroupedKeys = Object.keys(section).some((key) => groupedKeys.has(key));
  return hasGroupedKeys ? undefined : recordValue(section);
}

function dedupeArrayValues(values: unknown[]): unknown[] {
  const seen = new Set<string>();
  const deduped: unknown[] = [];
  for (const value of values) {
    const key = stableArrayValueKey(value);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(value);
  }
  return deduped;
}

function stableArrayValueKey(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return JSON.stringify(value);
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(Object.fromEntries(entries));
}
