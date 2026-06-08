import test from "node:test";
import assert from "node:assert/strict";

import { attachScoreParts, pendingPartialStockPayload } from "../src/lib/stockPartsResponse";
import type { StockPendingPayload } from "../src/lib/stockPendingResponse";
import type { StockScoreResult } from "../src/lib/stockSnapshotCache";

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
