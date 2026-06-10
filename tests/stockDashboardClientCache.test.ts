import test from "node:test";
import assert from "node:assert/strict";

import { readDashboardClientCacheFromStorage, rememberDashboardClientCacheInStorage } from "../src/components/stockDashboardClientCache";
import { dashboardClientCacheKey } from "../src/components/stockDashboardHelpers";
import type { StockQuoteResponse, StockScoreResponse } from "../src/lib/types";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

test("dashboard client cache storage helpers restore same-ticker snapshots", () => {
  const storage = memoryStorage();
  const score: StockScoreResponse = {
    requested_ticker: "KR:004020",
    market: "KR",
    symbol: "004020",
    name: "현대제철",
    score: 43.8,
  };
  const quote: StockQuoteResponse = {
    type: "quote",
    requested_ticker: "KR:004020",
    market: "KR",
    symbol: "004020",
    name: "현대제철",
    latest_price: 28_550,
  };

  assert.equal(rememberDashboardClientCacheInStorage(storage, "KR:004020", score, quote), true);

  const cached = readDashboardClientCacheFromStorage(storage, "KR:004020");
  assert.equal(cached?.score?.name, "현대제철");
  assert.equal(cached?.quote?.latest_price, 28_550);
  assert.equal(cached?.score?.server_cache?.source, "client_cache");
});

test("dashboard client cache storage helpers fail closed on quota and malformed storage", () => {
  const storage = memoryStorage();
  const score: StockScoreResponse = {
    requested_ticker: "US:KO",
    market: "US",
    symbol: "KO",
    name: "Coca-Cola",
    score: 70,
    note: "x".repeat(200),
  };

  assert.equal(rememberDashboardClientCacheInStorage(storage, "US:KO", score, undefined, 80), false);
  assert.equal(storage.values.has(dashboardClientCacheKey("US:KO")), false);

  const throwingStorage = {
    getItem() {
      throw new Error("storage unavailable");
    },
    setItem() {
      throw new Error("quota exceeded");
    },
  };

  assert.equal(readDashboardClientCacheFromStorage(throwingStorage, "US:KO"), undefined);
  assert.equal(rememberDashboardClientCacheInStorage(throwingStorage, "US:KO", score, undefined), false);
});
