import test from "node:test";
import assert from "node:assert/strict";

import { readTerminalStockDisplayFailures, terminalStockDisplayFailureParts } from "../src/lib/stockRefreshFailures";

const ENV_KEYS = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;

test.afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  globalThis.fetch = originalFetch;
});

test("terminal refresh failures map provider-empty score rows to derived detail sections", () => {
  const parts = terminalStockDisplayFailureParts({
    kind: "score",
    view_mode: "detail",
    last_error: "provider_confirmed_empty: No data found",
  }, "compare");

  assert.deepEqual(parts, [
    { part: "score", reason: "provider_confirmed_empty" },
    { part: "fundamentals", reason: "provider_confirmed_empty" },
    { part: "industryBenchmark", reason: "provider_confirmed_empty" },
  ]);
});

test("terminal refresh failures keep transient failures recoverable", () => {
  const parts = terminalStockDisplayFailureParts({
    kind: "chart",
    view_mode: null,
    last_error: "fetch failed",
  }, "technical");

  assert.deepEqual(parts, []);
});

test("terminal refresh failure reads fail open when Supabase is unavailable", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
  globalThis.fetch = (async () => {
    throw new Error("network down");
  }) as typeof fetch;

  assert.deepEqual(await readTerminalStockDisplayFailures("US:VLD", "technical"), []);
});
