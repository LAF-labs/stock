import test from "node:test";
import assert from "node:assert/strict";

import {
  dailyChangeText,
  displayTickerInput,
  formatRecordValue,
  scoreDataWithQuote,
  snapshotPendingFromPayload,
  visibleRecordEntries,
} from "../src/components/stockDashboardHelpers";
import type { StockQuoteResponse, StockScoreResponse } from "../src/lib/types";

test("dashboard pending payload maps queue state into user-facing retry guidance", () => {
  const pending = snapshotPendingFromPayload(
    {
      error: "snapshot_pending",
      ticker: "US:NVDA",
      retry_after_seconds: 42,
      refresh_request: { queued: true },
    },
    "US:KO",
  );

  assert.deepEqual(pending, {
    message: "처음 조회하는 종목이라 데이터를 준비하고 있어요. 수집이 끝나면 점수와 현재가가 표시됩니다. 보통 42초 안에 다시 확인할 수 있어요.",
    ticker: "US:NVDA",
    queued: true,
    retryAfterSeconds: 42,
  });
});

test("dashboard pending payload ignores unrelated errors", () => {
  assert.equal(snapshotPendingFromPayload({ error: "provider_timeout" }, "US:KO"), undefined);
  assert.equal(snapshotPendingFromPayload({ error: "refresh_queue_unavailable" }, "US:KO"), undefined);
});

test("scoreDataWithQuote overlays fresh quote fields without losing score fields", () => {
  const score = {
    requested_ticker: "US:KO",
    currency: "USD",
    latest_price: 61.5,
    latest_bar_date: "2026-06-05",
    usd_krw_rate: 1350,
    quality_score: 77,
  } satisfies StockScoreResponse;
  const quote = {
    latest_price: 62.25,
    currency: "USD",
    latest_bar_date: "2026-06-06",
    usd_krw_rate: 1360,
  } satisfies StockQuoteResponse;

  assert.deepEqual(scoreDataWithQuote(score, quote), {
    ...score,
    latest_price: 62.25,
    latest_bar_date: "2026-06-06",
    usd_krw_rate: 1360,
  });
});

test("dailyChangeText prefers quote label, then quote value, then cached score value", () => {
  const score = { price_metrics: { latest_change: -0.0123 } } satisfies StockScoreResponse;

  assert.equal(dailyChangeText(score, { latest_change_label: "+1.4%" }), "+1.4%");
  assert.equal(dailyChangeText(score, { latest_change: 0.021 }), "+2.1%");
  assert.equal(dailyChangeText(score, undefined), "-1.2%");
});

test("dashboard record formatting hides provider-only fields and formats ratio fields", () => {
  assert.equal(formatRecordValue("return_1m", 0.123), "+12.3%");
  assert.equal(formatRecordValue("debtToEquity", 55.432), "55.4%");
  assert.deepEqual(visibleRecordEntries({ source: "provider", price: 123, market_scope: "US" }), [["price", 123]]);
});

test("displayTickerInput strips market prefixes only", () => {
  assert.equal(displayTickerInput("US:NVDA"), "NVDA");
  assert.equal(displayTickerInput("KR:005930"), "005930");
  assert.equal(displayTickerInput("NVDA"), "NVDA");
});
