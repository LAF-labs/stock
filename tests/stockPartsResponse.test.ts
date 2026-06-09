import test from "node:test";
import assert from "node:assert/strict";

import { attachChartPartToPayload, attachScoreParts, pendingPartialStockPayload } from "../src/lib/stockPartsResponse";
import type { StockPendingPayload } from "../src/lib/stockPendingResponse";
import type { StockChartResult } from "../src/lib/stockChartCache";
import type { StockScoreResult } from "../src/lib/stockSnapshotCache";

const ENV_KEYS = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function restore() {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  globalThis.fetch = originalFetch;
}

test.afterEach(restore);

test("attachScoreParts adds score and chart part states without changing score fields", () => {
  const result = {
    payload: {
      ok: true,
      score: 72,
      chart_series: [{ date: "2026-06-08", close: 72.25 }],
    },
    cache: {
      state: "stale",
      source: "supabase",
      ticker: "US:KO",
      view: "technical",
      fetchedAt: "2026-06-08T00:00:00.000Z",
      expiresAt: "2026-06-08T00:15:00.000Z",
      refreshStarted: true,
    },
  } satisfies StockScoreResult;

  const payload = attachScoreParts(result);
  const parts = payload.parts as Record<string, Record<string, unknown>>;

  assert.equal(payload.score, 72);
  assert.equal(parts.technical.state, "stale");
  assert.equal(parts.chart.state, "stale");
  assert.equal(parts.technical.refresh_started, true);
});

test("attachChartPartToPayload merges durable chart candles into technical score payloads", () => {
  const chartResult = {
    payload: {
      ok: true,
      type: "chart",
      requested_ticker: "US:KO",
      chart_series: [
        { date: "2026-06-07", open: 70, high: 72, low: 69, close: 71 },
        { date: "2026-06-08", open: 71, high: 73, low: 70, close: 72 },
      ],
    },
    cache: {
      state: "fresh",
      source: "supabase",
      ticker: "US:KO",
      fetchedAt: "2026-06-08T00:00:00.000Z",
      expiresAt: "2026-06-08T00:15:00.000Z",
      staleExpiresAt: "2026-07-08T00:00:00.000Z",
      lastBarDate: "2026-06-08",
    },
  } satisfies StockChartResult;

  const payload = attachChartPartToPayload({ ok: true, chart_series: [], technical_analysis: { status: "ready" } }, chartResult);
  const parts = payload.parts as Record<string, Record<string, unknown>>;

  assert.equal(Array.isArray(payload.chart_series), true);
  assert.equal((payload.chart_series as unknown[]).length, 2);
  assert.equal(parts.chart.state, "fresh");
  assert.equal(parts.chart.last_bar_date, "2026-06-08");
});

test("pendingPartialStockPayload returns ready quote and chart parts while score is pending", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-key";

  const nowMs = Date.now();
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/rest/v1/stock_quote_snapshots")) {
      return Response.json([
        {
          ticker: "US:KO",
          payload: { ok: true, type: "quote", requested_ticker: "US:KO", market: "US", symbol: "KO", latest_price: 72.25 },
          fetched_at: new Date(nowMs - 10_000).toISOString(),
          expires_at: new Date(nowMs + 300_000).toISOString(),
          stale_expires_at: new Date(nowMs + 86_400_000).toISOString(),
        },
      ]);
    }
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
            chart_series: [{ date: "2026-06-08", close: 72.25 }],
          },
          fetched_at: new Date(nowMs - 10_000).toISOString(),
          expires_at: new Date(nowMs + 300_000).toISOString(),
          stale_expires_at: new Date(nowMs + 2_592_000_000).toISOString(),
          last_bar_date: "2026-06-08",
        },
      ]);
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  const pending = {
    ok: false,
    error: "snapshot_pending",
    message: "Stock data is being prepared. Please retry shortly.",
    kind: "score",
    ticker: "US:KO",
    view: "technical",
    reason: "snapshot_miss",
    retry_after_seconds: 300,
    refresh_request: { queued: true, job_id: "job-score", status: "queued" },
  } satisfies StockPendingPayload;

  const payload = await pendingPartialStockPayload({ pending, ticker: "US:KO", view: "technical" });
  assert.ok(payload);
  assert.equal(payload?.ok, true);
  assert.equal(payload?.type, "partial_stock_snapshot");
  assert.equal((payload?.parts as Record<string, Record<string, unknown>>).technical.state, "pending");
  assert.equal((payload?.parts as Record<string, Record<string, unknown>>).quote.state, "fresh");
  assert.equal((payload?.parts as Record<string, Record<string, unknown>>).chart.state, "fresh");
  assert.equal(Array.isArray(payload?.chart_series), true);
});

test("pendingPartialStockPayload reads quote and chart snapshots concurrently", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-key";

  const nowMs = Date.now();
  const events: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/rest/v1/stock_quote_snapshots")) {
      events.push("quote:start");
      await sleep(35);
      events.push("quote:end");
      return Response.json([
        {
          ticker: "US:FASTPART",
          payload: { ok: true, type: "quote", requested_ticker: "US:FASTPART", market: "US", symbol: "FASTPART", latest_price: 10 },
          fetched_at: new Date(nowMs - 10_000).toISOString(),
          expires_at: new Date(nowMs + 300_000).toISOString(),
          stale_expires_at: new Date(nowMs + 86_400_000).toISOString(),
        },
      ]);
    }
    if (url.includes("/rest/v1/stock_chart_snapshots")) {
      events.push("chart:start");
      await sleep(5);
      events.push("chart:end");
      return Response.json([
        {
          ticker: "US:FASTPART",
          payload: {
            ok: true,
            type: "chart",
            requested_ticker: "US:FASTPART",
            market: "US",
            symbol: "FASTPART",
            chart_series: [{ date: "2026-06-08", close: 10 }],
          },
          fetched_at: new Date(nowMs - 10_000).toISOString(),
          expires_at: new Date(nowMs + 300_000).toISOString(),
          stale_expires_at: new Date(nowMs + 2_592_000_000).toISOString(),
          last_bar_date: "2026-06-08",
        },
      ]);
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  const pending = {
    ok: false,
    error: "snapshot_pending",
    message: "Stock data is being prepared. Please retry shortly.",
    kind: "score",
    ticker: "US:FASTPART",
    view: "technical",
    reason: "snapshot_miss",
    retry_after_seconds: 5,
    refresh_request: { queued: true, job_id: "job-score", status: "queued" },
  } satisfies StockPendingPayload;

  const payload = await pendingPartialStockPayload({ pending, ticker: "US:FASTPART", view: "technical" });

  assert.equal(payload?.type, "partial_stock_snapshot");
  assert.ok(events.indexOf("chart:start") > -1);
  assert.ok(events.indexOf("chart:start") < events.indexOf("quote:end"));
});

test("pendingPartialStockPayload does not enqueue a separate chart job while score is pending", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

  let chartEnqueued = false;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/rest/v1/stock_quote_snapshots")) {
      return Response.json([
        {
          ticker: "US:COLDPART",
          payload: { ok: true, type: "quote", requested_ticker: "US:COLDPART", market: "US", symbol: "COLDPART", latest_price: 10 },
          fetched_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 300_000).toISOString(),
          stale_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        },
      ]);
    }
    if (url.includes("/rest/v1/stock_chart_snapshots")) return Response.json([]);
    if (url.includes("/rest/v1/rpc/enqueue_stock_refresh_job")) {
      chartEnqueued = true;
      return Response.json({ id: "job-chart", status: "queued" });
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  const pending = {
    ok: false,
    error: "snapshot_pending",
    message: "Stock data is being prepared. Please retry shortly.",
    kind: "score",
    ticker: "US:COLDPART",
    view: "technical",
    reason: "snapshot_miss",
    retry_after_seconds: 5,
    refresh_request: { queued: true, job_id: "job-score", status: "queued" },
  } satisfies StockPendingPayload;

  const payload = await pendingPartialStockPayload({ pending, ticker: "US:COLDPART", view: "technical" });
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(payload?.type, "partial_stock_snapshot");
  assert.equal(chartEnqueued, false);
});

test("pendingPartialStockPayload returns undefined when no usable parts are ready", async () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_PUBLISHABLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  const pending = {
    ok: false,
    error: "snapshot_pending",
    message: "Stock data is being prepared. Please retry shortly.",
    kind: "score",
    ticker: "US:MISS",
    view: "detail",
    reason: "snapshot_miss",
    retry_after_seconds: 300,
    refresh_request: { queued: true },
  } satisfies StockPendingPayload;

  const payload = await pendingPartialStockPayload({ pending, ticker: "US:MISS", view: "detail" });

  assert.equal(payload, undefined);
});
