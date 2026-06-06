import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { quoteOpenTtlSeconds, scoreOpenTtlSeconds } from "../src/lib/marketCalendar";
import { QUOTE_CACHE_FRESH_SECONDS, QUOTE_CACHE_STALE_SECONDS } from "../src/lib/quoteContract";
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

  assert.equal(quoteOpenTtlSeconds("US"), QUOTE_CACHE_FRESH_SECONDS);
  assert.equal(quoteOpenTtlSeconds("KR"), QUOTE_CACHE_FRESH_SECONDS);
  assert.equal(scoreOpenTtlSeconds("detail"), 1800);
  assert.equal(scoreOpenTtlSeconds("compare"), 1800);
});

test("quote TTL defaults are consumed from the shared quote contract", () => {
  assert.equal(QUOTE_CACHE_FRESH_SECONDS, 300);
  assert.equal(QUOTE_CACHE_STALE_SECONDS, 86_400);

  const marketCalendarSource = readFileSync(join(process.cwd(), "src/lib/marketCalendar.ts"), "utf8");
  const quoteCacheSource = readFileSync(join(process.cwd(), "src/lib/stockQuoteCache.ts"), "utf8");
  const publisherSource = readFileSync(join(process.cwd(), "scripts/publish_stock_snapshots.ts"), "utf8");

  assert.match(marketCalendarSource, /numericEnv\("STOCK_QUOTE_CACHE_OPEN_SECONDS", QUOTE_CACHE_FRESH_SECONDS\)/);
  assert.match(quoteCacheSource, /numericEnv\("STOCK_QUOTE_CACHE_STALE_SECONDS", QUOTE_CACHE_STALE_SECONDS\)/);
  assert.match(publisherSource, /QUOTE_CACHE_FRESH_SECONDS \* 1000/);
  assert.match(publisherSource, /QUOTE_CACHE_STALE_SECONDS \* 1000/);
});

test("default manual refresh cooldown is five minutes", () => {
  clearPolicyEnv();

  assert.equal(refreshCooldownSeconds(), 300);
});
