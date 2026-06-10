import { acquireRateLimit, apiLimitPolicy, fixedRateLimitKey } from "@/lib/apiRateLimit";
import { safeErrorMessage } from "@/lib/errorSafety";
import {
  acquireSharedKisTokenIssueLock,
  deleteSharedKisAccessToken,
  isFreshKisToken,
  kisTokenCacheKey,
  readSharedKisAccessToken,
  waitForSharedKisAccessToken,
  writeSharedKisAccessToken,
  type KisTokenCacheEntry,
} from "@/lib/kisTokenCache";
import { envValue, fetchWithTimeout } from "@/lib/supabaseRest";
import { parseTickerRef } from "@/lib/tickerRef";
import type { StockPayload } from "@/lib/stockSnapshotCache";
import { KIS_DOMESTIC_EXCHANGE_LABEL, KIS_DOMESTIC_MARKET_DIV_CODE, KIS_US_MARKETS } from "@/lib/quoteContract";

type KisConfig = {
  appKey: string;
  appSecret: string;
  baseUrl: string;
};

type KisPayload = Record<string, unknown>;
type KisUsMarket = (typeof KIS_US_MARKETS)[number];
type KisUsDiscoveryCacheEntry = {
  market: KisUsMarket;
  search: KisPayload;
  expiresAtMs: number;
};
type DomesticChartRow = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | undefined;
};
export type KisDailyChartBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  currency: string;
  open_label: string;
  high_label: string;
  low_label: string;
  close_label: string;
  ohl_label: string;
  volume_label: string;
  change_pct?: number;
  change_label?: string;
  range_pct?: number;
  range_label?: string;
};
export type KisDailyChartPayload = {
  requestedTicker: string;
  market: "US" | "KR";
  symbol: string;
  name: string;
  exchange: string;
  exchangeCode?: string;
  currency: string;
  latestPrice?: number;
  latestDate?: string;
  chartSeries: KisDailyChartBar[];
  priceMetrics: Record<string, unknown>;
  fetch: Record<string, unknown>;
};

declare global {
  var __kisQuoteTokenCache: Map<string, KisTokenCacheEntry> | undefined;
  var __kisQuoteDiscoveryCache: Map<string, KisUsDiscoveryCacheEntry> | undefined;
}

const tokenCache = (globalThis.__kisQuoteTokenCache ??= new Map<string, KisTokenCacheEntry>());
const discoveryCache = (globalThis.__kisQuoteDiscoveryCache ??= new Map<string, KisUsDiscoveryCacheEntry>());
const KIS_US_DISCOVERY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

class KisQuoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KisQuoteError";
  }
}

export async function fetchKisQuote(tickerRef: string): Promise<StockPayload> {
  await acquireKisQuoteSlot();
  const { market, symbol } = parseTicker(tickerRef);
  return market === "KR" ? fetchDomesticQuote(symbol) : fetchUsQuote(symbol);
}

export async function fetchKisDailyChart(tickerRef: string): Promise<KisDailyChartPayload> {
  await acquireKisQuoteSlot();
  const { market, symbol } = parseTicker(tickerRef);
  return market === "KR" ? fetchDomesticDailyChart(symbol) : fetchUsDailyChart(symbol);
}

export function kisQuoteConfigured(): boolean {
  return !!((envValue("STOCK_API_APP_KEY") || envValue("KIS_APP_KEY")) && (envValue("STOCK_API_APP_SECRET") || envValue("KIS_APP_SECRET")));
}

async function acquireKisQuoteSlot() {
  const result = await acquireRateLimit(
    fixedRateLimitKey("stock-kis-quote-provider-global"),
    apiLimitPolicy("stock_kis_quote_provider", 120, 60)
  );
  if (!result.allowed) {
    throw new KisQuoteError(`kis_quote_rate_limited_until_${result.resetAt}`);
  }
}

async function fetchDomesticQuote(symbol: string): Promise<StockPayload> {
  if (!/^(?:[0-9][A-Z0-9]{5}|Q\d{6})$/.test(symbol)) {
    return { ok: false, status: 400, error: "invalid_ticker", message: "Invalid KR ticker." };
  }

  const price = outputObject(
    await kisGet("/uapi/domestic-stock/v1/quotations/inquire-price", "FHKST01010100", {
      FID_COND_MRKT_DIV_CODE: KIS_DOMESTIC_MARKET_DIV_CODE,
      FID_INPUT_ISCD: symbol,
    })
  );
  const now = new Date();
  const latestPrice = asFloat(price.stck_prpr);
  const previousClose = asFloat(price.stck_sdpr) ?? asFloat(price.stck_prdy_clpr);
  const latestChange = kisPercent(price.prdy_ctrt) ?? changeFrom(latestPrice, previousClose);
  const volume = asInt(price.acml_vol);
  const name = stringValue(price.hts_kor_isnm) || stringValue(price.prdt_abrv_name) || symbol;
  const latestDate = kisDate(price.stck_bsop_date) || dateInSeoul(now);

  return {
    ok: true,
    type: "quote",
    requested_ticker: `KR:${symbol}`,
    market: "KR",
    symbol,
    name,
    exchange: KIS_DOMESTIC_EXCHANGE_LABEL,
    currency: "KRW",
    latest_price: latestPrice,
    latest_price_label: priceLabel(latestPrice, "KRW"),
    latest_bar_date: latestDate,
    previous_close: previousClose,
    latest_change: latestChange,
    latest_change_label: pct(latestChange),
    volume,
    volume_label: numLabel(volume),
    price_metrics: {
      price: latestPrice,
      previous_close: previousClose,
      latest_change: latestChange,
      volume,
    },
    fetch: {
      source: "market_data",
      price_endpoint: "/uapi/domestic-stock/v1/quotations/inquire-price",
      market_div_code: KIS_DOMESTIC_MARKET_DIV_CODE,
      fetched_at: now.toISOString(),
      cache: "server",
    },
  };
}

async function fetchUsQuote(symbol: string): Promise<StockPayload> {
  if (!/^[A-Z0-9.-]{1,12}$/.test(symbol)) {
    return { ok: false, status: 400, error: "invalid_ticker", message: "Invalid US ticker." };
  }

  const errors: string[] = [];
  const cacheKey = `US:${symbol}`;
  const cached = readUsDiscoveryCache(cacheKey);
  if (cached) {
    try {
      const payload = await fetchUsQuoteForMarket(symbol, cached.market, cached.search);
      delete (payload.fetch as { search_info_cache?: KisPayload } | undefined)?.search_info_cache;
      return payload;
    } catch (error) {
      discoveryCache.delete(cacheKey);
      errors.push(`${cached.market.excd} cached: ${safeErrorMessage(error)}`);
    }
  }

  for (const market of KIS_US_MARKETS) {
    try {
      const payload = await fetchUsQuoteForMarket(symbol, market);
      discoveryCache.set(cacheKey, {
        market,
        search: (payload.fetch as { search_info_cache?: KisPayload } | undefined)?.search_info_cache || {},
        expiresAtMs: Date.now() + KIS_US_DISCOVERY_CACHE_TTL_MS,
      });
      delete (payload.fetch as { search_info_cache?: KisPayload } | undefined)?.search_info_cache;
      return payload;
    } catch (error) {
      errors.push(`${market.excd}: ${safeErrorMessage(error)}`);
    }
  }

  throw new KisQuoteError(errors.slice(-3).join("; ") || `${symbol} quote was not found.`);
}

async function fetchUsQuoteForMarket(symbol: string, market: KisUsMarket, cachedSearch?: KisPayload): Promise<StockPayload> {
  const detail = outputObject(
    await kisGet("/uapi/overseas-price/v1/quotations/price-detail", "HHDFS76200200", {
      AUTH: "",
      EXCD: market.excd,
      SYMB: symbol,
    })
  );
  const latestPrice = asFloat(detail.last);
  if (latestPrice === undefined) {
    throw new KisQuoteError("empty price");
  }

  let search: KisPayload = cachedSearch || {};
  if (!cachedSearch) {
    try {
      search = outputObject(
        await kisGet("/uapi/overseas-price/v1/quotations/search-info", "CTPF1702R", {
          PRDT_TYPE_CD: market.productType,
          PDNO: symbol,
        })
      );
    } catch {
      search = {};
    }
  }

  const now = new Date();
  const currency = stringValue(detail.curr) || stringValue(search.tr_crcy_cd) || "USD";
  const usdKrw = currency === "USD" ? asFloat(detail.t_rate) : undefined;
  const previousClose = asFloat(detail.base);
  const latestChange = kisPercent(detail.rate) ?? changeFrom(latestPrice, previousClose);
  const volume = asInt(detail.tvol);
  const name = stringValue(search.prdt_eng_name) || stringValue(search.ovrs_item_name) || stringValue(search.prdt_name) || symbol;
  const exchange = stringValue(search.ovrs_excg_name) || market.label;
  const latestDate = kisDate(detail.xymd) || now.toISOString().slice(0, 10);

  return {
    ok: true,
    type: "quote",
    requested_ticker: `US:${symbol}`,
    market: "US",
    symbol,
    name,
    exchange,
    exchange_code: market.excd,
    currency,
    usd_krw_rate: usdKrw,
    usd_krw_label: usdKrw ? `$1 = 약 ${priceLabel(usdKrw, "KRW")}` : undefined,
    latest_price: latestPrice,
    latest_price_label: labeledMoney(latestPrice, currency),
    latest_bar_date: latestDate,
    previous_close: previousClose,
    latest_change: latestChange,
    latest_change_label: pct(latestChange),
    volume,
    volume_label: numLabel(volume),
    price_metrics: {
      price: latestPrice,
      previous_close: previousClose,
      latest_change: latestChange,
      volume,
    },
    fetch: {
      source: "market_data",
      price_detail_endpoint: "/uapi/overseas-price/v1/quotations/price-detail",
      search_info_endpoint: cachedSearch ? undefined : "/uapi/overseas-price/v1/quotations/search-info",
      exchange_code: market.excd,
      fetched_at: now.toISOString(),
      cache: "server",
      discovery_cache: cachedSearch ? "hit" : "miss",
      search_info_cache: search,
    },
  };
}

function readUsDiscoveryCache(cacheKey: string): KisUsDiscoveryCacheEntry | undefined {
  const cached = discoveryCache.get(cacheKey);
  if (!cached) return undefined;
  if (cached.expiresAtMs <= Date.now()) {
    discoveryCache.delete(cacheKey);
    return undefined;
  }
  return cached;
}

async function fetchDomesticDailyChart(symbol: string): Promise<KisDailyChartPayload> {
  if (!/^(?:[0-9][A-Z0-9]{5}|Q\d{6})$/.test(symbol)) {
    throw new KisQuoteError("Invalid KR ticker.");
  }
  const now = new Date();
  const end = dateInSeoul(now).replace(/-/g, "");
  const start = dateOffset(now, -540, "Asia/Seoul").replace(/-/g, "");
  let rows: KisPayload[] = [];
  let marketDivCode = KIS_DOMESTIC_MARKET_DIV_CODE;
  const errors: string[] = [];
  for (const candidate of domesticDailyMarketDivCodes()) {
    try {
      const payload = await kisGet(
        "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice",
        "FHKST03010100",
        {
          FID_COND_MRKT_DIV_CODE: candidate,
          FID_INPUT_ISCD: symbol,
          FID_INPUT_DATE_1: start,
          FID_INPUT_DATE_2: end,
          FID_PERIOD_DIV_CODE: "D",
          FID_ORG_ADJ_PRC: "0",
        },
        { timeoutMs: technicalKisTimeoutMs() }
      );
      const candidateRows = outputList(payload, "output2");
      if (!candidateRows.length) continue;
      rows = candidateRows;
      marketDivCode = candidate;
      break;
    } catch (error) {
      errors.push(`${candidate}: ${safeErrorMessage(error)}`);
    }
  }
  const chartSeries = domesticChartSeries(rows);
  if (!chartSeries.length) throw new KisQuoteError(errors.slice(-3).join("; ") || `${symbol} daily chart was not found.`);
  const latest = chartSeries.at(-1);
  return {
    requestedTicker: `KR:${symbol}`,
    market: "KR",
    symbol,
    name: symbol,
    exchange: KIS_DOMESTIC_EXCHANGE_LABEL,
    currency: "KRW",
    latestPrice: latest?.close,
    latestDate: latest?.date,
    chartSeries,
    priceMetrics: priceMetricsFromChart(chartSeries),
    fetch: {
      source: "market_data",
      provider_mode: "technical_request_fast_path",
      daily_price_endpoint: "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice",
      market_div_code: marketDivCode,
      history_rows: chartSeries.length,
      fetched_at: now.toISOString(),
      cache: "no-store",
    },
  };
}

async function fetchUsDailyChart(symbol: string): Promise<KisDailyChartPayload> {
  if (!/^[A-Z0-9.-]{1,12}$/.test(symbol)) {
    throw new KisQuoteError("Invalid US ticker.");
  }
  const errors: string[] = [];
  for (const market of KIS_US_MARKETS) {
    try {
      const rows = await fetchUsDailyRowsForMarket(symbol, market);
      const chartSeries = usChartSeries(rows);
      if (!chartSeries.length) throw new KisQuoteError("empty daily chart");
      const latest = chartSeries.at(-1);
      return {
        requestedTicker: `US:${symbol}`,
        market: "US",
        symbol,
        name: symbol,
        exchange: market.label,
        exchangeCode: market.excd,
        currency: "USD",
        latestPrice: latest?.close,
        latestDate: latest?.date,
        chartSeries,
        priceMetrics: priceMetricsFromChart(chartSeries),
        fetch: {
          source: "market_data",
          provider_mode: "technical_request_fast_path",
          daily_price_endpoint: "/uapi/overseas-price/v1/quotations/dailyprice",
          exchange_code: market.excd,
          history_rows: chartSeries.length,
          fetched_at: new Date().toISOString(),
          cache: "no-store",
        },
      };
    } catch (error) {
      errors.push(`${market.excd}: ${safeErrorMessage(error)}`);
    }
  }
  throw new KisQuoteError(errors.slice(-3).join("; ") || `${symbol} daily chart was not found.`);
}

async function fetchUsDailyRowsForMarket(symbol: string, market: KisUsMarket): Promise<KisPayload[]> {
  const rowsByDate = new Map<string, KisPayload>();
  const today = new Date();
  let before = today;
  const maxPages = Math.max(1, numericEnvForKis("STOCK_TECHNICAL_KIS_DAILY_MAX_PAGES", 1));
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const bymd = pageIndex === 0 ? "" : dateInUtc(before).replace(/-/g, "");
    const payload = await kisGet(
      "/uapi/overseas-price/v1/quotations/dailyprice",
      "HHDFS76240000",
      { AUTH: "", EXCD: market.excd, SYMB: symbol, GUBN: "0", BYMD: bymd, MODP: "1" },
      { timeoutMs: technicalKisTimeoutMs() }
    );
    const rows = outputList(payload, "output2").length ? outputList(payload, "output2") : outputList(payload, "output");
    const usable = rows.filter((row) => kisDate(row.xymd) && asFloat(row.clos) !== undefined);
    if (!usable.length) break;
    for (const row of usable) rowsByDate.set(String(row.xymd || ""), row);
    const earliest = usable
      .map((row) => parseKisDate(row.xymd))
      .filter((value): value is Date => Boolean(value))
      .sort((left, right) => left.getTime() - right.getTime())[0];
    if (!earliest) break;
    before = new Date(earliest.getTime() - 24 * 60 * 60 * 1000);
  }
  return [...rowsByDate.values()].sort((left, right) => String(left.xymd || "").localeCompare(String(right.xymd || "")));
}

async function kisGet(path: string, trId: string, params: Record<string, string>, options: { timeoutMs?: number } = {}): Promise<KisPayload> {
  const config = kisConfig();
  const cacheKey = kisTokenCacheKey(config);
  const first = await kisGetOnce(config, path, trId, params, options);
  if (first.ok) return first.payload;

  if (kisTokenExpiredMessage(first.message)) {
    tokenCache.delete(cacheKey);
    await deleteSharedKisAccessToken(cacheKey);
    const retry = await kisGetOnce(config, path, trId, params, { ...options, skipSharedTokenCache: true });
    if (retry.ok) return retry.payload;
    throw new KisQuoteError(retry.message);
  }

  throw new KisQuoteError(first.message);
}

async function kisGetOnce(
  config: KisConfig,
  path: string,
  trId: string,
  params: Record<string, string>,
  options: { skipSharedTokenCache?: boolean; timeoutMs?: number } = {}
): Promise<{ ok: true; payload: KisPayload } | { ok: false; message: string }> {
  const url = new URL(`${config.baseUrl}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetchWithTimeout(
    url.toString(),
    {
      headers: {
        "content-type": "application/json; charset=utf-8",
        authorization: `Bearer ${await kisAccessToken(config, options)}`,
        appkey: config.appKey,
        appsecret: config.appSecret,
        tr_id: trId,
        custtype: "P",
      },
      cache: "no-store",
    },
    options.timeoutMs ?? 12_000
  );
  const payload = (await response.json().catch(() => undefined)) as KisPayload | undefined;
  if (!response.ok || !payload || String(payload.rt_cd ?? "0") !== "0") {
    const message = stringValue(payload?.msg1) || stringValue(payload?.msg_cd) || `KIS HTTP ${response.status}`;
    return { ok: false, message };
  }
  return { ok: true, payload };
}

function kisTokenExpiredMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return normalized.includes("expired token") || normalized.includes("만료") && (normalized.includes("token") || normalized.includes("토큰"));
}

async function kisAccessToken(config: KisConfig, options: { skipSharedTokenCache?: boolean } = {}): Promise<string> {
  const cacheKey = kisTokenCacheKey(config);
  const cached = tokenCache.get(cacheKey);
  if (isFreshKisToken(cached)) {
    return cached.accessToken;
  }

  if (!options.skipSharedTokenCache) {
    const shared = await readSharedKisAccessToken(cacheKey);
    if (shared) {
      tokenCache.set(cacheKey, shared);
      return shared.accessToken;
    }
  }

  const lockAcquired = await acquireSharedKisTokenIssueLock(cacheKey);
  if (lockAcquired === false) {
    const waited = await waitForSharedKisAccessToken(cacheKey);
    if (waited) {
      tokenCache.set(cacheKey, waited);
      return waited.accessToken;
    }
  }

  const response = await fetchWithTimeout(
    `${config.baseUrl}/oauth2/tokenP`,
    {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        appkey: config.appKey,
        appsecret: config.appSecret,
      }),
      cache: "no-store",
    },
    12_000
  );
  const payload = (await response.json().catch(() => undefined)) as KisPayload | undefined;
  const token = stringValue(payload?.access_token);
  if (!response.ok || !token) {
    const message = stringValue(payload?.error_description) || stringValue(payload?.msg1) || `KIS token HTTP ${response.status}`;
    throw new KisQuoteError(`token_failed: ${message}`);
  }

  const expiresAtMs = parseTokenExpiry(payload?.access_token_token_expired) ?? Date.now() + Number(payload?.expires_in || 60 * 60 * 23) * 1000;
  const entry = { accessToken: token, expiresAtMs };
  tokenCache.set(cacheKey, entry);
  await writeSharedKisAccessToken(cacheKey, entry);
  return token;
}

function kisConfig(): KisConfig {
  const appKey = envValue("STOCK_API_APP_KEY") || envValue("KIS_APP_KEY");
  const appSecret = envValue("STOCK_API_APP_SECRET") || envValue("KIS_APP_SECRET");
  const baseUrl = (envValue("STOCK_API_BASE") || envValue("KIS_API_BASE") || "https://openapi.koreainvestment.com:9443").replace(/\/$/, "");
  if (!appKey || !appSecret) {
    throw new KisQuoteError("KIS quote API keys are not configured.");
  }
  return { appKey, appSecret, baseUrl };
}

function parseTicker(value: string): { market: "US" | "KR"; symbol: string } {
  const parsed = parseTickerRef(value);
  const raw = value.trim().replace(/^!/, "").toUpperCase();
  if (!raw.includes(":") && /^Q\d{6}$/.test(parsed.symbol)) {
    return { market: "KR", symbol: parsed.symbol.replace(/^Q/, "") };
  }
  return { market: parsed.market, symbol: parsed.symbol };
}

function outputObject(payload: KisPayload, key = "output"): KisPayload {
  const value = payload[key];
  if (Array.isArray(value)) {
    const first = value[0];
    return first && typeof first === "object" && !Array.isArray(first) ? (first as KisPayload) : {};
  }
  return value && typeof value === "object" && !Array.isArray(value) ? (value as KisPayload) : {};
}

function outputList(payload: KisPayload, key = "output"): KisPayload[] {
  const value = payload[key];
  if (Array.isArray(value)) return value.filter((item): item is KisPayload => Boolean(item) && typeof item === "object" && !Array.isArray(item));
  if (value && typeof value === "object" && !Array.isArray(value)) return [value as KisPayload];
  return [];
}

function asFloat(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function asInt(value: unknown): number | undefined {
  const parsed = asFloat(value);
  return parsed === undefined ? undefined : Math.trunc(parsed);
}

function kisPercent(value: unknown): number | undefined {
  const parsed = asFloat(value);
  return parsed === undefined ? undefined : roundRatio(parsed / 100);
}

function changeFrom(price: number | undefined, previousClose: number | undefined): number | undefined {
  if (!price || !previousClose) return undefined;
  return roundRatio(price / previousClose - 1);
}

function roundRatio(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function kisDate(value: unknown): string | undefined {
  const text = String(value || "").trim();
  if (!/^\d{8}$/.test(text)) return undefined;
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
}

function parseTokenExpiry(value: unknown): number | undefined {
  const text = stringValue(value);
  if (!text) return undefined;
  const match = text.match(/^(\d{4})-?(\d{2})-?(\d{2})[ T]?(\d{2}):?(\d{2}):?(\d{2})$/);
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second] = match;
  const ms = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  return Number.isFinite(ms) ? ms : undefined;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const text = String(value).trim();
  return text || undefined;
}

function priceLabel(value: number | undefined, currency: string): string {
  if (value === undefined) return "-";
  if (currency === "KRW") return `${Math.round(value).toLocaleString("ko-KR")}원`;
  if (currency === "USD") return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `${currency} ${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function labeledMoney(value: number | undefined, currency: string): string {
  if (value === undefined) return "-";
  return priceLabel(value, currency);
}

function pct(value: number | undefined): string {
  if (value === undefined) return "-";
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function numLabel(value: number | undefined): string {
  if (value === undefined) return "-";
  return value.toLocaleString("ko-KR");
}

function usChartSeries(rows: KisPayload[]): KisDailyChartBar[] {
  return rows
    .map((row, index, all) => {
      const date = kisDate(row.xymd);
      const close = asFloat(row.clos);
      if (!date || close === undefined) return undefined;
      const open = asFloat(row.open) ?? close;
      const high = asFloat(row.high) ?? Math.max(open, close);
      const low = asFloat(row.low) ?? Math.min(open, close);
      const volume = asInt(row.tvol);
      const previousClose = index > 0 ? asFloat(all[index - 1]?.clos) : undefined;
      return chartBar({ date, open, high, low, close, volume, previousClose, currency: "USD" });
    })
    .filter((row): row is KisDailyChartBar => Boolean(row));
}

function domesticChartSeries(rows: KisPayload[]): KisDailyChartBar[] {
  const parsed = rows
    .map((row) => {
      const date = kisDate(row.stck_bsop_date);
      const close = asFloat(row.stck_clpr);
      if (!date || close === undefined) return undefined;
      const open = asFloat(row.stck_oprc) ?? close;
      const high = asFloat(row.stck_hgpr) ?? Math.max(open, close);
      const low = asFloat(row.stck_lwpr) ?? Math.min(open, close);
      const volume = asInt(row.acml_vol);
      return { date, open, high, low, close, volume };
    })
    .filter((row): row is DomesticChartRow => Boolean(row))
    .sort((left, right) => left.date.localeCompare(right.date));

  return parsed.map((row, index, all) => chartBar({ ...row, previousClose: index > 0 ? all[index - 1]?.close : undefined, currency: "KRW" }));
}

function chartBar(input: {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  previousClose?: number;
  currency: string;
}): KisDailyChartBar {
  const high = Math.max(input.high, input.open, input.close);
  const low = Math.min(input.low, input.open, input.close);
  const rangePct = input.close ? roundRatio((high - low) / input.close) : undefined;
  const changePct = changeFrom(input.close, input.previousClose);
  return {
    date: input.date,
    open: input.open,
    high,
    low,
    close: input.close,
    volume: input.volume,
    currency: input.currency,
    open_label: priceLabel(input.open, input.currency),
    high_label: priceLabel(high, input.currency),
    low_label: priceLabel(low, input.currency),
    close_label: priceLabel(input.close, input.currency),
    ohl_label: `${priceLabel(input.open, input.currency)} / ${priceLabel(high, input.currency)} / ${priceLabel(low, input.currency)}`,
    volume_label: numLabel(input.volume),
    range_pct: rangePct,
    range_label: pct(rangePct),
    change_pct: changePct,
    change_label: pct(changePct),
  };
}

function priceMetricsFromChart(rows: KisDailyChartBar[]): Record<string, unknown> {
  const latest = rows.at(-1);
  const previous = rows.at(-2);
  const closes = rows.map((row) => row.close).filter((value) => Number.isFinite(value));
  const volumes = rows.map((row) => row.volume).filter((value): value is number => Number.isFinite(value));
  const year = rows.slice(-252);
  return {
    price: latest?.close,
    previous_close: previous?.close,
    latest_change: latest?.change_pct,
    volume: latest?.volume,
    avg_volume_20: average(volumes.slice(-20)),
    avg_volume_60: average(volumes.slice(-60)),
    year_high: year.length ? Math.max(...year.map((row) => row.high)) : undefined,
    year_low: year.length ? Math.min(...year.map((row) => row.low)) : undefined,
    ma20: average(closes.slice(-20)),
    ma50: average(closes.slice(-50)),
    ma200: average(closes.slice(-200)),
  };
}

function domesticDailyMarketDivCodes(): string[] {
  return [...new Set([KIS_DOMESTIC_MARKET_DIV_CODE, "J", "NX"].filter(Boolean))];
}

function average(values: number[]): number | undefined {
  const usable = values.filter((value) => Number.isFinite(value));
  if (!usable.length) return undefined;
  return Math.round((usable.reduce((sum, value) => sum + value, 0) / usable.length) * 1_000_000) / 1_000_000;
}

function parseKisDate(value: unknown): Date | undefined {
  const text = String(value || "").trim();
  if (!/^\d{8}$/.test(text)) return undefined;
  const ms = Date.UTC(Number(text.slice(0, 4)), Number(text.slice(4, 6)) - 1, Number(text.slice(6, 8)));
  return Number.isFinite(ms) ? new Date(ms) : undefined;
}

function dateInUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dateOffset(date: Date, days: number, timeZone: string): string {
  const shifted = new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
  if (timeZone === "Asia/Seoul") return dateInSeoul(shifted);
  return dateInUtc(shifted);
}

function numericEnvForKis(name: string, fallback: number): number {
  const parsed = Number(envValue(name));
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function technicalKisTimeoutMs(): number {
  return numericEnvForKis("STOCK_TECHNICAL_KIS_TIMEOUT_MS", 2_500);
}

function dateInSeoul(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value || "1970";
  const month = parts.find((part) => part.type === "month")?.value || "01";
  const day = parts.find((part) => part.type === "day")?.value || "01";
  return `${year}-${month}-${day}`;
}
