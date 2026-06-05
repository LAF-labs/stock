import test from "node:test";
import assert from "node:assert/strict";

import { quoteOpenTtlSeconds, scoreOpenTtlSeconds } from "../src/lib/marketCalendar";
import { refreshCooldownSeconds } from "../src/lib/refreshCooldown";

const ENV_KEYS = [
  "STOCK_QUOTE_CACHE_OPEN_SECONDS",
  "STOCK_QUOTE_US_CACHE_OPEN_SECONDS",
  "STOCK_QUOTE_KR_CACHE_OPEN_SECONDS",
  "STOCK_SCORE_CACHE_FRESH_SECONDS",
  "STOCK_SCORE_DETAIL_CACHE_SECONDS",
  "STOCK_SCORE_COMPARE_CACHE_SECONDS",
  "STOCK_REFRESH_COOLDOWN_SECONDS",
] as const;

const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function clearPolicyEnv() {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
}

test.afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

test("default cache policy keeps quotes fresh for five minutes and scores for thirty minutes", () => {
  clearPolicyEnv();

  assert.equal(quoteOpenTtlSeconds("US"), 300);
  assert.equal(quoteOpenTtlSeconds("KR"), 300);
  assert.equal(scoreOpenTtlSeconds("detail"), 1800);
  assert.equal(scoreOpenTtlSeconds("compare"), 1800);
});

test("default manual refresh cooldown is five minutes", () => {
  clearPolicyEnv();

  assert.equal(refreshCooldownSeconds(), 300);
});
