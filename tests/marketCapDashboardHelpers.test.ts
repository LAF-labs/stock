import test from "node:test";
import assert from "node:assert/strict";

import {
  detailHrefForMarketCapRow,
  formatMarketCapAmount,
  marketCapDashboardHref,
  marketCapScopeFromParam,
} from "../src/components/marketCapDashboardHelpers";

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
