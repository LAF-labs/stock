import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import { GET } from "../src/app/api/stock/display/route";

const ENV_KEYS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "STOCK_DISPLAY_RATE_LIMIT",
  "STOCK_DISPLAY_RATE_LIMIT_WINDOW_SECONDS",
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

function request(url: string, identity = "display-api-test"): NextRequest {
  return new NextRequest(url, {
    headers: {
      cookie: `stock_refresh_user=${identity}`,
      "user-agent": identity,
    },
  });
}

test.afterEach(restoreEnv);

test("stock display endpoint returns displayable payload instead of pending for valid cold ticker", async () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_PUBLISHABLE_KEY;

  const response = await GET(request("http://localhost/api/stock/display?ticker=KR:005930&view=detail", "display-cold"));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.ticker, "KR:005930");
  assert.equal(payload.identity.value.symbol, "005930");
  assert.deepEqual(payload.completion.recoveringParts, []);
  assert.deepEqual(payload.completion.missingParts, ["price", "chart", "score"]);
  assert.equal(payload.refresh.active, false);
  assert.equal(payload.refresh.pollable, false);
  assert.equal(payload.refresh.nextPollMs, undefined);
  assert.deepEqual(payload.refresh.recoveringParts, []);
  assert.equal(payload.refresh.queue.attempted, true);
  assert.equal(payload.refresh.queue.state, "unavailable");
  assert.equal(payload.refresh.queue.queuedActions, 0);
  assert.equal(payload.refresh.queue.failedActions, 3);
  assert.equal(JSON.stringify(payload).includes("snapshot_pending"), false);
  assert.match(response.headers.get("Cache-Control") || "", /max-age=0/);
  assert.match(response.headers.get("Vercel-CDN-Cache-Control") || "", /s-maxage=60/);
});

test("technical display endpoint keeps chart recovery separate from user-facing failure", async () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_PUBLISHABLE_KEY;

  const response = await GET(request("http://localhost/api/stock/display?ticker=US:KO&view=technical", "display-technical"));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.ticker, "US:KO");
  assert.equal(payload.completion.missingParts.includes("chart"), true);
  assert.equal(payload.completion.missingParts.includes("technical"), true);
  assert.deepEqual(payload.completion.recoveringParts, []);
  assert.equal(payload.refresh.active, false);
  assert.equal(payload.refresh.pollable, false);
  assert.equal(payload.refresh.queue.state, "unavailable");
  assert.equal(payload.refresh.queue.failedActions, 3);
});

test("stock display endpoint rate limits repeated uncached requests before fan-out", async () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.STOCK_DISPLAY_RATE_LIMIT = "1";
  process.env.STOCK_DISPLAY_RATE_LIMIT_WINDOW_SECONDS = "60";

  const first = await GET(request("http://localhost/api/stock/display?ticker=US:KO&view=detail", "display-rate"));
  const second = await GET(request("http://localhost/api/stock/display?ticker=US:AAPL&view=detail", "display-rate"));
  const payload = await second.json();

  assert.equal(first.status, 200);
  assert.equal(second.status, 429);
  assert.equal(payload.error, "rate_limited");
  assert.match(second.headers.get("cache-control") || "", /no-store/);
});
