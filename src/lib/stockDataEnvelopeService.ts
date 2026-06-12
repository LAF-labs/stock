import { chartPartFromPayload, pricePartFromPayload, scorePartFromPayload } from "@/lib/stockDataEnvelopeAdapters";
import { readyPart, unavailablePart, type PartState } from "@/lib/stockPartState";
import { partialStockScoreTimeoutMs } from "@/lib/stockScorePartialFastPath";
import { isProviderConfirmedEmptyError } from "@/lib/stockProviderErrors";
import { numericEnv } from "@/lib/supabaseRest";
import { normalizeTickerRef, parseTickerRef } from "@/lib/tickerRef";
import type { StockDataEnvelope } from "@/lib/stockDataEnvelopeTypes";
import type {
  StockChartView,
  StockDisplayPartName,
  StockDisplayUnavailablePart,
  StockDisplayView,
  StockIdentityView,
  StockPriceView,
  StockScoreView,
} from "@/lib/stockDisplayTypes";

export type StockDataEnvelopeSourceResult<T extends Record<string, unknown>> = T | undefined;

export type StockDataEnvelopeSources = {
  identity?: (ticker: string) => Promise<StockIdentityView | undefined>;
  price?: (ticker: string) => Promise<StockDataEnvelopeSourceResult<StockPriceView>>;
  chart?: (ticker: string) => Promise<StockDataEnvelopeSourceResult<StockChartView>>;
  score?: (ticker: string, view: StockDisplayView) => Promise<StockDataEnvelopeSourceResult<StockScoreView>>;
  terminalFailures?: (ticker: string, view: StockDisplayView) => Promise<StockDisplayUnavailablePart[]>;
};

export type BuildStockDataEnvelopeInput = {
  ticker: string;
  view: StockDisplayView;
  sources: StockDataEnvelopeSources;
  now?: Date;
};

export async function buildStockDataEnvelope(input: BuildStockDataEnvelopeInput): Promise<StockDataEnvelope> {
  const ticker = normalizeTickerRef(input.ticker);
  const now = input.now ?? new Date();
  const generatedAt = now.toISOString();
  const identityPromise = loadIdentity(ticker, input.sources);
  const pricePromise = withLaneDeadline("price", startDisplayLane(() => input.sources.price?.(ticker)));
  const chartPromise = withLaneDeadline("chart", startDisplayLane(() => input.sources.chart?.(ticker)));
  const scorePromise = withLaneDeadline("score", startDisplayLane(() => input.sources.score?.(ticker, input.view)));
  const terminalFailuresPromise = withDeadline(
    startDisplayLane(() => input.sources.terminalFailures?.(ticker, input.view)),
    terminalFailureLaneTimeoutMs(),
  );

  const [identityResult, priceResult, chartResult, scoreResult, terminalFailuresResult] = await Promise.allSettled([
    identityPromise,
    pricePromise,
    chartPromise,
    scorePromise,
    terminalFailuresPromise,
  ]);

  const identity = fulfilledValue(identityResult) ?? fallbackIdentity(ticker);
  const score = fulfilledValue(scoreResult);
  const price = fulfilledValue(priceResult) ?? priceFromScore(score);
  const chart = fulfilledValue(chartResult) ?? chartFromScore(score);
  const parts: StockDataEnvelope["parts"] = {
    identity: readyPart(identity, "symbol-master", generatedAt),
    ...(price ? { price: pricePartFromPayload(price) ?? readyPart(price, "derived", generatedAt) } : {}),
    ...(chart ? { chart: chartPartFromPayload(chart) ?? readyPart(chart, "derived", generatedAt) } : {}),
    ...(score ? { score: scorePartFromPayload(score) ?? readyPart(score, "derived", generatedAt) } : {}),
  };

  applyUnavailableParts(parts, uniqueUnavailableParts([
    ...unavailablePartsFromLaneResults({ priceResult, chartResult, scoreResult }, input.view),
    ...(fulfilledValue(terminalFailuresResult) || []),
  ]), generatedAt);

  return {
    ticker,
    requestedTicker: input.ticker,
    view: input.view,
    generatedAt,
    hotnessTier: "active",
    parts,
  };
}

export function displayLaneTimeoutMs(lane: "price" | "chart" | "score"): number {
  if (lane === "price") return numericEnv("STOCK_DISPLAY_PRICE_LANE_TIMEOUT_MS", 900);
  if (lane === "chart") return numericEnv("STOCK_DISPLAY_CHART_LANE_TIMEOUT_MS", 1_000);
  if (process.env.STOCK_DISPLAY_SCORE_LANE_TIMEOUT_MS?.trim()) {
    return numericEnv("STOCK_DISPLAY_SCORE_LANE_TIMEOUT_MS", partialStockScoreTimeoutMs("detail"));
  }
  return partialStockScoreTimeoutMs("detail");
}

export function fallbackIdentity(tickerRef: string): StockIdentityView {
  const parsed = parseTickerRef(tickerRef);
  return {
    ticker: parsed.ticker,
    market: parsed.market,
    symbol: parsed.symbol,
    name: parsed.symbol,
  };
}

async function loadIdentity(ticker: string, sources: StockDataEnvelopeSources): Promise<StockIdentityView> {
  const fromSource = await sources.identity?.(ticker).catch(() => undefined);
  if (fromSource) return fromSource;
  return fallbackIdentity(ticker);
}

function applyUnavailableParts(
  parts: StockDataEnvelope["parts"],
  unavailableParts: StockDisplayUnavailablePart[],
  checkedAt: string,
): void {
  const mutable = parts as Partial<Record<StockDisplayPartName, PartState<Record<string, unknown>>>>;
  for (const item of unavailableParts) {
    if (mutable[item.part]) continue;
    mutable[item.part] = unavailablePart(item.reason, checkedAt);
  }
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

function uniqueUnavailableParts(parts: StockDisplayUnavailablePart[]): StockDisplayUnavailablePart[] {
  const seen = new Set<string>();
  return parts.filter((part) => {
    const key = `${part.part}:${part.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function withLaneDeadline<T>(lane: "price" | "chart" | "score", promise: Promise<T | undefined> | undefined): Promise<T | undefined> {
  return withDeadline(promise, displayLaneTimeoutMs(lane));
}

async function withDeadline<T>(promise: Promise<T | undefined> | undefined, timeoutMs: number): Promise<T | undefined> {
  if (!promise) return undefined;
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

function terminalFailureLaneTimeoutMs(): number {
  return numericEnv("STOCK_DISPLAY_TERMINAL_FAILURE_TIMEOUT_MS", 700);
}
