import test from "node:test";
import assert from "node:assert/strict";

import {
  chartSummary,
  chartPointPriceLabel,
  dashboardInputValue,
  dashboardTickerFromSearchParam,
  dailyChangeText,
  dailyToneClass,
  directInputSymbolItem,
  displayTickerInput,
  factorSummary,
  formatMetricDisplayValue,
  formatNote,
  formatPrimaryPrice,
  formatPriceWithContext,
  formatRecordValue,
  formatSecondaryPrice,
  opportunityExtremes,
  partialStockDataFromPayload,
  pendingRetryTargetForDashboard,
  scoreDataWithQuote,
  scoreFreshnessSummary,
  scoreFreshnessTimeChip,
  stockHeaderFreshnessTimeChip,
  shouldShowStockSkeleton,
  shouldPreservePendingViewDuringRetry,
  isPartialStockSnapshotPayload,
  shouldUseCompactMetricGrid,
  snapshotPendingFromPayload,
  stockHeaderIdentity,
  stockJudgmentRequestPayload,
  stockMarketCapDisplay,
  termTipFor,
  usableChartPoints,
  visibleLabeledItems,
  visibleRecordEntries,
} from "../src/components/stockDashboardHelpers";
import { compactRuleJudgmentStock, tickerFromRuleJudgmentStock, validRuleJudgmentStock } from "../src/lib/ruleBasedJudgment";
import type { StockQuoteResponse, StockScoreResponse } from "../src/lib/types";

test("dashboard starts without a default ticker when the URL has no ticker", () => {
  assert.equal(dashboardTickerFromSearchParam(null), undefined);
  assert.equal(dashboardTickerFromSearchParam(""), undefined);
  assert.equal(dashboardTickerFromSearchParam("   "), undefined);
  assert.equal(dashboardInputValue(undefined), "");
});

test("dashboard preserves explicit ticker params instead of normalizing to the old landing default", () => {
  assert.equal(dashboardTickerFromSearchParam("us:nvda"), "US:NVDA");
  assert.equal(dashboardTickerFromSearchParam("  kr:005930  "), "KR:005930");
  assert.equal(dashboardInputValue("US:NVDA"), "NVDA");
});

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
    message: "처음 조회하는 종목이라 데이터를 준비하고 있어요. 화면은 자동으로 다시 확인하고, 준비가 끝나면 점수와 현재가를 바로 표시합니다.",
    ticker: "US:NVDA",
    queued: true,
    retryAfterSeconds: 42,
  });
  assert.doesNotMatch(pending?.message || "", /\d+초/);
});

test("dashboard pending payload explains stale refresh work as an update", () => {
  const pending = snapshotPendingFromPayload(
    {
      error: "snapshot_pending",
      reason: "stale_refresh",
      ticker: "US:NVDA",
      retry_after_seconds: 60,
      refresh_request: { queued: true },
    },
    "US:KO",
  );

  assert.deepEqual(pending, {
    message: "기존 데이터를 보여주는 동안 최신 데이터를 다시 준비하고 있어요. 화면은 자동으로 다시 확인하고, 준비가 끝나면 최신 점수와 현재가를 바로 표시합니다.",
    ticker: "US:NVDA",
    queued: true,
    retryAfterSeconds: 60,
  });
  assert.doesNotMatch(pending?.message || "", /\d+초/);
});

test("dashboard pending payload ignores unrelated errors", () => {
  assert.equal(snapshotPendingFromPayload({ error: "provider_timeout" }, "US:KO"), undefined);
  assert.equal(snapshotPendingFromPayload({ error: "refresh_queue_unavailable" }, "US:KO"), undefined);
});

test("dashboard recognizes partial stock snapshots and keeps pending retry metadata", () => {
  const payload = {
    ok: true,
    type: "partial_stock_snapshot",
    requested_ticker: "US:POET",
    quote: {
      market: "US",
      symbol: "POET",
      name: "POET Technologies Inc.",
      latest_price: 4.12,
      currency: "USD",
      latest_bar_date: "2026-06-08",
    },
    chart_series: [
      { date: "2026-06-05", open: 4, high: 4.2, low: 3.9, close: 4.1 },
      { date: "2026-06-08", open: 4.1, high: 4.3, low: 4, close: 4.12 },
    ],
    pending_snapshot: {
      error: "snapshot_pending",
      reason: "cold_start",
      ticker: "US:POET",
      retry_after_seconds: 30,
      refresh_request: { queued: true },
    },
  };

  assert.equal(isPartialStockSnapshotPayload(payload), true);
  assert.deepEqual(snapshotPendingFromPayload(payload, "US:KO"), {
    message: "처음 조회하는 종목이라 데이터를 준비하고 있어요. 화면은 자동으로 다시 확인하고, 준비가 끝나면 점수와 현재가를 바로 표시합니다.",
    ticker: "US:POET",
    queued: true,
    retryAfterSeconds: 30,
  });

  const partial = partialStockDataFromPayload(payload, "US:KO");
  assert.equal(partial?.requested_ticker, "US:POET");
  assert.equal(partial?.symbol, "POET");
  assert.equal(partial?.latest_price, 4.12);
  assert.equal(partial?.chart_series?.length, 2);
});

test("dashboard uses full skeleton only when no useful partial data is present", () => {
  assert.equal(shouldShowStockSkeleton("loading"), true);
  assert.equal(shouldShowStockSkeleton("pending"), true);
  assert.equal(shouldShowStockSkeleton("pending", true), false);
  assert.equal(shouldShowStockSkeleton("success"), false);
  assert.equal(shouldShowStockSkeleton("error"), false);
});

test("dashboard coalesces score and quote pending into one retry target", () => {
  const scorePending = {
    message: "점수 준비 중",
    ticker: "US:CRWV",
    queued: true,
    retryAfterSeconds: 300,
  };
  const quotePending = {
    message: "현재가 준비 중",
    ticker: "US:CRWV",
    queued: true,
    retryAfterSeconds: 60,
  };

  assert.deepEqual(pendingRetryTargetForDashboard("US:CRWV", scorePending, quotePending), {
    pending: scorePending,
    retryKey: "stock:US:CRWV",
  });
  assert.deepEqual(pendingRetryTargetForDashboard("US:CRWV", undefined, quotePending), {
    pending: quotePending,
    retryKey: "stock:US:CRWV",
  });
  assert.equal(pendingRetryTargetForDashboard(undefined, scorePending, quotePending), undefined);
});

test("dashboard keeps pending UI stable during automatic retry refreshes", () => {
  assert.equal(shouldPreservePendingViewDuringRetry("pending", true), true);
  assert.equal(shouldPreservePendingViewDuringRetry("partial", true), true);
  assert.equal(shouldPreservePendingViewDuringRetry("loading", true), false);
  assert.equal(shouldPreservePendingViewDuringRetry("success", true), false);
  assert.equal(shouldPreservePendingViewDuringRetry("pending", false), false);
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

test("stockHeaderFreshnessTimeChip uses the newest score or quote update time", () => {
  const score = {
    server_cache: {
      fetched_at: "2026-06-06T09:08:00.000Z",
    },
  } satisfies StockScoreResponse;
  const olderQuote = {
    server_cache: {
      fetched_at: "2026-06-06T08:59:00.000Z",
    },
  } satisfies StockQuoteResponse;
  const refreshedQuote = {
    server_cache: {
      fetched_at: "2026-06-06T09:12:00.000Z",
    },
  } satisfies StockQuoteResponse;

  assert.equal(stockHeaderFreshnessTimeChip(score, olderQuote), "18:08 기준");
  assert.equal(stockHeaderFreshnessTimeChip(score, refreshedQuote), "18:12 기준");
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
  assert.deepEqual(stockHeaderIdentity({ market: "US", symbol: "KO", name: "COCA-COLA CO", display_name: "코카콜라", instrument_type: "STOCK" }), {
    primary: "코카콜라",
    secondary: "KO",
    primaryKind: "name",
  });
  assert.deepEqual(stockHeaderIdentity({ market: "US", requested_ticker: "US:KO", display_name: "코카콜라", instrument_type: "STOCK" }), {
    primary: "코카콜라",
    secondary: "KO",
    primaryKind: "name",
  });
  assert.deepEqual(stockHeaderIdentity({ market: "US", symbol: "TSLL", display_name: "TSLL", english_name: "테슬라 2배 ETF", instrument_type: "ETF" }), {
    primary: "TSLL",
    secondary: "테슬라 2배 ETF",
    primaryKind: "ticker",
  });
  assert.deepEqual(stockHeaderIdentity({ symbol: "KO", name: "Coca-Cola Co" }), {
    primary: "Coca-Cola Co",
    secondary: "KO",
    primaryKind: "name",
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

test("shouldUseCompactMetricGrid keeps only short numeric metric groups horizontal", () => {
  assert.equal(
    shouldUseCompactMetricGrid({
      key: "momentum",
      label: "모멘텀",
      metrics: [
        { label: "1개월 수익률", value: "+0.3%" },
        { label: "3개월 수익률", value: "+3.9%" },
        { label: "52주 고점 거리", value: "-3.9%" },
      ],
    }),
    true,
  );

  assert.equal(
    shouldUseCompactMetricGrid({
      key: "valuation",
      label: "밸류에이션",
      metrics: [
        { label: "Forward PER", value: "22.8x" },
        { label: "업종 기준 PER", value: "12.8x" },
        { label: "시가총액", value: "$264.2B" },
      ],
    }),
    false,
  );

  assert.equal(
    shouldUseCompactMetricGrid({
      key: "growth",
      label: "성장성",
      metrics: [
        { label: "매출 성장률", value: "+1.2%" },
        { label: "이익 성장률", value: "+2.4%" },
        { label: "52주 수익률", value: "+8.1%" },
        { label: "영업현금흐름", value: "$10.1B" },
      ],
    }),
    false,
  );
});

test("factorSummary avoids trading-status wording in quality reasons", () => {
  assert.equal(
    factorSummary({
      key: "health",
      label: "거래 안정성",
      summary: "거래 상태, 유동성, 규모, 부채와 현금흐름 체력을 봐요.",
    }),
    "거래량, 시가총액, 부채 부담, 현금흐름처럼 거래 체력을 봐요.",
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

test("dashboard price displays split trading currency and KRW conversion consistently", () => {
  const usScore = {
    market: "US",
    currency: "USD",
    latest_price: 79.48,
    latest_price_label: "$79.48 / 123,456원",
    usd_krw_rate: 1553.3,
  } satisfies StockScoreResponse;
  const krScore = {
    market: "KR",
    currency: "KRW",
    latest_price: 23500,
  } satisfies StockScoreResponse;

  assert.equal(formatPrimaryPrice(usScore), "$79.48");
  assert.equal(formatSecondaryPrice(usScore), "약 123,456원");
  assert.equal(formatPriceWithContext(usScore), "$79.48 (약 123,456원)");
  assert.equal(formatPrimaryPrice(krScore), "23,500원");
  assert.equal(formatSecondaryPrice(krScore), "국내 원화 기준");
  assert.equal(formatPriceWithContext(krScore), "23,500원");
});

test("dashboard metric display formats money labels with stock context", () => {
  const usScore = {
    market: "US",
    currency: "USD",
    latest_price: 79.48,
    usd_krw_rate: 1553.3,
    key_metrics: [{ label: "시가총액", value: "$341.96B (약 531.2조원)" }],
  } satisfies StockScoreResponse;
  const krScore = {
    market: "KR",
    currency: "KRW",
    latest_price: 23500,
    key_metrics: [{ label: "시가총액", value: "₩91.70B" }],
  } satisfies StockScoreResponse;

  assert.equal(formatMetricDisplayValue({ label: "현재가", value: "$79.48 (약 12.3만원)" }, usScore), "$79.48 (약 123,456원)");
  assert.equal(formatMetricDisplayValue({ label: "평균 목표가", value: "$86.06" }, usScore), "$86.06");
  assert.equal(formatMetricDisplayValue({ label: "시가총액", value: "$341.96B (약 531.2조원)" }, usScore), "531조 1665억원 ($342B)");
  assert.equal(formatMetricDisplayValue({ label: "현재가", value: "23,500원" }, krScore), "23,500원");
  assert.equal(formatMetricDisplayValue({ label: "시가총액", value: "₩91.70B" }, krScore), "917억원");
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
  assert.equal(formatRecordValue("targetMeanPrice", 86.06, { market: "US", currency: "USD" }), "$86.06");
  assert.equal(formatRecordValue("targetMeanPrice", 86.06), "86.06");
  assert.equal(formatRecordValue("totalRevenue", 49_284_001_792, { market: "US", currency: "USD", usd_krw_rate: 1370 }), "67조 5191억원 ($49.3B)");
  assert.equal(formatRecordValue("totalCash", 147_378_078_220_288, { market: "KR", currency: "KRW" }), "147조 3781억원");
  assert.deepEqual(visibleRecordEntries({ source: "provider", price: 123, market_scope: "US" }), [["price", 123]]);
});

test("dashboard list display removes internal source and company metadata fields", () => {
  assert.deepEqual(
    visibleLabeledItems([
      { label: "회사명", value: "삼성전자" },
      { label: "상품유형코드", value: "300" },
      { label: "통화", value: "KRW" },
      { label: "환율 기준", value: "$1 = 약 1,370원" },
      { label: "Forward PER", value: "13.40", note: "yfinance" },
      { label: "거래가능여부", value: "Y" },
      { label: "신뢰도", value: "80.0%" },
    ]),
    [
      { label: "회사명", value: "삼성전자" },
      { label: "Forward PER", value: "13.40", note: "yfinance" },
      { label: "근거 충분도", value: "80.0%" },
    ],
  );
});

test("dashboard hides provider-only notes and explains recommendation mean", () => {
  assert.equal(formatNote("yfinance"), undefined);
  assert.equal(formatNote("Yahoo Finance 기준"), undefined);
  assert.equal(termTipFor("투자의견 평균")?.body, "애널리스트 투자의견을 평균낸 값이에요. 1에 가까울수록 매수 쪽, 5에 가까울수록 매도 쪽이에요.");
  assert.equal(termTipFor("근거 충분도")?.body, "이 항목 점수에 쓸 데이터가 얼마나 충분했는지 보여줘요.");
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
  assert.deepEqual(directInputSymbolItem("0194M0"), {
    key: "0194M0",
    market: "KR",
    ticker: "0194M0",
    displayName: "0194M0",
    subtitle: "0194M0",
    exchange: "",
    exchangeName: "직접 입력",
    koreanName: "",
    englishName: "0194M0",
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

test("chart summary uses currency labels instead of bare numbers", () => {
  assert.equal(chartPointPriceLabel({ close: 70.5, currency: "USD", close_label: "$70.50 (약 96,585원)" }), "$70.50");
  assert.equal(chartPointPriceLabel({ close: 72000, currency: "KRW", close_label: "72,000원" }), "72,000원");
  assert.equal(
    chartSummary([
      { date: "2026-06-01", close: 70.5, currency: "USD", close_label: "$70.50" },
      { date: "2026-06-02", close: 79.48, currency: "USD", close_label: "$79.48" },
    ]),
    "2026-06-01부터 2026-06-02까지 2개 가격 지점입니다. 시작 $70.50, 마지막 $79.48, 기간 변화 +12.7%, 최고 $79.48, 최저 $70.50.",
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
