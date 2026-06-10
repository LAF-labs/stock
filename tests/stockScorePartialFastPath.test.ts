import test from "node:test";
import assert from "node:assert/strict";

import { partialStockScoreTimeoutMs } from "../src/lib/stockScorePartialFastPath";

const ORIGINAL_ENV = {
  STOCK_PENDING_PARTIAL_SCORE_TIMEOUT_MS: process.env.STOCK_PENDING_PARTIAL_SCORE_TIMEOUT_MS,
  STOCK_PENDING_PARTIAL_TECHNICAL_SCORE_TIMEOUT_MS: process.env.STOCK_PENDING_PARTIAL_TECHNICAL_SCORE_TIMEOUT_MS,
};

test.afterEach(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("default partial score deadline prioritizes first useful dashboard data", () => {
  delete process.env.STOCK_PENDING_PARTIAL_SCORE_TIMEOUT_MS;
  delete process.env.STOCK_PENDING_PARTIAL_TECHNICAL_SCORE_TIMEOUT_MS;

  assert.equal(partialStockScoreTimeoutMs("detail"), 1_200);
  assert.equal(partialStockScoreTimeoutMs("compare"), 1_200);
  assert.equal(partialStockScoreTimeoutMs("technical"), 1_200);
});

test("partial score deadline remains configurable per deployment", () => {
  process.env.STOCK_PENDING_PARTIAL_SCORE_TIMEOUT_MS = "1200";
  process.env.STOCK_PENDING_PARTIAL_TECHNICAL_SCORE_TIMEOUT_MS = "1800";

  assert.equal(partialStockScoreTimeoutMs("detail"), 1200);
  assert.equal(partialStockScoreTimeoutMs("technical"), 1200);

  delete process.env.STOCK_PENDING_PARTIAL_SCORE_TIMEOUT_MS;
  assert.equal(partialStockScoreTimeoutMs("technical"), 1800);
});
