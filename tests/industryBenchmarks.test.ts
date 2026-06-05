import test from "node:test";
import assert from "node:assert/strict";
import {
  clearIndustryBenchmarkCacheForTests,
  getIndustryBenchmark,
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
