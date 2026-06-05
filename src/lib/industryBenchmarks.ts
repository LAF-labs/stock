import type { IndustryBenchmark, RuleJudgmentStock } from "@/lib/ruleBasedJudgment";
import { fetchWithTimeout, numericEnv, supabaseHeaders, supabaseReadConfig } from "@/lib/supabaseRest";

export type IndustryBenchmarkLookup = {
  market?: string;
  sector?: string;
  industry?: string;
  metric: string;
};

type BenchmarkCacheEntry = {
  value?: IndustryBenchmark;
  expiresAt: number;
};

type BenchmarkRow = {
  market?: string;
  sector?: string;
  industry?: string;
  metric?: string;
  median?: number | string | null;
  p25?: number | string | null;
  p75?: number | string | null;
  sample_count?: number | string | null;
};

declare global {
  var __stockIndustryBenchmarkCache: Map<string, BenchmarkCacheEntry> | undefined;
}

const SUPABASE_TABLE = "stock_industry_benchmarks";
const DEFAULT_CACHE_SECONDS = 6 * 60 * 60;
const benchmarkCache = (globalThis.__stockIndustryBenchmarkCache ??= new Map<string, BenchmarkCacheEntry>());

export async function getIndustryBenchmarkForStock(stock: RuleJudgmentStock): Promise<IndustryBenchmark | undefined> {
  return getIndustryBenchmark({
    market: String(stock.market || ""),
    sector: stock.sector,
    industry: stock.industry,
    metric: "per",
  });
}

export async function getIndustryBenchmarksForStock(stock: RuleJudgmentStock, metrics = ["per", "pbr"]): Promise<IndustryBenchmark[]> {
  const results = await Promise.all(
    metrics.map((metric) =>
      getIndustryBenchmark({
        market: String(stock.market || ""),
        sector: stock.sector,
        industry: stock.industry,
        metric,
      })
    )
  );
  return results.filter((item): item is IndustryBenchmark => Boolean(item));
}

export async function getIndustryBenchmark(lookup: IndustryBenchmarkLookup): Promise<IndustryBenchmark | undefined> {
  const market = lookup.market?.trim().toUpperCase();
  const metric = lookup.metric.trim().toLowerCase();
  const industry = lookup.industry?.trim();
  const sector = lookup.sector?.trim();
  if (!market || !metric || (!industry && !sector)) return undefined;

  const exact = await getCachedOrFetch({ market, metric, industry, sector });
  if (exact || !industry || !sector) return exact;
  return getCachedOrFetch({ market, metric, sector });
}

export function clearIndustryBenchmarkCacheForTests() {
  benchmarkCache.clear();
}

async function getCachedOrFetch(lookup: Required<Pick<IndustryBenchmarkLookup, "market" | "metric">> & Pick<IndustryBenchmarkLookup, "sector" | "industry">) {
  const key = cacheKey(lookup);
  const now = Date.now();
  const cached = benchmarkCache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;

  const value = await fetchBenchmark(lookup);
  benchmarkCache.set(key, {
    value,
    expiresAt: now + cacheSeconds() * 1000,
  });
  pruneBenchmarkCache(now);
  return value;
}

async function fetchBenchmark(lookup: Required<Pick<IndustryBenchmarkLookup, "market" | "metric">> & Pick<IndustryBenchmarkLookup, "sector" | "industry">) {
  const config = supabaseReadConfig();
  if (!config) return undefined;

  const query = new URLSearchParams();
  query.set("select", "market,sector,industry,metric,median,p25,p75,sample_count");
  query.set("market", `eq.${lookup.market}`);
  query.set("metric", `eq.${lookup.metric}`);
  if (lookup.industry) {
    query.set("industry", `eq.${lookup.industry}`);
    if (lookup.sector) query.set("sector", `eq.${lookup.sector}`);
  } else if (lookup.sector) {
    query.set("sector", `eq.${lookup.sector}`);
    query.set("industry", "eq.");
  }
  query.set("order", "expires_at.desc,sample_count.desc");
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
    market: row.market?.trim().toUpperCase(),
    sector: row.sector?.trim() || undefined,
    industry: row.industry?.trim() || undefined,
    metric,
    median,
    p25: numberFromValue(row.p25),
    p75: numberFromValue(row.p75),
    sampleCount: numberFromValue(row.sample_count),
  };
}

function cacheKey(lookup: Required<Pick<IndustryBenchmarkLookup, "market" | "metric">> & Pick<IndustryBenchmarkLookup, "sector" | "industry">): string {
  return [
    lookup.market.toUpperCase(),
    lookup.metric.toLowerCase(),
    (lookup.industry || "").toLowerCase(),
    (lookup.sector || "").toLowerCase(),
  ].join(":");
}

function cacheSeconds(): number {
  return numericEnv("STOCK_INDUSTRY_BENCHMARK_CACHE_SECONDS", DEFAULT_CACHE_SECONDS);
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
