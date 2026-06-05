import test from "node:test";
import assert from "node:assert/strict";
import {
  clearSymbolProfileCacheForTests,
  getSymbolIndustryProfile,
  mergeSymbolProfileIntoPayload,
  targetFromStockPayload,
  type SymbolIndustryProfile,
} from "../src/lib/symbolProfiles";
import { clearIndustryTaxonomyCacheForTests } from "../src/lib/industryTaxonomy";

const originalFetch = globalThis.fetch;
const originalEnv = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
  STOCK_SYMBOL_PROFILE_CACHE_SECONDS: process.env.STOCK_SYMBOL_PROFILE_CACHE_SECONDS,
  STOCK_SYMBOL_PROFILE_CACHE_MAX_ENTRIES: process.env.STOCK_SYMBOL_PROFILE_CACHE_MAX_ENTRIES,
};

function restore() {
  globalThis.fetch = originalFetch;
  clearSymbolProfileCacheForTests();
  clearIndustryTaxonomyCacheForTests();
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

test.afterEach(restore);

test("stock payload target detection normalizes market-prefixed and domestic tickers", () => {
  assert.deepEqual(targetFromStockPayload({ requested_ticker: "KR:005930" }), { market: "KR", symbol: "005930" });
  assert.deepEqual(targetFromStockPayload({ symbol: "005930" }), { market: "KR", symbol: "005930" });
  assert.deepEqual(targetFromStockPayload({ requested_ticker: "Q005930" }), { market: "KR", symbol: "005930" });
  assert.deepEqual(targetFromStockPayload({ requested_ticker: "ko", market: "us" }), { market: "US", symbol: "KO" });
});

test("symbol industry profile lookup is cached per process", async () => {
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
          market: "KR",
          symbol: "005930",
          name: "삼성전자",
          exchange: "KOSPI",
          asset_class: "stock",
          primary_sector: "Technology",
          primary_industry: "Semiconductors",
          primary_sector_key: "technology",
          primary_industry_key: "technology.semiconductors",
          classification_status: "verified",
          source: "yfinance",
          source_priority: 30,
          metadata: { yahoo_symbol: "005930.KS" },
          updated_at: "2026-06-05T00:00:00.000Z",
        },
      ]),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  const first = await getSymbolIndustryProfile({ market: "KR", symbol: "005930" });
  const second = await getSymbolIndustryProfile({ market: "KR", symbol: "005930" });

  assert.equal(calls, 1);
  assert.match(requestedUrl, /stock_symbol_profiles/);
  assert.match(requestedUrl, /market=eq\.KR/);
  assert.match(requestedUrl, /symbol=eq\.005930/);
  assert.equal(first?.primarySector, "Technology");
  assert.equal(first?.primaryIndustry, "Semiconductors");
  assert.deepEqual(second, first);
});

test("symbol industry profile enriches top-level and display profile fields", () => {
  const profile: SymbolIndustryProfile = {
    market: "KR",
    symbol: "005930",
    name: "삼성전자",
    exchange: "KOSPI",
    assetClass: "stock",
    primarySector: "Technology",
    primaryIndustry: "Semiconductors",
    primarySectorKey: "technology",
    primaryIndustryKey: "technology.semiconductors",
    classificationStatus: "verified",
    source: "yfinance",
    sourcePriority: 30,
    metadata: { yahoo_symbol: "005930.KS" },
  };

  const enriched = mergeSymbolProfileIntoPayload(
    {
      market: "KR",
      symbol: "005930",
      name: "삼성전자",
      stock_profile: [{ label: "회사명", value: "삼성전자" }],
    },
    profile,
    {
      taxonomy: "profile_primary",
      sourceKey: "KR:technology:technology.semiconductors",
      canonicalSectorKey: "정보기술",
      canonicalSectorName: "정보기술",
      canonicalIndustryKey: "정보기술_반도체",
      canonicalIndustryName: "반도체",
      confidence: 0.9,
    }
  );

  const rows = enriched.stock_profile as Array<{ label?: string; value?: string }>;
  const industryProfile = enriched.industry_profile as Record<string, unknown>;

  assert.equal(enriched.sector, "정보기술");
  assert.equal(enriched.industry, "반도체");
  assert.equal(enriched.raw_sector, "Technology");
  assert.equal(enriched.raw_industry, "Semiconductors");
  assert.equal(rows.some((row) => row.label === "섹터" && row.value === "정보기술"), true);
  assert.equal(rows.some((row) => row.label === "산업" && row.value === "반도체"), true);
  assert.equal(industryProfile.primary_sector_key, "technology");
  assert.equal(industryProfile.primary_industry_key, "technology.semiconductors");
  assert.equal(industryProfile.display_sector, "정보기술");
  assert.equal(industryProfile.display_industry, "반도체");
  assert.equal(industryProfile.canonical_industry_name, "반도체");
  assert.equal(industryProfile.classification_status, "verified");
});

test("symbol profile replaces quote ticker-name placeholders but keeps meaningful provider names", () => {
  const profile: SymbolIndustryProfile = {
    market: "KR",
    symbol: "005930",
    name: "삼성전자",
    exchange: "KOSPI",
    assetClass: "stock",
    classificationStatus: "verified",
    listingStatus: "listed",
    listedAt: "1975-06-11",
  };

  const placeholder = mergeSymbolProfileIntoPayload({ market: "KR", symbol: "005930", name: "005930" }, profile);
  const meaningful = mergeSymbolProfileIntoPayload({ market: "KR", symbol: "005930", name: "삼성전자우" }, profile);

  assert.equal(placeholder.name, "삼성전자");
  assert.equal(meaningful.name, "삼성전자우");
  assert.equal((placeholder.industry_profile as Record<string, unknown>).listing_status, "listed");
  assert.equal((placeholder.industry_profile as Record<string, unknown>).listed_at, "1975-06-11");
});
