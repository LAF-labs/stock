import { formatCurrencyAmount } from "@/lib/format";
import { combineProviderErrors, providerEmptyError } from "@/lib/stockProviderErrors";
import { fetchWithTimeout, numericEnv } from "@/lib/supabaseRest";
import { parseTickerRef } from "@/lib/tickerRef";
import type { KisDailyChartBar, KisDailyChartPayload } from "@/lib/kisQuoteClient";
import type { StockPayload } from "@/lib/stockScoreContract";

type YahooChartResponse = {
  chart?: {
    result?: YahooChartResult[];
    error?: { code?: string; description?: string } | null;
  };
};

type YahooChartResult = {
  meta?: Record<string, unknown>;
  timestamp?: number[];
  indicators?: {
    quote?: Array<Record<string, unknown>>;
  };
};

type YahooFundamentalsResponse = {
  timeseries?: {
    result?: YahooTimeseriesResult[];
    error?: { code?: string; description?: string } | null;
  };
};

type YahooTimeseriesResult = {
  meta?: {
    symbol?: unknown[];
    type?: unknown[];
  };
  timestamp?: number[];
  [key: string]: unknown;
};

export type YahooFundamentalsPayload = {
  requestedTicker: string;
  market: "US" | "KR";
  symbol: string;
  yahooSymbol: string;
  normalized: Record<string, number | string>;
  raw: Record<string, Array<Record<string, unknown>>>;
  fetchedAt: string;
};

const YAHOO_FUNDAMENTAL_TYPES = [
  "trailingTotalRevenue",
  "trailingNetIncome",
  "trailingOperatingIncome",
  "trailingEbitda",
  "trailingPeRatio",
  "trailingPbRatio",
  "trailingBasicEPS",
  "trailingDilutedEPS",
  "quarterlyTotalAssets",
  "quarterlyTotalLiabilitiesNetMinorityInterest",
  "quarterlyStockholdersEquity",
  "quarterlyCurrentAssets",
  "quarterlyCurrentLiabilities",
  "annualTotalRevenue",
  "annualNetIncome",
] as const;

export function yahooFinanceFallbackEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const raw = env.STOCK_YAHOO_FALLBACK?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  if (raw === "1" || raw === "true" || raw === "on") return true;
  return false;
}

export function yahooFundamentalsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const raw = env.STOCK_YAHOO_FUNDAMENTALS?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return true;
}

export async function fetchYahooQuote(tickerRef: string): Promise<StockPayload> {
  const daily = await fetchYahooDailyChart(tickerRef);
  const latestPrice = daily.latestPrice;
  const previousClose = numberField(daily.priceMetrics, "previous_close");
  const latestChange = latestPrice !== undefined && previousClose ? roundRatio(latestPrice / previousClose - 1) : undefined;
  const latestBar = daily.chartSeries.at(-1);

  return {
    ok: true,
    type: "quote",
    requested_ticker: daily.requestedTicker,
    market: daily.market,
    symbol: daily.symbol,
    name: daily.name,
    exchange: daily.exchange,
    ...(daily.exchangeCode ? { exchange_code: daily.exchangeCode } : {}),
    currency: daily.currency,
    latest_price: latestPrice,
    latest_price_label: formatCurrencyAmount(latestPrice, daily.currency),
    latest_bar_date: daily.latestDate,
    previous_close: previousClose,
    latest_change: latestChange,
    latest_change_label: pct(latestChange),
    volume: latestBar?.volume,
    volume_label: latestBar?.volume === undefined ? undefined : latestBar.volume.toLocaleString("ko-KR"),
    price_metrics: {
      ...daily.priceMetrics,
      price: latestPrice,
      previous_close: previousClose,
      latest_change: latestChange,
      volume: latestBar?.volume,
    },
    fetch: {
      ...daily.fetch,
      provider_mode: "yahoo_quote_fallback",
    },
  };
}

export async function fetchYahooDailyChart(tickerRef: string): Promise<KisDailyChartPayload> {
  if (!yahooFinanceFallbackEnabled()) {
    throw new Error("Yahoo Finance fallback is not enabled.");
  }

  const parsed = parseTickerRef(tickerRef);
  const errors: unknown[] = [];
  for (const yahooSymbol of yahooSymbolCandidates(parsed.market, parsed.symbol)) {
    try {
      const payload = await fetchYahooDailyChartForSymbol(parsed.ticker, parsed.market, parsed.symbol, yahooSymbol);
      if (payload.chartSeries.length > 0) return payload;
      errors.push(providerEmptyError(`${yahooSymbol}: empty daily chart`));
    } catch (error) {
      errors.push(error);
    }
  }
  throw combineProviderErrors(parsed.ticker, errors);
}

export async function fetchYahooFundamentals(
  tickerRef: string,
  context: { latestPrice?: number; marketCap?: number; timeoutMs?: number } = {}
): Promise<YahooFundamentalsPayload> {
  if (!yahooFundamentalsEnabled()) {
    throw new Error("Yahoo fundamentals are disabled.");
  }

  const parsed = parseTickerRef(tickerRef);
  if (parsed.market !== "US") throw providerEmptyError(`${parsed.ticker}: Yahoo fundamentals currently support US stocks only`);

  const errors: unknown[] = [];
  for (const yahooSymbol of yahooSymbolCandidates(parsed.market, parsed.symbol)) {
    try {
      const payload = await fetchYahooFundamentalsForSymbol(parsed.ticker, parsed.market, parsed.symbol, yahooSymbol, context);
      if (Object.keys(payload.normalized).length) return payload;
      errors.push(providerEmptyError(`${yahooSymbol}: empty fundamentals`));
    } catch (error) {
      errors.push(error);
    }
  }
  throw combineProviderErrors(parsed.ticker, errors);
}

async function fetchYahooDailyChartForSymbol(
  requestedTicker: string,
  market: "US" | "KR",
  symbol: string,
  yahooSymbol: string
): Promise<KisDailyChartPayload> {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}`);
  url.searchParams.set("range", "1y");
  url.searchParams.set("interval", "1d");
  url.searchParams.set("includePrePost", "false");
  url.searchParams.set("events", "history");

  const response = await fetchWithTimeout(
    url.toString(),
    {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0",
      },
      cache: "no-store",
    },
    yahooTimeoutMs()
  );
  const payload = (await response.json().catch(() => undefined)) as YahooChartResponse | undefined;
  const chartError = payload?.chart?.error;
  if (!response.ok || chartError) {
    const description = stringValue(chartError?.description) || stringValue(chartError?.code) || `Yahoo HTTP ${response.status}`;
    if (response.status === 404 || /no data found|delisted|not found/i.test(description)) {
      throw providerEmptyError(`${yahooSymbol}: ${description}`);
    }
    throw new Error(`${yahooSymbol}: ${description}`);
  }

  const result = payload?.chart?.result?.[0];
  if (!result) throw providerEmptyError(`${yahooSymbol}: empty chart response`);
  const chartSeries = yahooChartSeries(result, market === "KR" ? "KRW" : stringValue(result.meta?.currency) || "USD");
  if (!chartSeries.length) throw providerEmptyError(`${yahooSymbol}: empty daily chart`);

  const latest = chartSeries.at(-1);
  const currency = stringValue(result.meta?.currency) || (market === "KR" ? "KRW" : "USD");
  const exchange = stringValue(result.meta?.fullExchangeName) || stringValue(result.meta?.exchangeName) || (market === "KR" ? "KRX" : "US");
  const exchangeCode = stringValue(result.meta?.exchangeName);
  const latestClose = latest?.close;
  const previousClose = chartSeries.at(-2)?.close ?? numberValue(result.meta?.chartPreviousClose);
  const latestPrice = trustedYahooLatestPrice(numberValue(result.meta?.regularMarketPrice), latestClose, previousClose);

  return {
    requestedTicker,
    market,
    symbol,
    name: stringValue(result.meta?.longName) || stringValue(result.meta?.shortName) || symbol,
    exchange,
    exchangeCode,
    currency,
    latestPrice,
    latestDate: latest?.date,
    chartSeries,
    priceMetrics: {
      price: latestPrice,
      previous_close: previousClose,
      market_cap: numberValue(result.meta?.marketCap),
    },
    fetch: {
      source: "market_data",
      provider: "yahoo_finance",
      provider_mode: "yahoo_daily_chart_fallback",
      yahoo_symbol: yahooSymbol,
      daily_price_endpoint: "/v8/finance/chart",
      history_rows: chartSeries.length,
      fetched_at: new Date().toISOString(),
      cache: "no-store",
    },
  };
}

async function fetchYahooFundamentalsForSymbol(
  requestedTicker: string,
  market: "US" | "KR",
  symbol: string,
  yahooSymbol: string,
  context: { latestPrice?: number; marketCap?: number; timeoutMs?: number }
): Promise<YahooFundamentalsPayload> {
  const url = new URL(`https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(yahooSymbol)}`);
  url.searchParams.set("symbol", yahooSymbol);
  url.searchParams.set("type", YAHOO_FUNDAMENTAL_TYPES.join(","));
  url.searchParams.set("period1", "0");
  url.searchParams.set("period2", String(Math.floor(Date.now() / 1000)));

  const response = await fetchWithTimeout(
    url.toString(),
    {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0",
      },
      cache: "no-store",
    },
    context.timeoutMs ?? yahooFundamentalsTimeoutMs()
  );
  const payload = (await response.json().catch(() => undefined)) as YahooFundamentalsResponse | undefined;
  const timeseriesError = payload?.timeseries?.error;
  if (!response.ok || timeseriesError) {
    const description = stringValue(timeseriesError?.description) || stringValue(timeseriesError?.code) || `Yahoo HTTP ${response.status}`;
    if (response.status === 404 || /no data found|delisted|not found/i.test(description)) {
      throw providerEmptyError(`${yahooSymbol}: ${description}`);
    }
    throw new Error(`${yahooSymbol}: ${description}`);
  }

  const raw = yahooFundamentalsRaw(payload?.timeseries?.result);
  const normalized = normalizeYahooFundamentals(raw, context);
  return {
    requestedTicker,
    market,
    symbol,
    yahooSymbol,
    normalized,
    raw,
    fetchedAt: new Date().toISOString(),
  };
}

function trustedYahooLatestPrice(
  regularMarketPrice: number | undefined,
  latestClose: number | undefined,
  previousClose: number | undefined
): number | undefined {
  if (!positiveNumber(regularMarketPrice)) return latestClose;
  if (!positiveNumber(latestClose)) return regularMarketPrice;

  const closeRatio = regularMarketPrice / latestClose;
  if (closeRatio > 2 || closeRatio < 0.5) return latestClose;

  if (positiveNumber(previousClose)) {
    const regularMove = regularMarketPrice / previousClose - 1;
    const chartMove = latestClose / previousClose - 1;
    if (Math.abs(regularMove) > 2 && Math.abs(chartMove) < 0.5) return latestClose;
  }

  return regularMarketPrice;
}

function positiveNumber(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function yahooSymbolCandidates(market: "US" | "KR", symbol: string): string[] {
  if (market === "US") return [symbol.replace(/\./g, "-"), symbol];
  const domestic = symbol.startsWith("Q") ? symbol.slice(1) : symbol;
  return [`${domestic}.KS`, `${domestic}.KQ`];
}

function yahooFundamentalsRaw(results: YahooTimeseriesResult[] | undefined): Record<string, Array<Record<string, unknown>>> {
  const raw: Record<string, Array<Record<string, unknown>>> = {};
  for (const result of Array.isArray(results) ? results : []) {
    const type = stringValue(result.meta?.type?.[0]) || Object.keys(result).find((key) => key !== "meta" && key !== "timestamp");
    if (!type) continue;
    const rows = rowList(result[type]);
    if (rows.length) raw[type] = rows;
  }
  return raw;
}

function normalizeYahooFundamentals(
  raw: Record<string, Array<Record<string, unknown>>>,
  context: { latestPrice?: number; marketCap?: number }
): Record<string, number | string> {
  const revenue = latestReportedNumber(raw, "trailingTotalRevenue");
  const operatingIncome = latestReportedNumber(raw, "trailingOperatingIncome");
  const netIncome = latestReportedNumber(raw, "trailingNetIncome");
  const totalAssets = latestReportedNumber(raw, "quarterlyTotalAssets");
  const totalLiabilities = latestReportedNumber(raw, "quarterlyTotalLiabilitiesNetMinorityInterest");
  const totalEquity = latestReportedNumber(raw, "quarterlyStockholdersEquity");
  const currentAssets = latestReportedNumber(raw, "quarterlyCurrentAssets");
  const currentLiabilities = latestReportedNumber(raw, "quarterlyCurrentLiabilities");
  const marketCap = positiveNumber(context.marketCap) ? context.marketCap : undefined;
  const latestPrice = positiveNumber(context.latestPrice) ? context.latestPrice : undefined;
  const shares = marketCap && latestPrice ? marketCap / latestPrice : undefined;
  const bps = totalEquity !== undefined && shares ? totalEquity / shares : undefined;
  const priceToBook = latestReportedNumber(raw, "trailingPbRatio") ?? (latestPrice && bps ? latestPrice / bps : undefined);
  const period = latestReportedDate(raw, "trailingTotalRevenue", "trailingNetIncome", "annualTotalRevenue", "quarterlyTotalAssets");
  const currency = latestReportedCurrency(raw, "trailingTotalRevenue", "trailingNetIncome", "quarterlyTotalAssets");

  return compactFiniteMapping({
    period,
    periodEnded: period,
    currency,
    totalRevenue: revenue,
    operatingIncome,
    netIncome,
    ebitda: latestReportedNumber(raw, "trailingEbitda"),
    totalAssets,
    currentAssets,
    totalLiabilities,
    currentLiabilities,
    totalEquity,
    operatingMargins: divide(operatingIncome, revenue),
    profitMargins: divide(netIncome, revenue),
    returnOnEquity: divide(netIncome, totalEquity),
    revenueGrowth: seriesGrowth(raw, "annualTotalRevenue"),
    earningsGrowth: seriesGrowth(raw, "annualNetIncome"),
    eps: latestReportedNumber(raw, "trailingDilutedEPS") ?? latestReportedNumber(raw, "trailingBasicEPS"),
    bps,
    trailingPE: latestReportedNumber(raw, "trailingPeRatio"),
    priceToBook,
    listedShares: shares,
    marketCap,
    debtToEquity: divide(totalLiabilities, totalEquity),
    currentRatio: divide(currentAssets, currentLiabilities),
  });
}

function yahooChartSeries(result: YahooChartResult, currency: string): KisDailyChartBar[] {
  const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
  const quote = result.indicators?.quote?.[0] || {};
  const opens = numericArray(quote.open);
  const highs = numericArray(quote.high);
  const lows = numericArray(quote.low);
  const closes = numericArray(quote.close);
  const volumes = numericArray(quote.volume);
  const rows: KisDailyChartBar[] = [];

  timestamps.forEach((timestamp, index) => {
    const close = closes[index];
    if (!Number.isFinite(timestamp) || close === undefined) return;
    const previousClose = rows.at(-1)?.close;
    const open = opens[index] ?? close;
    const high = highs[index] ?? Math.max(open, close);
    const low = lows[index] ?? Math.min(open, close);
    const volume = volumes[index] === undefined ? undefined : Math.trunc(volumes[index]);
    rows.push(chartBar({ timestamp, open, high, low, close, volume, previousClose, currency }));
  });

  return rows;
}

function chartBar(input: {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  previousClose?: number;
  currency: string;
}): KisDailyChartBar {
  const changePct = input.previousClose ? roundRatio(input.close / input.previousClose - 1) : undefined;
  const rangePct = input.open ? roundRatio((input.high - input.low) / input.open) : undefined;
  return {
    date: new Date(input.timestamp * 1000).toISOString().slice(0, 10),
    open: roundPrice(input.open),
    high: roundPrice(input.high),
    low: roundPrice(input.low),
    close: roundPrice(input.close),
    volume: input.volume,
    currency: input.currency,
    open_label: formatCurrencyAmount(input.open, input.currency),
    high_label: formatCurrencyAmount(input.high, input.currency),
    low_label: formatCurrencyAmount(input.low, input.currency),
    close_label: formatCurrencyAmount(input.close, input.currency),
    ohl_label: `${formatCurrencyAmount(input.open, input.currency)} / ${formatCurrencyAmount(input.high, input.currency)} / ${formatCurrencyAmount(input.low, input.currency)}`,
    volume_label: input.volume === undefined ? "-" : input.volume.toLocaleString("ko-KR"),
    change_pct: changePct,
    change_label: pct(changePct),
    range_pct: rangePct,
    range_label: pct(rangePct),
  };
}

function numericArray(value: unknown): Array<number | undefined> {
  if (!Array.isArray(value)) return [];
  return value.map((item) => numberValue(item));
}

function rowList(value: unknown): Array<Record<string, unknown>> {
  return (Array.isArray(value) ? value : []).filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
}

function compactFiniteMapping(values: Record<string, unknown>): Record<string, number | string> {
  const compacted: Record<string, number | string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "string" && value.trim()) {
      compacted[key] = value.trim();
      continue;
    }
    const finite = numberValue(value);
    if (finite !== undefined) compacted[key] = finite;
  }
  return compacted;
}

function latestReportedNumber(raw: Record<string, Array<Record<string, unknown>>>, key: string): number | undefined {
  return numberValue(recordValue(latestReportedRow(raw[key])?.reportedValue)?.raw);
}

function latestReportedDate(raw: Record<string, Array<Record<string, unknown>>>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = stringValue(latestReportedRow(raw[key])?.asOfDate);
    if (value) return value;
  }
  return undefined;
}

function latestReportedCurrency(raw: Record<string, Array<Record<string, unknown>>>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = stringValue(latestReportedRow(raw[key])?.currencyCode);
    if (value) return value;
  }
  return undefined;
}

function latestReportedRow(rows: Array<Record<string, unknown>> | undefined): Record<string, unknown> | undefined {
  if (!rows?.length) return undefined;
  return rows.reduce((latest, row) => String(row.asOfDate || "") > String(latest.asOfDate || "") ? row : latest, rows[0]!);
}

function seriesGrowth(raw: Record<string, Array<Record<string, unknown>>>, key: string): number | undefined {
  const rows = [...(raw[key] || [])]
    .filter((row) => latestReportedValue(row) !== undefined)
    .sort((left, right) => String(left.asOfDate || "").localeCompare(String(right.asOfDate || "")));
  const latest = latestReportedValue(rows.at(-1));
  const previous = latestReportedValue(rows.at(-2));
  return divide(latest !== undefined && previous !== undefined ? latest - previous : undefined, previous);
}

function latestReportedValue(row: Record<string, unknown> | undefined): number | undefined {
  return numberValue(recordValue(row?.reportedValue)?.raw);
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  return numberValue(record[key]);
}

function numberValue(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const text = String(value).trim();
  return text || undefined;
}

function roundPrice(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function roundRatio(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function divide(numerator: number | undefined, denominator: number | undefined): number | undefined {
  if (numerator === undefined || denominator === undefined || denominator === 0) return undefined;
  return roundRatio(numerator / denominator);
}

function pct(value: number | undefined): string | undefined {
  if (value === undefined) return undefined;
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function yahooTimeoutMs(): number {
  return numericEnv("STOCK_YAHOO_TIMEOUT_MS", 2_500);
}

function yahooFundamentalsTimeoutMs(): number {
  return numericEnv("STOCK_YAHOO_FUNDAMENTALS_TIMEOUT_MS", yahooTimeoutMs());
}
