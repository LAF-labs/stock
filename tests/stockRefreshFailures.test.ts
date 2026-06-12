import test from "node:test";
import assert from "node:assert/strict";

import { terminalStockDisplayFailureParts } from "../src/lib/stockRefreshFailures";

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
