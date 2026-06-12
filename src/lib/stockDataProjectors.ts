import { planStockDisplayCompletion, requiredDisplayParts } from "@/lib/stockCompletionPlanner";
import { formatCurrencyAmount, formatPercent } from "@/lib/format";
import { partValue, type PartState, type PartUnavailableReason } from "@/lib/stockPartState";
import { stockScorePayloadNeedsEnrichment } from "@/lib/stockQueryCompleteness";
import { STOCKSTALKER_SERVICE_NAME } from "@/lib/stockShareMetadata";
import type { StockDataEnvelope } from "@/lib/stockDataEnvelopeTypes";
import type {
  DisplayPart,
  DisplayPartFreshness,
  DisplayPartSource,
  StockChartView,
  StockDisplayPartName,
  StockDisplayPayload,
  StockDisplayUnavailablePart,
  StockDisplayView,
  StockFundamentalsView,
  StockIndustryBenchmarkView,
  StockNewsView,
  StockPriceView,
  StockScoreView,
  StockTechnicalView,
} from "@/lib/stockDisplayTypes";

export function stockDisplayPayloadFromEnvelope(envelope: StockDataEnvelope): StockDisplayPayload {
  const score = normalizeDisplayScore(partValue(envelope.parts.score));
  const chart = partValue(envelope.parts.chart);
  const price = normalizePriceWithChart(partValue(envelope.parts.price), chart, score);
  const suppressTechnical = envelope.view === "technical" && unavailableReasonForPart(envelope, "chart") === "no_history";
  const technical = suppressTechnical ? undefined : partValue(envelope.parts.technical) ?? technicalFromScore(score);
  const fundamentals = partValue(envelope.parts.fundamentals) ?? fundamentalsFromScore(score);
  const industryBenchmark = partValue(envelope.parts.industryBenchmark) ?? industryBenchmarkFromScore(score);
  const news = partValue(envelope.parts.news) ?? newsFromScore(score);
  const requiredParts = requiredDisplayParts(envelope.view);
  const presentParts = presentDisplayParts({ price, chart, score, technical, fundamentals, industryBenchmark, news }, envelope.view);
  const unavailableParts = unavailablePartsFromEnvelope(envelope, requiredParts).filter((item) => !presentParts.includes(item.part));
  const completion = planStockDisplayCompletion({
    ticker: envelope.ticker,
    view: envelope.view,
    requiredParts,
    presentParts,
    unavailableParts,
  });
  const staleParts = stalePartsFromEnvelope(envelope, presentParts);
  const refreshActive = completion.recoveringParts.length > 0 || staleParts.length > 0;

  return {
    ok: true,
    ticker: envelope.ticker,
    requestedTicker: envelope.requestedTicker,
    view: envelope.view,
    generatedAt: envelope.generatedAt,
    snapshotVersion: "display-v1",
    hotnessTier: envelope.hotnessTier,
    identity: displayPartFromState(envelope.parts.identity, "symbol-master")!,
    ...(price ? { price: displayPartFromState(envelope.parts.price, "market-data", price)! } : {}),
    ...(chart ? { chart: displayPartFromState(envelope.parts.chart, "market-data")! } : {}),
    ...(score ? { score: displayPartFromState(envelope.parts.score, "derived", score)! } : {}),
    ...(technical ? { technical: displayPartFromState(envelope.parts.technical, "derived", technical, envelope.parts.score) } : {}),
    ...(fundamentals ? { fundamentals: displayPartFromState(envelope.parts.fundamentals, "derived", fundamentals, envelope.parts.score) } : {}),
    ...(industryBenchmark ? { industryBenchmark: displayPartFromState(envelope.parts.industryBenchmark, "derived", industryBenchmark, envelope.parts.score) } : {}),
    ...(news ? { news: displayPartFromState(envelope.parts.news, "derived", news, envelope.parts.score) } : {}),
    completion: {
      requiredParts: completion.requiredParts,
      presentParts: completion.presentParts,
      missingParts: completion.missingParts,
      recoveringParts: completion.recoveringParts,
      unavailableParts: completion.unavailableParts,
    },
    refresh: {
      active: refreshActive,
      staleParts,
      recoveringParts: completion.recoveringParts,
      ...(refreshActive ? { nextPollMs: 1_500 } : {}),
    },
    capabilities: {
      canCompare: true,
      canTechnical: true,
      technicalHref: `/technical?ticker=${encodeURIComponent(envelope.ticker)}`,
    },
  };
}

function displayPartFromState<T>(
  state: PartState<T> | undefined,
  fallbackSource: DisplayPartSource,
  fallbackValue?: T,
  fallbackState?: PartState<unknown>,
): DisplayPart<T> | undefined {
  const sourceState = state ?? fallbackState;
  const value = fallbackValue !== undefined ? fallbackValue : state ? partValue(state) : undefined;
  if (value === undefined || !sourceState) return undefined;
  const freshness = displayFreshness(sourceState);
  const source = displaySource(sourceState, fallbackSource);
  const fetchedAt = timestampFromState(sourceState);
  const expiresAt = "expiresAt" in sourceState ? sourceState.expiresAt : undefined;
  return {
    value,
    freshness,
    source,
    ...(fetchedAt ? { fetchedAt } : {}),
    ...(expiresAt ? { expiresAt } : {}),
  };
}

function normalizeDisplayScore(score: StockScoreView | undefined): StockScoreView | undefined {
  return score ? { ...score, app: STOCKSTALKER_SERVICE_NAME } : undefined;
}

function normalizePriceWithChart(
  price: StockPriceView | undefined,
  chart: StockChartView | undefined,
  score: StockScoreView | undefined,
): StockPriceView | undefined {
  if (!price) return price;
  const rows = usableChartRows(chart?.chart_series) || usableChartRows(score?.chart_series);
  if (!rows) return price;

  const latestRow = rows.at(-1);
  const previousRow = rows.at(-2);
  const chartLatest = numberValue(recordValue(latestRow)?.close);
  const chartPrevious = numberValue(recordValue(previousRow)?.close);
  if (!positiveNumber(chartLatest) || !positiveNumber(chartPrevious)) return price;

  const quotedPrice = numberValue(price.latest_price);
  const nextPrice = shouldPreferChartPrice(quotedPrice, chartLatest, chartPrevious) ? chartLatest : quotedPrice ?? chartLatest;
  const quotedPrevious = numberValue(price.previous_close);
  const chartChange = roundRatio(nextPrice / chartPrevious - 1);
  const quotedChange = numberValue(price.latest_change);
  const shouldNormalizeChange =
    !positiveNumber(quotedPrevious) ||
    Math.abs(quotedPrevious / chartPrevious - 1) > 0.5 ||
    (quotedChange !== undefined && Math.abs(quotedChange) > 2 && Math.abs(chartChange) < 0.5);

  if (!shouldNormalizeChange && nextPrice === quotedPrice) return price;

  const currency = stringValue(price.currency) || stringValue(score?.currency);
  const priceMetrics = recordValue(price.price_metrics);
  return {
    ...price,
    latest_price: nextPrice,
    latest_price_label: nextPrice === quotedPrice ? price.latest_price_label : formatCurrencyAmount(nextPrice, currency),
    previous_close: shouldNormalizeChange ? chartPrevious : price.previous_close,
    latest_change: shouldNormalizeChange ? chartChange : price.latest_change,
    latest_change_label: shouldNormalizeChange ? formatPercent(chartChange) : price.latest_change_label,
    price_metrics: {
      ...priceMetrics,
      price: nextPrice,
      previous_close: shouldNormalizeChange ? chartPrevious : priceMetrics?.previous_close,
      latest_change: shouldNormalizeChange ? chartChange : priceMetrics?.latest_change,
    },
  };
}

function presentDisplayParts(
  values: {
    price?: StockPriceView;
    chart?: StockChartView;
    score?: StockScoreView;
    technical?: StockTechnicalView;
    fundamentals?: StockFundamentalsView;
    industryBenchmark?: StockIndustryBenchmarkView;
    news?: StockNewsView;
  },
  view: StockDisplayView,
): StockDisplayPartName[] {
  const parts: StockDisplayPartName[] = ["identity"];
  if (values.price) parts.push("price");
  if (hasUsableChart(values.chart)) parts.push("chart");
  if (view === "technical") {
    if (values.technical) parts.push("technical");
  } else if (values.score) {
    parts.push("score");
    if (values.fundamentals) parts.push("fundamentals");
    if (values.industryBenchmark) parts.push("industryBenchmark");
    if (values.news) parts.push("news");
  }
  return parts;
}

function unavailablePartsFromEnvelope(envelope: StockDataEnvelope, requiredParts: StockDisplayPartName[]): StockDisplayUnavailablePart[] {
  const parts: StockDisplayUnavailablePart[] = [];
  for (const part of requiredParts) {
    const state = envelope.parts[part];
    if (state?.state === "unavailable") {
      parts.push({ part, reason: displayUnavailableReason(state.reason) });
    }
  }
  return parts;
}

function unavailableReasonForPart(envelope: StockDataEnvelope, part: StockDisplayPartName): StockDisplayUnavailablePart["reason"] | undefined {
  const state = envelope.parts[part];
  return state?.state === "unavailable" ? displayUnavailableReason(state.reason) : undefined;
}

function stalePartsFromEnvelope(envelope: StockDataEnvelope, presentParts: StockDisplayPartName[]): StockDisplayPartName[] {
  return presentParts.filter((part) => envelope.parts[part]?.state === "stale_ready");
}

function displayFreshness(state: PartState<unknown>): DisplayPartFreshness {
  if (state.state === "stale_ready") return "stale";
  if (state.state === "degraded") return "fallback";
  return "fresh";
}

function displaySource(state: PartState<unknown>, fallback: DisplayPartSource): DisplayPartSource {
  if (state.state === "degraded") return "fast-path";
  if (state.state !== "ready" && state.state !== "stale_ready") return fallback;
  const source = state.source;
  if (source === "memory" || source === "supabase" || source === "market-data" || source === "symbol-master" || source === "fast-path" || source === "derived") {
    return source;
  }
  return fallback;
}

function timestampFromState(state: PartState<unknown>): string | undefined {
  if (state.state === "ready" || state.state === "stale_ready" || state.state === "degraded") return state.fetchedAt;
  return undefined;
}

function displayUnavailableReason(reason: PartUnavailableReason): StockDisplayUnavailablePart["reason"] {
  if (reason === "provider_empty") return "provider_confirmed_empty";
  if (reason === "not_reported") return "provider_confirmed_empty";
  return reason;
}

function technicalFromScore(score: StockScoreView | undefined): StockTechnicalView | undefined {
  const value = score?.technical_analysis;
  if (value && typeof value === "object" && !Array.isArray(value)) return value as StockTechnicalView;
  return undefined;
}

function fundamentalsFromScore(score: StockScoreView | undefined): StockFundamentalsView | undefined {
  if (!score || stockScorePayloadNeedsEnrichment(score)) return undefined;
  return compactRecord({
    key_metrics: arrayValue(score.key_metrics),
    stock_profile: arrayValue(score.stock_profile),
    valuation_rows: fundamentalValuationRows(score.valuation_rows),
    financials: recordValue(score.financials),
    financial_statement: recordValue(score.financial_statement),
    market_cap: numberValue(score.market_cap),
    market_cap_label: stringValue(score.market_cap_label),
  });
}

function industryBenchmarkFromScore(score: StockScoreView | undefined): StockIndustryBenchmarkView | undefined {
  if (!score || stockScorePayloadNeedsEnrichment(score)) return undefined;
  return compactRecord({
    industry_benchmarks: arrayValue(score.industry_benchmarks),
    valuation_rows: industryBenchmarkRows(score.valuation_rows),
    benchmark: stringValue(score.benchmark),
    benchmark_label: stringValue(score.benchmark_label),
  });
}

function newsFromScore(score: StockScoreView | undefined): StockNewsView | undefined {
  const items = arrayValue(score?.news);
  return items?.length ? { items } : undefined;
}

function hasUsableChart(chart: StockChartView | undefined): chart is StockChartView {
  return !!chart && Array.isArray(chart.chart_series) && chart.chart_series.length >= 2;
}

function usableChartRows(value: unknown): unknown[] | undefined {
  return Array.isArray(value) && value.length >= 2 ? value : undefined;
}

function shouldPreferChartPrice(price: number | undefined, chartLatest: number, chartPrevious: number): boolean {
  if (!positiveNumber(price)) return true;
  const priceToLatest = price / chartLatest;
  if (priceToLatest > 2 || priceToLatest < 0.5) return true;
  const priceMove = price / chartPrevious - 1;
  const chartMove = chartLatest / chartPrevious - 1;
  return Math.abs(priceMove) > 2 && Math.abs(chartMove) < 0.5;
}

function positiveNumber(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function roundRatio(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function compactRecord<T extends Record<string, unknown>>(record: T): T | undefined {
  const entries = Object.entries(record).filter(([, value]) => {
    if (value === undefined || value === null) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
    return true;
  });
  return entries.length ? Object.fromEntries(entries) as T : undefined;
}

function arrayValue(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function industryBenchmarkRows(value: unknown): unknown[] | undefined {
  const rows = arrayValue(value)?.filter(isIndustryBenchmarkRow);
  return rows?.length ? rows : undefined;
}

function fundamentalValuationRows(value: unknown): unknown[] | undefined {
  const rows = arrayValue(value)?.filter((item) => !isIndustryBenchmarkRow(item));
  return rows?.length ? rows : undefined;
}

function isIndustryBenchmarkRow(item: unknown): boolean {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  const label = stringValue((item as Record<string, unknown>).label);
  return Boolean(label && label.includes("업종 기준"));
}
