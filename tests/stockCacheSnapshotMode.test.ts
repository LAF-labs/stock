import test from "node:test";
import assert from "node:assert/strict";

import { isStockDataUnavailableError } from "../src/lib/stockDataRuntime";
import { getStockQuote } from "../src/lib/stockQuoteCache";
import { getStockScore } from "../src/lib/stockSnapshotCache";

const ENV_KEYS = [
  "VERCEL",
  "STOCK_DATA_RUNTIME",
  "STOCK_DATA_BACKEND",
  "PYTHON_BIN",
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "MARKET_DATA_SERVICE_URL",
  "MARKET_DATA_INTERNAL_TOKEN",
  "MARKET_DATA_SERVICE_ENABLE_QUOTE",
  "MARKET_DATA_SERVICE_ENABLE_SCORE",
  "STOCK_API_APP_KEY",
  "STOCK_API_APP_SECRET",
  "STOCK_API_BASE",
  "STOCK_QUOTE_CACHE_STALE_SECONDS",
  "STOCK_SCORE_CACHE_STALE_SECONDS",
] as const;

const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;

function restoreEnv() {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  globalThis.fetch = originalFetch;
}

function useSnapshotOnlyRuntime() {
  restoreEnv();
  process.env.VERCEL = "1";
  process.env.PYTHON_BIN = "/bin/false";
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_PUBLISHABLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.MARKET_DATA_SERVICE_URL;
  delete process.env.MARKET_DATA_INTERNAL_TOKEN;
}

test.afterEach(restoreEnv);

test("score cache does not invoke Python collector when Vercel snapshot mode has no snapshot", async () => {
  useSnapshotOnlyRuntime();

  await assert.rejects(
    () => getStockScore("US:ZZZSNAPMISS", "detail"),
    (error) => {
      assert.equal(isStockDataUnavailableError(error), true);
      if (!isStockDataUnavailableError(error)) return false;
      assert.equal(error.status, 503);
      assert.equal(error.payload.error, "snapshot_unavailable");
      assert.equal(error.payload.reason, "snapshot_miss");
      assert.equal(error.payload.kind, "score");
      return true;
    }
  );
});

test("quote cache reports background-only refresh in Vercel snapshot mode", async () => {
  useSnapshotOnlyRuntime();

  await assert.rejects(
    () => getStockQuote("US:KO", { forceRefresh: true }),
    (error) => {
      assert.equal(isStockDataUnavailableError(error), true);
      if (!isStockDataUnavailableError(error)) return false;
      assert.equal(error.payload.error, "snapshot_unavailable");
      assert.equal(error.payload.reason, "refresh_background_only");
      assert.equal(error.payload.kind, "quote");
      return true;
    }
  );
});

test("quote force refresh serves existing snapshot when a provider refresh lease is already active", async () => {
  useSnapshotOnlyRuntime();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

  const ticker = "US:LEASEBUSY";
  const nowMs = Date.now();
  const snapshot = {
    ticker,
    payload: {
      ok: true,
      type: "quote",
      requested_ticker: ticker,
      market: "US",
      symbol: "LEASEBUSY",
      latest_price: 123.45,
    },
    fetched_at: new Date(nowMs - 30_000).toISOString(),
    expires_at: new Date(nowMs + 270_000).toISOString(),
  };

  globalThis.fetch = async (url, init) => {
    const text = String(url);
    if (text.includes("/rest/v1/stock_quote_snapshots")) {
      return new Response(JSON.stringify([snapshot]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (text.includes("/rest/v1/rpc/acquire_stock_refresh_lease")) {
      return new Response(
        JSON.stringify({
          acquired: false,
          lease_until: new Date(nowMs + 20_000).toISOString(),
          locked_by: "other-worker",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    throw new Error(`unexpected fetch ${text}`);
  };

  const result = await getStockQuote(ticker, { forceRefresh: true });

  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.latest_price, 123.45);
  assert.equal(result.cache.state, "fresh");
  assert.equal(result.cache.source, "supabase");
});

test("score force refresh serves existing snapshot when refresh is unavailable", async () => {
  useSnapshotOnlyRuntime();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "anon-key";
  process.env.STOCK_SCORE_CACHE_STALE_SECONDS = "86400";

  const ticker = "US:SCOREFALLBACK";
  const nowMs = Date.now();
  const snapshot = {
    ticker,
    view_mode: "detail",
    payload: {
      ok: true,
      type: "score",
      requested_ticker: ticker,
      market: "US",
      symbol: "SCOREFALLBACK",
      score: 72,
      quality_score: 72,
      opportunity_score: 61,
      opportunity_confidence: 0.8,
      opportunity_components: [],
      score_model_version: "score-v5-dual-quality-opportunity-2026-06-05",
      sia_snapshot: {
        quality_score: 72,
        opportunity_score: 61,
        score_model_version: "score-v5-dual-quality-opportunity-2026-06-05",
      },
    },
    fetched_at: new Date(nowMs - 60_000).toISOString(),
    expires_at: new Date(nowMs + 20 * 60_000).toISOString(),
  };

  globalThis.fetch = async (url) => {
    const text = String(url);
    if (text.includes("/rest/v1/stock_score_snapshots")) {
      return new Response(JSON.stringify([snapshot]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch ${text}`);
  };

  const result = await getStockScore(ticker, "detail", { forceRefresh: true });

  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.score, 72);
  assert.equal(result.cache.state, "fresh");
  assert.equal(result.cache.source, "supabase");
  assert.equal(result.cache.refreshError, "refresh_failed");
});

test("quote force refresh can use Node KIS quote client in Vercel snapshot mode", async () => {
  useSnapshotOnlyRuntime();
  process.env.STOCK_API_APP_KEY = "app-key";
  process.env.STOCK_API_APP_SECRET = "app-secret";
  process.env.STOCK_API_BASE = "https://kis.example.com";

  globalThis.fetch = async (url, init) => {
    const text = String(url);
    if (text.includes("/oauth2/tokenP")) {
      return Response.json({ access_token: "token-quote-cache", expires_in: 3600 });
    }
    if (text.includes("/uapi/domestic-stock/v1/quotations/inquire-price")) {
      return Response.json({
        rt_cd: "0",
        output: {
          stck_prpr: "70000",
          stck_sdpr: "69000",
          prdy_ctrt: "1.45",
          acml_vol: "1000",
          hts_kor_isnm: "삼성전자",
          stck_bsop_date: "20260605",
        },
      });
    }
    throw new Error(`unexpected fetch ${text}`);
  };

  const result = await getStockQuote("KR:005930", { forceRefresh: true });

  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.requested_ticker, "KR:005930");
  assert.equal(result.payload.latest_price, 70000);
  assert.equal(result.cache.source, "market-data");
});

test("quote force refresh writes serving columns required by Supabase quote snapshots", async () => {
  useSnapshotOnlyRuntime();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  process.env.STOCK_API_APP_KEY = "write-app-key";
  process.env.STOCK_API_APP_SECRET = "write-app-secret";
  process.env.STOCK_API_BASE = "https://kis-write.example.com";

  let writtenBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (url, init) => {
    const text = String(url);
    if (text.includes("/rest/v1/stock_quote_snapshots?") && init?.method !== "POST") {
      return Response.json([]);
    }
    if (text.includes("/rest/v1/rpc/acquire_stock_api_rate_limit")) {
      return Response.json({ allowed: true, remaining: 10, reset_at: new Date(Date.now() + 60_000).toISOString() });
    }
    if (text.includes("/rest/v1/rpc/acquire_stock_refresh_lease")) {
      return Response.json({ acquired: true, lease_until: new Date(Date.now() + 30_000).toISOString() });
    }
    if (text.includes("/rest/v1/kis_access_tokens") && init?.method !== "POST") {
      return Response.json([]);
    }
    if (text.includes("/rest/v1/rpc/acquire_kis_token_issue_lock")) {
      return Response.json({ acquired: true });
    }
    if (text.includes("/oauth2/tokenP")) {
      return Response.json({ access_token: "issued-token", expires_in: 3600 });
    }
    if (text.includes("/rest/v1/kis_access_tokens") && init?.method === "POST") {
      return new Response(null, { status: 201 });
    }
    if (text.includes("/rest/v1/market_calendar?")) {
      return Response.json([]);
    }
    if (text.includes("/uapi/overseas-price/v1/quotations/price-detail")) {
      return Response.json({
        rt_cd: "0",
        output: {
          last: "72.25",
          base: "71.80",
          rate: "0.63",
          tvol: "123456",
          curr: "USD",
          xymd: "20260605",
        },
      });
    }
    if (text.includes("/uapi/overseas-price/v1/quotations/search-info")) {
      return Response.json({
        rt_cd: "0",
        output: {
          prdt_eng_name: "Write Test Inc",
          ovrs_excg_name: "Nasdaq",
        },
      });
    }
    if (text.includes("/rest/v1/stock_quote_snapshots?") && init?.method === "POST") {
      writtenBody = JSON.parse(String(init.body));
      return new Response(null, { status: 201 });
    }
    throw new Error(`unexpected fetch ${text}`);
  };

  const result = await getStockQuote("US:WRITETEST", { forceRefresh: true });

  assert.equal(result.payload.ok, true);
  assert.equal(writtenBody?.ticker, "US:WRITETEST");
  assert.equal(writtenBody?.market, "US");
  assert.equal(writtenBody?.symbol, "WRITETEST");
  assert.equal(writtenBody?.source, "kis");
  assert.equal(typeof writtenBody?.stale_expires_at, "string");
});

test("quote stale snapshot returns immediately while inline provider refresh continues in background", async () => {
  useSnapshotOnlyRuntime();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "anon-key";
  process.env.STOCK_API_APP_KEY = "delayed-app-key";
  process.env.STOCK_API_APP_SECRET = "delayed-app-secret";
  process.env.STOCK_API_BASE = "https://kis-delayed.example.com";
  process.env.STOCK_QUOTE_CACHE_STALE_SECONDS = "86400";

  const ticker = "KR:009999";
  const nowMs = Date.now();
  const snapshot = {
    ticker,
    payload: {
      ok: true,
      type: "quote",
      requested_ticker: ticker,
      market: "KR",
      symbol: "009999",
      latest_price: 1000,
    },
    fetched_at: new Date(nowMs - 10 * 60_000).toISOString(),
    expires_at: new Date(nowMs - 5 * 60_000).toISOString(),
  };
  let providerCalls = 0;

  globalThis.fetch = async (url, init) => {
    const text = String(url);
    if (text.includes("/rest/v1/stock_quote_snapshots")) {
      return new Response(JSON.stringify([snapshot]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (text.includes("/oauth2/tokenP")) {
      providerCalls += 1;
      await sleep(100);
      return Response.json({ access_token: "delayed-token", expires_in: 3600 });
    }
    if (text.includes("/uapi/domestic-stock/v1/quotations/inquire-price")) {
      providerCalls += 1;
      return Response.json({
        rt_cd: "0",
        output: {
          stck_prpr: "1200",
          stck_sdpr: "1000",
          prdy_ctrt: "20.0",
          acml_vol: "100",
          hts_kor_isnm: "느린공급자",
          stck_bsop_date: "20260605",
        },
      });
    }
    throw new Error(`unexpected fetch ${text}`);
  };

  const raced = await Promise.race([getStockQuote(ticker), sleep(40).then(() => "timeout" as const)]);

  assert.notEqual(raced, "timeout");
  if (raced === "timeout") return;
  assert.equal(raced.cache.state, "stale");
  assert.equal(raced.cache.source, "supabase");
  assert.equal(raced.payload.latest_price, 1000);

  await sleep(140);
  assert.equal(providerCalls > 0, true);
});

test("quote stale snapshot also enqueues a refresh backstop when Supabase admin is configured", async () => {
  useSnapshotOnlyRuntime();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  process.env.STOCK_API_APP_KEY = "queued-app-key";
  process.env.STOCK_API_APP_SECRET = "queued-app-secret";
  process.env.STOCK_API_BASE = "https://kis-queued.example.com";
  process.env.STOCK_QUOTE_CACHE_STALE_SECONDS = "86400";

  const ticker = "KR:008888";
  const nowMs = Date.now();
  const snapshot = {
    ticker,
    payload: {
      ok: true,
      type: "quote",
      requested_ticker: ticker,
      market: "KR",
      symbol: "008888",
      latest_price: 900,
    },
    fetched_at: new Date(nowMs - 10 * 60_000).toISOString(),
    expires_at: new Date(nowMs - 5 * 60_000).toISOString(),
  };
  let enqueueBody: Record<string, unknown> | undefined;

  globalThis.fetch = async (url, init) => {
    const text = String(url);
    if (text.includes("/rest/v1/stock_quote_snapshots")) {
      return new Response(JSON.stringify([snapshot]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (text.includes("/rest/v1/rpc/enqueue_stock_refresh_job")) {
      enqueueBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ id: "job-stale-quote", status: "queued" });
    }
    if (text.includes("/rest/v1/rpc/acquire_stock_refresh_lease")) {
      return Response.json({
        acquired: false,
        lease_until: new Date(nowMs + 20_000).toISOString(),
        locked_by: "other-worker",
      });
    }
    if (text.includes("/oauth2/tokenP")) {
      return Response.json({ access_token: "queued-token", expires_in: 3600 });
    }
    throw new Error(`unexpected fetch ${text}`);
  };

  const result = await getStockQuote(ticker);
  await sleep(20);

  assert.equal(result.cache.state, "stale");
  assert.deepEqual(enqueueBody, {
    p_kind: "quote",
    p_market: "KR",
    p_symbol: "008888",
    p_view_mode: null,
    p_priority: 70,
    p_payload: { reason: "snapshot_miss", requested_ticker: ticker },
  });
});

test("quote cache honors Supabase stale_expires_at over local stale ttl math", async () => {
  useSnapshotOnlyRuntime();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "anon-key";
  process.env.STOCK_QUOTE_CACHE_STALE_SECONDS = "1";

  const ticker = "US:DBSTALETTL";
  const nowMs = Date.now();
  const snapshot = {
    ticker,
    payload: {
      ok: true,
      type: "quote",
      requested_ticker: ticker,
      market: "US",
      symbol: "DBSTALETTL",
      latest_price: 77,
    },
    fetched_at: new Date(nowMs - 2 * 86_400_000).toISOString(),
    expires_at: new Date(nowMs - 86_400_000).toISOString(),
    stale_expires_at: new Date(nowMs + 86_400_000).toISOString(),
  };

  globalThis.fetch = async (url) => {
    const text = String(url);
    if (text.includes("/rest/v1/stock_quote_snapshots")) {
      return new Response(JSON.stringify([snapshot]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch ${text}`);
  };

  const result = await getStockQuote(ticker);
  const serverCache = result.payload.server_cache as Record<string, unknown>;

  assert.equal(result.cache.state, "stale");
  assert.equal(result.cache.source, "supabase");
  assert.equal(result.cache.staleExpiresAt, snapshot.stale_expires_at);
  assert.equal(serverCache.stale_expires_at, snapshot.stale_expires_at);
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
