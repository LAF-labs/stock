import test from "node:test";
import assert from "node:assert/strict";

import { GET } from "../src/app/api/health/stock-data/route";

const ENV_KEYS = [
  "STOCK_DATA_RUNTIME",
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "STOCK_REFRESH_COOKIE_SECRET",
  "STOCK_RATE_LIMIT_SECRET",
  "STOCK_API_APP_KEY",
  "STOCK_API_APP_SECRET",
  "STOCK_API_BASE",
  "STOCK_HEALTH_CHECK_TOKEN",
  "MARKET_DATA_INTERNAL_TOKEN",
  "VERCEL_ENV",
  "VERCEL_GIT_COMMIT_REF",
  "VERCEL_GIT_COMMIT_SHA",
] as const;

const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function restoreEnv() {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function healthRequest(path = "/api/health/stock-data", token?: string): Request {
  return new Request(`http://localhost${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  });
}

test.afterEach(restoreEnv);

test("stock data health hides detailed env names and commit metadata by default", async () => {
  restoreEnv();
  process.env.VERCEL_ENV = "preview";
  process.env.VERCEL_GIT_COMMIT_REF = "codex/test";
  process.env.VERCEL_GIT_COMMIT_SHA = "abc123";
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_PUBLISHABLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  const response = await GET(healthRequest());
  const payload = await response.json();

  assert.equal(response.status, 503);
  assert.deepEqual(Object.keys(payload.env).sort(), ["missing_count", "required_count"]);
  assert.equal(typeof payload.env.missing_count, "number");
  assert.equal(payload.vercel.env, "preview");
  assert.equal(payload.vercel.branch, undefined);
  assert.equal(payload.vercel.sha, undefined);
});

test("stock data health requires a bearer token for verbose diagnostics", async () => {
  restoreEnv();
  process.env.STOCK_HEALTH_CHECK_TOKEN = "health-token";
  process.env.VERCEL_GIT_COMMIT_REF = "codex/test";
  process.env.VERCEL_GIT_COMMIT_SHA = "abc123";

  const denied = await GET(healthRequest("/api/health/stock-data?verbose=1"));
  assert.equal(denied.status, 401);

  const allowed = await GET(healthRequest("/api/health/stock-data?verbose=1", "health-token"));
  const payload = await allowed.json();

  assert.equal(Array.isArray(payload.env.missing), true);
  assert.equal(typeof payload.env.present.SUPABASE_URL, "boolean");
  assert.equal(payload.vercel.branch, "codex/test");
  assert.equal(payload.vercel.sha, "abc123");
});
