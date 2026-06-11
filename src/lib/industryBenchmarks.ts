import type { IndustryBenchmark, RuleJudgmentStock } from "@/lib/ruleBasedJudgment";
import { envValue, fetchWithTimeout, numericEnv, supabaseHeaders, supabaseReadConfig } from "@/lib/supabaseRest";

export type IndustryBenchmarkLookup = {
  scope?: "KR" | "OVERSEAS";
  market?: string;
  sector?: string;
  industry?: string;
  metric: string;
  period?: string;
};

type BenchmarkCacheEntry = {
  value?: IndustryBenchmark;
  expiresAt: number;
};

type BenchmarkRow = {
  scope?: string | null;
  market?: string;
  sector?: string;
  industry?: string;
  metric?: string;
  period?: string | null;
  median?: number | string | null;
  p25?: number | string | null;
  p75?: number | string | null;
  sample_count?: number | string | null;
  source?: string | null;
  provider_group_name?: string | null;
};

type NormalizedBenchmarkLookup = {
  scope?: "KR" | "OVERSEAS";
  market?: string;
  sector?: string;
  industry?: string;
  metric: string;
  period?: string;
};

declare global {
  var __stockIndustryBenchmarkCache: Map<string, BenchmarkCacheEntry> | undefined;
}

const SUPABASE_TABLE = "stock_industry_benchmarks";
const DEFAULT_CACHE_SECONDS = 6 * 60 * 60;
const DEFAULT_MISS_CACHE_SECONDS = 60;
const DEFAULT_PERIOD = "quarter";
const DEFAULT_BENCHMARK_METRICS = ["forward_per", "per", "ev_revenue", "psr", "pbr"];
const benchmarkCache = (globalThis.__stockIndustryBenchmarkCache ??= new Map<string, BenchmarkCacheEntry>());

export async function getIndustryBenchmarkForStock(stock: RuleJudgmentStock): Promise<IndustryBenchmark | undefined> {
  return getIndustryBenchmark({
    market: String(stock.market || ""),
    scope: scopeFromMarket(String(stock.market || "")),
    sector: stock.sector,
    industry: stock.industry,
    metric: "per",
    period: DEFAULT_PERIOD,
  });
}

export async function getIndustryBenchmarksForStock(stock: RuleJudgmentStock, metrics = DEFAULT_BENCHMARK_METRICS): Promise<IndustryBenchmark[]> {
  const results = await Promise.all(
    metrics.map((metric) =>
      getIndustryBenchmark({
        market: String(stock.market || ""),
        scope: scopeFromMarket(String(stock.market || "")),
        sector: stock.sector,
        industry: stock.industry,
        metric,
        period: DEFAULT_PERIOD,
      })
    )
  );
  return results.filter((item): item is IndustryBenchmark => Boolean(item));
}

export async function getIndustryBenchmark(lookup: IndustryBenchmarkLookup): Promise<IndustryBenchmark | undefined> {
  const market = lookup.market?.trim().toUpperCase();
  const scope = normalizeScope(lookup.scope) || scopeFromMarket(market);
  const metric = lookup.metric.trim().toLowerCase();
  const industry = lookup.industry?.trim();
  const sector = lookup.sector?.trim();
  const period = normalizePeriod(lookup.period) || DEFAULT_PERIOD;
  if ((!scope && !market) || !metric) return undefined;

  const fallbacks = fallbackLookups({ scope, market, metric, industry, sector, period });
  for (const candidate of fallbacks) {
    const value = await getCachedOrFetch(candidate);
    if (value) return value;
  }
  return undefined;
}

export function clearIndustryBenchmarkCacheForTests() {
  benchmarkCache.clear();
}

async function getCachedOrFetch(lookup: NormalizedBenchmarkLookup) {
  const key = cacheKey(lookup);
  const now = Date.now();
  const cached = benchmarkCache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;

  const value = await fetchBenchmark(lookup);
  benchmarkCache.set(key, {
    value,
    expiresAt: now + (value ? cacheSeconds() : missCacheSeconds()) * 1000,
  });
  pruneBenchmarkCache(now);
  return value;
}

async function fetchBenchmark(lookup: NormalizedBenchmarkLookup) {
  if (lookup.scope) {
    const scoped = await fetchBenchmarkRows(lookup, "scope");
    if (scoped) return scoped;
  }
  if (lookup.market) return fetchBenchmarkRows(lookup, "market");
  return undefined;
}

async function fetchBenchmarkRows(lookup: NormalizedBenchmarkLookup, mode: "scope" | "market") {
  const config = supabaseReadConfig();
  if (!config) return undefined;

  const query = new URLSearchParams();
  query.set(
    "select",
    mode === "scope"
      ? "scope,market,sector,industry,metric,period,median,p25,p75,sample_count,source,provider_group_name"
      : "market,sector,industry,metric,median,p25,p75,sample_count"
  );
  if (mode === "scope") {
    if (!lookup.scope) return undefined;
    query.set("scope", `eq.${lookup.scope}`);
    if (lookup.period) query.set("period", `eq.${lookup.period}`);
  } else {
    if (!lookup.market) return undefined;
    query.set("market", `eq.${lookup.market}`);
  }
  query.set("metric", `eq.${lookup.metric}`);
  query.set("expires_at", `gt.${new Date().toISOString()}`);
  if (lookup.industry) {
    query.set("industry", `eq.${lookup.industry}`);
    if (lookup.sector) query.set("sector", `eq.${lookup.sector}`);
  } else if (lookup.sector) {
    query.set("sector", `eq.${lookup.sector}`);
    query.set("industry", "eq.");
  } else {
    query.set("sector", "eq.");
    query.set("industry", "eq.");
  }
  query.set("order", mode === "scope" ? "expires_at.desc,sample_count.desc,updated_at.desc" : "expires_at.desc,sample_count.desc");
  query.set("limit", "1");

  try {
    const response = await fetchWithTimeout(`${config.url}/rest/v1/${SUPABASE_TABLE}?${query.toString()}`, {
      headers: supabaseHeaders(config.key),
      cache: "no-store",
    }, numericEnv("STOCK_INDUSTRY_BENCHMARK_TIMEOUT_MS", 1_500));
    if (!response.ok) return undefined;
    const rows = (await response.json()) as BenchmarkRow[];
    return benchmarkFromRow(rows[0]);
  } catch {
    return undefined;
  }
}

function benchmarkFromRow(row: BenchmarkRow | undefined): IndustryBenchmark | undefined {
  if (!row) return undefined;
  const metric = row.metric?.trim().toLowerCase();
  if (!metric) return undefined;
  const median = numberFromValue(row.median);
  if (median === undefined) return undefined;
  return {
    scope: normalizeScope(row.scope) || scopeFromMarket(row.market),
    market: row.market?.trim().toUpperCase(),
    sector: row.sector?.trim() || undefined,
    industry: row.industry?.trim() || undefined,
    metric,
    period: row.period?.trim() || undefined,
    median,
    p25: numberFromValue(row.p25),
    p75: numberFromValue(row.p75),
    sampleCount: numberFromValue(row.sample_count),
    source: row.source?.trim() || undefined,
    providerGroupName: row.provider_group_name?.trim() || undefined,
  };
}

function cacheKey(lookup: NormalizedBenchmarkLookup): string {
  return [
    lookup.scope || "",
    (lookup.market || "").toUpperCase(),
    lookup.metric.toLowerCase(),
    lookup.period || "",
    (lookup.industry || "").toLowerCase(),
    (lookup.sector || "").toLowerCase(),
  ].join(":");
}

function cacheSeconds(): number {
  return numericEnv("STOCK_INDUSTRY_BENCHMARK_CACHE_SECONDS", DEFAULT_CACHE_SECONDS);
}

function missCacheSeconds(): number {
  const parsed = Number(envValue("STOCK_INDUSTRY_BENCHMARK_MISS_CACHE_SECONDS"));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MISS_CACHE_SECONDS;
}

function pruneBenchmarkCache(now: number) {
  if (benchmarkCache.size < numericEnv("STOCK_INDUSTRY_BENCHMARK_CACHE_MAX_ENTRIES", 5_000)) return;
  for (const [key, item] of benchmarkCache) {
    if (item.expiresAt <= now) benchmarkCache.delete(key);
  }
}

function numberFromValue(value: number | string | null | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function scopeFromMarket(value: string | null | undefined): "KR" | "OVERSEAS" | undefined {
  const market = value?.trim().toUpperCase();
  if (market === "KR") return "KR";
  if (market === "US") return "OVERSEAS";
  return undefined;
}

function normalizeScope(value: unknown): "KR" | "OVERSEAS" | undefined {
  const scope = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (scope === "KR" || scope === "DOMESTIC") return "KR";
  if (scope === "OVERSEAS" || scope === "US" || scope === "GLOBAL") return "OVERSEAS";
  return undefined;
}

function normalizePeriod(value: unknown): string | undefined {
  const period = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (["quarter", "annual", "ttm"].includes(period)) return period;
  return undefined;
}

function fallbackLookups(lookup: NormalizedBenchmarkLookup): NormalizedBenchmarkLookup[] {
  const candidates: NormalizedBenchmarkLookup[] = [];
  if (lookup.industry) candidates.push(lookup);
  if (lookup.sector) {
    candidates.push({
      scope: lookup.scope,
      market: lookup.market,
      metric: lookup.metric,
      sector: lookup.sector,
      period: lookup.period,
    });
  }
  candidates.push({
    scope: lookup.scope,
    market: lookup.market,
    metric: lookup.metric,
    period: lookup.period,
  });

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = cacheKey(candidate);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
