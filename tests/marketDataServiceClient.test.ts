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
  MARKET_DATA_SERVICE_ENABLED: process.env.MARKET_DATA_SERVICE_ENABLED,
  MARKET_DATA_SERVICE_ENABLE_QUOTE: process.env.MARKET_DATA_SERVICE_ENABLE_QUOTE,
  MARKET_DATA_SERVICE_ENABLE_SCORE: process.env.MARKET_DATA_SERVICE_ENABLE_SCORE,
  MARKET_DATA_ALLOW_LOCALHOST_ON_VERCEL: process.env.MARKET_DATA_ALLOW_LOCALHOST_ON_VERCEL,
  VERCEL: process.env.VERCEL,
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
  if (originalEnv.MARKET_DATA_SERVICE_ENABLED === undefined) {
    delete process.env.MARKET_DATA_SERVICE_ENABLED;
  } else {
    process.env.MARKET_DATA_SERVICE_ENABLED = originalEnv.MARKET_DATA_SERVICE_ENABLED;
  }
  if (originalEnv.MARKET_DATA_SERVICE_ENABLE_QUOTE === undefined) {
    delete process.env.MARKET_DATA_SERVICE_ENABLE_QUOTE;
  } else {
    process.env.MARKET_DATA_SERVICE_ENABLE_QUOTE = originalEnv.MARKET_DATA_SERVICE_ENABLE_QUOTE;
  }
  if (originalEnv.MARKET_DATA_SERVICE_ENABLE_SCORE === undefined) {
    delete process.env.MARKET_DATA_SERVICE_ENABLE_SCORE;
  } else {
    process.env.MARKET_DATA_SERVICE_ENABLE_SCORE = originalEnv.MARKET_DATA_SERVICE_ENABLE_SCORE;
  }
  if (originalEnv.MARKET_DATA_ALLOW_LOCALHOST_ON_VERCEL === undefined) {
    delete process.env.MARKET_DATA_ALLOW_LOCALHOST_ON_VERCEL;
  } else {
    process.env.MARKET_DATA_ALLOW_LOCALHOST_ON_VERCEL = originalEnv.MARKET_DATA_ALLOW_LOCALHOST_ON_VERCEL;
  }
  if (originalEnv.VERCEL === undefined) {
    delete process.env.VERCEL;
  } else {
    process.env.VERCEL = originalEnv.VERCEL;
  }
}

test.afterEach(restore);

test("market-data service client is disabled without URL and token", () => {
  delete process.env.MARKET_DATA_SERVICE_URL;
  delete process.env.MARKET_DATA_INTERNAL_TOKEN;

  assert.equal(marketDataServiceConfig(), undefined);
});

test("market-data service client ignores localhost URLs on Vercel", () => {
  process.env.VERCEL = "1";
  process.env.MARKET_DATA_SERVICE_URL = "http://127.0.0.1:8080";
  process.env.MARKET_DATA_INTERNAL_TOKEN = "internal-token";

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

test("quote client can be disabled independently", async () => {
  process.env.MARKET_DATA_SERVICE_URL = "http://market-data.internal";
  process.env.MARKET_DATA_INTERNAL_TOKEN = "internal-token";
  process.env.MARKET_DATA_SERVICE_ENABLE_QUOTE = "0";
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  const result = await getMarketDataServiceQuote("US:KO");

  assert.equal(result, undefined);
  assert.equal(calls, 0);
});

test("score client is opt-in until Rust score has a durable refresh path", async () => {
  process.env.MARKET_DATA_SERVICE_URL = "http://market-data.internal";
  process.env.MARKET_DATA_INTERNAL_TOKEN = "internal-token";
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  const result = await getMarketDataServiceScore("US:KO", "detail");

  assert.equal(result, undefined);
  assert.equal(calls, 0);
});

test("score client falls back when Rust score is only queued", async () => {
  process.env.MARKET_DATA_SERVICE_URL = "http://market-data.internal";
  process.env.MARKET_DATA_INTERNAL_TOKEN = "internal-token";
  process.env.MARKET_DATA_SERVICE_ENABLE_SCORE = "1";

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
  process.env.MARKET_DATA_SERVICE_ENABLE_SCORE = "1";

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
