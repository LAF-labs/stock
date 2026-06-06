import test from "node:test";
import assert from "node:assert/strict";

import {
  chartSummary,
  dailyChangeText,
  dailyToneClass,
  directInputSymbolItem,
  displayTickerInput,
  formatRecordValue,
  scoreDataWithQuote,
  scoreFreshnessSummary,
  snapshotPendingFromPayload,
  usableChartPoints,
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

test("scoreFreshnessSummary separates score snapshot freshness from quote freshness", () => {
  const staleScore = {
    requested_ticker: "US:KO",
    server_cache: {
      state: "stale",
      source: "supabase",
      fetched_at: "2026-06-05T00:00:00.000Z",
      refresh_started: true,
    },
  } satisfies StockScoreResponse;

  assert.deepEqual(scoreFreshnessSummary(staleScore), {
    label: "점수 기준",
    value: "오래된 스냅샷",
    detail: "Supabase · 2026-06-05 09:00 KST 기준 · 새 점수 준비 중",
    tone: "stale",
  });
});

test("scoreFreshnessSummary accepts Rust cache millisecond timestamps", () => {
  const freshScore = {
    requested_ticker: "KR:005930",
    server_cache: {
      state: "fresh",
      source: "market-data",
      fetched_at_ms: 1780617600000,
    },
  } satisfies StockScoreResponse;

  assert.deepEqual(scoreFreshnessSummary(freshScore), {
    label: "점수 기준",
    value: "최신 스냅샷",
    detail: "Rust market-data · 2026-06-05 09:00 KST 기준",
    tone: "fresh",
  });
});

test("dailyChangeText prefers quote label, then quote value, then cached score value", () => {
  const score = { price_metrics: { latest_change: -0.0123 } } satisfies StockScoreResponse;

  assert.equal(dailyChangeText(score, { latest_change_label: "+1.4%" }), "+1.4%");
  assert.equal(dailyChangeText(score, { latest_change: 0.021 }), "+2.1%");
  assert.equal(dailyChangeText(score, undefined), "-1.2%");
});

test("dailyToneClass separates neutral missing and flat price states", () => {
  assert.equal(dailyToneClass("-"), "price-neutral");
  assert.equal(dailyToneClass("0.0%"), "price-neutral");
  assert.equal(dailyToneClass("+1.4%"), "price-up");
  assert.equal(dailyToneClass("-1.2%"), "price-down");
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

test("directInputSymbolItem only creates direct ticker entries for ticker-like input", () => {
  assert.equal(directInputSymbolItem("삼성전자"), undefined);
  assert.equal(directInputSymbolItem("###"), undefined);
  assert.deepEqual(directInputSymbolItem("005930"), {
    key: "005930",
    market: "KR",
    ticker: "005930",
    displayName: "005930",
    subtitle: "005930",
    exchange: "",
    exchangeName: "직접 입력",
    koreanName: "",
    englishName: "005930",
    instrumentType: "STOCK",
  });
  assert.deepEqual(directInputSymbolItem("brk.b"), {
    key: "BRK.B",
    market: "US",
    ticker: "BRK.B",
    displayName: "BRK.B",
    subtitle: "BRK.B",
    exchange: "",
    exchangeName: "직접 입력",
    koreanName: "",
    englishName: "BRK.B",
    instrumentType: "STOCK",
  });
});

test("usableChartPoints sorts valid daily points and keeps the latest duplicate date", () => {
  assert.deepEqual(
    usableChartPoints([
      { date: "2026-06-02", close: 102, close_label: "$102.00" },
      { date: "bad-date", close: 101 },
      { date: "2026-06-01T09:30:00Z", close: 100 },
      { date: "2026-06-02", close: 103, close_label: "$103.00" },
      { date: "2026-06-03", close: Number.NaN },
    ]),
    [
      { date: "2026-06-01", close: 100 },
      { date: "2026-06-02", close: 103, close_label: "$103.00" },
    ],
  );
});

test("chartSummary describes accessible chart range and move", () => {
  assert.equal(chartSummary([]), "가격 차트 데이터가 충분하지 않아요.");
  assert.equal(
    chartSummary([
      { date: "2026-06-01", close: 100 },
      { date: "2026-06-02", close: 112 },
      { date: "2026-06-03", close: 108 },
    ]),
    "2026-06-01부터 2026-06-03까지 3개 가격 지점입니다. 시작 100, 마지막 108, 기간 변화 +8.0%, 최고 112, 최저 100.",
  );
});
