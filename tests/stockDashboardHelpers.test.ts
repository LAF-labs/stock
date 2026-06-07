import test from "node:test";
import assert from "node:assert/strict";

import {
  chartSummary,
  dailyChangeText,
  dailyToneClass,
  directInputSymbolItem,
  displayTickerInput,
  formatRecordValue,
  opportunityExtremes,
  scoreDataWithQuote,
  scoreFreshnessSummary,
  scoreFreshnessTimeChip,
  snapshotPendingFromPayload,
  stockHeaderIdentity,
  stockJudgmentRequestPayload,
  stockMarketCapDisplay,
  usableChartPoints,
  visibleRecordEntries,
} from "../src/components/stockDashboardHelpers";
import { compactRuleJudgmentStock, tickerFromRuleJudgmentStock, validRuleJudgmentStock } from "../src/lib/ruleBasedJudgment";
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

test("stockJudgmentRequestPayload stays compact with one year of chart data", () => {
  const score = {
    requested_ticker: "KR:005930",
    market: "KR",
    symbol: "005930",
    name: "삼성전자",
    quality_score: 89.7,
    opportunity_score: 86.1,
    latest_bar_date: "2026-06-05",
    sia_snapshot: { raw_signal: "BUY", risk_level: "HIGH" },
    key_metrics: [
      { label: "PER", value: "50.12" },
      { label: "시가총액", value: "₩1923.43T" },
    ],
    valuation_rows: [{ label: "PBR", value: "5.14" }],
    stock_profile: [
      { label: "섹터", value: "Technology" },
      { label: "산업", value: "Semiconductors" },
    ],
    components: [
      {
        key: "growth",
        label: "성장 흐름",
        score: 100,
        metrics: [
          { label: "매출 성장률", value: "+69.2%" },
          { label: "이익 성장률", value: "+492.1%" },
          { label: "52주 수익률", value: "+456.7%" },
        ],
      },
    ],
    chart_series: Array.from({ length: 260 }, (_, index) => ({
      date: `2026-01-${String((index % 28) + 1).padStart(2, "0")}`,
      close: 100 + index,
      volume: 1_000_000 + index,
    })),
    financials: { oversized: "x".repeat(80_000) },
  } satisfies StockScoreResponse;

  const payload = stockJudgmentRequestPayload(score);
  const compactStock = compactRuleJudgmentStock(payload);

  assert.equal("chart_series" in payload, false);
  assert.equal("financials" in payload, false);
  assert.ok(JSON.stringify(payload).length < 8_192);
  assert.equal(tickerFromRuleJudgmentStock(compactStock), "005930");
  assert.equal(validRuleJudgmentStock(compactStock), true);
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

test("scoreFreshnessTimeChip keeps only the KST time for compact header display", () => {
  const score = {
    server_cache: {
      fetched_at: "2026-06-06T09:08:00.000Z",
    },
  } satisfies StockScoreResponse;

  assert.equal(scoreFreshnessTimeChip(score), "18:08 기준");
});

test("stockHeaderIdentity prioritizes Korean names and keeps domestic ETFs name-first", () => {
  assert.deepEqual(stockHeaderIdentity({ symbol: "005930", name: "삼성전자" }), {
    primary: "삼성전자",
    secondary: "005930",
    primaryKind: "name",
  });
  assert.deepEqual(stockHeaderIdentity({ market: "KR", symbol: "0194M0", name: "ACE 삼성전자단일종목레버리지" }), {
    primary: "ACE 삼성전자단일종목레버리지",
    secondary: "0194M0",
    primaryKind: "name",
  });
  assert.deepEqual(stockHeaderIdentity({ market: "US", symbol: "KORU", name: "한국 단일종목 레버리지 ETF" }), {
    primary: "KORU",
    secondary: "한국 단일종목 레버리지 ETF",
    primaryKind: "ticker",
  });
  assert.deepEqual(stockHeaderIdentity({ symbol: "KO", name: "Coca-Cola Co" }), {
    primary: "KO",
    secondary: "Coca-Cola Co",
    primaryKind: "ticker",
  });
});

test("opportunityExtremes returns the highest and lowest scored opportunity labels", () => {
  assert.deepEqual(
    opportunityExtremes([
      { label: "성장", score: 72 },
      { label: "유동성", score: 91 },
      { label: "목표가", score: 44 },
    ]),
    {
      best: { label: "유동성", score: 91 },
      worst: { label: "목표가", score: 44 },
    },
  );
});

test("stockMarketCapDisplay formats domestic caps in Korean won units", () => {
  assert.deepEqual(
    stockMarketCapDisplay({
      market: "KR",
      currency: "KRW",
      key_metrics: [{ label: "시가총액", value: 1_923_430_000_000_000 }],
    }),
    { primary: "1923조 4300억원" },
  );
});

test("stockMarketCapDisplay formats US caps in KRW with compact dollar context", () => {
  assert.deepEqual(
    stockMarketCapDisplay({
      market: "US",
      currency: "USD",
      usd_krw_rate: 1370,
      key_metrics: [{ label: "시가총액", value: 3_242_000_000_000 }],
    }),
    { primary: "4441조 5400억원", secondary: "($3.2T)" },
  );
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
