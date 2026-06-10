import type { StockDisplayPayload } from "@/lib/stockDisplayTypes";
import type { ChartSeriesPoint, StockScoreResponse } from "@/lib/types";

export function stockScoreDataFromDisplayPayload(payload: StockDisplayPayload): StockScoreResponse {
  const identity = payload.identity.value;
  const price = payload.price?.value || {};
  const chart = payload.chart?.value || {};
  const score = payload.score?.value || {};
  const technical = payload.technical?.value || score.technical_analysis;
  const chartSeries = arrayValue(chart.chart_series) || arrayValue(score.chart_series);
  const market = identity.market;
  const symbol = identity.symbol;

  return {
    ...score,
    requested_ticker: payload.ticker,
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
    chart_series: chartSeries as ChartSeriesPoint[] | undefined,
    chart_patterns: arrayValue(score.chart_patterns) as StockScoreResponse["chart_patterns"],
    components: arrayValue(score.components) as StockScoreResponse["components"],
    opportunity_components: arrayValue(score.opportunity_components) as StockScoreResponse["opportunity_components"],
    key_metrics: arrayValue(score.key_metrics) as StockScoreResponse["key_metrics"],
    stock_profile: arrayValue(score.stock_profile) as StockScoreResponse["stock_profile"],
    valuation_rows: arrayValue(score.valuation_rows) as StockScoreResponse["valuation_rows"],
    news: arrayValue(score.news) as StockScoreResponse["news"],
    price_metrics: recordValue(price.price_metrics) || recordValue(chart.price_metrics) || recordValue(score.price_metrics),
    financials: recordValue(score.financials),
    financial_statement: recordValue(score.financial_statement),
    technical_analysis: recordValue(technical) as StockScoreResponse["technical_analysis"],
    server_cache: {
      state: payload.refresh.active ? "recovering" : "ready",
      source: "display",
      fetched_at: payload.generatedAt,
      refresh_started: payload.refresh.active,
      recovering_parts: payload.refresh.recoveringParts,
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

function recordValue(value: unknown): Record<string, never> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, never>;
}
