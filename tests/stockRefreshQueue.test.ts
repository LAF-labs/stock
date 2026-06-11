import test from "node:test";
import assert from "node:assert/strict";

import { clearStockRefreshEnqueueMemoryForTests, enqueueStockRefreshJob, stockRefreshDedupeKey } from "../src/lib/stockRefreshQueue";

const ENV_KEYS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_RPC_TIMEOUT_MS",
  "STOCK_REFRESH_QUEUE_ENQUEUE_TIMEOUT_MS",
  "STOCK_REFRESH_ENQUEUE_MEMORY_DEDUPE_SECONDS",
] as const;
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
  clearStockRefreshEnqueueMemoryForTests();
}

test.afterEach(restore);

test("stockRefreshDedupeKey scopes jobs by kind, ticker, view, and reason bucket", () => {
  assert.equal(
    stockRefreshDedupeKey({ kind: "score", market: "US", symbol: "NVDA", view: "technical", reason: "snapshot_miss" }),
    "score:US:NVDA:technical:snapshot_miss"
  );
  assert.equal(
    stockRefreshDedupeKey({ kind: "quote", market: "KR", symbol: "005930", reason: "stale_refresh" }),
    "quote:KR:005930:-:stale_refresh"
  );
});

test("enqueueStockRefreshJob skips safely without Supabase admin config", async () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_PUBLISHABLE_KEY;

  const result = await enqueueStockRefreshJob({ kind: "score", ticker: "US:NVDA", view: "compare" });

  assert.equal(result.queued, false);
  assert.equal(result.reason, "missing_supabase_admin_config");
});

test("enqueueStockRefreshJob uses the queue-specific Supabase RPC timeout", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  process.env.SUPABASE_RPC_TIMEOUT_MS = "250";
  process.env.STOCK_REFRESH_QUEUE_ENQUEUE_TIMEOUT_MS = "15";

  let abortedAtMs: number | undefined;
  const startMs = Date.now();
  globalThis.fetch = async (_url, init) => {
    await new Promise((resolve) => init?.signal?.addEventListener("abort", resolve, { once: true }));
    abortedAtMs = Date.now() - startMs;
    throw new DOMException("The operation was aborted.", "AbortError");
  };

  const result = await enqueueStockRefreshJob({ kind: "score", ticker: "US:TIMEOUT", view: "detail" });

  assert.equal(result.queued, false);
  assert.equal(result.reason, "enqueue_failed");
  assert.ok(abortedAtMs !== undefined);
  assert.ok(abortedAtMs < 150);
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
    p_payload: {
      reason: "snapshot_miss",
      reason_bucket: "snapshot_miss",
      requested_ticker: "US:NVDA",
      dedupe_key: "score:US:NVDA:compare:snapshot_miss",
    },
  });
});

test("enqueueStockRefreshJob suppresses repeated successful enqueue RPCs briefly", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  process.env.STOCK_REFRESH_ENQUEUE_MEMORY_DEDUPE_SECONDS = "30";

  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ id: "job-1", status: "queued" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const first = await enqueueStockRefreshJob({ kind: "score", ticker: "US:NVDA", view: "detail" });
  const second = await enqueueStockRefreshJob({ kind: "score", ticker: "US:NVDA", view: "detail" });

  assert.equal(first.queued, true);
  assert.equal(second.queued, true);
  assert.equal(second.job?.status, "recently_queued");
  assert.equal(calls, 1);
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
    p_payload: {
      reason: "snapshot_miss",
      reason_bucket: "snapshot_miss",
      requested_ticker: "US:NVDA",
      dedupe_key: "score:US:NVDA:technical:snapshot_miss",
    },
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
    p_priority: 70,
    p_payload: {
      reason: "stale_refresh",
      reason_bucket: "stale_refresh",
      requested_ticker: "US:NVDA",
      dedupe_key: "score:US:NVDA:detail:stale_refresh",
    },
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
    p_priority: 5,
    p_payload: {
      reason: "snapshot_miss",
      reason_bucket: "snapshot_miss",
      requested_ticker: "KR:005930",
      dedupe_key: "quote:KR:005930:-:snapshot_miss",
    },
  });
});

test("enqueueStockRefreshJob sends chart jobs as a high-priority independent lane", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co/";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

  let capturedBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_url, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ id: "job-chart", status: "queued" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const result = await enqueueStockRefreshJob({ kind: "chart", ticker: "US:KO" });

  assert.equal(result.queued, true);
  assert.deepEqual(capturedBody, {
    p_kind: "chart",
    p_market: "US",
    p_symbol: "KO",
    p_view_mode: null,
    p_priority: 15,
    p_payload: {
      reason: "snapshot_miss",
      reason_bucket: "snapshot_miss",
      requested_ticker: "US:KO",
      dedupe_key: "chart:US:KO:-:snapshot_miss",
    },
  });
});
