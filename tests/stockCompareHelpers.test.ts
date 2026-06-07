import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_COMPARE,
  bestBy,
  comparePriceTone,
  normalizeTicker,
  normalizedPoints,
  parseTickers,
  pendingMessage,
  removeCompareTicker,
  semanticMetricRows,
  toCompareItem,
} from "../src/components/stockCompareHelpers";
import type { StockScoreResponse } from "../src/lib/types";

test("compare helpers normalize and cap ticker lists", () => {
  assert.equal(normalizeTicker("005930"), "KR:005930");
  assert.equal(normalizeTicker("kr:q123456"), "KR:Q123456");
  assert.equal(normalizeTicker("! nvda "), "US:NVDA");
  assert.equal(normalizeTicker("US:BRK.B"), "US:BRK.B");
  assert.deepEqual(parseTickers("KO, US:KO,005930,TSLA,NVDA,AAPL,MSFT"), ["US:KO", "KR:005930", "US:TSLA", "US:NVDA", "US:AAPL"]);
  assert.equal(parseTickers("KO,TSLA,NVDA,AAPL,MSFT,GOOGL").length, MAX_COMPARE);
});

test("compare helpers never remove the base ticker", () => {
  const tickers = ["US:KO", "US:PEP", "US:MNST"];

  assert.deepEqual(removeCompareTicker(tickers, "US:KO"), tickers);
  assert.deepEqual(removeCompareTicker(tickers, "US:PEP"), ["US:KO", "US:MNST"]);
});

test("compare helpers build stable compare item fields", () => {
  const data = {
    ok: true,
    symbol: "MRVL",
    score: 74.2,
    quality_score: 82.4,
    opportunity_score: 91.5,
    market: "US",
    usd_krw_rate: 1400,
    name: "Marvell Technology",
    components: [
      { key: "profitability", label: "수익성", score: 88 },
      { key: "valuation", label: "가격 부담", score: 42 },
    ],
    key_metrics: [{ label: "시가총액", value: 65000000000 }],
    valuation_rows: [
      { label: "PER", value: "1,234.5" },
      { label: "Forward PER", value: 31.2 },
    ],
    price_metrics: { latest_change: 0.012, return_52w: 0.42 },
    financials: { profitMargins: 0.22, revenueGrowth: 0.18 },
  } as unknown as StockScoreResponse;

  const item = toCompareItem(data, "US:MRVL");

  assert.equal(item.ticker, "MRVL");
  assert.equal(item.score, 82.4);
  assert.equal(item.opportunityScore, 91.5);
  assert.equal(item.per, 1234.5);
  assert.equal(item.forwardPer, 31.2);
  assert.equal(item.marketCap, "91조원 ($65B)");
  assert.equal(item.strongest?.key, "profitability");
  assert.equal(item.weakest?.key, "valuation");
});

test("compare helpers choose best values and normalize chart series", () => {
  const first = { ticker: "A", score: 70, data: { chart_series: [{ date: "2026-06-02", close: 125 }, { date: "bad", close: 900 }, { date: "2026-06-01", close: 100 }] } } as any;
  const second = { ticker: "B", score: 90, data: { chart_series: [{ date: "2026-06-01", close: 200 }, { date: "2026-06-02", close: 180 }] } } as any;

  assert.equal(bestBy([first, second], (item) => item.score)?.ticker, "B");
  assert.equal(bestBy([first, second], (item) => item.score, "low")?.ticker, "A");
  assert.deepEqual(normalizedPoints(first), [
    { date: "2026-06-01", value: 100 },
    { date: "2026-06-02", value: 125 },
  ]);
});

test("compare bestBy evaluates each item once", () => {
  let calls = 0;
  const items = [
    { ticker: "A", score: 70 },
    { ticker: "B", score: 90 },
    { ticker: "C", score: undefined },
  ] as any;

  const best = bestBy(items, (item) => {
    calls += 1;
    return item.score;
  });

  assert.equal(best?.ticker, "B");
  assert.equal(calls, items.length);
});

test("compare pending message includes retry hint when available", () => {
  assert.match(pendingMessage({ retry_after_seconds: 300 } as any), /300초/);
  assert.doesNotMatch(pendingMessage(undefined), /초 안에/);
});

test("compare price tone keeps missing and flat moves neutral", () => {
  assert.equal(comparePriceTone(undefined), "price-neutral");
  assert.equal(comparePriceTone(0), "price-neutral");
  assert.equal(comparePriceTone(0.012), "price-up");
  assert.equal(comparePriceTone(-0.012), "price-down");
});

test("semanticMetricRows maps compare items into accessible table rows", () => {
  const items = [
    { ticker: "KO", daily: 0.01, score: 70, data: {} },
    { ticker: "PEP", daily: -0.02, score: 80, data: {} },
  ] as any;

  assert.deepEqual(semanticMetricRows<any>(items, [{ label: "전일 대비", value: (item) => item.daily, display: (value) => `${value ?? "-"}` }]), [
    { label: "전일 대비", values: [{ ticker: "KO", value: "0.01" }, { ticker: "PEP", value: "-0.02" }] },
  ]);
});
