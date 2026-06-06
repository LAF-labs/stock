import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_COMPARE,
  bestBy,
  normalizeTicker,
  normalizedPoints,
  parseTickers,
  pendingMessage,
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

test("compare helpers build stable compare item fields", () => {
  const data = {
    ok: true,
    symbol: "MRVL",
    score: 74.2,
    quality_score: 82.4,
    opportunity_score: 91.5,
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
  assert.equal(item.strongest?.key, "profitability");
  assert.equal(item.weakest?.key, "valuation");
});

test("compare helpers choose best values and normalize chart series", () => {
  const first = { ticker: "A", score: 70, data: { chart_series: [{ date: "d1", close: 100 }, { date: "d2", close: 125 }] } } as any;
  const second = { ticker: "B", score: 90, data: { chart_series: [{ date: "d1", close: 200 }, { date: "d2", close: 180 }] } } as any;

  assert.equal(bestBy([first, second], (item) => item.score)?.ticker, "B");
  assert.equal(bestBy([first, second], (item) => item.score, "low")?.ticker, "A");
  assert.deepEqual(normalizedPoints(first), [
    { date: "d1", value: 100 },
    { date: "d2", value: 125 },
  ]);
});

test("compare pending message includes retry hint when available", () => {
  assert.match(pendingMessage({ retry_after_seconds: 300 } as any), /300초/);
  assert.doesNotMatch(pendingMessage(undefined), /초 안에/);
});
