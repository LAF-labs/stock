import { formatCurrencyAmount } from "@/lib/format";
import { fetchWithTimeout } from "@/lib/supabaseRest";
import { parseTickerRef } from "@/lib/tickerRef";
import type { KisDailyChartBar, KisDailyChartPayload } from "@/lib/kisQuoteClient";
import type { StockPayload } from "@/lib/stockScoreContract";

type TossConfig = {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
};

type TossToken = {
  accessToken: string;
  expiresAtMs: number;
};

type TossStock = {
  symbol?: unknown;
  name?: unknown;
  englishName?: unknown;
  market?: unknown;
  currency?: unknown;
  sharesOutstanding?: unknown;
};

type TossPrice = {
  symbol?: unknown;
  timestamp?: unknown;
  lastPrice?: unknown;
  currency?: unknown;
};

type TossCandle = {
  timestamp?: unknown;
  openPrice?: unknown;
  highPrice?: unknown;
  lowPrice?: unknown;
  closePrice?: unknown;
  volume?: unknown;
  currency?: unknown;
};

declare global {
  var __tossInvestTokenCache: Map<string, TossToken> | undefined;
  var __tossInvestTokenInflight: Map<string, Promise<TossToken>> | undefined;
}

const tokenCache = (globalThis.__tossInvestTokenCache ??= new Map<string, TossToken>());
const tokenInflight = (globalThis.__tossInvestTokenInflight ??= new Map<string, Promise<TossToken>>());

export function tossInvestConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return !!((env.TOSS_INVEST_CLIENT_ID || env.TOSS_INVEST_API_KEY) && (env.TOSS_INVEST_CLIENT_SECRET || env.TOSS_INVEST_SECRET_KEY));
}

export async function fetchTossQuote(tickerRef: string): Promise<StockPayload> {
  const { market, symbol, ticker } = parseTickerRef(tickerRef);
  const [stock, price] = await Promise.all([fetchTossStock(symbol), fetchTossPrice(symbol)]);
  const currency = text(price.currency) || text(stock.currency) || (market === "KR" ? "KRW" : "USD");
  const latestPrice = decimal(price.lastPrice);
  const shares = decimal(stock.sharesOutstanding);
  const marketCap = latestPrice !== undefined && shares !== undefined ? latestPrice * shares : undefined;
  const latestDate = dateOnly(price.timestamp);
  const name = text(stock.name) || text(stock.englishName) || symbol;
  const exchange = text(stock.market) || (market === "KR" ? "KR" : "US");

  return {
    ok: true,
    type: "quote",
    requested_ticker: ticker,
    market,
    symbol,
    name,
    exchange,
    currency,
    latest_price: latestPrice,
    latest_price_label: formatCurrencyAmount(latestPrice, currency),
    latest_bar_date: latestDate,
    market_cap: marketCap,
    market_cap_label: formatCurrencyAmount(marketCap, currency),
    price_metrics: {
      price: latestPrice,
      market_cap: marketCap,
    },
    fetch: {
      source: "market_data",
      provider: "toss_invest",
      price_endpoint: "/api/v1/prices",
      stock_endpoint: "/api/v1/stocks",
      fetched_at: new Date().toISOString(),
      cache: "server",
    },
  };
}

export async function fetchTossDailyChart(tickerRef: string): Promise<KisDailyChartPayload> {
  const { market, symbol, ticker } = parseTickerRef(tickerRef);
  const [stock, candles] = await Promise.all([fetchTossStock(symbol), fetchTossCandles(symbol)]);
  const currency = text(stock.currency) || (market === "KR" ? "KRW" : "USD");
  const chartSeries = candlesToBars(candles, currency);
  if (!chartSeries.length) throw new Error(`${ticker} Toss daily chart was empty.`);
  const latest = chartSeries.at(-1);
  const shares = decimal(stock.sharesOutstanding);
  const marketCap = latest?.close !== undefined && shares !== undefined ? latest.close * shares : undefined;

  return {
    requestedTicker: ticker,
    market,
    symbol,
    name: text(stock.name) || text(stock.englishName) || symbol,
    exchange: text(stock.market) || (market === "KR" ? "KR" : "US"),
    currency,
    latestPrice: latest?.close,
    latestDate: latest?.date,
    chartSeries,
    priceMetrics: {
      price: latest?.close,
      previous_close: chartSeries.at(-2)?.close,
      market_cap: marketCap,
    },
    fetch: {
      source: "market_data",
      provider: "toss_invest",
      provider_mode: "technical_request_fast_path",
      daily_price_endpoint: "/api/v1/candles",
      stock_endpoint: "/api/v1/stocks",
      history_rows: chartSeries.length,
      fetched_at: new Date().toISOString(),
      cache: "no-store",
    },
  };
}

async function fetchTossStock(symbol: string): Promise<TossStock> {
  const result = await tossGetArray<TossStock>("/api/v1/stocks", { symbols: symbol });
  const stock = result.find((item) => text(item.symbol)?.toUpperCase() === symbol.toUpperCase()) || result[0];
  if (!stock) throw new Error(`${symbol} Toss stock info was empty.`);
  return stock;
}

async function fetchTossPrice(symbol: string): Promise<TossPrice> {
  const result = await tossGetArray<TossPrice>("/api/v1/prices", { symbols: symbol });
  const price = result.find((item) => text(item.symbol)?.toUpperCase() === symbol.toUpperCase()) || result[0];
  if (!price) throw new Error(`${symbol} Toss price was empty.`);
  return price;
}

async function fetchTossCandles(symbol: string): Promise<TossCandle[]> {
  const payload = await tossGet<{ candles?: TossCandle[] }>("/api/v1/candles", {
    symbol,
    interval: "1d",
    count: "200",
    adjusted: "true",
  });
  return Array.isArray(payload.candles) ? payload.candles : [];
}

async function tossGetArray<T>(path: string, params: Record<string, string>): Promise<T[]> {
  const result = await tossGet<T[]>(path, params);
  return Array.isArray(result) ? result : [];
}

async function tossGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const config = tossConfig();
  const url = new URL(`${config.baseUrl}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetchWithTimeout(
    url.toString(),
    {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${await tossAccessToken(config)}`,
      },
      cache: "no-store",
    },
    12_000
  );
  const payload = (await response.json().catch(() => undefined)) as { result?: T; error?: { message?: string; code?: string } } | undefined;
  if (!response.ok || !payload || payload.result === undefined) {
    throw new Error(text(payload?.error?.message) || text(payload?.error?.code) || `Toss HTTP ${response.status}`);
  }
  return payload.result;
}

async function tossAccessToken(config: TossConfig): Promise<string> {
  const cacheKey = `${config.baseUrl}:${config.clientId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAtMs > Date.now() + 60_000) return cached.accessToken;

  const existing = tokenInflight.get(cacheKey);
  if (existing) return (await existing).accessToken;

  const promise = issueTossAccessToken(config);
  tokenInflight.set(cacheKey, promise);
  try {
    const token = await promise;
    tokenCache.set(cacheKey, token);
    return token.accessToken;
  } finally {
    if (tokenInflight.get(cacheKey) === promise) tokenInflight.delete(cacheKey);
  }
}

async function issueTossAccessToken(config: TossConfig): Promise<TossToken> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });
  const response = await fetchWithTimeout(
    `${config.baseUrl}/oauth2/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
    },
    12_000
  );
  const payload = (await response.json().catch(() => undefined)) as { access_token?: unknown; expires_in?: unknown; error_description?: unknown } | undefined;
  const accessToken = text(payload?.access_token);
  if (!response.ok || !accessToken) {
    throw new Error(text(payload?.error_description) || `Toss token HTTP ${response.status}`);
  }
  const expiresIn = decimal(payload?.expires_in) ?? 3600;
  return { accessToken, expiresAtMs: Date.now() + expiresIn * 1000 };
}

function tossConfig(): TossConfig {
  const clientId = process.env.TOSS_INVEST_CLIENT_ID?.trim() || process.env.TOSS_INVEST_API_KEY?.trim();
  const clientSecret = process.env.TOSS_INVEST_CLIENT_SECRET?.trim() || process.env.TOSS_INVEST_SECRET_KEY?.trim();
  if (!clientId || !clientSecret) throw new Error("Toss Invest API credentials are not configured.");
  return {
    clientId,
    clientSecret,
    baseUrl: (process.env.TOSS_INVEST_API_BASE?.trim() || "https://openapi.tossinvest.com").replace(/\/$/, ""),
  };
}

function candlesToBars(candles: TossCandle[], fallbackCurrency: string): KisDailyChartBar[] {
  const sorted = [...candles].sort((left, right) => String(left.timestamp || "").localeCompare(String(right.timestamp || "")));
  const bars: KisDailyChartBar[] = [];
  for (const candle of sorted) {
    const close = decimal(candle.closePrice);
    const date = dateOnly(candle.timestamp);
    if (close === undefined || !date) continue;
    const currency = text(candle.currency) || fallbackCurrency;
    const open = decimal(candle.openPrice) ?? close;
    const high = decimal(candle.highPrice) ?? Math.max(open, close);
    const low = decimal(candle.lowPrice) ?? Math.min(open, close);
    const volume = decimal(candle.volume);
    const previousClose = bars.at(-1)?.close;
    bars.push({
      date,
      open,
      high,
      low,
      close,
      volume: volume === undefined ? undefined : Math.trunc(volume),
      currency,
      open_label: formatCurrencyAmount(open, currency),
      high_label: formatCurrencyAmount(high, currency),
      low_label: formatCurrencyAmount(low, currency),
      close_label: formatCurrencyAmount(close, currency),
      ohl_label: `${formatCurrencyAmount(open, currency)} / ${formatCurrencyAmount(high, currency)} / ${formatCurrencyAmount(low, currency)}`,
      volume_label: volume === undefined ? "-" : Math.trunc(volume).toLocaleString("ko-KR"),
      change_pct: previousClose ? roundRatio(close / previousClose - 1) : undefined,
      change_label: previousClose ? pct(roundRatio(close / previousClose - 1)) : undefined,
      range_pct: open ? roundRatio((high - low) / open) : undefined,
      range_label: open ? pct(roundRatio((high - low) / open)) : undefined,
    });
  }
  return bars;
}

function decimal(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  return String(value).trim() || undefined;
}

function dateOnly(value: unknown): string | undefined {
  const raw = text(value);
  return raw && /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : undefined;
}

function roundRatio(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function pct(value: number | undefined): string | undefined {
  return value === undefined ? undefined : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}
