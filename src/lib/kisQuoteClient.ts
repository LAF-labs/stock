import { acquireRateLimit, apiLimitPolicy, fixedRateLimitKey } from "@/lib/apiRateLimit";
import { safeErrorMessage } from "@/lib/errorSafety";
import {
  acquireSharedKisTokenIssueLock,
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

declare global {
  var __kisQuoteTokenCache: Map<string, KisTokenCacheEntry> | undefined;
}

const tokenCache = (globalThis.__kisQuoteTokenCache ??= new Map<string, KisTokenCacheEntry>());

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
  if (!/^\d{6}$/.test(symbol)) {
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
  for (const market of KIS_US_MARKETS) {
    try {
      const detail = outputObject(
        await kisGet("/uapi/overseas-price/v1/quotations/price-detail", "HHDFS76200200", {
          AUTH: "",
          EXCD: market.excd,
          SYMB: symbol,
        })
      );
      const latestPrice = asFloat(detail.last);
      if (latestPrice === undefined) {
        errors.push(`${market.excd}: empty price`);
        continue;
      }

      let search: KisPayload = {};
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
        usd_krw_label: usdKrw ? `$1 = ${priceLabel(usdKrw, "KRW")}` : undefined,
        latest_price: latestPrice,
        latest_price_label: labeledMoney(latestPrice, currency, usdKrw),
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
          search_info_endpoint: "/uapi/overseas-price/v1/quotations/search-info",
          exchange_code: market.excd,
          fetched_at: now.toISOString(),
          cache: "server",
        },
      };
    } catch (error) {
      errors.push(`${market.excd}: ${safeErrorMessage(error)}`);
    }
  }

  throw new KisQuoteError(errors.slice(-3).join("; ") || `${symbol} quote was not found.`);
}

async function kisGet(path: string, trId: string, params: Record<string, string>): Promise<KisPayload> {
  const config = kisConfig();
  const url = new URL(`${config.baseUrl}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetchWithTimeout(
    url.toString(),
    {
      headers: {
        "content-type": "application/json; charset=utf-8",
        authorization: `Bearer ${await kisAccessToken(config)}`,
        appkey: config.appKey,
        appsecret: config.appSecret,
        tr_id: trId,
        custtype: "P",
      },
      cache: "no-store",
    },
    12_000
  );
  const payload = (await response.json().catch(() => undefined)) as KisPayload | undefined;
  if (!response.ok || !payload || String(payload.rt_cd ?? "0") !== "0") {
    const message = stringValue(payload?.msg1) || stringValue(payload?.msg_cd) || `KIS HTTP ${response.status}`;
    throw new KisQuoteError(message);
  }
  return payload;
}

async function kisAccessToken(config: KisConfig): Promise<string> {
  const cacheKey = kisTokenCacheKey(config);
  const cached = tokenCache.get(cacheKey);
  if (isFreshKisToken(cached)) {
    return cached.accessToken;
  }

  const shared = await readSharedKisAccessToken(cacheKey);
  if (shared) {
    tokenCache.set(cacheKey, shared);
    return shared.accessToken;
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
  return `${currency} ${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function labeledMoney(value: number | undefined, currency: string, usdKrw: number | undefined): string {
  if (value === undefined) return "-";
  if (currency === "USD" && usdKrw) {
    return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} / ${priceLabel(value * usdKrw, "KRW")}`;
  }
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
