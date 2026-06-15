import test from "node:test";
import assert from "node:assert/strict";

import {
  detailHrefForMarketCapRow,
  filterMarketCapSnapshotRows,
  formatMarketCapAmount,
  marketCapDashboardHref,
  marketCapScopeFromParam,
} from "../src/components/marketCapDashboardHelpers";
import type { MarketCapDashboardSnapshot } from "../src/lib/marketCapRankingTypes";

test("marketCapScopeFromParam accepts only supported dashboard tabs", () => {
  assert.equal(marketCapScopeFromParam("domestic"), "domestic");
  assert.equal(marketCapScopeFromParam("overseas"), "overseas");
  assert.equal(marketCapScopeFromParam("bad"), "all");
  assert.equal(marketCapScopeFromParam(null), "all");
});

test("marketCapDashboardHref preserves one optional sector filter", () => {
  assert.equal(marketCapDashboardHref({ scope: "domestic", sector: "Technology" }), "/market-cap?scope=domestic&sector=Technology");
  assert.equal(marketCapDashboardHref({ scope: "all", sector: "" }), "/market-cap");
});

test("detailHrefForMarketCapRow links rows to stock detail pages", () => {
  assert.equal(detailHrefForMarketCapRow({ ticker: "KR:005930" }), "/?ticker=KR%3A005930");
});

test("formatMarketCapAmount uses native large-number labels", () => {
  assert.equal(formatMarketCapAmount(450_000_000_000_000, "KRW"), "450조원");
  assert.equal(formatMarketCapAmount(4_750_000_000_000, "USD"), "$4.8T");
});

test("filterMarketCapSnapshotRows filters sectors and re-ranks locally", () => {
  const snapshot: MarketCapDashboardSnapshot = {
    scope: "all",
    rows: [
      marketCapRow(1, "US:NVDA", "Technology"),
      marketCapRow(2, "US:LLY", "Healthcare"),
      marketCapRow(3, "US:AAPL", "Technology"),
    ],
    sectors: ["Healthcare", "Technology"],
    fetchedAt: "2026-06-12T11:00:00.000Z",
    updatedAt: "2026-06-12T11:00:00.000Z",
    expiresAt: "2026-06-12T12:00:00.000Z",
    source: "mixed",
  };

  assert.deepEqual(filterMarketCapSnapshotRows(snapshot, "Technology").rows.map((row) => [row.rank, row.ticker]), [
    [1, "US:NVDA"],
    [2, "US:AAPL"],
  ]);
});

function marketCapRow(rank: number, ticker: string, sector: string) {
  const symbol = ticker.split(":")[1];
  return {
    rank,
    ticker,
    market: "US" as const,
    symbol,
    name: symbol,
    price: 100,
    priceChange: 1,
    priceChangePercent: 0.01,
    marketCap: 1_000_000_000,
    marketCapCurrency: "USD" as const,
    marketCapUsd: 1_000_000_000,
    sector,
    fetchedAt: "2026-06-12T11:00:00.000Z",
    source: "nasdaq-fallback" as const,
  };
}
