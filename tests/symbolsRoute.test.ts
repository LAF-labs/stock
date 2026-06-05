import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import { GET } from "../src/app/api/symbols/route";

const ENV_KEYS = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "STOCK_SYMBOL_SEARCH_RATE_LIMIT",
  "STOCK_SYMBOL_SEARCH_RATE_LIMIT_WINDOW_SECONDS",
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

function requestFor(query: string, identity: string): NextRequest {
  return new NextRequest(`http://localhost/api/symbols?q=${encodeURIComponent(query)}&limit=1`, {
    headers: {
      "user-agent": identity,
      "x-forwarded-for": "203.0.113.10",
    },
  });
}

test.afterEach(restoreEnv);

test("symbols API rate limits repeated search requests", async () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_PUBLISHABLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.STOCK_SYMBOL_SEARCH_RATE_LIMIT = "1";
  process.env.STOCK_SYMBOL_SEARCH_RATE_LIMIT_WINDOW_SECONDS = "60";

  const first = await GET(requestFor("ko", "symbols-route-rate-limit-test"));
  const second = await GET(requestFor("nvda", "symbols-route-rate-limit-test"));
  const payload = await second.json();

  assert.equal(first.status, 200);
  assert.equal(second.status, 429);
  assert.equal(payload.error, "rate_limited");
});
