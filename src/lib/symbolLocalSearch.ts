import { symbolDisplayName } from "@/lib/symbolDisplay";
import type { SymbolMarket, SymbolMasterItem, SymbolSearchItem } from "@/lib/symbolTypes";
import { resolveTickerAlias, validTickerSymbolForMarket, type ParsedTickerRef, type TickerAliasResolution } from "@/lib/tickerRef";

export type SymbolSearchInput = {
  query?: string;
  limit?: number;
  market?: string | null;
};

export type SymbolSearchIndexEntry = {
  item: SymbolMasterItem;
  key: string;
  displayName: string;
  tickerSearch: string;
  koreanSearch: string;
  englishSearch: string;
  displaySearch: string;
  aliasSearch: string[];
};

const DEFAULT_SYMBOLS = ["US:KO", "US:NVDA", "US:AAPL", "US:MSFT", "KR:005930", "KR:000660", "KR:035420", "KR:005380"];
const PRIORITY_SYMBOL_BONUS = new Map(DEFAULT_SYMBOLS.map((key, index) => [key, Math.max(8, 28 - index)]));
const CURATED_SYMBOL_OVERRIDES: SymbolMasterItem[] = [
  {
    market: "US",
    ticker: "SPCX",
    exchange: "NAS",
    exchangeName: "나스닥",
    koreanName: "스페이스X",
    englishName: "SpaceX Space Exploration Technologies Corp Class A Common Stock",
    instrumentType: "STOCK",
    currency: "USD",
    listingStatus: "newly_listed",
    listedAt: "2026-06-12",
  },
];
const CURATED_SYMBOL_ALIASES = new Map<string, string[]>([
  ["US:SPCX", ["스페이스엑스", "스엑스", "스엑", "Space X"]],
]);

export function buildSymbolSearchIndex(items: readonly SymbolMasterItem[]): SymbolSearchIndexEntry[] {
  return symbolSearchEntries(mergeCuratedSymbols(items));
}

export function searchCuratedSymbolOverrides(input: SymbolSearchInput): SymbolSearchItem[] {
  return searchSymbolIndex(symbolSearchEntries(CURATED_SYMBOL_OVERRIDES), input);
}

function symbolSearchEntries(items: readonly SymbolMasterItem[]): SymbolSearchIndexEntry[] {
  return items.filter(isApiSearchableSymbol).map((item) => {
    const displayName = symbolDisplayName(item);
    const key = `${item.market}:${item.ticker}`;
    return {
      item,
      key,
      displayName,
      tickerSearch: normalizeSymbolSearchText(item.ticker),
      koreanSearch: normalizeSymbolSearchText(item.koreanName || ""),
      englishSearch: normalizeSymbolSearchText(item.englishName || ""),
      displaySearch: normalizeSymbolSearchText(displayName),
      aliasSearch: (CURATED_SYMBOL_ALIASES.get(key) || []).map(normalizeSymbolSearchText).filter(Boolean),
    };
  });
}

export function searchSymbolIndex(index: readonly SymbolSearchIndexEntry[], input: SymbolSearchInput): SymbolSearchItem[] {
  const query = input.query || "";
  const limit = clampSymbolSearchLimit(input.limit);
  const market = normalizeSymbolMarket(input.market);
  const normalizedQuery = normalizeSymbolSearchText(query);
  const aliasItem = exactAliasFromSymbolIndex(index, query, market);
  if (aliasItem) return [aliasItem].slice(0, limit);

  const scored: Array<{ entry: SymbolSearchIndexEntry; score: number }> = [];
  for (const entry of index) {
    if (market && entry.item.market !== market) continue;
    if (entry.item.listingStatus === "delisted") continue;
    const score = normalizedQuery ? applyPrioritySymbolBias(entry, rankSymbolEntry(entry, normalizedQuery)) : DEFAULT_SYMBOLS.includes(entry.key) ? 0 : 999;
    if (score < 999) scored.push({ entry, score });
  }

  return scored
    .sort((left, right) => left.score - right.score || left.entry.item.market.localeCompare(right.entry.item.market) || left.entry.item.ticker.localeCompare(right.entry.item.ticker))
    .slice(0, limit)
    .map(({ entry }) => toSymbolSearchItem(entry.item));
}

export function exactAliasFromSymbolIndex(index: readonly SymbolSearchIndexEntry[], query: string, market: SymbolMarket | undefined): SymbolSearchItem | undefined {
  const alias = resolveTickerAlias(query);
  if (!isDeterministicAlias(alias)) return undefined;
  if (market && market !== alias.market) return undefined;
  const entry = index.find((item) => item.item.market === alias.market && item.item.ticker.toUpperCase() === alias.symbol && item.item.listingStatus !== "delisted");
  return entry ? toSymbolSearchItem(entry.item) : undefined;
}

export function exactSymbolFromIndex(index: readonly SymbolSearchIndexEntry[], parsed: ParsedTickerRef): SymbolSearchItem | undefined {
  const entry = index.find((item) => item.item.market === parsed.market && item.item.ticker.toUpperCase() === parsed.symbol && item.item.listingStatus !== "delisted");
  return entry ? toSymbolSearchItem(entry.item) : undefined;
}

export function toSymbolSearchItem(item: SymbolMasterItem): SymbolSearchItem {
  const key = `${item.market}:${item.ticker}`;
  return {
    ...item,
    key,
    displayName: symbolDisplayName(item),
    subtitle: [item.market === "US" ? "미국" : "국내", item.exchangeName || item.exchange].filter(Boolean).join(" · "),
  };
}

export function localSymbolSearchCacheKey(input: SymbolSearchInput): string {
  return [normalizeSymbolMarket(input.market) || "", clampSymbolSearchLimit(input.limit), normalizeSymbolSearchText(input.query || "")].join("\u0000");
}

export function normalizeSymbolSearchText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[.\-_/()[\],]/g, "");
}

export function normalizeSymbolMarket(value: string | null | undefined): SymbolMarket | undefined {
  const market = value?.trim().toUpperCase();
  return market === "US" || market === "KR" ? market : undefined;
}

export function clampSymbolSearchLimit(value: number | undefined): number {
  return Math.min(Math.max(Number.isFinite(value) ? Number(value) : 8, 1), 20);
}

function isApiSearchableSymbol(item: SymbolMasterItem): boolean {
  return validTickerSymbolForMarket(item.market, item.ticker);
}

function rankSymbolEntry(entry: SymbolSearchIndexEntry, normalizedQuery: string): number {
  if (!normalizedQuery) return DEFAULT_SYMBOLS.includes(entry.key) ? 0 : 999;
  if (entry.tickerSearch === normalizedQuery) return 0;
  if (entry.koreanSearch === normalizedQuery || entry.displaySearch === normalizedQuery || entry.aliasSearch.includes(normalizedQuery)) return 2;
  if (entry.englishSearch === normalizedQuery) return 4;
  if (entry.tickerSearch.startsWith(normalizedQuery)) return 10 + entry.tickerSearch.length;
  if (entry.koreanSearch.startsWith(normalizedQuery) || entry.displaySearch.startsWith(normalizedQuery) || entry.aliasSearch.some((value) => value.startsWith(normalizedQuery))) return 30 + entry.displaySearch.length;
  if (entry.englishSearch.startsWith(normalizedQuery)) return 45 + entry.englishSearch.length;
  const nearNameScore = fuzzyNameScore(entry, normalizedQuery);
  if (nearNameScore < 999) return nearNameScore;
  if (entry.tickerSearch.includes(normalizedQuery)) return 60 + entry.tickerSearch.indexOf(normalizedQuery);
  if (entry.koreanSearch.includes(normalizedQuery) || entry.displaySearch.includes(normalizedQuery) || entry.aliasSearch.some((value) => value.includes(normalizedQuery))) {
    const positions = [entry.koreanSearch, entry.displaySearch, ...entry.aliasSearch]
      .filter((value) => value.includes(normalizedQuery))
      .map((value) => value.indexOf(normalizedQuery));
    return 80 + Math.min(...positions);
  }
  if (entry.englishSearch.includes(normalizedQuery)) return 100 + entry.englishSearch.indexOf(normalizedQuery);
  return 999;
}

function fuzzyNameScore(entry: SymbolSearchIndexEntry, normalizedQuery: string): number {
  if (Array.from(normalizedQuery).length < 3) return 999;
  const localNames = [entry.koreanSearch, entry.displaySearch, ...entry.aliasSearch].filter(Boolean);
  if (localNames.some((value) => hasNearPrefix(value, normalizedQuery))) return 55 + entry.displaySearch.length;
  if (entry.englishSearch && hasNearPrefix(entry.englishSearch, normalizedQuery)) return 70 + entry.englishSearch.length;
  return 999;
}

function hasNearPrefix(candidate: string, query: string): boolean {
  if (!candidate || !query) return false;
  const candidateChars = Array.from(candidate);
  const queryChars = Array.from(query);
  for (const lengthDelta of [-1, 0, 1]) {
    const length = queryChars.length + lengthDelta;
    if (length <= 0 || length > candidateChars.length) continue;
    if (hasEditDistanceAtMostOne(queryChars, candidateChars.slice(0, length))) return true;
  }
  return candidateChars.length < queryChars.length && hasEditDistanceAtMostOne(queryChars, candidateChars);
}

function hasEditDistanceAtMostOne(leftChars: string[], rightChars: string[]): boolean {
  const lengthDelta = leftChars.length - rightChars.length;
  if (Math.abs(lengthDelta) > 1) return false;
  let leftIndex = 0;
  let rightIndex = 0;
  let edits = 0;

  while (leftIndex < leftChars.length && rightIndex < rightChars.length) {
    if (leftChars[leftIndex] === rightChars[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }

    edits += 1;
    if (edits > 1) return false;
    if (lengthDelta === 0) {
      leftIndex += 1;
      rightIndex += 1;
    } else if (lengthDelta < 0) {
      rightIndex += 1;
    } else {
      leftIndex += 1;
    }
  }

  if (leftIndex < leftChars.length || rightIndex < rightChars.length) edits += 1;
  return edits <= 1;
}

function mergeCuratedSymbols(items: readonly SymbolMasterItem[]): SymbolMasterItem[] {
  const byKey = new Map(items.map((item) => [`${item.market}:${item.ticker}`, item]));
  for (const override of CURATED_SYMBOL_OVERRIDES) {
    const key = `${override.market}:${override.ticker}`;
    const existing = byKey.get(key);
    byKey.set(key, existing ? { ...existing, ...override, standardCode: override.standardCode || existing.standardCode } : override);
  }
  return [...byKey.values()];
}

function applyPrioritySymbolBias(entry: SymbolSearchIndexEntry, score: number): number {
  if (score <= 0 || score >= 999) return score;
  const bonus = PRIORITY_SYMBOL_BONUS.get(entry.key);
  return bonus ? Math.max(1, score - bonus) : score;
}

function isDeterministicAlias(alias: TickerAliasResolution): alias is Extract<TickerAliasResolution, { ok: true }> {
  return alias.ok && alias.source !== "symbol_master";
}
