import { fetchWithTimeout, numericEnv, supabaseHeaders, supabaseReadConfig } from "@/lib/supabaseRest";
import type { SymbolIndustryProfile } from "@/lib/symbolProfiles";

export type IndustryTaxonomyMapping = {
  taxonomy: string;
  sourceKey: string;
  canonicalSectorKey?: string;
  canonicalSectorName?: string;
  canonicalIndustryKey?: string;
  canonicalIndustryName?: string;
  confidence?: number;
};

type IndustryTaxonomyRow = {
  taxonomy?: string | null;
  source_key?: string | null;
  canonical_sector_key?: string | null;
  canonical_sector_name?: string | null;
  canonical_industry_key?: string | null;
  canonical_industry_name?: string | null;
  confidence?: number | string | null;
};

type SymbolIndustryTagRow = {
  taxonomy?: string | null;
  code?: string | null;
  name?: string | null;
  level?: number | string | null;
  confidence?: number | string | null;
  source?: string | null;
};

type IndustryTaxonomyCacheEntry = {
  value?: IndustryTaxonomyMapping;
  expiresAt: number;
};

declare global {
  var __stockIndustryTaxonomyCache: Map<string, IndustryTaxonomyCacheEntry> | undefined;
}

const SUPABASE_TABLE = "industry_taxonomy_map";
const SYMBOL_TAG_TABLE = "stock_symbol_industry_tags";
const PROFILE_TAXONOMY = "profile_primary";
const SYMBOL_CANONICAL_TAXONOMY = "finviz_canonical";
const DEFAULT_CACHE_SECONDS = 24 * 60 * 60;
const taxonomyCache = (globalThis.__stockIndustryTaxonomyCache ??= new Map<string, IndustryTaxonomyCacheEntry>());

export async function getIndustryTaxonomyMappingForProfile(
  profile: SymbolIndustryProfile | undefined
): Promise<IndustryTaxonomyMapping | undefined> {
  const sourceKey = sourceKeyForProfile(profile);
  const symbolKey = symbolTagSourceKeyForProfile(profile);
  if (!sourceKey && !symbolKey) return undefined;

  const key = `${SYMBOL_CANONICAL_TAXONOMY}:${symbolKey || ""}:${PROFILE_TAXONOMY}:${sourceKey || ""}`;
  const now = Date.now();
  const cached = taxonomyCache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;

  const value =
    (await fetchSymbolCanonicalTagMapping(profile)) ||
    (sourceKey ? await fetchIndustryTaxonomyMapping(PROFILE_TAXONOMY, sourceKey) : undefined);
  taxonomyCache.set(key, {
    value,
    expiresAt: now + cacheSeconds() * 1000,
  });
  pruneTaxonomyCache(now);
  return value;
}

export function sourceKeyForProfile(profile: SymbolIndustryProfile | undefined): string | undefined {
  if (!profile?.market || !profile.primaryIndustryKey) return undefined;
  return [profile.market, profile.primarySectorKey || "", profile.primaryIndustryKey].join(":");
}

function symbolTagSourceKeyForProfile(profile: SymbolIndustryProfile | undefined): string | undefined {
  if (!profile?.market || !profile.symbol) return undefined;
  return [profile.market, profile.symbol].join(":");
}

export function clearIndustryTaxonomyCacheForTests() {
  taxonomyCache.clear();
}

async function fetchIndustryTaxonomyMapping(taxonomy: string, sourceKey: string): Promise<IndustryTaxonomyMapping | undefined> {
  const config = supabaseReadConfig();
  if (!config) return undefined;

  const query = new URLSearchParams();
  query.set(
    "select",
    [
      "taxonomy",
      "source_key",
      "canonical_sector_key",
      "canonical_sector_name",
      "canonical_industry_key",
      "canonical_industry_name",
      "confidence",
    ].join(",")
  );
  query.set("taxonomy", `eq.${taxonomy}`);
  query.set("source_key", `eq.${sourceKey}`);
  query.set("limit", "1");

  try {
    const response = await fetchWithTimeout(
      `${config.url}/rest/v1/${SUPABASE_TABLE}?${query.toString()}`,
      {
        headers: supabaseHeaders(config.key),
        cache: "no-store",
      },
      numericEnv("STOCK_INDUSTRY_TAXONOMY_TIMEOUT_MS", 1_500)
    );
    if (!response.ok) return undefined;
    const rows = (await response.json()) as IndustryTaxonomyRow[];
    return mappingFromRow(rows[0]);
  } catch {
    return undefined;
  }
}

async function fetchSymbolCanonicalTagMapping(profile: SymbolIndustryProfile | undefined): Promise<IndustryTaxonomyMapping | undefined> {
  const symbolKey = symbolTagSourceKeyForProfile(profile);
  if (!profile?.market || !profile.symbol || !symbolKey) return undefined;

  const config = supabaseReadConfig();
  if (!config) return undefined;

  const query = new URLSearchParams();
  query.set("select", ["taxonomy", "code", "name", "level", "confidence", "source"].join(","));
  query.set("market", `eq.${profile.market}`);
  query.set("symbol", `eq.${profile.symbol}`);
  query.set("taxonomy", `eq.${SYMBOL_CANONICAL_TAXONOMY}`);
  query.set("level", "in.(1,2)");
  query.set("order", "level.asc,confidence.desc,updated_at.desc");

  try {
    const response = await fetchWithTimeout(
      `${config.url}/rest/v1/${SYMBOL_TAG_TABLE}?${query.toString()}`,
      {
        headers: supabaseHeaders(config.key),
        cache: "no-store",
      },
      numericEnv("STOCK_INDUSTRY_TAXONOMY_TIMEOUT_MS", 1_500)
    );
    if (!response.ok) return undefined;
    const rows = (await response.json()) as SymbolIndustryTagRow[];
    return mappingFromSymbolTagRows(symbolKey, rows);
  } catch {
    return undefined;
  }
}

function mappingFromRow(row: IndustryTaxonomyRow | undefined): IndustryTaxonomyMapping | undefined {
  if (!row?.taxonomy || !row.source_key) return undefined;
  return {
    taxonomy: row.taxonomy,
    sourceKey: row.source_key,
    canonicalSectorKey: meaningfulText(row.canonical_sector_key),
    canonicalSectorName: meaningfulText(row.canonical_sector_name),
    canonicalIndustryKey: meaningfulText(row.canonical_industry_key),
    canonicalIndustryName: meaningfulText(row.canonical_industry_name),
    confidence: numberFromValue(row.confidence),
  };
}

function mappingFromSymbolTagRows(sourceKey: string, rows: SymbolIndustryTagRow[]): IndustryTaxonomyMapping | undefined {
  const sector = rows.find((row) => numberFromValue(row.level) === 1 && meaningfulText(row.name));
  const industry = rows.find((row) => numberFromValue(row.level) === 2 && meaningfulText(row.name));
  if (!sector && !industry) return undefined;

  return {
    taxonomy: SYMBOL_CANONICAL_TAXONOMY,
    sourceKey,
    canonicalSectorKey: meaningfulText(sector?.code),
    canonicalSectorName: meaningfulText(sector?.name),
    canonicalIndustryKey: meaningfulText(industry?.code),
    canonicalIndustryName: meaningfulText(industry?.name),
    confidence: numberFromValue(industry?.confidence) ?? numberFromValue(sector?.confidence),
  };
}

function cacheSeconds(): number {
  return numericEnv("STOCK_INDUSTRY_TAXONOMY_CACHE_SECONDS", DEFAULT_CACHE_SECONDS);
}

function pruneTaxonomyCache(now: number) {
  if (taxonomyCache.size < numericEnv("STOCK_INDUSTRY_TAXONOMY_CACHE_MAX_ENTRIES", 10_000)) return;
  for (const [key, item] of taxonomyCache) {
    if (item.expiresAt <= now) taxonomyCache.delete(key);
  }
}

function meaningfulText(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text && text !== "-" ? text : undefined;
}

function numberFromValue(value: number | string | null | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
