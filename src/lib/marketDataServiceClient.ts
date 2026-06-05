import { fetchWithTimeout, numericEnv } from "@/lib/supabaseRest";
import { isCurrentScoreModelPayload } from "@/lib/scoreModel";
import type { StockQuoteResult } from "@/lib/stockQuoteCache";
import type { ScoreView, StockPayload, StockScoreResult } from "@/lib/stockSnapshotCache";

type MarketCode = "US" | "KR";

type ParsedTicker = {
  ticker: string;
  market: MarketCode;
  symbol: string;
};

type MarketDataServiceResponse = {
  ok?: unknown;
  data?: unknown;
  server_cache?: unknown;
};

export type MarketDataServiceConfig = {
  url: string;
  token: string;
  timeoutMs: number;
};

export function marketDataServiceConfig(): MarketDataServiceConfig | undefined {
  if (process.env.MARKET_DATA_SERVICE_ENABLED === "0") return undefined;
  const url = process.env.MARKET_DATA_SERVICE_URL?.trim().replace(/\/$/, "");
  const token = process.env.MARKET_DATA_INTERNAL_TOKEN?.trim();
  if (!url || !token) return undefined;
  if (process.env.VERCEL === "1" && isLocalServiceUrl(url) && process.env.MARKET_DATA_ALLOW_LOCALHOST_ON_VERCEL !== "1") {
    return undefined;
  }
  return {
    url,
    token,
    timeoutMs: numericEnv("MARKET_DATA_SERVICE_TIMEOUT_MS", 1_500),
  };
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
  const config = marketDataServiceConfig();
  if (!config) return undefined;

  const ticker = parseTicker(tickerRef);
  const refresh = options.forceRefresh ? "?refresh=1" : "";
  const response = await callMarketDataService(
    config,
    `/v1/quote/${ticker.market.toLowerCase()}/${encodeURIComponent(ticker.symbol)}${refresh}`
  );
  if (!response || response.ok !== true || !isRecord(response.data)) return undefined;
  return adaptQuoteResponse(ticker, response.data, response.server_cache);
}

export async function getMarketDataServiceScore(
  tickerRef: string,
  view: ScoreView,
  options: { forceRefresh?: boolean } = {}
): Promise<StockScoreResult | undefined> {
  const config = marketDataServiceConfig();
  if (!config) return undefined;

  const ticker = parseTicker(tickerRef);
  const query = new URLSearchParams({ view });
  if (options.forceRefresh) query.set("refresh", "1");
  const response = await callMarketDataService(
    config,
    `/v1/score/${ticker.market.toLowerCase()}/${encodeURIComponent(ticker.symbol)}?${query}`
  );
  if (!response || response.ok !== true || !isRecord(response.data)) return undefined;
  if (typeof response.data.score !== "number" || !Number.isFinite(response.data.score)) return undefined;
  if (!isCurrentScoreModelPayload(response.data)) return undefined;
  return adaptScoreResponse(ticker, view, response.data as StockPayload, response.server_cache);
}

async function callMarketDataService(
  config: MarketDataServiceConfig,
  path: string
): Promise<MarketDataServiceResponse | undefined> {
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
    if (!response.ok) return undefined;
    const payload = (await response.json()) as unknown;
    return isRecord(payload) ? (payload as MarketDataServiceResponse) : undefined;
  } catch {
    return undefined;
  }
}

function adaptQuoteResponse(
  ticker: ParsedTicker,
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
  const exchange = stringField(data, "exchange") || (ticker.market === "KR" ? "KRX" : undefined);
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
  ticker: ParsedTicker,
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

function parseTicker(value: string): ParsedTicker {
  const raw = value.trim().replace(/^!/, "").toUpperCase();
  const [marketPart, symbolPart] = raw.includes(":") ? raw.split(":", 2) : ["", raw];
  const symbol = (symbolPart || "").replace(/[^A-Z0-9.-]/g, "");
  const market: MarketCode = marketPart === "KR" || (!marketPart && /^(?:\d{6}|Q\d{6})$/.test(symbol)) ? "KR" : "US";
  return {
    ticker: `${market}:${symbol}`,
    market,
    symbol,
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
