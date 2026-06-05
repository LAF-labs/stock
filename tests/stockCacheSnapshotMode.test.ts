import test from "node:test";
import assert from "node:assert/strict";

import { isStockDataUnavailableError } from "../src/lib/stockDataRuntime";
import { getStockQuote } from "../src/lib/stockQuoteCache";
import { getStockScore } from "../src/lib/stockSnapshotCache";

const ENV_KEYS = [
  "VERCEL",
  "STOCK_DATA_RUNTIME",
  "STOCK_DATA_BACKEND",
  "PYTHON_BIN",
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "MARKET_DATA_SERVICE_URL",
  "MARKET_DATA_INTERNAL_TOKEN",
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

function useSnapshotOnlyRuntime() {
  restoreEnv();
  process.env.VERCEL = "1";
  process.env.PYTHON_BIN = "/bin/false";
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_PUBLISHABLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.MARKET_DATA_SERVICE_URL;
  delete process.env.MARKET_DATA_INTERNAL_TOKEN;
}

test.afterEach(restoreEnv);

test("score cache does not invoke Python collector when Vercel snapshot mode has no snapshot", async () => {
  useSnapshotOnlyRuntime();

  await assert.rejects(
    () => getStockScore("US:ZZZSNAPMISS", "detail"),
    (error) => {
      assert.equal(isStockDataUnavailableError(error), true);
      if (!isStockDataUnavailableError(error)) return false;
      assert.equal(error.status, 503);
      assert.equal(error.payload.error, "snapshot_unavailable");
      assert.equal(error.payload.reason, "snapshot_miss");
      assert.equal(error.payload.kind, "score");
      return true;
    }
  );
});

test("quote cache reports background-only refresh in Vercel snapshot mode", async () => {
  useSnapshotOnlyRuntime();

  await assert.rejects(
    () => getStockQuote("US:KO", { forceRefresh: true }),
    (error) => {
      assert.equal(isStockDataUnavailableError(error), true);
      if (!isStockDataUnavailableError(error)) return false;
      assert.equal(error.payload.error, "snapshot_unavailable");
      assert.equal(error.payload.reason, "refresh_background_only");
      assert.equal(error.payload.kind, "quote");
      return true;
    }
  );
});
