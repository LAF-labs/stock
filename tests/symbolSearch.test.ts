import test from "node:test";
import assert from "node:assert/strict";

import { searchLocalSymbolsForTests, searchSymbols } from "../src/lib/symbolSearch";

const originalFetch = globalThis.fetch;
const originalEnv = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  STOCK_SYMBOL_SEARCH_TIMEOUT_MS: process.env.STOCK_SYMBOL_SEARCH_TIMEOUT_MS,
};

function restore() {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

test.afterEach(restore);

test("symbol search uses Supabase RPC when available", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "anon-key";
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  const calls: Array<{ url: string; body?: string }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: String(init?.body || "") });
    return Response.json([
      {
        market: "US",
        ticker: "NVDA",
        exchange: "NASDAQ",
        exchange_name: "Nasdaq",
        korean_name: "엔비디아",
        english_name: "NVIDIA Corporation",
        instrument_type: "STOCK",
        currency: "USD",
        standard_code: null,
        provider_sector_code: "technology.semiconductors",
        listing_status: "listed",
        listed_at: "1999-01-22",
        delisted_at: null,
      },
    ]);
  }) as typeof fetch;

  const items = await searchSymbols({ query: "nvda", limit: 8 });

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/search_stock_symbols$/);
  assert.equal(JSON.parse(calls[0].body || "{}").p_query, "nvda");
  assert.equal(items.length, 1);
  assert.equal(items[0].key, "US:NVDA");
  assert.equal(items[0].displayName, "엔비디아");
  assert.equal(items[0].listingStatus, "listed");
  assert.equal(items[0].listedAt, "1999-01-22");
});

test("symbol search does not fallback when Supabase returns a real empty result", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "anon-key";

  globalThis.fetch = (async () => Response.json([])) as typeof fetch;

  const items = await searchSymbols({ query: "ko", limit: 8 });

  assert.deepEqual(items, []);
});

test("symbol search falls back to the generated universe when Supabase is unavailable", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "anon-key";

  globalThis.fetch = (async () => new Response("service unavailable", { status: 503 })) as typeof fetch;

  const items = await searchSymbols({ query: "nvda", limit: 8, market: "US" });

  assert.equal(items.some((item) => item.key === "US:NVDA"), true);
});

test("local symbol search excludes delisted rows and keeps newly listed rows searchable", async () => {
  const items = await searchLocalSymbolsForTests(
    [
      {
        market: "US",
        ticker: "LIVE",
        exchange: "NASDAQ",
        exchangeName: "Nasdaq",
        koreanName: "",
        englishName: "Live Corp",
        instrumentType: "STOCK",
        listingStatus: "listed",
      },
      {
        market: "US",
        ticker: "DEAD",
        exchange: "NASDAQ",
        exchangeName: "Nasdaq",
        koreanName: "",
        englishName: "Dead Corp",
        instrumentType: "STOCK",
        listingStatus: "delisted",
      },
      {
        market: "KR",
        ticker: "123456",
        exchange: "KOSDAQ",
        exchangeName: "KOSDAQ",
        koreanName: "새상장",
        englishName: "New Listing",
        instrumentType: "STOCK",
        listingStatus: "newly_listed",
      },
    ],
    { query: "새", limit: 10 }
  );

  assert.equal(items.some((item) => item.key === "US:DEAD"), false);
  assert.equal(items.some((item) => item.key === "KR:123456"), true);
});
