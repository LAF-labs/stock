import { fetchWithTimeout, numericEnv, supabaseHeaders, supabaseReadConfig } from "@/lib/supabaseRest";
import {
  getIndustryTaxonomyMappingForProfile,
  sourceKeyForProfile,
  type IndustryTaxonomyMapping,
} from "@/lib/industryTaxonomy";

export type SymbolProfileTarget = {
  market: "US" | "KR";
  symbol: string;
};

export type SymbolIndustryProfile = {
  market: "US" | "KR";
  symbol: string;
  name?: string;
  exchange?: string;
  assetClass?: string;
  primarySector?: string;
  primaryIndustry?: string;
  primarySectorKey?: string;
  primaryIndustryKey?: string;
  classificationStatus?: string;
  source?: string;
  sourcePriority?: number;
  metadata?: Record<string, unknown>;
  updatedAt?: string;
};

type SymbolIndustryProfileRow = {
  market?: string | null;
  symbol?: string | null;
  name?: string | null;
  exchange?: string | null;
  asset_class?: string | null;
  primary_sector?: string | null;
  primary_industry?: string | null;
  primary_sector_key?: string | null;
  primary_industry_key?: string | null;
  classification_status?: string | null;
  source?: string | null;
  source_priority?: number | string | null;
  metadata?: Record<string, unknown> | null;
  updated_at?: string | null;
};

type SymbolProfileCacheEntry = {
  value?: SymbolIndustryProfile;
  expiresAt: number;
};

declare global {
  var __stockSymbolProfileCache: Map<string, SymbolProfileCacheEntry> | undefined;
}

const SUPABASE_TABLE = "stock_symbol_profiles";
const DEFAULT_CACHE_SECONDS = 24 * 60 * 60;
const symbolProfileCache = (globalThis.__stockSymbolProfileCache ??= new Map<string, SymbolProfileCacheEntry>());

export function targetFromStockPayload(raw: unknown): SymbolProfileTarget | undefined {
  const payload = recordFromUnknown(raw);
  const explicitMarket = normalizeMarket(cleanString(payload.market));
  const symbolCandidate = firstText(payload.symbol, payload.requested_ticker, payload.ticker, payload.code);
  if (!symbolCandidate) return undefined;

  const prefixed = parsePrefixedSymbol(symbolCandidate);
  if (prefixed) return prefixed;

  const market = explicitMarket || marketFromSymbol(symbolCandidate);
  if (!market) return undefined;

  const symbol = normalizeSymbol(symbolCandidate, market);
  if (!symbol) return undefined;
  return { market, symbol };
}

export async function enrichStockPayloadWithSymbolProfile<T extends Record<string, unknown>>(payload: T): Promise<T & Record<string, unknown>> {
  const target = targetFromStockPayload(payload);
  if (!target) return payload as T & Record<string, unknown>;
  const profile = await getSymbolIndustryProfile(target);
  const mapping = await getIndustryTaxonomyMappingForProfile(profile);
  return mergeSymbolProfileIntoPayload(payload, profile, mapping);
}

export async function getSymbolIndustryProfile(target: SymbolProfileTarget): Promise<SymbolIndustryProfile | undefined> {
  const normalized = normalizeTarget(target);
  if (!normalized) return undefined;

  const key = cacheKey(normalized);
  const now = Date.now();
  const cached = symbolProfileCache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;

  const value = await fetchSymbolIndustryProfile(normalized);
  symbolProfileCache.set(key, {
    value,
    expiresAt: now + cacheSeconds() * 1000,
  });
  pruneSymbolProfileCache(now);
  return value;
}

export function mergeSymbolProfileIntoPayload<T extends Record<string, unknown>>(
  payload: T,
  profile: SymbolIndustryProfile | undefined,
  mapping?: IndustryTaxonomyMapping
): T & Record<string, unknown> {
  if (!profile) return payload as T & Record<string, unknown>;

  const currentSector = cleanString(payload.sector);
  const currentIndustry = cleanString(payload.industry);
  const rawSector = meaningfulText(currentSector) || meaningfulText(profile.primarySector);
  const rawIndustry = meaningfulText(currentIndustry) || meaningfulText(profile.primaryIndustry);
  const sector = meaningfulText(mapping?.canonicalSectorName) || rawSector;
  const industry = meaningfulText(mapping?.canonicalIndustryName) || rawIndustry;
  const result: Record<string, unknown> = { ...payload };

  if (sector) result.sector = sector;
  if (industry) result.industry = industry;
  if (rawSector) result.raw_sector = rawSector;
  if (rawIndustry) result.raw_industry = rawIndustry;

  const rows = Array.isArray(payload.stock_profile)
    ? payload.stock_profile.map((item) => ({ ...recordFromUnknown(item) }))
    : [];
  upsertProfileRow(rows, ["섹터", "Sector"], sector);
  upsertProfileRow(rows, ["산업", "Industry"], industry);
  if (rows.length > 0) result.stock_profile = rows;

  result.industry_profile = {
    market: profile.market,
    symbol: profile.symbol,
    name: profile.name,
    exchange: profile.exchange,
    asset_class: profile.assetClass,
    primary_sector: profile.primarySector,
    primary_industry: profile.primaryIndustry,
    primary_sector_key: profile.primarySectorKey,
    primary_industry_key: profile.primaryIndustryKey,
    raw_sector: rawSector,
    raw_industry: rawIndustry,
    display_sector: sector,
    display_industry: industry,
    canonical_sector_key: mapping?.canonicalSectorKey,
    canonical_sector_name: mapping?.canonicalSectorName,
    canonical_industry_key: mapping?.canonicalIndustryKey,
    canonical_industry_name: mapping?.canonicalIndustryName,
    taxonomy_source_key: sourceKeyForProfile(profile),
    taxonomy_confidence: mapping?.confidence,
    classification_status: profile.classificationStatus,
    source: profile.source,
    source_priority: profile.sourcePriority,
    metadata: profile.metadata,
    updated_at: profile.updatedAt,
  };

  return result as T & Record<string, unknown>;
}

export function clearSymbolProfileCacheForTests() {
  symbolProfileCache.clear();
}

async function fetchSymbolIndustryProfile(target: SymbolProfileTarget): Promise<SymbolIndustryProfile | undefined> {
  const config = supabaseReadConfig();
  if (!config) return undefined;

  const query = new URLSearchParams();
  query.set(
    "select",
    [
      "market",
      "symbol",
      "name",
      "exchange",
      "asset_class",
      "primary_sector",
      "primary_industry",
      "primary_sector_key",
      "primary_industry_key",
      "classification_status",
      "source",
      "source_priority",
      "metadata",
      "updated_at",
    ].join(",")
  );
  query.set("market", `eq.${target.market}`);
  query.set("symbol", `eq.${target.symbol}`);
  query.set("limit", "1");

  try {
    const response = await fetchWithTimeout(
      `${config.url}/rest/v1/${SUPABASE_TABLE}?${query.toString()}`,
      {
        headers: supabaseHeaders(config.key),
        cache: "no-store",
      },
      numericEnv("STOCK_SYMBOL_PROFILE_TIMEOUT_MS", 1_500)
    );
    if (!response.ok) return undefined;
    const rows = (await response.json()) as SymbolIndustryProfileRow[];
    return profileFromRow(rows[0]);
  } catch {
    return undefined;
  }
}

function profileFromRow(row: SymbolIndustryProfileRow | undefined): SymbolIndustryProfile | undefined {
  if (!row) return undefined;
  const market = normalizeMarket(cleanString(row.market));
  const rawSymbol = cleanString(row.symbol);
  if (!market || !rawSymbol) return undefined;
  const symbol = normalizeSymbol(rawSymbol, market);
  if (!symbol) return undefined;

  return {
    market,
    symbol,
    name: meaningfulText(row.name),
    exchange: meaningfulText(row.exchange),
    assetClass: meaningfulText(row.asset_class),
    primarySector: meaningfulText(row.primary_sector),
    primaryIndustry: meaningfulText(row.primary_industry),
    primarySectorKey: meaningfulText(row.primary_sector_key),
    primaryIndustryKey: meaningfulText(row.primary_industry_key),
    classificationStatus: meaningfulText(row.classification_status),
    source: meaningfulText(row.source),
    sourcePriority: numberFromValue(row.source_priority),
    metadata: recordOrUndefined(row.metadata),
    updatedAt: meaningfulText(row.updated_at),
  };
}

function normalizeTarget(target: SymbolProfileTarget): SymbolProfileTarget | undefined {
  const market = normalizeMarket(target.market);
  const symbol = normalizeSymbol(target.symbol, market || undefined);
  if (!market || !symbol) return undefined;
  return { market, symbol };
}

function cacheKey(target: SymbolProfileTarget): string {
  return `${target.market}:${target.symbol}`;
}

function cacheSeconds(): number {
  return numericEnv("STOCK_SYMBOL_PROFILE_CACHE_SECONDS", DEFAULT_CACHE_SECONDS);
}

function pruneSymbolProfileCache(now: number) {
  if (symbolProfileCache.size < numericEnv("STOCK_SYMBOL_PROFILE_CACHE_MAX_ENTRIES", 20_000)) return;
  for (const [key, item] of symbolProfileCache) {
    if (item.expiresAt <= now) symbolProfileCache.delete(key);
  }
}

function parsePrefixedSymbol(value: string): SymbolProfileTarget | undefined {
  const match = value.trim().match(/^(US|KR):(.+)$/i);
  if (!match) return undefined;
  const market = normalizeMarket(match[1]);
  const symbol = market ? normalizeSymbol(match[2], market) : "";
  if (!market || !symbol) return undefined;
  return { market, symbol };
}

function marketFromSymbol(value: string): "US" | "KR" {
  const symbol = value.trim().toUpperCase();
  if (/^Q?\d{6}(\.(KS|KQ))?$/.test(symbol)) return "KR";
  return "US";
}

function normalizeMarket(value: string | undefined): "US" | "KR" | undefined {
  const market = value?.trim().toUpperCase();
  return market === "US" || market === "KR" ? market : undefined;
}

function normalizeSymbol(value: string | undefined, market?: "US" | "KR"): string {
  const trimmed = value?.trim().toUpperCase() || "";
  const unprefixed = trimmed.replace(/^(US|KR):/i, "");
  if (market === "KR") {
    const domestic = unprefixed.match(/^(\d{6})(?:\.(?:KS|KQ))?$/);
    return domestic?.[1] || unprefixed.replace(/[^0-9]/g, "").slice(0, 6);
  }
  return unprefixed.replace(/[^A-Z0-9.-]/g, "");
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = cleanString(value);
    if (text) return text;
  }
  return undefined;
}

function upsertProfileRow(rows: Array<Record<string, unknown>>, labels: string[], value: string | undefined) {
  if (!value) return;
  const index = rows.findIndex((row) => {
    const label = cleanString(row.label);
    return labels.some((candidate) => labelsEqual(label, candidate));
  });
  if (index >= 0) {
    const current = cleanString(rows[index].value);
    if (!meaningfulText(current)) rows[index] = { ...rows[index], label: labels[0], value };
    return;
  }
  rows.push({ label: labels[0], value });
}

function labelsEqual(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function meaningfulText(value: unknown): string | undefined {
  const text = cleanString(value);
  return text && text !== "-" ? text : undefined;
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberFromValue(value: number | string | null | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function recordOrUndefined(value: unknown): Record<string, unknown> | undefined {
  const record = recordFromUnknown(value);
  return Object.keys(record).length > 0 ? record : undefined;
}
