import test from "node:test";
import assert from "node:assert/strict";

import { isStockDataUnavailableError } from "../src/lib/stockDataRuntime";
import { getStockChart } from "../src/lib/stockChartCache";

const ENV_KEYS = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;

function restore() {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  globalThis.fetch = originalFetch;
}

test.afterEach(restore);

test("stock chart cache serves fresh Supabase chart snapshots", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-key";

  const nowMs = Date.now();
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/rest/v1/stock_chart_snapshots")) {
      return Response.json([
        {
          ticker: "US:KO",
          payload: {
            ok: true,
            type: "chart",
            requested_ticker: "US:KO",
            market: "US",
            symbol: "KO",
            chart_series: [{ date: "2026-06-08", open: 1, high: 2, low: 1, close: 2, volume: 100 }],
          },
          fetched_at: new Date(nowMs - 30_000).toISOString(),
          expires_at: new Date(nowMs + 300_000).toISOString(),
          stale_expires_at: new Date(nowMs + 2_592_000_000).toISOString(),
          last_bar_date: "2026-06-08",
        },
      ]);
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  const result = await getStockChart("US:KO");

  assert.equal(result.cache.state, "fresh");
  assert.equal(result.cache.source, "supabase");
  assert.equal(result.cache.lastBarDate, "2026-06-08");
  assert.equal(Array.isArray(result.payload.chart_series), true);
  assert.equal(result.payload.server_cache && typeof result.payload.server_cache, "object");
});

test("stock chart cache serves stale snapshots and enqueues a chart refresh", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

  const nowMs = Date.now();
  const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.includes("/rest/v1/stock_chart_snapshots")) {
      return Response.json([
        {
          ticker: "US:STALECHART",
          payload: {
            ok: true,
            type: "chart",
            requested_ticker: "US:STALECHART",
            market: "US",
            symbol: "STALECHART",
            chart_series: [{ date: "2026-06-07", open: 1, high: 2, low: 1, close: 2, volume: 100 }],
          },
          fetched_at: new Date(nowMs - 3_600_000).toISOString(),
          expires_at: new Date(nowMs - 60_000).toISOString(),
          stale_expires_at: new Date(nowMs + 2_592_000_000).toISOString(),
          last_bar_date: "2026-06-07",
        },
      ]);
    }
    if (url.includes("/rest/v1/rpc/enqueue_stock_refresh_job")) {
      return Response.json({ id: "chart-job", status: "queued" });
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  const result = await getStockChart("US:STALECHART");

  assert.equal(result.cache.state, "stale");
  assert.equal(result.cache.refreshStarted, true);
  const enqueue = calls.find((call) => call.url.includes("/rest/v1/rpc/enqueue_stock_refresh_job"));
  assert.deepEqual(enqueue?.body, {
    p_kind: "chart",
    p_market: "US",
    p_symbol: "STALECHART",
    p_view_mode: null,
    p_priority: 15,
    p_payload: { reason: "stale_refresh", requested_ticker: "US:STALECHART" },
  });
});

test("stock chart cache reports snapshot misses without provider calls", async () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_PUBLISHABLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  await assert.rejects(
    () => getStockChart("US:MISSCHART"),
    (error) => {
      assert.equal(isStockDataUnavailableError(error), true);
      if (!isStockDataUnavailableError(error)) return false;
      assert.equal(error.payload.kind, "chart");
      assert.equal(error.payload.reason, "snapshot_miss");
      return true;
    }
  );
});
