import { getStockChart, type StockChartResult } from "@/lib/stockChartCache";
import { getStockQuote, type StockQuoteResult } from "@/lib/stockQuoteCache";
import type { StockPendingPayload } from "@/lib/stockPendingResponse";
import type { ScoreView, StockPayload, StockScoreResult } from "@/lib/stockScoreContract";
import type { StockDisplayUnavailablePart } from "@/lib/stockDisplayTypes";
import { numericEnv } from "@/lib/supabaseRest";
import { findExactLocalSymbol } from "@/lib/symbolSearch";

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

type PendingPartialReadyPart =
  | { kind: "quote"; status: "fulfilled"; value: StockQuoteResult }
  | { kind: "quote"; status: "rejected" }
  | { kind: "chart"; status: "fulfilled"; value: StockChartResult }
  | { kind: "chart"; status: "rejected" };

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

  const readyParts: PendingPartialReadyPart[] = [];
  const quotePromise = trackReadyPart(readyParts, "quote", getStockQuote(ticker));
  const chartPromise = trackReadyPart(
    readyParts,
    "chart",
    getStockChart(ticker, { enqueueOnMiss: false, enqueueStaleRefresh: false })
  );
  const partsPromise = Promise.all([quotePromise, chartPromise]);
  const identity = await localIdentityPayload(ticker);

  if (identity) {
    await waitForPendingPartialParts(partsPromise);
  } else {
    await partsPromise;
  }

  void partsPromise.catch(() => undefined);

  for (const readyPart of readyParts) {
    if (readyPart.kind === "quote" && readyPart.status === "fulfilled") {
      quote = attachQuoteParts(readyPart.value);
      parts.quote = partFromQuoteResult(readyPart.value);
    }

    if (readyPart.kind === "chart" && readyPart.status === "fulfilled") {
      chart = attachChartParts(readyPart.value);
      parts.chart = partFromChartResult(readyPart.value);
    }
  }

  const identityPayload = identity || quote || chart;
  if (!identityPayload) return undefined;
  if (!quote && !chart) {
    parts.identity = { state: "fresh", source: "symbol_master" };
  }

  const identitySource = identityPayload;
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
      display_name: stringField(identitySource.display_name),
      korean_name: stringField(identitySource.korean_name),
      english_name: stringField(identitySource.english_name),
      instrument_type: stringField(identitySource.instrument_type),
      quote,
      chart,
      chart_series: Array.isArray(chart?.chart_series) ? chart?.chart_series : undefined,
      pending_snapshot: pending,
    },
    parts
  );
}

export async function terminalUnavailableStockPayload({
  ticker,
  view,
  unavailableParts,
}: {
  ticker: string;
  view?: ScoreView;
  unavailableParts: StockDisplayUnavailablePart[];
}): Promise<StockPayload | undefined> {
  const identity = await localIdentityPayload(ticker);
  if (!identity) return undefined;
  const parts = terminalUnavailableParts(unavailableParts, view);
  return attachParts(
    {
      ok: true,
      type: "partial_stock_snapshot",
      ticker,
      requested_ticker: ticker,
      market: stringField(identity.market),
      symbol: stringField(identity.symbol),
      name: stringField(identity.name),
      exchange: stringField(identity.exchange),
      currency: stringField(identity.currency),
      display_name: stringField(identity.display_name),
      korean_name: stringField(identity.korean_name),
      english_name: stringField(identity.english_name),
      instrument_type: stringField(identity.instrument_type),
      server_cache: {
        state: "unavailable",
        source: "terminal_failure",
        refresh_started: false,
        recovering_parts: [],
        unavailable_parts: unavailableParts.map((item) => item.part),
      },
    },
    {
      identity: { state: "fresh", source: "symbol_master" },
      ...parts,
    }
  );
}

async function trackReadyPart(
  readyParts: PendingPartialReadyPart[],
  kind: "quote",
  promise: Promise<StockQuoteResult>
): Promise<void>;
async function trackReadyPart(
  readyParts: PendingPartialReadyPart[],
  kind: "chart",
  promise: Promise<StockChartResult>
): Promise<void>;
async function trackReadyPart(
  readyParts: PendingPartialReadyPart[],
  kind: "quote" | "chart",
  promise: Promise<StockQuoteResult> | Promise<StockChartResult>
): Promise<void> {
  try {
    const value = await promise;
    if (kind === "quote") {
      readyParts.push({ kind, status: "fulfilled", value: value as StockQuoteResult });
    } else {
      readyParts.push({ kind, status: "fulfilled", value: value as StockChartResult });
    }
  } catch {
    readyParts.push({ kind, status: "rejected" });
  }
}

async function waitForPendingPartialParts(partsPromise: Promise<unknown>): Promise<void> {
  const timeoutMs = numericEnv("STOCK_PENDING_PARTIAL_PARTS_TIMEOUT_MS", 120);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      partsPromise,
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, timeoutMs);
        unrefTimer(timeout);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function unrefTimer(timeout: ReturnType<typeof setTimeout>) {
  if (typeof timeout === "object" && timeout && "unref" in timeout && typeof timeout.unref === "function") {
    timeout.unref();
  }
}

async function localIdentityPayload(ticker: string): Promise<StockPayload | undefined> {
  const item = await findExactLocalSymbol(ticker);
  if (!item) return undefined;
  return {
    market: item.market,
    symbol: item.ticker,
    name: item.displayName || item.koreanName || item.englishName,
    exchange: item.exchangeName || item.exchange,
    currency: item.currency,
    display_name: item.displayName,
    korean_name: item.koreanName || undefined,
    english_name: item.englishName || undefined,
    instrument_type: item.instrumentType,
  };
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

function terminalUnavailableParts(unavailableParts: StockDisplayUnavailablePart[], view?: ScoreView): StockParts {
  const status = compactPart({
    state: "unavailable",
    source: "provider",
    reason: "provider_confirmed_empty",
    refresh_started: false,
  });
  const parts: StockParts = {};
  for (const item of unavailableParts) {
    if (item.reason !== "provider_confirmed_empty") continue;
    if (item.part === "price") parts.quote = status;
    if (item.part === "chart") parts.chart = status;
    if (item.part === "technical" || (item.part === "score" && view === "technical")) parts.technical = status;
    if (item.part === "score" && view !== "technical") parts.score = status;
    if (item.part === "fundamentals") parts.fundamentals = status;
  }
  return parts;
}

function compactPart(part: StockPartStatus): StockPartStatus {
  return Object.fromEntries(Object.entries(part).filter(([, value]) => value !== undefined)) as StockPartStatus;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
