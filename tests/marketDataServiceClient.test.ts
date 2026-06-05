import test from "node:test";
import assert from "node:assert/strict";
import {
  getMarketDataServiceQuote,
  getMarketDataServiceScore,
  marketDataServiceConfig,
} from "../src/lib/marketDataServiceClient";

const originalFetch = globalThis.fetch;
const originalEnv = {
  MARKET_DATA_SERVICE_URL: process.env.MARKET_DATA_SERVICE_URL,
  MARKET_DATA_INTERNAL_TOKEN: process.env.MARKET_DATA_INTERNAL_TOKEN,
};

function restore() {
  globalThis.fetch = originalFetch;
  if (originalEnv.MARKET_DATA_SERVICE_URL === undefined) {
    delete process.env.MARKET_DATA_SERVICE_URL;
  } else {
    process.env.MARKET_DATA_SERVICE_URL = originalEnv.MARKET_DATA_SERVICE_URL;
  }
  if (originalEnv.MARKET_DATA_INTERNAL_TOKEN === undefined) {
    delete process.env.MARKET_DATA_INTERNAL_TOKEN;
  } else {
    process.env.MARKET_DATA_INTERNAL_TOKEN = originalEnv.MARKET_DATA_INTERNAL_TOKEN;
  }
}

test.afterEach(restore);

test("market-data service client is disabled without URL and token", () => {
  delete process.env.MARKET_DATA_SERVICE_URL;
  delete process.env.MARKET_DATA_INTERNAL_TOKEN;

  assert.equal(marketDataServiceConfig(), undefined);
});

test("quote client maps Rust quote response into public payload shape", async () => {
  process.env.MARKET_DATA_SERVICE_URL = "http://market-data.internal";
  process.env.MARKET_DATA_INTERNAL_TOKEN = "internal-token";

  let requestedUrl = "";
  let authorization = "";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requestedUrl = String(input);
    authorization = new Headers(init?.headers).get("authorization") || "";
    return new Response(
      JSON.stringify({
        ok: true,
        data: {
          market: "us",
          symbol: "KO",
          exchange: "NYSE",
          last: 72.25,
          currency: "USD",
          previous_close: 71.8,
          volume: 12345678,
        },
        server_cache: {
          state: "miss",
          source: "provider",
          fetched_at_ms: 1780617600000,
          expires_at_ms: 1780617780000,
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  const result = await getMarketDataServiceQuote("US:KO", { forceRefresh: true });

  assert.equal(requestedUrl, "http://market-data.internal/v1/quote/us/KO?refresh=1");
  assert.equal(authorization, "Bearer internal-token");
  assert.equal(result?.payload.ok, true);
  assert.equal(result?.payload.type, "quote");
  assert.equal(result?.payload.requested_ticker, "US:KO");
  assert.equal(result?.payload.latest_price, 72.25);
  const serverCache = result?.payload.server_cache as { source?: unknown } | undefined;
  assert.equal(serverCache?.source, "market-data");
  assert.equal(result?.cache.source, "market-data");
});

test("score client falls back when Rust score is only queued", async () => {
  process.env.MARKET_DATA_SERVICE_URL = "http://market-data.internal";
  process.env.MARKET_DATA_INTERNAL_TOKEN = "internal-token";

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        ok: true,
        data: { status: "queued", market: "us", symbol: "KO", view: "detail" },
        server_cache: { state: "miss", source: "queue", refresh_started: true },
      }),
      { status: 202, headers: { "content-type": "application/json" } }
    )) as typeof fetch;

  const result = await getMarketDataServiceScore("US:KO", "detail");

  assert.equal(result, undefined);
});

test("score client falls back when Rust score model version is stale", async () => {
  process.env.MARKET_DATA_SERVICE_URL = "http://market-data.internal";
  process.env.MARKET_DATA_INTERNAL_TOKEN = "internal-token";

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        ok: true,
        data: {
          ok: true,
          market: "US",
          symbol: "KO",
          score: 72.4,
          score_model_version: "legacy-score-v1",
        },
        server_cache: { state: "fresh", source: "cache" },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    )) as typeof fetch;

  const result = await getMarketDataServiceScore("US:KO", "detail");

  assert.equal(result, undefined);
});
