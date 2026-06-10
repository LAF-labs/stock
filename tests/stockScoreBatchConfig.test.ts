import test from "node:test";
import assert from "node:assert/strict";

import { STOCK_SCORE_BATCH_MAX_TICKERS, stockScoreBatchConcurrency } from "../src/lib/stockScoreBatchConfig";

test("stock score batch concurrency defaults to the visible compare limit", () => {
  assert.equal(STOCK_SCORE_BATCH_MAX_TICKERS, 5);
  assert.equal(stockScoreBatchConcurrency({}), 5);
  assert.equal(stockScoreBatchConcurrency({ STOCK_SCORE_BATCH_CONCURRENCY: "99" }), 5);
  assert.equal(stockScoreBatchConcurrency({ STOCK_SCORE_BATCH_CONCURRENCY: "3" }), 3);
  assert.equal(stockScoreBatchConcurrency({ STOCK_SCORE_BATCH_CONCURRENCY: "0" }), 5);
  assert.equal(stockScoreBatchConcurrency({ STOCK_SCORE_BATCH_CONCURRENCY: "nope" }), 5);
});
