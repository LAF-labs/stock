import test from "node:test";
import assert from "node:assert/strict";

import { clearIndustryBenchmarkCacheForTests } from "../src/lib/industryBenchmarks";
import { enrichStockPayloadWithIndustryBenchmarks } from "../src/lib/stockIndustryBenchmarkEnrichment";

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

test("industry benchmark enrichment appends benchmark rows to score valuation payloads", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const metric = url.searchParams.get("metric")?.replace(/^eq\./, "") || "";
    if (metric !== "per" && metric !== "pbr") {
      return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(
      JSON.stringify([
        {
          scope: "OVERSEAS",
          market: "US",
          sector: "필수소비재",
          industry: "음료",
          metric,
          period: "quarter",
          median: metric === "per" ? 18.25 : 4.1,
          p25: metric === "per" ? 14 : 2.2,
          p75: metric === "per" ? 24 : 6.8,
          sample_count: 32,
          source: "score_snapshot",
        },
      ]),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  const enriched = await enrichStockPayloadWithIndustryBenchmarks({
    ok: true,
    requested_ticker: "US:KO",
    market: "US",
    symbol: "KO",
    sector: "필수소비재",
    industry: "음료",
    valuation_rows: [{ label: "PER", value: "29.98" }],
    key_metrics: [],
    components: [{ label: "이익성", score: 82 }],
  });

  const rows = enriched.valuation_rows as Array<{ label?: string; value?: string; note?: string }>;
  const benchmarks = enriched.industry_benchmarks as Array<{ metric?: string; median?: number }>;

  assert.equal(rows.some((row) => row.label === "업종 기준 PER" && row.value === "18.25"), true);
  assert.equal(rows.some((row) => row.label === "업종 기준 PBR" && row.value === "4.10"), true);
  assert.equal(rows.find((row) => row.label === "업종 기준 PER")?.note, "해외 음료 업종 기준");
  assert.deepEqual(benchmarks.map((item) => item.metric), ["per", "pbr"]);
});

test("industry benchmark enrichment does not duplicate existing benchmark labels", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify([
        {
          scope: "KR",
          market: "KR",
          sector: "정보기술",
          industry: "반도체",
          metric: "per",
          period: "quarter",
          median: 11,
          sample_count: 50,
        },
      ]),
      { status: 200, headers: { "content-type": "application/json" } }
    )) as typeof fetch;

  const enriched = await enrichStockPayloadWithIndustryBenchmarks({
    ok: true,
    market: "KR",
    symbol: "005930",
    sector: "정보기술",
    industry: "반도체",
    valuation_rows: [{ label: "업종 기준 PER", value: "10.00" }],
  });

  const rows = enriched.valuation_rows as Array<{ label?: string; value?: string }>;
  assert.equal(rows.filter((row) => row.label === "업종 기준 PER").length, 1);
  assert.equal(rows.find((row) => row.label === "업종 기준 PER")?.value, "11.00");
});
