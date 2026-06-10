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
  "STOCK_TECHNICAL_REQUEST_FAST_PATH",
  "STOCK_DETAIL_REQUEST_FAST_PATH",
  "STOCK_DETAIL_DAILY_FAST_PATH_TIMEOUT_MS",
  "STOCK_QUOTE_CACHE_STALE_SECONDS",
  "STOCK_SCORE_CACHE_STALE_SECONDS",
  "SUPABASE_READ_TIMEOUT_MS",
  "SUPABASE_WRITE_TIMEOUT_MS",
  "STOCK_SCORE_SUPABASE_READ_TIMEOUT_MS",
  "STOCK_SCORE_SUPABASE_WRITE_TIMEOUT_MS",
  "STOCK_QUOTE_SUPABASE_READ_TIMEOUT_MS",
  "STOCK_QUOTE_SUPABASE_WRITE_TIMEOUT_MS",
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

test("technical score cache serves current technical-only snapshots in snapshot mode", async () => {
  useSnapshotOnlyRuntime();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-key";

  const ticker = "US:TECHONLY";
  const nowMs = Date.now();
  const snapshot = {
    ticker,
    view_mode: "technical",
    payload: {
      ok: true,
      score_model_version: "score-v5-dual-quality-opportunity-2026-06-05",
      requested_ticker: "TECHONLY",
      market: "US",
      symbol: "TECHONLY",
      name: "TECH ONLY INC",
      technical_analysis: {
        type: "technical_analysis",
        version: "technical-v1",
        status: "ready",
        data_window: { available_days: 100, required_days: 60 },
        summary: { headline: "기술 신호 확인", tone: "neutral", bullets: [] },
        indicators: [],
      },
    },
    fetched_at: new Date(nowMs - 30_000).toISOString(),
    expires_at: new Date(nowMs + 270_000).toISOString(),
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

  const result = await getStockScore(ticker, "technical");

  assert.equal(result.payload.ok, true);
  assert.equal((result.payload.technical_analysis as Record<string, unknown>).type, "technical_analysis");
  assert.equal(result.cache.state, "fresh");
  assert.equal(result.cache.source, "supabase");
  assert.equal(result.cache.view, "technical");
});

test("technical score cache builds a request fast path from KIS daily rows in Vercel snapshot mode", async () => {
  useSnapshotOnlyRuntime();
  process.env.STOCK_API_APP_KEY = "app-key";
  process.env.STOCK_API_APP_SECRET = "app-secret";
  process.env.STOCK_API_BASE = "https://kis.example";

  const rows = Array.from({ length: 80 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 0, 2 + index)).toISOString().slice(0, 10).replace(/-/g, "");
    const close = 20 + index * 0.1;
    return {
      xymd: date,
      open: String(close - 0.1),
      high: String(close + 0.3),
      low: String(close - 0.4),
      clos: String(close),
      tvol: String(1_000_000 + index),
    };
  });

  globalThis.fetch = async (url) => {
    const text = String(url);
    if (text.includes("/oauth2/tokenP")) {
      return Response.json({ access_token: "token-technical", expires_in: 3600 });
    }
    if (text.includes("/uapi/overseas-price/v1/quotations/dailyprice")) {
      return Response.json({ rt_cd: "0", output2: rows });
    }
    throw new Error(`unexpected fetch ${text}`);
  };

  const result = await getStockScore("US:FASTTECH", "technical");

  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.requested_ticker, "US:FASTTECH");
  assert.equal((result.payload.technical_analysis as Record<string, unknown>).type, "technical_analysis");
  assert.equal((result.payload.chart_series as unknown[]).length, 80);
  assert.equal(result.cache.source, "market-data");
  assert.equal(result.cache.state, "miss");
});

test("detail score cache builds a request fast path from KIS daily rows in Vercel snapshot mode", async () => {
  useSnapshotOnlyRuntime();
  process.env.STOCK_API_APP_KEY = "app-key";
  process.env.STOCK_API_APP_SECRET = "app-secret";
  process.env.STOCK_API_BASE = "https://kis.example";

  const rows = Array.from({ length: 120 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 0, 2 + index)).toISOString().slice(0, 10).replace(/-/g, "");
    const close = 10 + index * 0.04;
    return {
      xymd: date,
      open: String(close - 0.08),
      high: String(close + 0.2),
      low: String(close - 0.2),
      clos: String(close),
      tvol: String(120_000 + index * 50),
    };
  });

  globalThis.fetch = async (url) => {
    const text = String(url);
    if (text.includes("/oauth2/tokenP")) {
      return Response.json({ access_token: "token-detail", expires_in: 3600 });
    }
    if (text.includes("/uapi/overseas-price/v1/quotations/dailyprice")) {
      return Response.json({ rt_cd: "0", output2: rows });
    }
    throw new Error(`unexpected fetch ${text}`);
  };

  const result = await getStockScore("US:BEEM", "detail");

  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.requested_ticker, "US:BEEM");
  assert.equal(result.payload.score_model_version, "score-v5-dual-quality-opportunity-2026-06-05");
  assert.equal(typeof result.payload.score, "number");
  assert.equal(typeof result.payload.quality_score, "number");
  assert.equal(typeof result.payload.opportunity_score, "number");
  assert.equal(result.payload.korean_name, "빔 글로벌");
  assert.equal(result.payload.display_name, "빔 글로벌");
  assert.equal(result.payload.name, "빔 글로벌");
  assert.equal((result.payload.chart_series as unknown[]).length, 120);
  assert.equal((result.payload.technical_analysis as Record<string, unknown>).type, "technical_analysis");
  assert.deepEqual(
    (result.payload.components as Array<Record<string, unknown>>).map((item) => item.key),
    ["profitability", "growth", "health", "momentum", "valuation"]
  );
  assert.deepEqual(
    (result.payload.opportunity_components as Array<Record<string, unknown>>).map((item) => item.key),
    ["opportunity_momentum", "opportunity_growth", "opportunity_analyst", "opportunity_liquidity", "opportunity_risk"]
  );
  assert.equal((result.payload.fetch as Record<string, unknown>).detail_fast_path, true);
  assert.equal(result.cache.source, "market-data");
  assert.equal(result.cache.state, "miss");
});

test("detail score cache falls back to a quote-only fast path when daily rows are slow", async () => {
  useSnapshotOnlyRuntime();
  process.env.STOCK_API_APP_KEY = "app-key";
  process.env.STOCK_API_APP_SECRET = "app-secret";
  process.env.STOCK_API_BASE = "https://kis.example";

  globalThis.fetch = async (url) => {
    const text = String(url);
    if (text.includes("/oauth2/tokenP")) {
      return Response.json({ access_token: "token-detail-quote", expires_in: 3600 });
    }
    if (text.includes("/uapi/overseas-price/v1/quotations/dailyprice")) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      return Response.json({
        rt_cd: "0",
        output2: [{ xymd: "20260605", open: "10", high: "11", low: "9", clos: "10.5", tvol: "1000" }],
      });
    }
    if (text.includes("/uapi/overseas-price/v1/quotations/price-detail")) {
      return Response.json({
        rt_cd: "0",
        output: {
          last: "24.50",
          base: "24.00",
          rate: "2.08",
          tvol: "12345",
          curr: "USD",
          xymd: "20260605",
        },
      });
    }
    if (text.includes("/uapi/overseas-price/v1/quotations/search-info")) {
      return Response.json({
        rt_cd: "0",
        output: {
          prdt_eng_name: "Quote Fast Inc",
          ovrs_excg_name: "Nasdaq",
        },
      });
    }
    throw new Error(`unexpected fetch ${text}`);
  };

  const result = await getStockScore("US:QUOTEFAST", "detail");

  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.requested_ticker, "US:QUOTEFAST");
  assert.equal(result.payload.latest_price, 24.5);
  assert.equal(result.payload.name, "Quote Fast Inc");
  assert.equal((result.payload.fetch as Record<string, unknown>).quote_only_fast_path, true);
  assert.equal((result.payload.chart_series as unknown[]).length, 0);
  assert.equal(typeof result.payload.score, "number");
  assert.equal(result.cache.source, "market-data");
  assert.equal(result.cache.state, "miss");
});

test("compare score cache skips daily rows and uses the quote-only fast path immediately", async () => {
  useSnapshotOnlyRuntime();
  process.env.STOCK_API_APP_KEY = "app-key";
  process.env.STOCK_API_APP_SECRET = "app-secret";
  process.env.STOCK_API_BASE = "https://kis.example";
  process.env.STOCK_DETAIL_DAILY_FAST_PATH_TIMEOUT_MS = "15";

  let dailyCalls = 0;
  globalThis.fetch = async (url) => {
    const text = String(url);
    if (text.includes("/oauth2/tokenP")) {
      return Response.json({ access_token: "token-compare-quote", expires_in: 3600 });
    }
    if (text.includes("/uapi/overseas-price/v1/quotations/dailyprice")) {
      dailyCalls += 1;
      return Response.json({
        rt_cd: "0",
        output2: [{ xymd: "20260605", open: "10", high: "11", low: "9", clos: "10.5", tvol: "1000" }],
      });
    }
    if (text.includes("/uapi/overseas-price/v1/quotations/price-detail")) {
      return Response.json({
        rt_cd: "0",
        output: {
          last: "18.25",
          base: "18.00",
          rate: "1.39",
          tvol: "22000",
          curr: "USD",
          xymd: "20260605",
        },
      });
    }
    if (text.includes("/uapi/overseas-price/v1/quotations/search-info")) {
      return Response.json({
        rt_cd: "0",
        output: {
          prdt_eng_name: "Anixa Biosciences",
          ovrs_excg_name: "Nasdaq",
        },
      });
    }
    throw new Error(`unexpected fetch ${text}`);
  };

  const result = await getStockScore("US:ANIX", "compare");

  assert.equal(dailyCalls, 0);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.requested_ticker, "US:ANIX");
  assert.equal(result.payload.data_quality, "quote_fast_path");
  assert.equal((result.payload.fetch as Record<string, unknown>).provider_mode, "detail_quote_fast_path");
  assert.equal((result.payload.chart_series as unknown[]).length, 0);
  assert.equal(result.cache.source, "market-data");
  assert.equal(result.cache.state, "miss");
});

test("compare score cache does not wait for slow Supabase score writes", async () => {
  useSnapshotOnlyRuntime();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  process.env.STOCK_API_APP_KEY = "app-key";
  process.env.STOCK_API_APP_SECRET = "app-secret";
  process.env.STOCK_API_BASE = "https://kis.example";

  let writeStarted = false;
  let writeFinished = false;
  globalThis.fetch = async (url, init) => {
    const text = String(url);
    if (text.includes("/rest/v1/stock_score_snapshots") && init?.method === "POST") {
      writeStarted = true;
      await sleep(250);
      writeFinished = true;
      return new Response(null, { status: 204 });
    }
    if (text.includes("/rest/v1/stock_score_snapshots")) {
      return Response.json([]);
    }
    if (text.includes("/rest/v1/rpc/acquire_stock_api_rate_limit")) {
      return Response.json({ allowed: true, remaining: 10, reset_at: new Date(Date.now() + 60_000).toISOString() });
    }
    if (text.includes("/rest/v1/rpc/enqueue_stock_refresh_job")) {
      return Response.json({ id: "job-compare-write-behind", status: "queued" });
    }
    if (text.includes("/rest/v1/rpc/acquire_kis_token_issue_lock")) {
      return Response.json({ acquired: true });
    }
    if (text.includes("/rest/v1/kis_access_tokens") && init?.method === "POST") {
      return new Response(null, { status: 204 });
    }
    if (text.includes("/rest/v1/kis_access_tokens")) {
      return Response.json([]);
    }
    if (text.includes("/oauth2/tokenP")) {
      return Response.json({ access_token: "token-compare-write", expires_in: 3600 });
    }
    if (text.includes("/uapi/overseas-price/v1/quotations/price-detail")) {
      return Response.json({
        rt_cd: "0",
        output: {
          last: "21.25",
          base: "21.00",
          rate: "1.19",
          tvol: "32000",
          curr: "USD",
          xymd: "20260605",
        },
      });
    }
    if (text.includes("/uapi/overseas-price/v1/quotations/search-info")) {
      return Response.json({
        rt_cd: "0",
        output: {
          prdt_eng_name: "Apogee Therapeutics",
          ovrs_excg_name: "Nasdaq",
        },
      });
    }
    throw new Error(`unexpected fetch ${text}`);
  };

  const startedAt = Date.now();
  const result = await getStockScore("US:APGE", "compare");
  const elapsedMs = Date.now() - startedAt;

  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.requested_ticker, "US:APGE");
  assert.equal(writeStarted, true);
  assert.equal(writeFinished, false);
  assert.ok(elapsedMs < 200, `compare score waited ${elapsedMs}ms for the score write`);

  await sleep(300);
  assert.equal(writeFinished, true);
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
      currency: "USD",
      latest_price: 123.45,
      latest_price_label: "$123.45 / 169,127원",
      usd_krw_rate: 1370,
      usd_krw_label: "$1 = 1,370원",
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
  assert.equal(result.payload.latest_price_label, "$123.45");
  assert.equal(result.payload.usd_krw_label, "$1 = 약 1,370원");
  assert.equal(result.cache.state, "fresh");
  assert.equal(result.cache.source, "supabase");
});

test("quote provider refresh failures do not leak unhandled inflight promise rejections", async () => {
  useSnapshotOnlyRuntime();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  process.env.STOCK_API_APP_KEY = "app-key";
  process.env.STOCK_API_APP_SECRET = "app-secret";
  process.env.STOCK_API_BASE = "https://kis.example";

  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => {
    unhandled.push(reason);
  };
  process.on("unhandledRejection", onUnhandled);

  globalThis.fetch = async (url) => {
    const text = String(url);
    if (text.includes("/rest/v1/stock_quote_snapshots")) {
      return Response.json([]);
    }
    if (text.includes("/rest/v1/rpc/acquire_stock_refresh_lease")) {
      return Response.json({ acquired: true });
    }
    if (text.includes("/rest/v1/rpc/acquire_stock_api_rate_limit")) {
      return Response.json({ allowed: true, remaining: 119, reset_at: new Date(Date.now() + 60_000).toISOString() });
    }
    if (text.includes("/rest/v1/kis_access_tokens")) {
      return Response.json([]);
    }
    if (text.includes("/rest/v1/rpc/acquire_kis_token_issue_lock")) {
      return Response.json({ acquired: true });
    }
    if (text.startsWith("https://kis.example/")) {
      throw new Error("provider network failed");
    }
    throw new Error(`unexpected fetch ${text}`);
  };

  try {
    await assert.rejects(() => getStockQuote("US:UHFAIL", { forceRefresh: true }), /provider network failed/);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
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
      components: [
        { key: "profitability", label: "Profitability", score: 76 },
        { key: "growth", label: "Growth", score: 69 },
        { key: "health", label: "Health", score: 74 },
        { key: "momentum", label: "Momentum", score: 71 },
        { key: "valuation", label: "Valuation", score: 68 },
      ],
      opportunity_components: [
        { key: "opportunity_momentum", label: "Momentum setup", score: 63 },
        { key: "opportunity_growth", label: "Growth setup", score: 67 },
        { key: "opportunity_analyst", label: "Analyst upside", score: 56 },
        { key: "opportunity_liquidity", label: "Liquidity", score: 78 },
        { key: "opportunity_risk", label: "Risk control", score: 49 },
      ],
      score_model_version: "score-v5-dual-quality-opportunity-2026-06-05",
      sia_snapshot: {
        confidence: 0.86,
        quality_score: 0.72,
        opportunity_score: 0.61,
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

test("score stale snapshot enqueues stale refresh work instead of a snapshot miss", async () => {
  useSnapshotOnlyRuntime();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  process.env.STOCK_SCORE_CACHE_STALE_SECONDS = "86400";

  const ticker = "US:SCORESTALE";
  const nowMs = Date.now();
  const snapshot = {
    ticker,
    view_mode: "detail",
    payload: {
      ok: true,
      type: "score",
      requested_ticker: ticker,
      market: "US",
      symbol: "SCORESTALE",
      score: 69,
      quality_score: 69,
      opportunity_score: 64,
      opportunity_confidence: 0.82,
      components: [
        { key: "profitability", label: "Profitability", score: 72 },
        { key: "growth", label: "Growth", score: 66 },
        { key: "health", label: "Health", score: 70 },
        { key: "momentum", label: "Momentum", score: 68 },
        { key: "valuation", label: "Valuation", score: 67 },
      ],
      opportunity_components: [
        { key: "opportunity_momentum", label: "Momentum setup", score: 63 },
        { key: "opportunity_growth", label: "Growth setup", score: 65 },
        { key: "opportunity_analyst", label: "Analyst upside", score: 61 },
        { key: "opportunity_liquidity", label: "Liquidity", score: 77 },
        { key: "opportunity_risk", label: "Risk control", score: 52 },
      ],
      score_model_version: "score-v5-dual-quality-opportunity-2026-06-05",
      sia_snapshot: {
        confidence: 0.82,
        quality_score: 0.69,
        opportunity_score: 0.64,
        score_model_version: "score-v5-dual-quality-opportunity-2026-06-05",
      },
    },
    fetched_at: new Date(nowMs - 10 * 60_000).toISOString(),
    expires_at: new Date(nowMs - 5 * 60_000).toISOString(),
  };
  let enqueueBody: Record<string, unknown> | undefined;

  globalThis.fetch = async (url, init) => {
    const text = String(url);
    if (text.includes("/rest/v1/stock_score_snapshots")) {
      return new Response(JSON.stringify([snapshot]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (text.includes("/rest/v1/rpc/enqueue_stock_refresh_job")) {
      enqueueBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ id: "job-stale-score", status: "queued" });
    }
    throw new Error(`unexpected fetch ${text}`);
  };

  const result = await getStockScore(ticker, "detail");
  await sleep(20);

  assert.equal(result.cache.state, "stale");
  assert.equal(result.cache.source, "supabase");
  assert.deepEqual(enqueueBody, {
    p_kind: "score",
    p_market: "US",
    p_symbol: "SCORESTALE",
    p_view_mode: "detail",
    p_priority: 70,
    p_payload: {
      reason: "stale_refresh",
      reason_bucket: "stale_refresh",
      requested_ticker: ticker,
      dedupe_key: "score:US:SCORESTALE:detail:stale_refresh",
    },
  });
});

test("score cache uses the score-specific Supabase read timeout", async () => {
  useSnapshotOnlyRuntime();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-key";
  process.env.SUPABASE_READ_TIMEOUT_MS = "250";
  process.env.STOCK_SCORE_SUPABASE_READ_TIMEOUT_MS = "15";

  let abortedAtMs: number | undefined;
  const startMs = Date.now();
  globalThis.fetch = async (_url, init) => {
    await new Promise((resolve) => init?.signal?.addEventListener("abort", resolve, { once: true }));
    abortedAtMs = Date.now() - startMs;
    throw new DOMException("The operation was aborted.", "AbortError");
  };

  await assert.rejects(() => getStockScore("US:SCORETIMEOUT", "detail"), (error) => {
    assert.equal(isStockDataUnavailableError(error), true);
    return true;
  });

  assert.ok(abortedAtMs !== undefined);
  assert.ok(abortedAtMs < 150);
});

test("quote cache uses the quote-specific Supabase read timeout", async () => {
  useSnapshotOnlyRuntime();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-key";
  process.env.SUPABASE_READ_TIMEOUT_MS = "250";
  process.env.STOCK_QUOTE_SUPABASE_READ_TIMEOUT_MS = "15";

  let abortedAtMs: number | undefined;
  const startMs = Date.now();
  globalThis.fetch = async (_url, init) => {
    await new Promise((resolve) => init?.signal?.addEventListener("abort", resolve, { once: true }));
    abortedAtMs = Date.now() - startMs;
    throw new DOMException("The operation was aborted.", "AbortError");
  };

  await assert.rejects(() => getStockQuote("US:QUOTETIMEOUT"), (error) => {
    assert.equal(isStockDataUnavailableError(error), true);
    return true;
  });

  assert.ok(abortedAtMs !== undefined);
  assert.ok(abortedAtMs < 150);
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

test("quote stale snapshot avoids queued backstop when inline refresh is available", async () => {
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
  assert.equal(enqueueBody, undefined);
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
