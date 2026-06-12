import { planStockDisplayCompletion } from "@/lib/stockCompletionPlanner";
import { stockScorePayloadNeedsEnrichment } from "@/lib/stockQueryCompleteness";
import { partialStockScoreTimeoutMs } from "@/lib/stockScorePartialFastPath";
import { STOCKSTALKER_SERVICE_NAME } from "@/lib/stockShareMetadata";
import { isProviderConfirmedEmptyError } from "@/lib/stockProviderErrors";
import { findExactLocalSymbol } from "@/lib/symbolSearch";
import { numericEnv } from "@/lib/supabaseRest";
import { normalizeTickerRef, parseTickerRef } from "@/lib/tickerRef";
import type { ScoreView, StockPayload, StockScoreResult } from "@/lib/stockScoreContract";
import type {
  DisplayPart,
  StockChartView,
  StockDisplayPayload,
  StockDisplayPartName,
  StockDisplayUnavailablePart,
  StockDisplayView,
  StockFundamentalsView,
  StockIdentityView,
  StockIndustryBenchmarkView,
  StockNewsView,
  StockPriceView,
  StockScoreView,
  StockTechnicalView,
} from "@/lib/stockDisplayTypes";

export type StockDisplaySourceResult<T extends Record<string, unknown>> = T | undefined;

export type StockDisplaySources = {
  identity?: (ticker: string) => Promise<StockIdentityView | undefined>;
  price?: (ticker: string) => Promise<StockDisplaySourceResult<StockPriceView>>;
  chart?: (ticker: string) => Promise<StockDisplaySourceResult<StockChartView>>;
  score?: (ticker: string, view: StockDisplayView) => Promise<StockDisplaySourceResult<StockScoreView>>;
};

export type StockDisplayScoreSourceDeps = {
  readSnapshot: (ticker: string, view: ScoreView) => Promise<StockScoreResult | undefined>;
  detailFastPathEnabled: () => boolean | Promise<boolean>;
  technicalFastPathEnabled: () => boolean | Promise<boolean>;
  buildDetailFastPathPayload: (ticker: string, view: ScoreView) => Promise<StockPayload>;
  buildTechnicalScoreFastPathPayload: (ticker: string) => Promise<StockPayload>;
  enrichStockPayloadWithSymbolProfile: (payload: StockPayload) => Promise<StockPayload>;
  enrichStockPayloadWithIndustryBenchmarks: (payload: StockPayload) => Promise<StockPayload>;
};

export type BuildStockDisplayPayloadInput = {
  ticker: string;
  view: StockDisplayView;
  sources?: StockDisplaySources;
  now?: Date;
};

export async function readStockDisplayScoreSource(
  ticker: string,
  view: StockDisplayView,
  deps: StockDisplayScoreSourceDeps = defaultDisplayScoreSourceDeps()
): Promise<StockDisplaySourceResult<StockScoreView>> {
  const scoreView = displayScoreView(view);
  const snapshot = await deps.readSnapshot(ticker, scoreView).catch(() => undefined);
  let payload = snapshot?.payload;

  if (!payload || payload.ok === false) {
    payload = await requestFastPathDisplayScore(ticker, scoreView, deps);
  }

  if (!payload || payload.ok === false) return undefined;
  if (scoreView === "technical") return payload;

  const withProfile = await deps.enrichStockPayloadWithSymbolProfile(payload).catch(() => payload);
  return deps.enrichStockPayloadWithIndustryBenchmarks(withProfile).catch(() => withProfile);
}

export async function buildStockDisplayPayload(input: BuildStockDisplayPayloadInput): Promise<StockDisplayPayload> {
  const ticker = normalizeTickerRef(input.ticker);
  const now = input.now ?? new Date();
  const sources = input.sources ?? defaultDisplaySources();
  const identityPromise = loadIdentity(ticker, sources);
  const pricePromise = withLaneDeadline("price", startDisplayLane(() => sources.price?.(ticker)));
  const chartPromise = withLaneDeadline("chart", startDisplayLane(() => sources.chart?.(ticker)));
  const scorePromise = withLaneDeadline("score", startDisplayLane(() => sources.score?.(ticker, input.view)));

  const [identityResult, priceResult, chartResult, scoreResult] = await Promise.allSettled([
    identityPromise,
    pricePromise,
    chartPromise,
    scorePromise,
  ]);

  const identity = fulfilledValue(identityResult) ?? fallbackIdentity(ticker);
  const score = normalizeDisplayScore(fulfilledValue(scoreResult));
  const price = fulfilledValue(priceResult) ?? priceFromScore(score);
  const chart = fulfilledValue(chartResult) ?? chartFromScore(score);
  const technical = technicalFromScore(score);
  const fundamentals = fundamentalsFromScore(score);
  const industryBenchmark = industryBenchmarkFromScore(score);
  const news = newsFromScore(score);
  const presentParts = presentDisplayParts({ price, chart, score, technical, fundamentals, industryBenchmark, news }, input.view);
  const requiredParts = displayRequiredParts(input.view, score);
  const unavailableParts = unavailablePartsFromLaneResults({ priceResult, chartResult, scoreResult }, input.view)
    .filter((item) => !presentParts.includes(item.part));
  const completion = planStockDisplayCompletion({
    ticker,
    view: input.view,
    requiredParts,
    presentParts,
    unavailableParts,
  });

  const refreshActive = completion.recoveringParts.length > 0;

  return {
    ok: true,
    ticker,
    requestedTicker: input.ticker,
    view: input.view,
    generatedAt: now.toISOString(),
    snapshotVersion: "display-v1",
    hotnessTier: "active",
    identity: part(identity, "symbol-master", now),
    ...(price ? { price: part(price, "market-data", now) } : {}),
    ...(chart ? { chart: part(chart, "market-data", now) } : {}),
    ...(score ? { score: part(score, "derived", now) } : {}),
    ...(technical ? { technical: part(technical, "derived", now) } : {}),
    ...(fundamentals ? { fundamentals: part(fundamentals, "derived", now) } : {}),
    ...(industryBenchmark ? { industryBenchmark: part(industryBenchmark, "derived", now) } : {}),
    ...(news ? { news: part(news, "derived", now) } : {}),
    completion: publicCompletion(completion),
    refresh: {
      active: refreshActive,
      staleParts: [],
      recoveringParts: completion.recoveringParts,
      ...(refreshActive ? { nextPollMs: 1_500 } : {}),
    },
    capabilities: {
      canCompare: true,
      canTechnical: true,
      technicalHref: `/technical?ticker=${encodeURIComponent(ticker)}`,
    },
  };
}

function publicCompletion(completion: ReturnType<typeof planStockDisplayCompletion>): StockDisplayPayload["completion"] {
  return {
    requiredParts: completion.requiredParts,
    presentParts: completion.presentParts,
    missingParts: completion.missingParts,
    recoveringParts: completion.recoveringParts,
    unavailableParts: completion.unavailableParts,
  };
}

function normalizeDisplayScore(score: StockScoreView | undefined): StockScoreView | undefined {
  return score ? { ...score, app: STOCKSTALKER_SERVICE_NAME } : undefined;
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

function displayRequiredParts(view: StockDisplayView, score: StockScoreView | undefined): StockDisplayPartName[] {
  const required: StockDisplayPartName[] = view === "technical"
    ? ["identity", "price", "chart", "technical"]
    : ["identity", "price", "chart", "score"];
  if (view !== "technical" && score && stockScorePayloadNeedsEnrichment(score)) {
    required.push("fundamentals", "industryBenchmark");
  }
  return required;
}

function hasFundamentals(score: StockScoreView | undefined): boolean {
  if (!score) return false;
  if (hasMetricLabel(score.key_metrics, "시가총액")) return true;
  if (hasMetricLabel(score.valuation_rows, "Forward PER")) return true;
  if (numberValue(score.market_cap) !== undefined) return true;
  return false;
}

function hasIndustryBenchmark(score: StockScoreView | undefined): boolean {
  if (!score) return false;
  if (hasMetricLabel(score.valuation_rows, "업종 기준 PER")) return true;
  if (hasMetricLabel(score.valuation_rows, "업종 기준 PBR")) return true;
  return Array.isArray(score.industry_benchmarks) && score.industry_benchmarks.length > 0;
}

function hasMetricLabel(value: unknown, label: string): boolean {
  if (!Array.isArray(value)) return false;
  return value.some((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    return (item as Record<string, unknown>).label === label;
  });
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function hasUsableChart(chart: StockChartView | undefined): chart is StockChartView {
  return !!chart && Array.isArray(chart.chart_series) && chart.chart_series.length >= 2;
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

function priceFromScore(score: StockScoreView | undefined): StockPriceView | undefined {
  if (!score || score.latest_price === undefined) return undefined;
  return {
    requested_ticker: score.requested_ticker,
    market: score.market,
    symbol: score.symbol,
    name: score.name || score.display_name,
    currency: score.currency,
    latest_price: score.latest_price,
    latest_price_label: score.latest_price_label,
    latest_change: score.latest_change,
    latest_change_label: score.latest_change_label,
    latest_bar_date: score.latest_bar_date,
    price_metrics: score.price_metrics,
  };
}

function chartFromScore(score: StockScoreView | undefined): StockChartView | undefined {
  if (!score || !Array.isArray(score.chart_series)) return undefined;
  return {
    requested_ticker: score.requested_ticker,
    market: score.market,
    symbol: score.symbol,
    name: score.name || score.display_name,
    currency: score.currency,
    chart_series: score.chart_series,
    latest_bar_date: score.latest_bar_date,
    price_metrics: score.price_metrics,
  };
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

function fulfilledValue<T>(result: PromiseSettledResult<T>): T | undefined {
  return result.status === "fulfilled" ? result.value : undefined;
}

function unavailablePartsFromLaneResults(
  results: {
    priceResult: PromiseSettledResult<unknown>;
    chartResult: PromiseSettledResult<unknown>;
    scoreResult: PromiseSettledResult<unknown>;
  },
  view: StockDisplayView,
): StockDisplayUnavailablePart[] {
  const parts: StockDisplayUnavailablePart[] = [];
  if (results.priceResult.status === "rejected" && isProviderConfirmedEmptyError(results.priceResult.reason)) {
    parts.push({ part: "price", reason: "provider_confirmed_empty" });
  }
  if (results.chartResult.status === "rejected" && isProviderConfirmedEmptyError(results.chartResult.reason)) {
    parts.push({ part: "chart", reason: "provider_confirmed_empty" });
  }
  if (results.scoreResult.status === "rejected" && isProviderConfirmedEmptyError(results.scoreResult.reason)) {
    parts.push({ part: view === "technical" ? "technical" : "score", reason: "provider_confirmed_empty" });
  }
  return parts;
}

async function loadIdentity(ticker: string, sources: StockDisplaySources): Promise<StockIdentityView> {
  const fromSource = await sources.identity?.(ticker).catch(() => undefined);
  if (fromSource) return fromSource;
  return fallbackIdentity(ticker);
}

function part<T>(value: T, source: DisplayPart<T>["source"], now: Date): DisplayPart<T> {
  return {
    value,
    freshness: "fresh",
    source,
    fetchedAt: now.toISOString(),
  };
}

function fallbackIdentity(tickerRef: string): StockIdentityView {
  const parsed = parseTickerRef(tickerRef);
  return {
    ticker: parsed.ticker,
    market: parsed.market,
    symbol: parsed.symbol,
    name: parsed.symbol,
  };
}

function defaultDisplaySources(): StockDisplaySources {
  return {
    identity: async (ticker) => {
      const item = await findExactLocalSymbol(ticker);
      if (!item) return fallbackIdentity(ticker);
      return {
        ticker: item.key,
        market: item.market,
        symbol: item.ticker,
        name: item.displayName || item.koreanName || item.englishName || item.ticker,
        koreanName: item.koreanName || undefined,
        englishName: item.englishName || undefined,
        exchange: item.exchange || undefined,
        instrumentType: item.instrumentType || undefined,
      };
    },
    price: async (ticker) => {
      const { getStockQuote } = await import("@/lib/stockQuoteCache");
      const result = await getStockQuote(ticker);
      return result.payload.ok === false ? undefined : result.payload;
    },
    chart: async (ticker) => {
      const { getStockChart } = await import("@/lib/stockChartCache");
      const result = await getStockChart(ticker);
      return result.payload.ok === false ? undefined : result.payload;
    },
    score: async (ticker, view) => {
      return readStockDisplayScoreSource(ticker, view);
    },
  };
}

function displayScoreView(view: StockDisplayView): ScoreView {
  return view === "technical" ? "technical" : view === "compare" ? "compare" : "detail";
}

async function requestFastPathDisplayScore(
  ticker: string,
  view: ScoreView,
  deps: StockDisplayScoreSourceDeps
): Promise<StockPayload | undefined> {
  try {
    if (view === "technical") {
      if (!(await deps.technicalFastPathEnabled())) return undefined;
      return await deps.buildTechnicalScoreFastPathPayload(ticker);
    }
    if (!(await deps.detailFastPathEnabled())) return undefined;
    return await deps.buildDetailFastPathPayload(ticker, view);
  } catch (error) {
    if (isProviderConfirmedEmptyError(error)) throw error;
    return undefined;
  }
}

function defaultDisplayScoreSourceDeps(): StockDisplayScoreSourceDeps {
  return {
    readSnapshot: async (ticker, view) => {
      const { readStockScoreSnapshotForDisplay } = await import("@/lib/stockScoreSnapshotReader");
      return readStockScoreSnapshotForDisplay(ticker, view);
    },
    detailFastPathEnabled: async () => {
      const { detailRequestFastPathEnabled } = await import("@/lib/detailScoreFastPath");
      return detailRequestFastPathEnabled();
    },
    technicalFastPathEnabled: async () => {
      const { technicalRequestFastPathEnabled } = await import("@/lib/technicalScoreFastPath");
      return technicalRequestFastPathEnabled();
    },
    buildDetailFastPathPayload: async (ticker, view) => {
      const { buildDetailScoreFastPathPayload } = await import("@/lib/detailScoreFastPath");
      return buildDetailScoreFastPathPayload(ticker, view);
    },
    buildTechnicalScoreFastPathPayload: async (ticker) => {
      const { buildTechnicalScoreFastPathPayload } = await import("@/lib/technicalScoreFastPath");
      return buildTechnicalScoreFastPathPayload(ticker);
    },
    enrichStockPayloadWithSymbolProfile: async (payload) => {
      const { enrichStockPayloadWithSymbolProfile } = await import("@/lib/symbolProfiles");
      return enrichStockPayloadWithSymbolProfile(payload);
    },
    enrichStockPayloadWithIndustryBenchmarks: async (payload) => {
      const { enrichStockPayloadWithIndustryBenchmarks } = await import("@/lib/stockIndustryBenchmarkEnrichment");
      return enrichStockPayloadWithIndustryBenchmarks(payload);
    },
  };
}

async function withLaneDeadline<T>(lane: "price" | "chart" | "score", promise: Promise<T | undefined> | undefined): Promise<T | undefined> {
  if (!promise) return undefined;
  const timeoutMs = displayLaneTimeoutMs(lane);
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function startDisplayLane<T>(source: () => Promise<T | undefined> | undefined): Promise<T | undefined> | undefined {
  try {
    return source();
  } catch {
    return Promise.resolve(undefined);
  }
}

export function displayLaneTimeoutMs(lane: "price" | "chart" | "score"): number {
  if (lane === "price") return numericEnv("STOCK_DISPLAY_PRICE_LANE_TIMEOUT_MS", 900);
  if (lane === "chart") return numericEnv("STOCK_DISPLAY_CHART_LANE_TIMEOUT_MS", 1_000);
  if (process.env.STOCK_DISPLAY_SCORE_LANE_TIMEOUT_MS?.trim()) {
    return numericEnv("STOCK_DISPLAY_SCORE_LANE_TIMEOUT_MS", partialStockScoreTimeoutMs("detail"));
  }
  return partialStockScoreTimeoutMs("detail");
}
