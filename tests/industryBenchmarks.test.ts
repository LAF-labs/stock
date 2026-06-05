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
