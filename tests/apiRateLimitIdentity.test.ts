import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import { acquireRateLimit, apiLimitPolicy, clientRateLimitKey } from "../src/lib/apiRateLimit";
import { acquireRefreshCooldown } from "../src/lib/refreshCooldown";

const ENV_KEYS = [
  "NODE_ENV",
  "VERCEL_ENV",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "STOCK_RATE_LIMIT_SECRET",
  "STOCK_REFRESH_COOKIE_SECRET",
  "STOCK_REFRESH_COOLDOWN_SECONDS",
  "TRUST_PROXY_HEADERS",
] as const;

const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;

function restoreEnv() {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      (process.env as Record<string, string | undefined>)[key] = value;
    }
  }
  globalThis.fetch = originalFetch;
}

function requestFor(ip: string, userAgent: string): NextRequest {
  return new NextRequest("http://localhost/api/quote?ticker=US:KO&refresh=1", {
    headers: {
      "x-forwarded-for": ip,
      "user-agent": userAgent,
    },
  });
}

test.afterEach(restoreEnv);

test("production rate limit fails closed when the Supabase guard is unavailable", async () => {
  restoreEnv();
  process.env.VERCEL_ENV = "production";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  process.env.STOCK_RATE_LIMIT_SECRET = "r".repeat(32);
  globalThis.fetch = async () => {
    throw new Error("network down");
  };

  const result = await acquireRateLimit("identity", apiLimitPolicy("stock_score", 180, 60));

  assert.equal(result.allowed, false);
  assert.equal(result.remaining, 0);
  assert.equal(result.source, "supabase");
});

test("client rate-limit identity is not changed by user-agent rotation", () => {
  restoreEnv();
  process.env.STOCK_RATE_LIMIT_SECRET = "r".repeat(32);
  process.env.TRUST_PROXY_HEADERS = "1";

  const first = clientRateLimitKey(requestFor("203.0.113.41", "ua-a"));
  const second = clientRateLimitKey(requestFor("203.0.113.41", "ua-b"));
  const differentIp = clientRateLimitKey(requestFor("203.0.113.42", "ua-a"));

  assert.equal(first, second);
  assert.notEqual(first, differentIp);
});

test("client rate-limit identity ignores forwarding headers unless proxy trust is enabled", () => {
  restoreEnv();
  process.env.STOCK_RATE_LIMIT_SECRET = "r".repeat(32);
  delete process.env.TRUST_PROXY_HEADERS;

  const first = clientRateLimitKey(requestFor("203.0.113.41", "ua-a"));
  const spoofed = clientRateLimitKey(requestFor("203.0.113.42", "ua-a"));

  assert.equal(first, spoofed);

  process.env.TRUST_PROXY_HEADERS = "1";
  assert.notEqual(
    clientRateLimitKey(requestFor("203.0.113.41", "ua-a")),
    clientRateLimitKey(requestFor("203.0.113.42", "ua-a"))
  );
});

test("production-like runtime requires a strong dedicated rate-limit secret", () => {
  restoreEnv();
  process.env.VERCEL_ENV = "preview";
  delete process.env.STOCK_RATE_LIMIT_SECRET;

  assert.throws(
    () => clientRateLimitKey(requestFor("203.0.113.51", "ua-a")),
    /STOCK_RATE_LIMIT_SECRET/
  );
});

test("manual refresh cooldown binds no-cookie requests to the network identity", async () => {
  restoreEnv();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.STOCK_RATE_LIMIT_SECRET = "r".repeat(32);
  process.env.STOCK_REFRESH_COOKIE_SECRET = "c".repeat(32);
  process.env.STOCK_REFRESH_COOLDOWN_SECONDS = "300";
  process.env.TRUST_PROXY_HEADERS = "1";

  const nowMs = Date.parse("2026-06-05T12:00:00.000Z");
  const first = await acquireRefreshCooldown(requestFor("203.0.113.77", "ua-a"), nowMs);
  const second = await acquireRefreshCooldown(requestFor("203.0.113.77", "ua-b"), nowMs + 1_000);

  assert.equal(first.blocked, false);
  assert.equal(second.blocked, true);
  assert.equal(second.remainingSeconds, 299);
});

test("production refresh cooldown fails closed when the Supabase guard is unavailable", async () => {
  restoreEnv();
  process.env.VERCEL_ENV = "production";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  process.env.STOCK_RATE_LIMIT_SECRET = "r".repeat(32);
  process.env.STOCK_REFRESH_COOKIE_SECRET = "c".repeat(32);
  globalThis.fetch = async () => {
    throw new Error("network down");
  };

  const result = await acquireRefreshCooldown(requestFor("203.0.113.88", "ua-a"));

  assert.equal(result.blocked, true);
  assert.equal(result.remainingSeconds, 300);
});
