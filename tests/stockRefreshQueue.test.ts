import test from "node:test";
import assert from "node:assert/strict";

import { enqueueStockRefreshJob } from "../src/lib/stockRefreshQueue";

const ENV_KEYS = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_PUBLISHABLE_KEY"] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;

function restore() {
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

test.afterEach(restore);

test("enqueueStockRefreshJob skips safely without Supabase admin config", async () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_PUBLISHABLE_KEY;

  const result = await enqueueStockRefreshJob({ kind: "score", ticker: "US:NVDA", view: "compare" });

  assert.equal(result.queued, false);
  assert.equal(result.reason, "missing_supabase_admin_config");
});

test("enqueueStockRefreshJob calls Supabase RPC with normalized score job", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = async (url, init) => {
    capturedUrl = String(url);
    capturedInit = init;
    return new Response(JSON.stringify({ id: "job-1", status: "queued" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const result = await enqueueStockRefreshJob({
    kind: "score",
    ticker: "nvda",
    view: "compare",
    priority: 20,
    reason: "snapshot_miss",
  });

  assert.equal(result.queued, true);
  assert.equal(result.job?.id, "job-1");
  assert.equal(capturedUrl, "https://example.supabase.co/rest/v1/rpc/enqueue_stock_refresh_job");
  assert.equal(capturedInit?.method, "POST");
  assert.equal((capturedInit?.headers as Record<string, string>).apikey, "service-role-key");
  assert.deepEqual(JSON.parse(String(capturedInit?.body)), {
    p_kind: "score",
    p_market: "US",
    p_symbol: "NVDA",
    p_view_mode: "compare",
    p_priority: 20,
    p_payload: { reason: "snapshot_miss", requested_ticker: "US:NVDA" },
  });
});

test("enqueueStockRefreshJob queues technical score jobs with on-demand priority", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

  let capturedBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_url, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ id: "job-technical", status: "queued" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const result = await enqueueStockRefreshJob({
    kind: "score",
    ticker: "nvda",
    view: "technical",
  });

  assert.equal(result.queued, true);
  assert.deepEqual(capturedBody, {
    p_kind: "score",
    p_market: "US",
    p_symbol: "NVDA",
    p_view_mode: "technical",
    p_priority: 20,
    p_payload: { reason: "snapshot_miss", requested_ticker: "US:NVDA" },
  });
});

test("enqueueStockRefreshJob preserves stale refresh reasons", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

  let capturedBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_url, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ id: "job-stale", status: "queued" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const result = await enqueueStockRefreshJob({
    kind: "score",
    ticker: "US:NVDA",
    view: "detail",
    reason: "stale_refresh",
  });

  assert.equal(result.queued, true);
  assert.deepEqual(capturedBody, {
    p_kind: "score",
    p_market: "US",
    p_symbol: "NVDA",
    p_view_mode: "detail",
    p_priority: 20,
    p_payload: { reason: "stale_refresh", requested_ticker: "US:NVDA" },
  });
});

test("enqueueStockRefreshJob sends quote jobs without a view mode", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co/";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

  let capturedBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_url, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ id: "job-2", status: "queued" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const result = await enqueueStockRefreshJob({ kind: "quote", ticker: "005930" });

  assert.equal(result.queued, true);
  assert.deepEqual(capturedBody, {
    p_kind: "quote",
    p_market: "KR",
    p_symbol: "005930",
    p_view_mode: null,
    p_priority: 40,
    p_payload: { reason: "snapshot_miss", requested_ticker: "KR:005930" },
  });
});
