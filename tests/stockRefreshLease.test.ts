import test from "node:test";
import assert from "node:assert/strict";

import { acquireStockRefreshLease } from "../src/lib/stockRefreshLease";

const ENV_KEYS = [
  "VERCEL_ENV",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "STOCK_API_APP_KEY",
] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
const originalWarn = console.warn;

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
  console.warn = originalWarn;
}

test.afterEach(restore);

test("acquireStockRefreshLease fails closed in production when Supabase guard is unavailable", async () => {
  process.env.VERCEL_ENV = "production";
  process.env.SUPABASE_URL = "https://example.supabase.co/";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  process.env.SUPABASE_PUBLISHABLE_KEY = "public-safe-key";
  process.env.STOCK_API_APP_KEY = "secret-stock-app-key-value";
  const warnings: unknown[][] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  globalThis.fetch = async () => {
    throw new Error("network down secret-stock-app-key-value");
  };

  const result = await acquireStockRefreshLease({
    kind: "quote",
    ticker: `US:STRICTLEASE${Date.now()}`,
    lockSeconds: 30,
    owner: "test-worker",
  });

  assert.equal(result.acquired, false);
  assert.equal(result.source, "supabase");
  assert.equal(result.lockedBy, "guard_unavailable");
  assert.equal(JSON.stringify(warnings).includes("secret-stock-app-key-value"), false);
  assert.match(JSON.stringify(warnings), /\[redacted\]/);
});

test("acquireStockRefreshLease uses process memory when Supabase admin config is missing", async () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_PUBLISHABLE_KEY;

  const ticker = `US:LEASE${Date.now()}`;
  const first = await acquireStockRefreshLease({ kind: "quote", ticker, lockSeconds: 30, owner: "test-worker" });
  const second = await acquireStockRefreshLease({ kind: "quote", ticker, lockSeconds: 30, owner: "test-worker-2" });

  assert.equal(first.acquired, true);
  assert.equal(first.source, "memory");
  assert.equal(second.acquired, false);
  assert.equal(second.source, "memory");
  assert.equal(typeof second.leaseUntil, "string");
});

test("acquireStockRefreshLease calls Supabase RPC with normalized score target", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co/";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = async (url, init) => {
    capturedUrl = String(url);
    capturedInit = init;
    return new Response(
      JSON.stringify({
        acquired: true,
        lease_until: "2026-06-05T12:00:30.000Z",
        locked_by: "api-worker",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  const result = await acquireStockRefreshLease({
    kind: "score",
    ticker: "nvda",
    view: "compare",
    lockSeconds: 45,
    owner: "api-worker",
  });

  assert.equal(result.acquired, true);
  assert.equal(result.source, "supabase");
  assert.equal(result.leaseUntil, "2026-06-05T12:00:30.000Z");
  assert.equal(capturedUrl, "https://example.supabase.co/rest/v1/rpc/acquire_stock_refresh_lease");
  assert.equal(capturedInit?.method, "POST");
  assert.equal((capturedInit?.headers as Record<string, string>).apikey, "service-role-key");
  assert.deepEqual(JSON.parse(String(capturedInit?.body)), {
    p_kind: "score",
    p_market: "US",
    p_symbol: "NVDA",
    p_view_mode: "compare",
    p_lock_seconds: 45,
    p_locked_by: "api-worker",
  });
});

test("acquireStockRefreshLease passes technical score view to Supabase", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co/";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

  let capturedBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_url, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify([{ acquired: true, lease_until: "2026-06-05T12:00:30.000Z", locked_by: "api-worker" }]),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  const result = await acquireStockRefreshLease({
    kind: "score",
    ticker: "nvda",
    view: "technical",
    lockSeconds: 45,
    owner: "api-worker",
  });

  assert.equal(result.acquired, true);
  assert.equal(capturedBody?.p_view_mode, "technical");
});

test("acquireStockRefreshLease omits view mode for quote targets", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

  let capturedBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_url, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify([{ acquired: false, lease_until: "2026-06-05T12:00:30.000Z" }]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const result = await acquireStockRefreshLease({ kind: "quote", ticker: "005930", lockSeconds: 20 });

  assert.equal(result.acquired, false);
  assert.equal(result.leaseUntil, "2026-06-05T12:00:30.000Z");
  assert.deepEqual(capturedBody, {
    p_kind: "quote",
    p_market: "KR",
    p_symbol: "005930",
    p_view_mode: null,
    p_lock_seconds: 20,
    p_locked_by: result.owner,
  });
});
