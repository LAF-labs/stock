import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  buildSymbolSearchIndex,
  clampSymbolSearchLimit,
  exactAliasFromSymbolIndex,
  exactSymbolFromIndex,
  localSymbolSearchCacheKey,
  normalizeSymbolMarket,
  searchSymbolIndex,
  toSymbolSearchItem,
  type SymbolSearchIndexEntry,
} from "@/lib/symbolLocalSearch";
import { fetchWithTimeout, numericEnv, supabaseHeaders, supabaseReadConfig } from "@/lib/supabaseRest";
import type { SymbolListingStatus, SymbolMarket, SymbolMasterItem, SymbolSearchItem } from "@/lib/symbolTypes";
import { parseTickerRef, resolveTickerAlias, validTickerSymbolForMarket, type TickerAliasResolution } from "@/lib/tickerRef";

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

type LocalSymbolIndex = {
  entries: SymbolSearchIndexEntry[];
  resultCache: Map<string, SymbolSearchItem[]>;
};

let localIndexPromise: Promise<LocalSymbolIndex> | undefined;

export async function searchSymbols(input: SymbolSearchInput): Promise<SymbolSearchItem[]> {
  const query = input.query || "";
  const limit = clampSymbolSearchLimit(input.limit);
  const market = normalizeSymbolMarket(input.market);
  const aliasItem = await exactAliasSearchItem(query, market);
  if (aliasItem) return [aliasItem];
  const rpcItems = await searchSupabaseSymbols({ query, limit, market });
  if (rpcItems) return rpcItems;
  return searchCachedLocalIndex(await localSymbolIndex(), { query, limit, market });
}

export async function searchLocalSymbolsForTests(items: SymbolMasterItem[], input: SymbolSearchInput): Promise<SymbolSearchItem[]> {
  return searchSymbolIndex(buildSymbolSearchIndex(items), input);
}

export async function findExactSymbol(tickerRef: string): Promise<SymbolSearchItem | undefined> {
  const parsed = parseTickerRef(tickerRef);
  const localExact = await findExactLocalSymbol(tickerRef);
  if (localExact) return localExact;

  const items = await searchSymbols({ query: parsed.symbol, market: parsed.market, limit: 20 });
  return items.find((item) => item.market === parsed.market && item.ticker.toUpperCase() === parsed.symbol);
}

export async function findExactLocalSymbol(tickerRef: string): Promise<SymbolSearchItem | undefined> {
  const parsed = parseTickerRef(tickerRef);
  return exactSymbolFromIndex((await localSymbolIndex()).entries, parsed);
}

export async function enrichStockPayloadWithSymbolDisplay<T extends Record<string, unknown>>(payload: T): Promise<T & Record<string, unknown>> {
  const tickerRef = tickerRefFromPayload(payload);
  if (!tickerRef) return payload as T & Record<string, unknown>;

  const item = await findExactSymbol(tickerRef);
  if (!item) return payload as T & Record<string, unknown>;

  const displayName = item.displayName || cleanString(payload.display_name);
  const koreanName = item.koreanName || cleanString(payload.korean_name) || (hasHangul(displayName) ? displayName : "");
  const englishName = item.englishName || cleanString(payload.english_name);

  return {
    ...payload,
    display_name: displayName,
    korean_name: koreanName || undefined,
    english_name: englishName || undefined,
    instrument_type: item.instrumentType || cleanString(payload.instrument_type) || undefined,
  };
}

async function exactAliasSearchItem(query: string, market: SymbolMarket | undefined): Promise<SymbolSearchItem | undefined> {
  const alias = resolveTickerAlias(query);
  if (!isDeterministicAlias(alias)) return undefined;
  if (market && market !== alias.market) return undefined;

  const rpcItems = await searchSupabaseSymbols({ query: alias.symbol, limit: 20, market: alias.market });
  const rpcExact = rpcItems?.find((item) => item.market === alias.market && item.ticker.toUpperCase() === alias.symbol);
  if (rpcExact) return rpcExact;

  return exactAliasFromSymbolIndex((await localSymbolIndex()).entries, query, market);
}

function isDeterministicAlias(alias: TickerAliasResolution): alias is Extract<TickerAliasResolution, { ok: true }> {
  return alias.ok && alias.source !== "symbol_master";
}

function searchCachedLocalIndex(store: LocalSymbolIndex, input: SymbolSearchInput): SymbolSearchItem[] {
  const key = localSymbolSearchCacheKey(input);
  const cached = store.resultCache.get(key);
  if (cached) return [...cached];

  const items = searchSymbolIndex(store.entries, input);
  rememberLocalSearch(store.resultCache, key, items);
  return items;
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

async function localSymbolIndex(): Promise<LocalSymbolIndex> {
  if (!localIndexPromise) {
    localIndexPromise = readLocalSymbolItems().then((items) => ({
      entries: buildSymbolSearchIndex(items),
      resultCache: new Map<string, SymbolSearchItem[]>(),
    }));
  }
  return localIndexPromise;
}

async function readLocalSymbolItems(): Promise<SymbolMasterItem[]> {
  const raw = await readFile(path.join(process.cwd(), "src", "data", "symbols.generated.json"), "utf8");
  const parsed = JSON.parse(raw) as unknown;
  return Array.isArray(parsed) ? parsed as SymbolMasterItem[] : [];
}

function rememberLocalSearch(cache: Map<string, SymbolSearchItem[]>, key: string, items: SymbolSearchItem[]) {
  const limit = Math.max(0, numericEnv("STOCK_SYMBOL_LOCAL_QUERY_CACHE_MAX", 250));
  if (limit <= 0) return;
  if (cache.size >= limit) {
    const first = cache.keys().next().value;
    if (typeof first === "string") cache.delete(first);
  }
  cache.set(key, [...items]);
}

function itemFromRpcRow(row: RpcSymbolSearchRow): SymbolSearchItem | undefined {
  const market = normalizeSymbolMarket(row.market);
  const ticker = cleanString(row.ticker);
  if (!market || !ticker) return undefined;
  if (!validTickerSymbolForMarket(market, ticker)) return undefined;
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
  return toSymbolSearchItem(item);
}

function tickerRefFromPayload(payload: Record<string, unknown>): string | undefined {
  const requestedTicker = cleanString(payload.requested_ticker);
  if (/^(US|KR):/i.test(requestedTicker)) return parseTickerRef(requestedTicker).ticker;

  const market = normalizeSymbolMarket(cleanString(payload.market));
  const symbol = cleanString(payload.symbol) || requestedTicker || cleanString(payload.ticker);
  if (!symbol) return undefined;
  if (market) return `${market}:${symbol.toUpperCase()}`;

  return parseTickerRef(symbol).ticker;
}

function normalizeInstrumentType(value: string | null | undefined): "STOCK" | "ETF" {
  return value?.trim().toUpperCase() === "ETF" ? "ETF" : "STOCK";
}

function normalizeListingStatus(value: string | null | undefined): SymbolListingStatus {
  const status = value?.trim();
  return status === "delisted" || status === "newly_listed" || status === "pending_data" ? status : "listed";
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function hasHangul(value: string): boolean {
  return /[가-힣]/.test(value);
}
