import test from "node:test";
import assert from "node:assert/strict";

import { isStockDataUnavailableError } from "../src/lib/stockDataRuntime";
import { getStockChart } from "../src/lib/stockChartCache";

const ENV_KEYS = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_READ_TIMEOUT_MS",
  "SUPABASE_WRITE_TIMEOUT_MS",
  "STOCK_CHART_SUPABASE_READ_TIMEOUT_MS",
  "STOCK_CHART_SUPABASE_WRITE_TIMEOUT_MS",
  "STOCK_YAHOO_FALLBACK",
  "STOCK_YAHOO_TIMEOUT_MS",
] as const;
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
    p_priority: 60,
    p_payload: {
      reason: "stale_refresh",
      reason_bucket: "stale_refresh",
      requested_ticker: "US:STALECHART",
      dedupe_key: "chart:US:STALECHART:-:stale_refresh",
    },
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

test("stock chart cache refreshes cold charts inline from Yahoo fallback", async () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_PUBLISHABLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.STOCK_YAHOO_FALLBACK = "1";

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("query1.finance.yahoo.com/v8/finance/chart/FASTCHART")) {
      return Response.json({
        chart: {
          result: [
            {
              meta: {
                currency: "USD",
                exchangeName: "NMS",
                regularMarketPrice: 12.5,
                chartPreviousClose: 11.5,
              },
              timestamp: [1780531200, 1780617600],
              indicators: {
                quote: [
                  {
                    open: [11, 12],
                    high: [12, 13],
                    low: [10, 11],
                    close: [11.5, 12.5],
                    volume: [1000, 1100],
                  },
                ],
              },
            },
          ],
          error: null,
        },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  const result = await getStockChart("US:FASTCHART");

  assert.equal(result.cache.state, "miss");
  assert.equal(result.cache.source, "market-data");
  assert.equal(result.cache.lastBarDate, "2026-06-05");
  assert.equal((result.payload.chart_series as unknown[]).length, 2);
  assert.equal((result.payload.fetch as Record<string, unknown>).provider, "yahoo_finance");
});

test("stock chart cache queues forced misses before regular chart misses", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

  const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.includes("/rest/v1/stock_chart_snapshots")) return Response.json([]);
    if (url.includes("/rest/v1/rpc/enqueue_stock_refresh_job")) return Response.json({ id: "chart-force-job", status: "queued" });
    throw new Error(`unexpected fetch ${url}`);
  };

  await assert.rejects(() => getStockChart("US:FORCECHART", { forceRefresh: true }), (error) => {
    assert.equal(isStockDataUnavailableError(error), true);
    if (!isStockDataUnavailableError(error)) return false;
    assert.equal(error.payload.kind, "chart");
    assert.equal(error.payload.reason, "refresh_background_only");
    return true;
  });

  const enqueue = calls.find((call) => call.url.includes("/rest/v1/rpc/enqueue_stock_refresh_job"));
  assert.deepEqual(enqueue?.body, {
    p_kind: "chart",
    p_market: "US",
    p_symbol: "FORCECHART",
    p_view_mode: null,
    p_priority: 1,
    p_payload: {
      reason: "refresh_background_only",
      reason_bucket: "refresh_background_only",
      requested_ticker: "US:FORCECHART",
      dedupe_key: "chart:US:FORCECHART:-:refresh_background_only",
    },
  });
});

test("stock chart cache uses the chart-specific Supabase read timeout", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-key";
  process.env.SUPABASE_READ_TIMEOUT_MS = "250";
  process.env.STOCK_CHART_SUPABASE_READ_TIMEOUT_MS = "15";

  let abortedAtMs: number | undefined;
  const startMs = Date.now();
  globalThis.fetch = async (_url, init) => {
    await new Promise((resolve) => init?.signal?.addEventListener("abort", resolve, { once: true }));
    abortedAtMs = Date.now() - startMs;
    throw new DOMException("The operation was aborted.", "AbortError");
  };

  await assert.rejects(() => getStockChart("US:CHARTTIMEOUT"), (error) => {
    assert.equal(isStockDataUnavailableError(error), true);
    return true;
  });

  assert.ok(abortedAtMs !== undefined);
  assert.ok(abortedAtMs < 150);
});
