import test from "node:test";
import assert from "node:assert/strict";

import { fetchWithTimeout, supabaseAdminConfig, supabaseReadConfig } from "../src/lib/supabaseRest";

const ENV_KEYS = ["NODE_ENV", "VERCEL_ENV", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ALLOW_SERVICE_ROLE_READ_FALLBACK"] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;

function restoreEnv() {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    const env = process.env as Record<string, string | undefined>;
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }
}

test.afterEach(() => {
  restoreEnv();
  globalThis.fetch = originalFetch;
});

test("Supabase read config prefers the publishable key over service role", () => {
  process.env.SUPABASE_URL = "https://example.supabase.co/";
  process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

  assert.deepEqual(supabaseReadConfig(), {
    url: "https://example.supabase.co",
    key: "publishable-key",
    keySource: "publishable",
  });
});

test("Supabase read config can fall back to service role when no publishable key exists", () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  delete process.env.SUPABASE_PUBLISHABLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

  assert.deepEqual(supabaseReadConfig(), {
    url: "https://example.supabase.co",
    key: "service-role-key",
    keySource: "service_role",
  });
});

test("Supabase read config does not use service role fallback in production without explicit override", () => {
  process.env.VERCEL_ENV = "production";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  delete process.env.SUPABASE_PUBLISHABLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

  assert.equal(supabaseReadConfig(), undefined);

  process.env.SUPABASE_ALLOW_SERVICE_ROLE_READ_FALLBACK = "1";
  assert.deepEqual(supabaseReadConfig(), {
    url: "https://example.supabase.co",
    key: "service-role-key",
    keySource: "service_role",
  });
});

test("Supabase admin config remains service-role only", () => {
  process.env.SUPABASE_URL = "https://example.supabase.co/";
  process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

  assert.deepEqual(supabaseAdminConfig(), {
    url: "https://example.supabase.co",
    key: "service-role-key",
    keySource: "service_role",
  });
});

test("fetchWithTimeout still times out when caller provides an abort signal", async () => {
  const callerController = new AbortController();
  globalThis.fetch = async (_url, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });

  const result = await Promise.race([
    fetchWithTimeout("https://example.com/slow", { signal: callerController.signal }, 10).then(
      () => "resolved",
      () => "rejected"
    ),
    sleep(80).then(() => "timeout"),
  ]);

  assert.equal(result, "rejected");
  assert.equal(callerController.signal.aborted, false);
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
