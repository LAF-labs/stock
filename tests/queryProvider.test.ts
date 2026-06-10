import test from "node:test";
import assert from "node:assert/strict";

import {
  STOCK_QUERY_CACHE_MAX_AGE_MS,
  STOCK_QUERY_PERSIST_KEY,
  STOCK_QUERY_PERSIST_THROTTLE_MS,
  createStockQueryClient,
  stockQueryRetry,
} from "../src/components/QueryProvider";

test("stock query provider keeps persisted cache and gc windows aligned", () => {
  assert.equal(STOCK_QUERY_CACHE_MAX_AGE_MS, 3 * 24 * 60 * 60 * 1000);
  assert.equal(STOCK_QUERY_PERSIST_KEY, "stock-query-cache-v2");
  assert.equal(STOCK_QUERY_PERSIST_THROTTLE_MS, 1_000);

  const queryClient = createStockQueryClient();
  const defaults = queryClient.getDefaultOptions().queries;
  assert.equal(defaults?.gcTime, STOCK_QUERY_CACHE_MAX_AGE_MS);
  assert.equal(defaults?.staleTime, 0);
  assert.equal(defaults?.refetchOnWindowFocus, false);
});

test("stock query retry avoids non-retryable stock API states", () => {
  assert.equal(stockQueryRetry(0, { status: 202, error: "snapshot_pending" }), false);
  assert.equal(stockQueryRetry(0, { status: 200, state: "partial" }), false);
  assert.equal(stockQueryRetry(0, { status: 400, code: "technical_unsupported_product" }), false);
  assert.equal(stockQueryRetry(0, { status: 429, error: "refresh_cooldown" }), false);
  assert.equal(stockQueryRetry(0, { status: 400, error: "invalid_ticker" }), false);
});

test("stock query retry keeps transient server and network failures retryable", () => {
  assert.equal(stockQueryRetry(0, { status: 502, error: "collector_unreachable" }), true);
  assert.equal(stockQueryRetry(1, { status: 500 }), true);
  assert.equal(stockQueryRetry(2, { status: 500 }), false);
  assert.equal(stockQueryRetry(0, new TypeError("network failed")), true);
});
