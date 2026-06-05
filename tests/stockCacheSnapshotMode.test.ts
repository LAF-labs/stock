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
  "STOCK_API_APP_KEY",
  "STOCK_API_APP_SECRET",
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

  globalThis.fetch = async (url) => {
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

test("quote force refresh can use Node KIS quote client in Vercel snapshot mode", async () => {
  useSnapshotOnlyRuntime();
  process.env.STOCK_API_APP_KEY = "app-key";
  process.env.STOCK_API_APP_SECRET = "app-secret";
  process.env.STOCK_API_BASE = "https://kis.example.com";

  globalThis.fetch = async (url) => {
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
