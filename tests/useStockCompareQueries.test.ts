import test from "node:test";
import assert from "node:assert/strict";

import { compareDateAlignedSeries } from "../src/components/stockCompareHelpers";
import {
  compareItemsFromStates,
  compareStockDataWithDisplayFallback,
  shouldPromotePartialCompareData,
  shouldShowCompareChartSkeleton,
  shouldShowCompareOverviewSkeleton,
  type CompareLoadState,
} from "../src/components/useStockCompareQueries";
import type { StockScoreResponse } from "../src/lib/types";

test("compare query promotes priced fast-path partials into provisional compare items", () => {
  const pricedPartial = {
    status: "partial",
    ticker: "KR:064350",
    data: {
      ok: true,
      requested_ticker: "KR:064350",
      symbol: "064350",
      market: "KR",
      name: "현대로템",
      quality_score: 56.4,
      opportunity_score: 61.2,
      latest_price: 187400,
      data_quality: "quote_fast_path",
      fetch: { quote_only_fast_path: true, pending_enrichment: true },
      components: [{ key: "momentum", label: "모멘텀", score: 72, metrics: [{ label: "1개월", value: "+3.8%" }] }],
      price_metrics: { latest_change: 0.018 },
    } as unknown as StockScoreResponse,
    message: "선택한 종목을 같은 기준으로 비교합니다.",
  } satisfies Extract<CompareLoadState, { status: "partial" }>;
  const identityOnlyPartial = {
    status: "partial",
    ticker: "US:ZVRA",
    data: {
      ok: true,
      requested_ticker: "US:ZVRA",
      symbol: "ZVRA",
      market: "US",
      name: "지브러 테라퓨틱스",
      data_quality: "identity_fast_path",
      fetch: { identity_only_fast_path: true, pending_enrichment: true },
    } as unknown as StockScoreResponse,
    message: "선택한 종목을 같은 기준으로 비교합니다.",
  } satisfies Extract<CompareLoadState, { status: "partial" }>;

  assert.equal(shouldPromotePartialCompareData(pricedPartial.data), true);
  assert.equal(shouldPromotePartialCompareData(identityOnlyPartial.data), false);

  const items = compareItemsFromStates([pricedPartial, identityOnlyPartial]);
  assert.equal(items.length, 1);
  assert.equal(items[0]?.ticker, "064350");
  assert.equal(items[0]?.provisional, true);
  assert.equal(items[0]?.score, 56.4);
});

test("compare overview skeleton hides once priced partial cards are available", () => {
  const pricedWithoutScore = {
    status: "partial",
    ticker: "US:GTLS",
    data: {
      requested_ticker: "US:GTLS",
      symbol: "GTLS",
      market: "US",
      name: "Chart Industries",
      latest_price: 206.49,
      latest_price_label: "$206.49",
    } as unknown as StockScoreResponse,
    message: "선택한 종목을 같은 기준으로 비교합니다.",
  } satisfies Extract<CompareLoadState, { status: "partial" }>;
  const identityOnly = {
    status: "partial",
    ticker: "US:ZVRA",
    data: {
      requested_ticker: "US:ZVRA",
      symbol: "ZVRA",
      market: "US",
      name: "Zevra Therapeutics",
      data_quality: "identity_fast_path",
    } as unknown as StockScoreResponse,
    message: "선택한 종목을 같은 기준으로 비교합니다.",
  } satisfies Extract<CompareLoadState, { status: "partial" }>;

  assert.equal(compareItemsFromStates([pricedWithoutScore]).length, 0);
  assert.equal(shouldShowCompareOverviewSkeleton([pricedWithoutScore], []), false);
  assert.equal(shouldShowCompareOverviewSkeleton([identityOnly], []), true);
  assert.equal(shouldShowCompareOverviewSkeleton([{ status: "pending", ticker: "US:GTLS", message: "확인 중" }], []), true);
});

test("compare chart skeleton shows only while comparable chart data is still pending", () => {
  const first = {
    status: "partial",
    ticker: "US:FRSH",
    data: {
      requested_ticker: "US:FRSH",
      symbol: "FRSH",
      market: "US",
      name: "Freshworks",
      latest_price: 9.22,
      quality_score: 50,
      components: [{ key: "momentum", label: "모멘텀", score: 50, metrics: [{ label: "1개월", value: "+2.1%" }] }],
    } as unknown as StockScoreResponse,
    message: "차트 확인 중",
  } satisfies Extract<CompareLoadState, { status: "partial" }>;
  const second = {
    status: "partial",
    ticker: "US:BOX",
    data: {
      requested_ticker: "US:BOX",
      symbol: "BOX",
      market: "US",
      name: "Box",
      latest_price: 25.49,
      quality_score: 48,
      components: [{ key: "momentum", label: "모멘텀", score: 48, metrics: [{ label: "1개월", value: "-1.3%" }] }],
    } as unknown as StockScoreResponse,
    message: "차트 확인 중",
  } satisfies Extract<CompareLoadState, { status: "partial" }>;
  const items = compareItemsFromStates([first, second]);

  assert.equal(items.length, 2);
  assert.equal(shouldShowCompareChartSkeleton([first, second], items, false), true);
  assert.equal(shouldShowCompareChartSkeleton([first, second], items, true), false);
  assert.equal(shouldShowCompareChartSkeleton([{ status: "success", ticker: "US:FRSH", data: first.data }, { status: "success", ticker: "US:BOX", data: second.data }], items, false), false);
});

test("compare chart skeleton stops for newly listed one-bar chart partials", () => {
  const first = {
    status: "partial",
    ticker: "US:SPCX",
    data: {
      requested_ticker: "US:SPCX",
      symbol: "SPCX",
      market: "US",
      name: "SpaceX",
      latest_price: 135,
      quality_score: 50,
      chart_series: [{ date: "2026-06-11", close: 135, volume: 0 }],
    } as unknown as StockScoreResponse,
    message: "상장 초기 데이터 부족",
  } satisfies Extract<CompareLoadState, { status: "partial" }>;
  const second = {
    status: "partial",
    ticker: "US:IPO2",
    data: {
      requested_ticker: "US:IPO2",
      symbol: "IPO2",
      market: "US",
      name: "Recent IPO",
      latest_price: 42,
      quality_score: 48,
      chart_series: [{ date: "2026-06-11", close: 42, volume: 0 }],
    } as unknown as StockScoreResponse,
    message: "상장 초기 데이터 부족",
  } satisfies Extract<CompareLoadState, { status: "partial" }>;
  const items = compareItemsFromStates([first, second]);

  assert.equal(items.length, 0);
  assert.equal(shouldShowCompareChartSkeleton([first, second], items, false), false);
});

test("compare data merges display chart and metrics into lean ready score results", () => {
  const leanReadyScore = {
    ok: true,
    requested_ticker: "US:LANE",
    symbol: "LANE",
    market: "US",
    name: "Lane Test",
    quality_score: 62.5,
    opportunity_score: 58.1,
    components: [{ key: "growth", label: "성장성", score: 70 }],
  } as unknown as StockScoreResponse;
  const displayFallback = {
    requested_ticker: "US:LANE",
    symbol: "LANE",
    market: "US",
    name: "Lane Test",
    latest_price: 11,
    market_cap: 5_000_000_000,
    market_cap_label: "$5B",
    chart_series: [
      { date: "2026-06-09", close: 10 },
      { date: "2026-06-10", close: 11 },
    ],
    price_metrics: { latest_change: 0.03, return_1m: 0.12 },
    financials: { profitMargins: 0.18, revenueGrowth: 0.24 },
    valuation_rows: [{ label: "Forward PER", value: 21.4 }],
  } as unknown as StockScoreResponse;

  const merged = compareStockDataWithDisplayFallback(leanReadyScore, displayFallback);
  const items = compareItemsFromStates([{ status: "success", ticker: "US:LANE", data: merged }]);

  assert.equal(items.length, 1);
  assert.equal(items[0]?.score, 62.5);
  assert.equal(items[0]?.daily, 0.03);
  assert.equal(items[0]?.return1m, 0.12);
  assert.equal(items[0]?.netMargin, 0.18);
  assert.equal(items[0]?.revenueGrowth, 0.24);
  assert.equal(items[0]?.forwardPer, 21.4);
  assert.equal(compareDateAlignedSeries(items).series[0]?.points.length, 2);
});
