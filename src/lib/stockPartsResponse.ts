import { getStockChart, type StockChartResult } from "@/lib/stockChartCache";
import { getStockQuote, type StockQuoteResult } from "@/lib/stockQuoteCache";
import type { StockPendingPayload } from "@/lib/stockPendingResponse";
import type { ScoreView, StockPayload, StockScoreResult } from "@/lib/stockSnapshotCache";

export type StockPartName = "identity" | "quote" | "chart" | "score" | "technical" | "fundamentals";
export type StockPartState = "fresh" | "stale" | "pending" | "miss" | "unavailable";

export type StockPartStatus = {
  state: StockPartState;
  source?: string;
  fetched_at?: string;
  expires_at?: string;
  stale_expires_at?: string;
  last_bar_date?: string;
  refresh_started?: boolean;
  refresh_error?: string;
  job_id?: string;
  status?: string;
  reason?: string;
};

export type StockParts = Partial<Record<StockPartName, StockPartStatus>>;

export function attachScoreParts(result: StockScoreResult): StockPayload {
  const parts: StockParts = {
    ...partsFromPayload(result.payload),
  };
  const scorePart = partFromScoreResult(result);
  if (result.cache.view === "technical") {
    parts.technical = scorePart;
    if (Array.isArray(result.payload.chart_series)) parts.chart = scorePart;
  } else {
    parts.score = scorePart;
  }
  return attachParts(result.payload, parts);
}

export function attachQuoteParts(result: StockQuoteResult): StockPayload {
  return attachParts(result.payload, {
    ...partsFromPayload(result.payload),
    quote: partFromQuoteResult(result),
  });
}

export function attachChartParts(result: StockChartResult): StockPayload {
  return attachParts(result.payload, {
    ...partsFromPayload(result.payload),
    chart: partFromChartResult(result),
  });
}

export function attachChartPartToPayload(payload: StockPayload, result: StockChartResult): StockPayload {
  const chartSeries = Array.isArray(result.payload.chart_series) ? result.payload.chart_series : undefined;
  return attachParts(
    {
      ...payload,
      chart_series: Array.isArray(payload.chart_series) && payload.chart_series.length ? payload.chart_series : chartSeries,
    },
    {
      ...partsFromPayload(payload),
      chart: partFromChartResult(result),
    }
  );
}

export async function pendingPartialStockPayload({
  pending,
  ticker,
  view,
}: {
  pending: StockPendingPayload;
  ticker: string;
  view?: ScoreView;
}): Promise<StockPayload | undefined> {
  const parts: StockParts = pendingParts(pending, view);
  let quote: StockPayload | undefined;
  let chart: StockPayload | undefined;

  try {
    const quoteResult = await getStockQuote(ticker);
    quote = attachQuoteParts(quoteResult);
    parts.quote = partFromQuoteResult(quoteResult);
  } catch {
    // Partial responses are best effort; the original pending payload remains the fallback.
  }

  try {
    const chartResult = await getStockChart(ticker);
    chart = attachChartParts(chartResult);
    parts.chart = partFromChartResult(chartResult);
  } catch {
    // Missing chart should not hide a ready quote.
  }

  if (!quote && !chart) return undefined;

  const identitySource = quote || chart || {};
  return attachParts(
    {
      ok: true,
      type: "partial_stock_snapshot",
      ticker,
      requested_ticker: ticker,
      market: stringField(identitySource.market),
      symbol: stringField(identitySource.symbol),
      name: stringField(identitySource.name),
      exchange: stringField(identitySource.exchange),
      currency: stringField(identitySource.currency),
      quote,
      chart,
      chart_series: Array.isArray(chart?.chart_series) ? chart?.chart_series : undefined,
      pending_snapshot: pending,
    },
    parts
  );
}

function attachParts(payload: StockPayload, parts: StockParts): StockPayload {
  return {
    ...payload,
    parts,
  };
}

function partsFromPayload(payload: StockPayload): StockParts {
  const existing = payload.parts;
  return existing && typeof existing === "object" && !Array.isArray(existing) ? (existing as StockParts) : {};
}

function partFromScoreResult(result: StockScoreResult): StockPartStatus {
  return compactPart({
    state: result.cache.state,
    source: result.cache.source,
    fetched_at: result.cache.fetchedAt,
    expires_at: result.cache.expiresAt,
    refresh_started: result.cache.refreshStarted,
    refresh_error: result.cache.refreshError,
  });
}

function partFromQuoteResult(result: StockQuoteResult): StockPartStatus {
  return compactPart({
    state: result.cache.state,
    source: result.cache.source,
    fetched_at: result.cache.fetchedAt,
    expires_at: result.cache.expiresAt,
    stale_expires_at: result.cache.staleExpiresAt,
    refresh_started: result.cache.refreshStarted,
    refresh_error: result.cache.refreshError,
  });
}

function partFromChartResult(result: StockChartResult): StockPartStatus {
  return compactPart({
    state: result.cache.state,
    source: result.cache.source,
    fetched_at: result.cache.fetchedAt,
    expires_at: result.cache.expiresAt,
    stale_expires_at: result.cache.staleExpiresAt,
    last_bar_date: result.cache.lastBarDate,
    refresh_started: result.cache.refreshStarted,
    refresh_error: result.cache.refreshError,
  });
}

function pendingParts(pending: StockPendingPayload, view?: ScoreView): StockParts {
  const status = compactPart({
    state: "pending",
    job_id: pending.refresh_request.job_id,
    status: pending.refresh_request.status,
    reason: pending.reason,
  });
  if (pending.kind === "quote") return { quote: status };
  if (pending.kind === "chart") return { chart: status };
  if (pending.kind === "score" && view === "technical") return { technical: status };
  return { score: status };
}

function compactPart(part: StockPartStatus): StockPartStatus {
  return Object.fromEntries(Object.entries(part).filter(([, value]) => value !== undefined)) as StockPartStatus;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
