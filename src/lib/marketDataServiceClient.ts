import { fetchWithTimeout, numericEnv } from "@/lib/supabaseRest";
import { isCurrentScoreModelPayload } from "@/lib/scoreModel";
import { KIS_DOMESTIC_EXCHANGE_LABEL } from "@/lib/quoteContract";
import { parseTickerRef, type ParsedTickerRef } from "@/lib/tickerRef";
import type { StockQuoteResult } from "@/lib/stockQuoteCache";
import type { ScoreView, StockPayload, StockScoreResult } from "@/lib/stockScoreContract";

type MarketDataServiceResponse = {
  ok?: unknown;
  data?: unknown;
  server_cache?: unknown;
};

export type MarketDataServiceFeature = "quote" | "score";

export type MarketDataServiceFallbackReason =
  | "service_disabled"
  | "feature_disabled"
  | "config_missing"
  | "localhost_blocked"
  | "technical_score_unsupported"
  | "timeout"
  | "network_error"
  | "http_error"
  | "invalid_json"
  | "invalid_response"
  | "invalid_payload"
  | "queued"
  | "stale_score_model";

export type MarketDataServiceFailure = {
  ok: false;
  feature: MarketDataServiceFeature;
  reason: MarketDataServiceFallbackReason;
  ticker?: string;
  view?: ScoreView;
  status?: number;
  forceRefresh: boolean;
};

export type MarketDataServiceAttempt<T> = { ok: true; result: T } | MarketDataServiceFailure;

export type MarketDataServiceConfig = {
  url: string;
  token: string;
  timeoutMs: number;
};

export function marketDataServiceConfig(): MarketDataServiceConfig | undefined {
  const resolved = resolveMarketDataServiceConfig();
  return resolved.ok ? resolved.config : undefined;
}

function resolveMarketDataServiceConfig(): { ok: true; config: MarketDataServiceConfig } | { ok: false; reason: "service_disabled" | "config_missing" | "localhost_blocked" } {
  if (process.env.MARKET_DATA_SERVICE_ENABLED === "0") return { ok: false, reason: "service_disabled" };
  const url = process.env.MARKET_DATA_SERVICE_URL?.trim().replace(/\/$/, "");
  const token = process.env.MARKET_DATA_INTERNAL_TOKEN?.trim();
  if (!url || !token) return { ok: false, reason: "config_missing" };
  if (process.env.VERCEL === "1" && isLocalServiceUrl(url) && process.env.MARKET_DATA_ALLOW_LOCALHOST_ON_VERCEL !== "1") {
    return { ok: false, reason: "localhost_blocked" };
  }
  return { ok: true, config: { url, token, timeoutMs: numericEnv("MARKET_DATA_SERVICE_TIMEOUT_MS", 1_500) } };
}

function marketDataServiceFeatureEnabled(feature: MarketDataServiceFeature): boolean {
  if (feature === "quote") return process.env.MARKET_DATA_SERVICE_ENABLE_QUOTE !== "0";
  return process.env.MARKET_DATA_SERVICE_ENABLE_SCORE === "1";
}

function isLocalServiceUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

export async function getMarketDataServiceQuote(
  tickerRef: string,
  options: { forceRefresh?: boolean } = {}
): Promise<StockQuoteResult | undefined> {
  const attempt = await getMarketDataServiceQuoteAttempt(tickerRef, options);
  if (attempt.ok) return attempt.result;
  logMarketDataServiceFallback(attempt);
  return undefined;
}

export async function getMarketDataServiceQuoteAttempt(
  tickerRef: string,
  options: { forceRefresh?: boolean } = {}
): Promise<MarketDataServiceAttempt<StockQuoteResult>> {
  const ticker = parseTickerRef(tickerRef);
  const setup = marketDataServiceSetup("quote", ticker, undefined, options.forceRefresh);
  if (!setup.ok) return setup;

  const refresh = options.forceRefresh ? "?refresh=1" : "";
  const call = await callMarketDataService(
    setup.config,
    `/v1/quote/${ticker.market.toLowerCase()}/${encodeURIComponent(ticker.symbol)}${refresh}`
  );
  if (!call.ok) return serviceFailure("quote", ticker, undefined, call.reason, options.forceRefresh, call.status);
  if (call.response.ok !== true || !isRecord(call.response.data)) {
    return serviceFailure("quote", ticker, undefined, "invalid_response", options.forceRefresh);
  }

  const result = adaptQuoteResponse(ticker, call.response.data, call.response.server_cache);
  return result ? { ok: true, result } : serviceFailure("quote", ticker, undefined, "invalid_payload", options.forceRefresh);
}

export async function getMarketDataServiceScore(
  tickerRef: string,
  view: ScoreView,
  options: { forceRefresh?: boolean } = {}
): Promise<StockScoreResult | undefined> {
  const attempt = await getMarketDataServiceScoreAttempt(tickerRef, view, options);
  if (attempt.ok) return attempt.result;
  logMarketDataServiceFallback(attempt);
  return undefined;
}

export async function getMarketDataServiceScoreAttempt(
  tickerRef: string,
  view: ScoreView,
  options: { forceRefresh?: boolean } = {}
): Promise<MarketDataServiceAttempt<StockScoreResult>> {
  const ticker = parseTickerRef(tickerRef);
  if (!marketDataServiceFeatureEnabled("score")) {
    return serviceFailure("score", ticker, view, "feature_disabled", options.forceRefresh);
  }
  if (view === "technical") {
    return serviceFailure("score", ticker, view, "technical_score_unsupported", options.forceRefresh);
  }
  const setup = marketDataServiceSetup("score", ticker, view, options.forceRefresh);
  if (!setup.ok) return setup;

  const query = new URLSearchParams({ view });
  if (options.forceRefresh) query.set("refresh", "1");
  const call = await callMarketDataService(
    setup.config,
    `/v1/score/${ticker.market.toLowerCase()}/${encodeURIComponent(ticker.symbol)}?${query}`
  );
  if (!call.ok) return serviceFailure("score", ticker, view, call.reason, options.forceRefresh, call.status);
  if (call.response.ok !== true || !isRecord(call.response.data)) {
    return serviceFailure("score", ticker, view, "invalid_response", options.forceRefresh);
  }
  if (stringField(call.response.data, "status") === "queued") {
    return serviceFailure("score", ticker, view, "queued", options.forceRefresh);
  }
  if (typeof call.response.data.score !== "number" || !Number.isFinite(call.response.data.score)) {
    return serviceFailure("score", ticker, view, "invalid_payload", options.forceRefresh);
  }
  if (!isCurrentScoreModelPayload(call.response.data)) {
    return serviceFailure("score", ticker, view, "stale_score_model", options.forceRefresh);
  }
  return { ok: true, result: adaptScoreResponse(ticker, view, call.response.data as StockPayload, call.response.server_cache) };
}

async function callMarketDataService(
  config: MarketDataServiceConfig,
  path: string
): Promise<{ ok: true; response: MarketDataServiceResponse } | { ok: false; reason: MarketDataServiceFallbackReason; status?: number }> {
  try {
    const response = await fetchWithTimeout(
      `${config.url}${path}`,
      {
        headers: {
          Authorization: `Bearer ${config.token}`,
          Accept: "application/json",
        },
        cache: "no-store",
      },
      config.timeoutMs
    );
    if (!response.ok) return { ok: false, reason: "http_error", status: response.status };
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { ok: false, reason: "invalid_json", status: response.status };
    }
    return isRecord(payload) ? { ok: true, response: payload as MarketDataServiceResponse } : { ok: false, reason: "invalid_response", status: response.status };
  } catch (error) {
    return { ok: false, reason: isAbortError(error) ? "timeout" : "network_error" };
  }
}

function marketDataServiceSetup(
  feature: MarketDataServiceFeature,
  ticker: ParsedTickerRef,
  view: ScoreView | undefined,
  forceRefresh: boolean | undefined
): { ok: true; config: MarketDataServiceConfig } | MarketDataServiceFailure {
  if (!marketDataServiceFeatureEnabled(feature)) {
    return serviceFailure(feature, ticker, view, "feature_disabled", forceRefresh);
  }
  const resolved = resolveMarketDataServiceConfig();
  return resolved.ok ? resolved : serviceFailure(feature, ticker, view, resolved.reason, forceRefresh);
}

function serviceFailure(
  feature: MarketDataServiceFeature,
  ticker: ParsedTickerRef,
  view: ScoreView | undefined,
  reason: MarketDataServiceFallbackReason,
  forceRefresh: boolean | undefined,
  status?: number
): MarketDataServiceFailure {
  return {
    ok: false,
    feature,
    reason,
    ticker: ticker.ticker,
    ...(view ? { view } : {}),
    ...(status === undefined ? {} : { status }),
    forceRefresh: forceRefresh === true,
  };
}

function logMarketDataServiceFallback(failure: MarketDataServiceFailure) {
  if (quietFallbackReason(failure.reason)) return;
  console.warn("market_data_service_fallback", {
    feature: failure.feature,
    reason: failure.reason,
    ticker: failure.ticker,
    ...(failure.view ? { view: failure.view } : {}),
    ...(failure.status === undefined ? {} : { status: failure.status }),
    force_refresh: failure.forceRefresh,
  });
}

function quietFallbackReason(reason: MarketDataServiceFallbackReason): boolean {
  return (
    reason === "service_disabled" ||
    reason === "feature_disabled" ||
    reason === "config_missing" ||
    reason === "localhost_blocked" ||
    reason === "technical_score_unsupported"
  );
}

function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === "AbortError";
}

function adaptQuoteResponse(
  ticker: ParsedTickerRef,
  data: Record<string, unknown>,
  rawCache: unknown
): StockQuoteResult | undefined {
  const latestPrice = numberField(data, "latest_price") ?? numberField(data, "last") ?? numberField(recordField(data, "quote"), "last");
  if (latestPrice === undefined) return undefined;

  const previousClose =
    numberField(data, "previous_close") ?? numberField(data, "base") ?? numberField(recordField(data, "quote"), "previous_close");
  const latestChange = previousClose && previousClose !== 0 ? latestPrice / previousClose - 1 : undefined;
  const volume = numberField(data, "volume") ?? numberField(recordField(data, "quote"), "volume");
  const serverCache = serverCachePayload(ticker.ticker, undefined, rawCache);
  const exchange = stringField(data, "exchange") || (ticker.market === "KR" ? KIS_DOMESTIC_EXCHANGE_LABEL : undefined);
  const currency = stringField(data, "currency") || (ticker.market === "KR" ? "KRW" : "USD");
  const payload: StockPayload = {
    ok: true,
    type: "quote",
    requested_ticker: ticker.ticker,
    market: ticker.market,
    symbol: ticker.symbol,
    name: stringField(data, "name") || ticker.symbol,
    exchange,
    exchange_code: exchange,
    currency,
    latest_price: latestPrice,
    previous_close: previousClose,
    latest_change: latestChange,
    volume,
    price_metrics: {
      price: latestPrice,
      previous_close: previousClose,
      latest_change: latestChange,
      volume,
    },
    server_cache: serverCache,
  };

  return {
    payload,
    cache: {
      state: cacheState(rawCache),
      source: "market-data",
      ticker: ticker.ticker,
      fetchedAt: serverCache.fetched_at,
      expiresAt: serverCache.expires_at,
    },
  };
}

function adaptScoreResponse(
  ticker: ParsedTickerRef,
  view: ScoreView,
  data: StockPayload,
  rawCache: unknown
): StockScoreResult {
  const serverCache = serverCachePayload(ticker.ticker, view, rawCache);
  return {
    payload: {
      ...data,
      requested_ticker: data.requested_ticker || ticker.ticker,
      market: data.market || ticker.market,
      symbol: data.symbol || ticker.symbol,
      server_cache: serverCache,
    },
    cache: {
      state: cacheState(rawCache),
      source: "market-data",
      ticker: ticker.ticker,
      view,
      fetchedAt: serverCache.fetched_at,
      expiresAt: serverCache.expires_at,
    },
  };
}

function serverCachePayload(ticker: string, view: ScoreView | undefined, rawCache: unknown) {
  const cache = isRecord(rawCache) ? rawCache : {};
  return {
    state: cacheState(rawCache),
    source: "market-data",
    ticker,
    ...(view ? { view } : {}),
    fetched_at: isoField(cache, "fetched_at") ?? isoMsField(cache, "fetched_at_ms"),
    expires_at: isoField(cache, "expires_at") ?? isoMsField(cache, "expires_at_ms"),
    refresh_started: booleanField(cache, "refresh_started"),
  };
}

function cacheState(rawCache: unknown): "fresh" | "stale" | "miss" {
  const state = isRecord(rawCache) ? rawCache.state : undefined;
  return state === "fresh" || state === "stale" || state === "miss" ? state : "miss";
}

function recordField(value: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const nested = value[key];
  return isRecord(nested) ? nested : undefined;
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  return typeof field === "string" && field.trim() ? field : undefined;
}

function numberField(value: Record<string, unknown> | undefined, key: string): number | undefined {
  const field = value?.[key];
  if (typeof field === "number" && Number.isFinite(field)) return field;
  if (typeof field === "string") {
    const parsed = Number(field.replaceAll(",", ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function booleanField(value: Record<string, unknown>, key: string): boolean | undefined {
  const field = value[key];
  return typeof field === "boolean" ? field : undefined;
}

function isoField(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  if (typeof field !== "string") return undefined;
  return Number.isFinite(Date.parse(field)) ? field : undefined;
}

function isoMsField(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  if (typeof field !== "number" || !Number.isFinite(field)) return undefined;
  return new Date(field).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
