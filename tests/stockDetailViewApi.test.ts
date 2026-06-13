import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import { GET } from "../src/app/api/stock/detail-view/route";

const ENV_KEYS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "STOCK_DETAIL_VIEW_RATE_LIMIT",
  "STOCK_DETAIL_VIEW_RATE_LIMIT_WINDOW_SECONDS",
] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function restoreEnv() {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const globalWithRateLimits = globalThis as typeof globalThis & {
    __stockApiRateLimits?: Map<string, unknown>;
  };
  globalWithRateLimits.__stockApiRateLimits?.clear();
}

test.afterEach(restoreEnv);

test("stock detail-view endpoint returns partial model for a valid cold ticker", async () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_PUBLISHABLE_KEY;

  const response = await GET(new NextRequest("http://localhost/api/stock/detail-view?ticker=KR:005930"));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, "partial");
  assert.equal(payload.ticker, "KR:005930");
  assert.equal(payload.identity.symbol, "005930");
  assert.equal(payload.degradedReason, "identity_only");
  assert.equal(payload.parts.price.state, "missing");
  assert.equal(payload.nextPollMs, undefined);
  assert.deepEqual(payload.jobs, []);
  assert.match(response.headers.get("Cache-Control") || "", /max-age=0/);
});

test("stock detail-view endpoint returns irreversible failure for invalid ticker", async () => {
  const response = await GET(new NextRequest("http://localhost/api/stock/detail-view?ticker=KR:BAD"));
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.mode, "failed_irreversible");
  assert.equal(payload.error, "invalid_ticker");
  assert.match(response.headers.get("Cache-Control") || "", /no-store/);
});

test("stock detail-view endpoint stops polling when missing parts cannot be queued", async () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_PUBLISHABLE_KEY;

  const response = await GET(new NextRequest("http://localhost/api/stock/detail-view?ticker=US:VLD"));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, "partial");
  assert.equal(payload.nextPollMs, undefined);
  assert.equal(payload.parts.price.state, "missing");
  assert.deepEqual(payload.jobs, []);
});

test("stock detail-view endpoint rate limits repeated uncached requests before fan-out", async () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.STOCK_DETAIL_VIEW_RATE_LIMIT = "1";
  process.env.STOCK_DETAIL_VIEW_RATE_LIMIT_WINDOW_SECONDS = "60";

  const first = await GET(new NextRequest("http://localhost/api/stock/detail-view?ticker=US:KO", {
    headers: { cookie: "stock_refresh_user=detail-rate" },
  }));
  const second = await GET(new NextRequest("http://localhost/api/stock/detail-view?ticker=US:AAPL", {
    headers: { cookie: "stock_refresh_user=detail-rate" },
  }));
  const payload = await second.json();

  assert.equal(first.status, 200);
  assert.equal(second.status, 429);
  assert.equal(payload.error, "rate_limited");
});
