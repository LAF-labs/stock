import test from "node:test";
import assert from "node:assert/strict";

import {
  STOCK_QUERY_CACHE_MAX_AGE_MS,
  STOCK_QUERY_PERSIST_KEY,
  STOCK_QUERY_PERSIST_THROTTLE_MS,
  createStockQueryClient,
  shouldPersistStockQuery,
  stockQueryRetry,
} from "../src/components/QueryProvider";

test("stock query provider keeps persisted cache and gc windows aligned", () => {
  assert.equal(STOCK_QUERY_CACHE_MAX_AGE_MS, 3 * 24 * 60 * 60 * 1000);
  assert.equal(STOCK_QUERY_PERSIST_KEY, "stock-query-cache-v5");
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

test("stock query persistence stores only compact ready query results", () => {
  assert.equal(shouldPersistStockQuery(query(["stock", "quote", "KR:004020"], "success", { state: "ready" })), true);
  assert.equal(
    shouldPersistStockQuery(
      query(["stock", "display", "detail", "KR:004020"], "success", {
        state: "ready",
        data: {
          ok: true,
          ticker: "KR:004020",
          identity: { value: { ticker: "KR:004020", market: "KR", symbol: "004020", name: "현대제철" } },
          completion: { presentParts: ["identity"], recoveringParts: ["price", "chart", "score"] },
          refresh: { active: true, recoveringParts: ["price", "chart", "score"] },
        },
      }),
    ),
    true,
  );
  assert.equal(shouldPersistStockQuery(query(["stock", "score", "detail", "KR:004020"], "success", { state: "ready" })), true);
  assert.equal(shouldPersistStockQuery(query(["stock", "symbols", "all", "004020"], "success", { state: "ready" })), true);
  assert.equal(shouldPersistStockQuery(query(["stock", "judgment", "KR:004020", "v1", "hash"], "success", { state: "ready" })), true);

  assert.equal(shouldPersistStockQuery(query(["stock", "quote", "KR:004020"], "success", { state: "pending" })), false);
  assert.equal(shouldPersistStockQuery(query(["stock", "score", "detail", "KR:004020"], "success", { state: "partial" })), false);
  assert.equal(
    shouldPersistStockQuery(
      query(["stock", "score", "detail", "KR:064350"], "success", {
        state: "ready",
        data: {
          requested_ticker: "KR:064350",
          chart_series: [],
          fetch: { quote_only_fast_path: true, pending_enrichment: true },
        },
      }),
    ),
    false,
  );
  assert.equal(shouldPersistStockQuery(query(["stock", "score", "technical", "KR:004020"], "success", { state: "ready", data: { chart_series: [] } })), false);
  assert.equal(shouldPersistStockQuery(query(["stock", "compare", "KR:004020,US:KO"], "success", { state: "ready", results: [] })), false);
  assert.equal(shouldPersistStockQuery(query(["stock", "quote", "KR:004020"], "error", { state: "ready" })), false);
});

function query(queryKey: readonly unknown[], status: string, data: unknown) {
  return { queryKey, state: { status, data } };
}
