import test from "node:test";
import assert from "node:assert/strict";

import { stockCachePolicyFor, stockCachePolicyFreshSeconds, stockCachePolicyStaleSeconds } from "../src/lib/stockCachePolicy";

test("stock cache policy exposes long-lived identity and chart windows", () => {
  assert.ok(stockCachePolicyFreshSeconds("identity") >= 30 * 24 * 60 * 60);
  assert.equal(stockCachePolicyFreshSeconds("quote"), 300);
  assert.ok(stockCachePolicyStaleSeconds("chart") >= 30 * 24 * 60 * 60);
});

test("stock cache policy keeps statement fundamentals longer than market ratios", () => {
  assert.ok(stockCachePolicyStaleSeconds("fundamentals_statement") > stockCachePolicyStaleSeconds("fundamentals_market_ratio"));
});

test("stock cache policy rejects unknown keys with a clear message", () => {
  assert.throws(
    () => stockCachePolicyFor("unknown_policy" as never),
    /Unknown stock cache policy: unknown_policy/
  );
});
