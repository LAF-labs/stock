import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  clearIndustryBenchmarkCacheForTests,
  getIndustryBenchmark,
  getIndustryBenchmarksForStock,
} from "../src/lib/industryBenchmarks";

const originalFetch = globalThis.fetch;
const originalEnv = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
};

function restore() {
  globalThis.fetch = originalFetch;
  clearIndustryBenchmarkCacheForTests();
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

test.afterEach(restore);

test("industry benchmark lookup is cached per process", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";

  let calls = 0;
  let requestedUrl = "";
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls += 1;
    requestedUrl = String(input);
    return new Response(
      JSON.stringify([
        {
          market: "US",
          sector: "Consumer Defensive",
          industry: "Beverages",
          metric: "per",
          median: 18,
          p25: 14,
          p75: 24,
          sample_count: 32,
        },
      ]),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  const first = await getIndustryBenchmark({
    market: "US",
    sector: "Consumer Defensive",
    industry: "Beverages",
    metric: "per",
  });
  const second = await getIndustryBenchmark({
    market: "US",
    sector: "Consumer Defensive",
    industry: "Beverages",
    metric: "per",
  });

  assert.equal(calls, 1);
  assert.match(requestedUrl, /stock_industry_benchmarks/);
  assert.match(requestedUrl, /industry=eq\.Beverages/);
  assert.equal(first?.median, 18);
  assert.equal(second?.p75, 24);
});

test("industry benchmark lookup can target sector aggregate rows", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";

  let requestedUrl = "";
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requestedUrl = String(input);
    return new Response(
      JSON.stringify([
        {
          market: "KR",
          sector: "Technology",
          industry: "",
          metric: "pbr",
          median: 1.4,
          p25: 0.9,
          p75: 2.0,
          sample_count: 14,
        },
      ]),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  const benchmark = await getIndustryBenchmark({
    market: "KR",
    sector: "Technology",
    metric: "pbr",
  });

  assert.match(requestedUrl, /sector=eq\.Technology/);
  assert.match(requestedUrl, /industry=eq\./);
  assert.equal(benchmark?.metric, "pbr");
  assert.equal(benchmark?.median, 1.4);
});

test("industry benchmark lookup prefers domestic scope over market-only rows", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";

  let requestedUrl = "";
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requestedUrl = String(input);
    return new Response(
      JSON.stringify([
        {
          scope: "KR",
          market: "KR",
          sector: "산업재",
          industry: "로봇",
          metric: "per",
          period: "quarter",
          median: 31.2,
          p25: 22.1,
          p75: 44.8,
          sample_count: 18,
          source: "fnguide_tics",
        },
      ]),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  const benchmark = await getIndustryBenchmark({
    market: "KR",
    sector: "산업재",
    industry: "로봇",
    metric: "per",
    period: "quarter",
  });

  assert.match(requestedUrl, /scope=eq\.KR/);
  assert.doesNotMatch(requestedUrl, /market=eq\.KR/);
  assert.match(requestedUrl, /period=eq\.quarter/);
  assert.equal(benchmark?.scope, "KR");
  assert.equal(benchmark?.period, "quarter");
  assert.equal(benchmark?.source, "fnguide_tics");
  assert.equal(benchmark?.median, 31.2);
});

test("industry benchmark lookup falls back to legacy market rows when scoped rows are absent", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";

  const requestedUrls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requestedUrls.push(url);
    if (url.includes("scope=eq.OVERSEAS")) {
      return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(
      JSON.stringify([
        {
          market: "US",
          sector: "Information Technology",
          industry: "반도체",
          metric: "per",
          median: 46.6,
          sample_count: 144,
        },
      ]),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  const benchmark = await getIndustryBenchmark({
    market: "US",
    sector: "Information Technology",
    industry: "반도체",
    metric: "per",
  });

  assert.equal(requestedUrls.length, 2);
  assert.match(requestedUrls[0], /scope=eq\.OVERSEAS/);
  assert.match(requestedUrls[1], /market=eq\.US/);
  assert.equal(benchmark?.scope, "OVERSEAS");
  assert.equal(benchmark?.median, 46.6);
});

test("industry benchmark lookup falls back to scope aggregate rows when industry and sector rows are absent", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";

  const requestedUrls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requestedUrls.push(url);
    if (requestedUrls.length < 3) {
      return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(
      JSON.stringify([
        {
          scope: "OVERSEAS",
          market: "US",
          sector: "",
          industry: "",
          metric: "per",
          period: "quarter",
          median: 21.5,
          sample_count: 420,
          source: "score_snapshot",
        },
      ]),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  const benchmark = await getIndustryBenchmark({
    market: "US",
    sector: "Tiny Sector",
    industry: "Thin Industry",
    metric: "per",
  });

  assert.equal(requestedUrls.length, 3);
  assert.match(requestedUrls[0], /industry=eq\.Thin\+Industry/);
  assert.match(requestedUrls[1], /sector=eq\.Tiny\+Sector/);
  assert.match(requestedUrls[1], /industry=eq\./);
  assert.match(requestedUrls[2], /sector=eq\./);
  assert.match(requestedUrls[2], /industry=eq\./);
  assert.equal(benchmark?.median, 21.5);
  assert.equal(benchmark?.sampleCount, 420);
});

test("industry benchmark lookup keeps missing-result cache short so refreshes become visible", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
  process.env.STOCK_INDUSTRY_BENCHMARK_MISS_CACHE_SECONDS = "0";

  let calls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls += 1;
    const url = new URL(String(input));
    if (url.searchParams.get("sector") === "eq.소형" || calls <= 4) {
      return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(
      JSON.stringify([
        {
          scope: "KR",
          market: "KR",
          sector: "",
          industry: "",
          metric: "per",
          period: "quarter",
          median: 14.8,
          sample_count: 300,
        },
      ]),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  const first = await getIndustryBenchmark({ market: "KR", sector: "소형", metric: "per" });
  const second = await getIndustryBenchmark({ market: "KR", sector: "소형", metric: "per" });

  assert.equal(first, undefined);
  assert.equal(second?.median, 14.8);
  assert.equal(calls, 7);
});

test("stock benchmark lookup includes forward valuation metrics by default", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";

  const requestedMetrics: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const metric = url.searchParams.get("metric")?.replace(/^eq\./, "") || "";
    requestedMetrics.push(metric);
    return new Response(
      JSON.stringify([
        {
          scope: "OVERSEAS",
          market: "US",
          sector: "Technology",
          industry: "Semiconductors",
          metric,
          period: "quarter",
          median: 20,
          p25: 15,
          p75: 30,
          sample_count: 12,
        },
      ]),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  const benchmarks = await getIndustryBenchmarksForStock({
    market: "US",
    sector: "Technology",
    industry: "Semiconductors",
    score: 80,
    keyMetrics: [],
    valuation: [],
    components: [{ label: "이익성", score: 90 }],
  });

  assert.deepEqual(requestedMetrics, ["forward_per", "per", "ev_revenue", "psr", "pbr"]);
  assert.deepEqual(benchmarks.map((item) => item.metric), requestedMetrics);
});

test("industry benchmark migration uses market calendar expiry instead of fixed one day TTL", () => {
  const migration = readFileSync(
    join(process.cwd(), "supabase/migrations/20260607060000_calendar_aware_industry_benchmark_expiry.sql"),
    "utf8"
  );

  assert.match(migration, /create or replace function public\.stock_industry_benchmark_expires_at/);
  assert.match(migration, /from public\.market_calendar/);
  assert.match(migration, /close_at \+ grace_window/);
  assert.match(migration, /public\.stock_industry_benchmark_expires_at\(scope, market\)/);
  assert.doesNotMatch(migration, /now\(\) \+ interval '1 day'/);
});

test("latest industry benchmark migration creates market-wide fallback rows", () => {
  const migration = readFileSync(
    join(process.cwd(), "supabase/migrations/20260611124500_prune_expired_industry_benchmark_rows.sql"),
    "utf8"
  );

  assert.match(migration, /or expires_at <= now\(\)/);
  assert.match(migration, /select scope, market, '' as sector, '' as industry, metric, value/);
  assert.match(migration, /group by scope, market, sector, industry, metric/);
  assert.match(migration, /coalesce\(fetched_at, updated_at\) >= now\(\) - interval '30 days'/);
  assert.doesNotMatch(migration, /and expires_at > now\(\)/);
  assert.match(migration, /public\.stock_industry_benchmark_expires_at\(scope, market\)/);
});
