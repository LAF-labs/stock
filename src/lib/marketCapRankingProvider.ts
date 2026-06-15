import { acquireRateLimit, apiLimitPolicy, fixedRateLimitKey } from "@/lib/apiRateLimit";
import { safeErrorMessage } from "@/lib/errorSafety";
import { formatCompactUsd, formatKoreanWonLarge } from "@/lib/format";
import { getIndustryTaxonomyMappingForProfile } from "@/lib/industryTaxonomy";
import { kisGetRaw, kisQuoteConfigured } from "@/lib/kisQuoteClient";
import { KIS_DOMESTIC_EXCHANGE_LABEL, KIS_US_MARKETS } from "@/lib/quoteContract";
import { getSymbolIndustryProfile } from "@/lib/symbolProfiles";
import { fetchWithTimeout } from "@/lib/supabaseRest";
import symbols from "@/data/symbols.generated.json";
import type { MarketCapDashboardSnapshot, MarketCapRankingRow, MarketCapScope } from "@/lib/marketCapRankingTypes";
import type { SymbolMasterItem } from "@/lib/symbolTypes";

type ProviderPayload = Record<string, unknown>;

type MergeOptions = {
  scope: MarketCapScope;
  symbols?: SymbolMasterItem[];
  limit?: number;
};

type ProviderBuildOptions = {
  scope: MarketCapScope;
  nowMs?: number;
  limit?: number;
};

const DEFAULT_LIMIT = 100;
const DOMESTIC_MARKET_CAP_UNIT = 100_000_000;
const DEFAULT_USD_KRW_RATE = 1400;
const MARKET_CAP_FRESH_MS = 60 * 60 * 1000;
const NASDAQ_SCREENER_URL = "https://api.nasdaq.com/api/screener/stocks";
const NASDAQ_SCREENER_HEADERS = {
  "User-Agent": "Mozilla/5.0",
  Accept: "application/json,text/plain,*/*",
  Origin: "https://www.nasdaq.com",
  Referer: "https://www.nasdaq.com/market-activity/stocks/screener",
};

const localSymbols = symbols as SymbolMasterItem[];

export async function buildMarketCapRankingSnapshot(options: ProviderBuildOptions): Promise<MarketCapDashboardSnapshot> {
  const nowMs = options.nowMs ?? Date.now();
  const fetchedAt = new Date(nowMs).toISOString();
  const usdKrwRate = marketCapUsdKrwRate();
  const fetches: Array<Promise<MarketCapRankingRow[]>> = [];

  if (options.scope === "domestic" || options.scope === "all") {
    fetches.push(fetchDomesticMarketCapRows({ fetchedAt, usdKrwRate }));
  }
  if (options.scope === "overseas" || options.scope === "all") {
    fetches.push(fetchOverseasMarketCapRows({ fetchedAt }));
  }
  const rows = (await Promise.all(fetches)).flat();

  const merged = mergeMarketCapRows(rows, {
    scope: options.scope,
    symbols: localSymbols,
    limit: options.limit ?? DEFAULT_LIMIT,
  });
  const enriched = await enrichMarketCapRowsWithSectors(merged);
  const sectors = sectorsFromRows(enriched);

  const source = rows.some((row) => row.source === "nasdaq-fallback") ? "mixed" : "kis";
  return {
    scope: options.scope,
    rows: enriched,
    sectors,
    fetchedAt,
    updatedAt: fetchedAt,
    expiresAt: new Date(nowMs + MARKET_CAP_FRESH_MS).toISOString(),
    source,
    usdKrwRate,
  };
}

export function normalizeDomesticMarketCapRow(raw: ProviderPayload, fetchedAt: string, usdKrwRate = marketCapUsdKrwRate()): MarketCapRankingRow | undefined {
  const symbol = text(raw.mksc_shrn_iscd);
  const marketCapEok = numberValue(raw.stck_avls);
  const price = numberValue(raw.stck_prpr);
  if (!symbol || marketCapEok === undefined || price === undefined) return undefined;
  const marketCap = marketCapEok * DOMESTIC_MARKET_CAP_UNIT;
  return {
    rank: Math.max(0, Math.trunc(numberValue(raw.data_rank) ?? 0)),
    ticker: `KR:${symbol}`,
    market: "KR",
    symbol,
    name: text(raw.hts_kor_isnm) || symbol,
    exchange: KIS_DOMESTIC_EXCHANGE_LABEL,
    price,
    priceChange: numberValue(raw.prdy_vrss) ?? 0,
    priceChangePercent: percentValue(raw.prdy_ctrt),
    marketCap,
    marketCapCurrency: "KRW",
    marketCapUsd: usdKrwRate > 0 ? marketCap / usdKrwRate : marketCap / DEFAULT_USD_KRW_RATE,
    fetchedAt,
    source: "kis-domestic",
  };
}

export function normalizeOverseasMarketCapRow(raw: ProviderPayload, fetchedAt: string): MarketCapRankingRow | undefined {
  const symbol = text(raw.symb);
  const marketCap = numberValue(raw.mcap) ?? numberValue(raw.tomv);
  const price = numberValue(raw.last);
  if (!symbol || marketCap === undefined || price === undefined) return undefined;
  return {
    rank: Math.max(0, Math.trunc(numberValue(raw.rank) ?? 0)),
    ticker: `US:${symbol}`,
    market: "US",
    symbol,
    name: text(raw.name) || text(raw.ename) || symbol,
    exchangeCode: text(raw.excd),
    price,
    priceChange: numberValue(raw.diff) ?? 0,
    priceChangePercent: percentValue(raw.rate),
    marketCap,
    marketCapCurrency: "USD",
    marketCapUsd: marketCap,
    fetchedAt,
    source: "kis-overseas",
  };
}

export function normalizeNasdaqMarketCapRow(raw: ProviderPayload, fetchedAt: string): MarketCapRankingRow | undefined {
  const symbol = normalizeUsSymbol(raw.symbol);
  const marketCap = numberValue(raw.marketCap);
  const price = numberValue(raw.lastsale);
  if (!symbol || marketCap === undefined || marketCap <= 0 || price === undefined) return undefined;
  return {
    rank: 0,
    ticker: `US:${symbol}`,
    market: "US",
    symbol,
    name: text(raw.name) || symbol,
    price,
    priceChange: numberValue(raw.netchange) ?? 0,
    priceChangePercent: percentValue(raw.pctchange),
    marketCap,
    marketCapCurrency: "USD",
    marketCapUsd: marketCap,
    sector: meaningfulText(raw.sector),
    industry: meaningfulText(raw.industry),
    fetchedAt,
    source: "nasdaq-fallback",
  };
}

export function mergeMarketCapRows(rows: MarketCapRankingRow[], options: MergeOptions): MarketCapRankingRow[] {
  const symbolMap = symbolInstrumentMap(options.symbols || localSymbols);
  const byTicker = new Map<string, MarketCapRankingRow>();
  for (const row of rows) {
    if (!scopeIncludesRow(options.scope, row)) continue;
    if (!isSingleStockRow(row, symbolMap)) continue;
    const existing = byTicker.get(row.ticker);
    if (!existing || row.marketCapUsd > existing.marketCapUsd) byTicker.set(row.ticker, row);
  }

  return [...byTicker.values()]
    .sort((left, right) => right.marketCapUsd - left.marketCapUsd || left.ticker.localeCompare(right.ticker))
    .slice(0, options.limit ?? DEFAULT_LIMIT)
    .map((row, index) => ({
      ...row,
      rank: index + 1,
    }));
}

export async function enrichMarketCapRowsWithSectors(rows: MarketCapRankingRow[], chunkSize = 50): Promise<MarketCapRankingRow[]> {
  const chunks: MarketCapRankingRow[][] = [];
  for (let index = 0; index < rows.length; index += chunkSize) {
    chunks.push(rows.slice(index, index + chunkSize));
  }

  const enrichedChunks: MarketCapRankingRow[][] = [];
  for (const chunk of chunks) {
    enrichedChunks.push(await Promise.all(chunk.map(enrichMarketCapRowWithSector)));
  }
  return enrichedChunks.flat();
}

export function marketCapUsdKrwRate(): number {
  const parsed = Number(process.env.MARKET_CAP_USD_KRW_RATE || process.env.STOCK_USD_KRW_RATE || "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_USD_KRW_RATE;
}

export function marketCapDisplayLabel(row: Pick<MarketCapRankingRow, "marketCap" | "marketCapCurrency">): string {
  return row.marketCapCurrency === "KRW" ? formatKoreanWonLarge(row.marketCap) : formatCompactUsd(row.marketCap);
}

export function overseasMarketCapRequestParams(excd: string): Record<string, string> {
  return {
    EXCD: excd,
    VOL_RANG: "0",
    KEYB: "",
    AUTH: "",
    CURR_GB: "",
  };
}

async function fetchDomesticMarketCapRows(options: { fetchedAt: string; usdKrwRate: number }): Promise<MarketCapRankingRow[]> {
  if (!kisQuoteConfigured()) return [];
  await acquireKisMarketCapSlot();
  const rows: MarketCapRankingRow[] = [];
  let trCont = "";
  for (let page = 0; page < 5 && rows.length < DEFAULT_LIMIT; page += 1) {
    const response = await kisGetRaw(
      "/uapi/domestic-stock/v1/ranking/market-cap",
      "FHPST01740000",
      {
        fid_input_price_2: "",
        fid_cond_mrkt_div_code: "J",
        fid_cond_scr_div_code: "20174",
        fid_div_cls_code: "1",
        fid_input_iscd: "0000",
        fid_trgt_cls_code: "0",
        fid_trgt_exls_cls_code: "0",
        fid_input_price_1: "",
        fid_vol_cnt: "",
      },
      { trCont }
    );
    for (const item of outputList(response.payload, "output")) {
      const normalized = normalizeDomesticMarketCapRow(item, options.fetchedAt, options.usdKrwRate);
      if (normalized) rows.push(normalized);
    }
    if (response.trCont !== "M") break;
    trCont = "N";
  }
  return rows;
}

async function fetchOverseasMarketCapRows(options: { fetchedAt: string }): Promise<MarketCapRankingRow[]> {
  const nasdaqRows = await fetchNasdaqMarketCapRows(options);
  if (nasdaqRows.length) return nasdaqRows;
  if (!kisQuoteConfigured()) return [];
  await acquireKisMarketCapSlot();
  const perMarket = await Promise.all(KIS_US_MARKETS.map(async (market) => {
    const rows: MarketCapRankingRow[] = [];
    let trCont = "";
    for (let page = 0; page < 5 && rows.length < DEFAULT_LIMIT; page += 1) {
      try {
        const response = await kisGetRaw(
          "/uapi/overseas-stock/v1/ranking/market-cap",
          "HHDFS76350100",
          overseasMarketCapRequestParams(market.excd),
          { trCont }
        );
        for (const item of outputList(response.payload, "output2")) {
          const normalized = normalizeOverseasMarketCapRow({ ...item, excd: item.excd || market.excd }, options.fetchedAt);
          if (normalized) rows.push(normalized);
        }
        if (response.trCont !== "M" && response.trCont !== "F") break;
        trCont = "N";
      } catch (error) {
        console.warn("market_cap_overseas_fetch_failed", { exchange: market.excd, error: safeErrorMessage(error) });
        break;
      }
    }
    return rows;
  }));
  return perMarket.flat();
}

async function fetchNasdaqMarketCapRows(options: { fetchedAt: string }): Promise<MarketCapRankingRow[]> {
  const params = new URLSearchParams({ tableonly: "true", download: "true" });
  try {
    const response = await fetchWithTimeout(
      `${NASDAQ_SCREENER_URL}?${params.toString()}`,
      { headers: NASDAQ_SCREENER_HEADERS, cache: "no-store" },
      5_000
    );
    if (!response.ok) throw new Error(`nasdaq_market_cap_http_${response.status}`);
    const payload = await response.json() as ProviderPayload;
    const data = recordValue(payload.data);
    return outputList(data || {}, "rows")
      .map((item) => normalizeNasdaqMarketCapRow(item, options.fetchedAt))
      .filter((row): row is MarketCapRankingRow => !!row);
  } catch (error) {
    console.warn("market_cap_nasdaq_fetch_failed", { error: safeErrorMessage(error) });
    return [];
  }
}

async function enrichMarketCapRowWithSector(row: MarketCapRankingRow): Promise<MarketCapRankingRow> {
  const profile = await getSymbolIndustryProfile({ market: row.market, symbol: row.symbol });
  const mapping = await getIndustryTaxonomyMappingForProfile(profile);
  const sector = meaningfulText(mapping?.canonicalSectorName) || meaningfulText(profile?.primarySector);
  const industry = meaningfulText(mapping?.canonicalIndustryName) || meaningfulText(profile?.primaryIndustry);
  return {
    ...row,
    name: meaningfulText(profile?.name) || row.name,
    exchange: row.exchange || meaningfulText(profile?.exchange),
    sector,
    industry,
  };
}

function sectorsFromRows(rows: MarketCapRankingRow[]): string[] {
  return [...new Set(rows.map((row) => meaningfulText(row.sector)).filter((value): value is string => !!value))]
    .sort((left, right) => left.localeCompare(right));
}

function symbolInstrumentMap(items: SymbolMasterItem[]) {
  return new Map(items.map((item) => [`${item.market}:${item.ticker.toUpperCase()}`, item]));
}

function scopeIncludesRow(scope: MarketCapScope, row: MarketCapRankingRow): boolean {
  if (scope === "domestic") return row.market === "KR";
  if (scope === "overseas") return row.market === "US";
  return true;
}

function isSingleStockRow(row: MarketCapRankingRow, symbolMap: Map<string, SymbolMasterItem>): boolean {
  const item = symbolMap.get(row.ticker);
  if (item) return item.instrumentType === "STOCK";
  const name = row.name.toLowerCase();
  if (/\b(etf|fund|trust|warrant|right|unit|preferred|depositary preferred)\b/.test(name)) return false;
  if (/(?:U|W|R)$/.test(row.symbol) && /\b(unit|warrant|right)\b/.test(name)) return false;
  return true;
}

function outputList(payload: ProviderPayload, key: string): ProviderPayload[] {
  const value = payload[key];
  if (Array.isArray(value)) return value.filter((item): item is ProviderPayload => Boolean(item) && typeof item === "object" && !Array.isArray(item));
  return [];
}

function recordValue(value: unknown): ProviderPayload | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as ProviderPayload : undefined;
}

function acquireKisMarketCapSlot() {
  return acquireRateLimit(
    fixedRateLimitKey("stock-kis-market-cap-provider-global"),
    apiLimitPolicy("stock_kis_market_cap_provider", 90, 60)
  ).then((result) => {
    if (!result.allowed) throw new Error(`kis_market_cap_rate_limited_until_${result.resetAt}`);
  });
}

function numberValue(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(String(value).replace(/[,$]/g, "").replace(/%$/, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function percentValue(value: unknown): number {
  const parsed = numberValue(value);
  return parsed === undefined ? 0 : Math.round((parsed / 100) * 1_000_000) / 1_000_000;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function meaningfulText(value: unknown): string | undefined {
  const cleaned = text(value);
  return cleaned && cleaned !== "-" ? cleaned : undefined;
}

function normalizeUsSymbol(value: unknown): string {
  return text(value).toUpperCase().replace("/", ".");
}
