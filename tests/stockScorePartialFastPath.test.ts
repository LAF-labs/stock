import test from "node:test";
import assert from "node:assert/strict";

import { partialStockScoreTimeoutMs, waitForPartialStockScore, type SettledStockScoreResult } from "../src/lib/stockScorePartialFastPath";

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

test("default partial score deadline leaves room for request fast paths inside the five second budget", () => {
  delete process.env.STOCK_PENDING_PARTIAL_SCORE_TIMEOUT_MS;
  delete process.env.STOCK_PENDING_PARTIAL_TECHNICAL_SCORE_TIMEOUT_MS;

  assert.equal(partialStockScoreTimeoutMs("detail"), 4_000);
  assert.equal(partialStockScoreTimeoutMs("compare"), 4_000);
  assert.equal(partialStockScoreTimeoutMs("technical"), 4_000);
});

test("partial score wait returns a fast path result instead of timing out too early", async () => {
  delete process.env.STOCK_PENDING_PARTIAL_SCORE_TIMEOUT_MS;
  delete process.env.STOCK_PENDING_PARTIAL_TECHNICAL_SCORE_TIMEOUT_MS;

  const settled = new Promise<SettledStockScoreResult>((resolve) => {
    setTimeout(
      () => resolve({
        status: "fulfilled",
        value: {
          payload: { ok: true },
          cache: { state: "miss", source: "market-data", ticker: "US:FAST", view: "detail" },
        },
      }),
      1_250
    );
  });

  const result = await waitForPartialStockScore(settled, { view: "detail" });

  assert.equal(result.status, "fulfilled");
});

test("partial score deadline remains configurable per deployment", () => {
  process.env.STOCK_PENDING_PARTIAL_SCORE_TIMEOUT_MS = "1200";
  process.env.STOCK_PENDING_PARTIAL_TECHNICAL_SCORE_TIMEOUT_MS = "1800";

  assert.equal(partialStockScoreTimeoutMs("detail"), 1200);
  assert.equal(partialStockScoreTimeoutMs("technical"), 1200);

  delete process.env.STOCK_PENDING_PARTIAL_SCORE_TIMEOUT_MS;
  assert.equal(partialStockScoreTimeoutMs("technical"), 1800);
});
