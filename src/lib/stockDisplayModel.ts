import { planStockDisplayCompletion } from "@/lib/stockCompletionPlanner";
import { findExactLocalSymbol } from "@/lib/symbolSearch";
import { numericEnv } from "@/lib/supabaseRest";
import { normalizeTickerRef, parseTickerRef } from "@/lib/tickerRef";
import type {
  DisplayPart,
  StockChartView,
  StockDisplayPayload,
  StockDisplayPartName,
  StockDisplayView,
  StockIdentityView,
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

export type BuildStockDisplayPayloadInput = {
  ticker: string;
  view: StockDisplayView;
  sources?: StockDisplaySources;
  now?: Date;
};

export async function buildStockDisplayPayload(input: BuildStockDisplayPayloadInput): Promise<StockDisplayPayload> {
  const ticker = normalizeTickerRef(input.ticker);
  const now = input.now ?? new Date();
  const sources = input.sources ?? defaultDisplaySources();
  const identity = await loadIdentity(ticker, sources);

  const [priceResult, chartResult, scoreResult] = await Promise.allSettled([
    withLaneDeadline("price", sources.price?.(ticker)),
    withLaneDeadline("chart", sources.chart?.(ticker)),
    withLaneDeadline("score", sources.score?.(ticker, input.view)),
  ]);

  const score = fulfilledValue(scoreResult);
  const price = fulfilledValue(priceResult) ?? priceFromScore(score);
  const chart = fulfilledValue(chartResult) ?? chartFromScore(score);
  const technical = technicalFromScore(score);
  const presentParts = presentDisplayParts({ price, chart, score, technical }, input.view);
  const completion = planStockDisplayCompletion({
    ticker,
    view: input.view,
    presentParts,
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
    identity: part(identity, "symbol-master"),
    ...(price ? { price: part(price, "market-data") } : {}),
    ...(chart ? { chart: part(chart, "market-data") } : {}),
    ...(score ? { score: part(score, "derived") } : {}),
    ...(technical ? { technical: part(technical, "derived") } : {}),
    completion,
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

function presentDisplayParts(
  values: {
    price?: StockPriceView;
    chart?: StockChartView;
    score?: StockScoreView;
    technical?: StockTechnicalView;
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
  }
  return parts;
}

function hasUsableChart(chart: StockChartView | undefined): chart is StockChartView {
  return !!chart && Array.isArray(chart.chart_series) && chart.chart_series.length >= 2;
}

function technicalFromScore(score: StockScoreView | undefined): StockTechnicalView | undefined {
  const value = score?.technical_analysis;
  if (value && typeof value === "object" && !Array.isArray(value)) return value as StockTechnicalView;
  return undefined;
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

function fulfilledValue<T>(result: PromiseSettledResult<T | undefined>): T | undefined {
  return result.status === "fulfilled" ? result.value : undefined;
}

async function loadIdentity(ticker: string, sources: StockDisplaySources): Promise<StockIdentityView> {
  const fromSource = await sources.identity?.(ticker).catch(() => undefined);
  if (fromSource) return fromSource;
  return fallbackIdentity(ticker);
}

function part<T>(value: T, source: DisplayPart<T>["source"]): DisplayPart<T> {
  return {
    value,
    freshness: "fresh",
    source,
    fetchedAt: new Date().toISOString(),
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
      const { readStockScoreSnapshotForDisplay } = await import("@/lib/stockScoreSnapshotReader");
      const scoreView = view === "technical" ? "technical" : view === "compare" ? "compare" : "detail";
      const result = await readStockScoreSnapshotForDisplay(ticker, scoreView);
      return result?.payload.ok === false ? undefined : result?.payload;
    },
  };
}

async function withLaneDeadline<T>(lane: "price" | "chart" | "score", promise: Promise<T | undefined> | undefined): Promise<T | undefined> {
  if (!promise) return undefined;
  const timeoutMs = laneTimeoutMs(lane);
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

function laneTimeoutMs(lane: "price" | "chart" | "score"): number {
  if (lane === "price") return numericEnv("STOCK_DISPLAY_PRICE_LANE_TIMEOUT_MS", 1_800);
  if (lane === "chart") return numericEnv("STOCK_DISPLAY_CHART_LANE_TIMEOUT_MS", 2_200);
  return numericEnv("STOCK_DISPLAY_SCORE_LANE_TIMEOUT_MS", 2_500);
}
