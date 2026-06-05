import { fetchWithTimeout, numericEnv, supabaseHeaders, supabaseReadConfig } from "@/lib/supabaseRest";
import type { SymbolListingStatus, SymbolMarket, SymbolMasterItem, SymbolSearchItem } from "@/lib/symbolTypes";

type SymbolSearchInput = {
  query?: string;
  limit?: number;
  market?: string | null;
};

type RpcSymbolSearchRow = {
  market?: string | null;
  ticker?: string | null;
  exchange?: string | null;
  exchange_name?: string | null;
  korean_name?: string | null;
  english_name?: string | null;
  instrument_type?: string | null;
  currency?: string | null;
  standard_code?: string | null;
  provider_sector_code?: string | null;
  listing_status?: string | null;
  listed_at?: string | null;
  delisted_at?: string | null;
};

type IndexedSymbol = {
  item: SymbolMasterItem;
  key: string;
  displayName: string;
  tickerSearch: string;
  koreanSearch: string;
  englishSearch: string;
  displaySearch: string;
};

const DEFAULT_SYMBOLS = ["US:KO", "US:NVDA", "US:AAPL", "US:MSFT", "KR:005930", "KR:000660", "KR:035420", "KR:005380"];

let localIndexPromise: Promise<IndexedSymbol[]> | undefined;

export async function searchSymbols(input: SymbolSearchInput): Promise<SymbolSearchItem[]> {
  const query = input.query || "";
  const limit = clampLimit(input.limit);
  const market = normalizeMarket(input.market);
  const rpcItems = await searchSupabaseSymbols({ query, limit, market });
  if (rpcItems) return rpcItems;
  return searchLocalIndex(await localSymbolIndex(), { query, limit, market });
}

export async function searchLocalSymbolsForTests(items: SymbolMasterItem[], input: SymbolSearchInput): Promise<SymbolSearchItem[]> {
  return searchLocalIndex(buildIndex(items), input);
}

function searchLocalIndex(index: IndexedSymbol[], input: SymbolSearchInput): SymbolSearchItem[] {
  const query = input.query || "";
  const limit = clampLimit(input.limit);
  const market = normalizeMarket(input.market);
  const normalizedQuery = normalize(query);
  return index
    .filter((entry) => {
      if (market && entry.item.market !== market) return false;
      if (entry.item.listingStatus === "delisted") return false;
      if (!normalizedQuery) return DEFAULT_SYMBOLS.includes(entry.key);
      return rank(entry, normalizedQuery) < 999;
    })
    .map((entry) => ({ entry, score: rank(entry, normalizedQuery) }))
    .sort((left, right) => left.score - right.score || left.entry.item.market.localeCompare(right.entry.item.market) || left.entry.item.ticker.localeCompare(right.entry.item.ticker))
    .slice(0, limit)
    .map(({ entry }) => toSearchItem(entry.item));
}

async function searchSupabaseSymbols(input: { query: string; limit: number; market?: SymbolMarket }): Promise<SymbolSearchItem[] | undefined> {
  const config = supabaseReadConfig();
  if (!config) return undefined;

  try {
    const response = await fetchWithTimeout(
      `${config.url}/rest/v1/rpc/search_stock_symbols`,
      {
        method: "POST",
        headers: supabaseHeaders(config.key),
        body: JSON.stringify({
          p_query: input.query,
          p_limit: input.limit,
          p_market: input.market || null,
        }),
        cache: "no-store",
      },
      numericEnv("STOCK_SYMBOL_SEARCH_TIMEOUT_MS", 1_000)
    );
    if (!response.ok) return undefined;
    const rows = (await response.json()) as RpcSymbolSearchRow[];
    if (!Array.isArray(rows)) return undefined;
    return rows.map(itemFromRpcRow).filter((item): item is SymbolSearchItem => !!item);
  } catch {
    return undefined;
  }
}

async function localSymbolIndex(): Promise<IndexedSymbol[]> {
  if (!localIndexPromise) {
    localIndexPromise = import("@/data/symbols.generated.json").then((module) => buildIndex(module.default as SymbolMasterItem[]));
  }
  return localIndexPromise;
}

function buildIndex(items: SymbolMasterItem[]): IndexedSymbol[] {
  return items.map((item) => {
    const displayName = displayNameFor(item);
    return {
      item,
      key: `${item.market}:${item.ticker}`,
      displayName,
      tickerSearch: normalize(item.ticker),
      koreanSearch: normalize(item.koreanName || ""),
      englishSearch: normalize(item.englishName || ""),
      displaySearch: normalize(displayName),
    };
  });
}

function toSearchItem(item: SymbolMasterItem): SymbolSearchItem {
  const key = `${item.market}:${item.ticker}`;
  return {
    ...item,
    key,
    displayName: displayNameFor(item),
    subtitle: `${item.market === "US" ? "미국" : "국내"} · ${item.exchangeName} · ${item.ticker}`,
  };
}

function itemFromRpcRow(row: RpcSymbolSearchRow): SymbolSearchItem | undefined {
  const market = normalizeMarket(row.market);
  const ticker = cleanString(row.ticker);
  if (!market || !ticker) return undefined;
  const item: SymbolMasterItem = {
    market,
    ticker,
    exchange: cleanString(row.exchange),
    exchangeName: cleanString(row.exchange_name) || cleanString(row.exchange),
    koreanName: cleanString(row.korean_name),
    englishName: cleanString(row.english_name),
    instrumentType: normalizeInstrumentType(row.instrument_type),
    currency: cleanString(row.currency) || undefined,
    standardCode: cleanString(row.standard_code) || undefined,
    providerSectorCode: cleanString(row.provider_sector_code) || undefined,
    listingStatus: normalizeListingStatus(row.listing_status),
    listedAt: cleanString(row.listed_at) || undefined,
    delistedAt: cleanString(row.delisted_at) || undefined,
  };
  return toSearchItem(item);
}

function displayNameFor(item: SymbolMasterItem): string {
  if (item.instrumentType === "ETF" && item.englishName) return item.englishName;
  return item.koreanName || item.englishName || item.ticker;
}

function rank(entry: IndexedSymbol, normalizedQuery: string): number {
  if (!normalizedQuery) return DEFAULT_SYMBOLS.includes(entry.key) ? 0 : 999;
  if (entry.tickerSearch === normalizedQuery) return 0;
  if (entry.koreanSearch === normalizedQuery || entry.displaySearch === normalizedQuery) return 2;
  if (entry.englishSearch === normalizedQuery) return 4;
  if (entry.tickerSearch.startsWith(normalizedQuery)) return 10 + entry.tickerSearch.length;
  if (entry.koreanSearch.startsWith(normalizedQuery) || entry.displaySearch.startsWith(normalizedQuery)) return 30 + entry.displaySearch.length;
  if (entry.englishSearch.startsWith(normalizedQuery)) return 45 + entry.englishSearch.length;
  if (entry.tickerSearch.includes(normalizedQuery)) return 60 + entry.tickerSearch.indexOf(normalizedQuery);
  if (entry.koreanSearch.includes(normalizedQuery) || entry.displaySearch.includes(normalizedQuery)) {
    const positions = [entry.koreanSearch, entry.displaySearch].filter((value) => value.includes(normalizedQuery)).map((value) => value.indexOf(normalizedQuery));
    return 80 + Math.min(...positions);
  }
  if (entry.englishSearch.includes(normalizedQuery)) return 100 + entry.englishSearch.indexOf(normalizedQuery);
  return 999;
}

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[.\-_/()[\],]/g, "");
}

function normalizeMarket(value: string | null | undefined): SymbolMarket | undefined {
  const market = value?.trim().toUpperCase();
  return market === "US" || market === "KR" ? market : undefined;
}

function normalizeInstrumentType(value: string | null | undefined): "STOCK" | "ETF" {
  return value?.trim().toUpperCase() === "ETF" ? "ETF" : "STOCK";
}

function normalizeListingStatus(value: string | null | undefined): SymbolListingStatus {
  const status = value?.trim();
  return status === "delisted" || status === "newly_listed" || status === "pending_data" ? status : "listed";
}

function clampLimit(value: number | undefined): number {
  return Math.min(Math.max(Number.isFinite(value) ? Number(value) : 8, 1), 20);
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
