import test from "node:test";
import assert from "node:assert/strict";

import { stockQueryKeys } from "../src/lib/stockQueryKeys";

test("stock query keys keep score views separate", () => {
  assert.deepEqual(stockQueryKeys.all, ["stock"]);
  assert.deepEqual(stockQueryKeys.score("KR:004020", "detail"), ["stock", "score", "detail", "KR:004020"]);
  assert.deepEqual(stockQueryKeys.score("KR:004020", "technical"), ["stock", "score", "technical", "KR:004020"]);
});

test("symbol query keys trim queries without changing user intent", () => {
  assert.deepEqual(stockQueryKeys.symbols("  현대  "), ["stock", "symbols", "all", "현대"]);
  assert.deepEqual(stockQueryKeys.symbols("ko", "US"), ["stock", "symbols", "US", "ko"]);
});

test("judgment query keys include score version and input hash", () => {
  assert.deepEqual(stockQueryKeys.judgment("US:KO", "score-v1", "abc123"), ["stock", "judgment", "US:KO", "score-v1", "stock-rule-judge-v4", "abc123"]);
});
