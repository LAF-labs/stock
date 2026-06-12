import test from "node:test";
import assert from "node:assert/strict";

import {
  chartSummary,
  chartPointPriceLabel,
  chooseRicherStockData,
  componentHasDisplayableScore,
  componentScoreText,
  dashboardInputValue,
  dashboardStateFromDetailView,
  dashboardSearchInputValue,
  dashboardSearchSyncDecision,
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
  humanizeRecordKey,
  formatSecondaryPrice,
  hasDisplayableStockPartialData,
  opportunityExtremes,
  partialStockDataFromQuote,
  partialStockDataFromTicker,
  partialStockDataFromPayload,
  priceVolatilitySummaryItems,
  riskLevelLabel,
  scoreConfidenceChips,
  scoreDataWithQuote,
  scoreFreshnessSummary,
  scoreFreshnessTimeChip,
  signalLabel,
  stockHeaderFreshnessTimeChip,
  shouldShowStockSkeleton,
  isPartialStockSnapshotPayload,
  shouldUseCompactMetricGrid,
  snapshotPendingFromPayload,
  stockDataUsefulness,
  stockHeaderIdentity,
  strongestAndWeakest,
  stockJudgmentRequestPayload,
  stockMarketCapDisplay,
  stockRecoveringParts,
  termTipFor,
  usableChartPoints,
  visibleLabeledItems,
  visibleRecordEntries,
} from "../src/components/stockDashboardHelpers";
import { compactRuleJudgmentStock, tickerFromRuleJudgmentStock, validRuleJudgmentStock } from "../src/lib/ruleBasedJudgment";
import type { StockDetailViewResponse } from "../src/lib/stockDetailViewTypes";
import type { StockQuoteResponse, StockScoreResponse } from "../src/lib/types";

const implementationCacheSource = ["client", "cache"].join("_");

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

test("dashboard pending payload maps queue state into display-first guidance", () => {
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
    message: "가격과 점수가 확보되는 즉시 화면에 반영합니다.",
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
    message: "표시 중인 데이터에 최신 가격과 점수를 조용히 반영합니다.",
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
    message: "가격과 점수가 확보되는 즉시 화면에 반영합니다.",
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

test("dashboard keeps identity-only partial snapshots behind the skeleton", () => {
  const payload = {
    ok: true,
    type: "partial_stock_snapshot",
    ticker: "US:ZVRA",
    requested_ticker: "US:ZVRA",
    market: "US",
    symbol: "ZVRA",
    name: "지브러 테라퓨틱스",
    exchange: "나스닥",
    currency: "USD",
    pending_snapshot: {
      error: "snapshot_pending",
      reason: "snapshot_miss",
      ticker: "US:ZVRA",
      retry_after_seconds: 5,
      refresh_request: { queued: true },
    },
  };

  const partial = partialStockDataFromPayload(payload, "US:ZVRA");

  assert.equal(partial?.requested_ticker, "US:ZVRA");
  assert.equal(partial?.symbol, "ZVRA");
  assert.equal(partial?.name, "지브러 테라퓨틱스");
  assert.equal(hasDisplayableStockPartialData(partial), false);
  assert.equal(shouldShowStockSkeleton("partial", hasDisplayableStockPartialData(partial)), true);
});

test("dashboard search input prefers stock names from partial data", () => {
  const partial = partialStockDataFromPayload(
    {
      ok: true,
      type: "partial_stock_snapshot",
      ticker: "KR:004020",
      requested_ticker: "KR:004020",
      market: "KR",
      symbol: "004020",
      name: "현대제철",
      exchange: "KOSPI",
      currency: "KRW",
      pending_snapshot: {
        error: "snapshot_pending",
        reason: "snapshot_miss",
        ticker: "KR:004020",
        retry_after_seconds: 5,
        refresh_request: { queued: true },
      },
    },
    "KR:004020",
  );

  assert.ok(partial);
  assert.equal(dashboardSearchInputValue(partial, undefined, "KR:004020"), "현대제철");
  assert.equal(dashboardSearchInputValue(partialStockDataFromTicker("KR:004020"), undefined, "KR:004020"), "004020");
});

test("dashboard search sync leaves landing input alone while the user is editing", () => {
  assert.deepEqual(
    dashboardSearchSyncDecision({
      tickerParam: undefined,
      previousTickerParam: undefined,
      isSearchEditing: true,
    }),
    {
      action: "none",
      previousTickerParam: undefined,
    },
  );
});

test("dashboard search sync clears once when navigating from detail back to landing", () => {
  assert.deepEqual(
    dashboardSearchSyncDecision({
      tickerParam: undefined,
      previousTickerParam: "KR:004020",
      isSearchEditing: true,
    }),
    {
      action: "replace",
      value: "",
      isSearchEditing: false,
      previousTickerParam: undefined,
    },
  );
});

test("dashboard search input keeps Korean stock names from ready score or quote payloads", () => {
  const readyScore = {
    requested_ticker: "KR:004020",
    market: "KR",
    symbol: "004020",
    name: "현대제철",
  } satisfies StockScoreResponse;
  const quote = {
    type: "quote",
    requested_ticker: "KR:004020",
    market: "KR",
    symbol: "004020",
    name: "현대제철",
    currency: "KRW",
    latest_price: 28550,
  } satisfies StockQuoteResponse;

  assert.equal(dashboardSearchInputValue(readyScore, undefined, "KR:004020"), "현대제철");
  assert.equal(dashboardSearchInputValue(undefined, quote, "KR:004020"), "현대제철");
});

test("dashboard can render a useful partial view from quote before score is ready", () => {
  const quote: StockQuoteResponse = {
    type: "quote",
    requested_ticker: "US:CAVA",
    market: "US",
    symbol: "CAVA",
    name: "CAVA GROUP INC",
    exchange: "NYSE",
    currency: "USD",
    latest_price: 76.33,
    latest_price_label: "$76.33",
    latest_bar_date: "2026-06-09",
    usd_krw_rate: 1_520,
    market_cap: 16_600_000_000,
    market_cap_label: "$16.60B",
  };

  const partial = partialStockDataFromQuote(quote, "US:CAVA");

  assert.equal(partial?.requested_ticker, "US:CAVA");
  assert.equal(partial?.symbol, "CAVA");
  assert.equal(partial?.latest_price, 76.33);
  assert.equal(partial?.market_cap, 16_600_000_000);
  assert.equal(stockMarketCapDisplay(partial || {}).primary, "25조 2320억원");
  assert.equal(partial?.server_cache?.source, "quote_partial");
  assert.equal(hasDisplayableStockPartialData(partial), true);
  assert.equal(shouldShowStockSkeleton("partial", hasDisplayableStockPartialData(partial)), false);
});

test("dashboard keeps deadline identity placeholders behind the skeleton", () => {
  const partial = partialStockDataFromTicker("US:AFRM");

  assert.equal(partial.requested_ticker, "US:AFRM");
  assert.equal(partial.market, "US");
  assert.equal(partial.symbol, "AFRM");
  assert.equal(partial.currency, "USD");
  assert.equal(partial.server_cache?.source, "client_deadline");
  assert.equal(stockHeaderIdentity(partial).primary, "AFRM");
  assert.equal(hasDisplayableStockPartialData(partial), false);
  assert.equal(shouldShowStockSkeleton("partial", hasDisplayableStockPartialData(partial)), true);
});

test("dashboard does not replace the skeleton with profile-only partial data", () => {
  const partial = {
    requested_ticker: "KR:059090",
    market: "KR",
    symbol: "059090",
    name: "미코",
    exchange: "KOSDAQ",
    currency: "KRW",
    stock_profile: [{ label: "시장", value: "국내" }],
  } satisfies StockScoreResponse;

  assert.equal(hasDisplayableStockPartialData(partial), false);
  assert.equal(shouldShowStockSkeleton("partial", hasDisplayableStockPartialData(partial)), true);
});

test("dashboard uses full skeleton only when no useful partial data is present", () => {
  assert.equal(shouldShowStockSkeleton("loading"), true);
  assert.equal(shouldShowStockSkeleton("pending"), true);
  assert.equal(shouldShowStockSkeleton("pending", true), true);
  assert.equal(shouldShowStockSkeleton("partial", true), false);
  assert.equal(shouldShowStockSkeleton("success"), false);
  assert.equal(shouldShowStockSkeleton("error"), false);
});

test("dashboard keeps skeleton priority while non-displayable data is still loading", () => {
  assert.equal(shouldShowStockSkeleton("loading", false), true);
  assert.equal(shouldShowStockSkeleton("pending", false), true);
  assert.equal(shouldShowStockSkeleton("partial", false), true);
});

test("dashboard can leave full skeleton for identity-only detail view after first response", () => {
  const detailView = {
    ok: true,
    mode: "partial",
    ticker: "US:VLD",
    requestedTicker: "US:VLD",
    view: "detail",
    generatedAt: "2026-06-12T00:00:00.000Z",
    snapshotVersion: "display-v1",
    degradedReason: "identity_only",
    nextPollMs: 1500,
    identity: { ticker: "US:VLD", market: "US", symbol: "VLD", name: "Velo3D" },
    sections: {},
    parts: {
      price: { state: "refreshing" },
      chart: { state: "refreshing" },
      score: { state: "refreshing" },
      financials: { state: "missing" },
      analyst: { state: "missing" },
    },
    jobs: [],
  } satisfies StockDetailViewResponse;
  const state = dashboardStateFromDetailView(detailView);

  assert.equal(state?.status, "partial");
  assert.equal(state?.data?.symbol, "VLD");
  assert.equal(shouldShowStockSkeleton("partial", false, true), true);
});

test("dashboard promotes detail-view financial and analyst sections into visible stock data", () => {
  const detailView = {
    ok: true,
    mode: "partial",
    ticker: "US:KO",
    requestedTicker: "US:KO",
    view: "detail",
    generatedAt: "2026-06-12T00:00:00.000Z",
    snapshotVersion: "display-v1",
    nextPollMs: 1500,
    identity: { ticker: "US:KO", market: "US", symbol: "KO", name: "Coca-Cola" },
    sections: {
      price: { latest_price: 61.25, latest_price_label: "$61.25" },
      score: { score: 72, quality_score: 72 },
      financials: {
        key_metrics: [{ label: "시가총액", value: "$263B" }],
        stock_profile: [{ label: "섹터", value: "Consumer Defensive" }],
        valuation_rows: [
          { label: "Forward PER", value: "21.4" },
          { label: "업종 기준 PER", value: "24.0" },
        ],
        financials: { profitMargins: 0.22, revenueGrowth: 0.04 },
        financial_statement: { period: "TTM" },
        industry_benchmarks: [{ metric: "per", value: 24 }],
      },
      analyst: {
        news: [{ title: "실적 발표", link: "https://example.com/news" }],
      },
    },
    parts: {
      price: { state: "ready" },
      chart: { state: "refreshing" },
      score: { state: "ready" },
      financials: { state: "ready" },
      analyst: { state: "ready" },
    },
    jobs: [{ part: "chart", state: "queued" }],
  } satisfies StockDetailViewResponse;

  const state = dashboardStateFromDetailView(detailView);

  assert.equal(state?.status, "partial");
  assert.equal(state?.data?.key_metrics?.[0]?.label, "시가총액");
  assert.equal(state?.data?.stock_profile?.[0]?.label, "섹터");
  assert.equal(state?.data?.valuation_rows?.length, 2);
  assert.equal(state?.data?.financials?.profitMargins, 0.22);
  assert.equal(state?.data?.financial_statement?.period, "TTM");
  assert.equal((state?.data?.industry_benchmarks as unknown[] | undefined)?.length, 1);
  assert.equal(state?.data?.news?.[0]?.title, "실적 발표");
  assert.ok(stockDataUsefulness(state?.data) >= 12);
});

test("dashboard keeps skeleton for empty partials and shows useful detail-view partials", () => {
  assert.equal(shouldShowStockSkeleton("loading", false, false), true);
  assert.equal(shouldShowStockSkeleton("partial", false, false), true);
  assert.equal(shouldShowStockSkeleton("partial", false, true), true);
  assert.equal(shouldShowStockSkeleton("partial", true, true), false);
  assert.equal(shouldShowStockSkeleton("success", false, true), false);
});

test("dashboard extracts recovering display parts from server cache", () => {
  const data = {
    requested_ticker: "US:FAST",
    server_cache: {
      recovering_parts: ["chart", "score", 123, "fundamentals"],
    },
  } as unknown as StockScoreResponse;

  assert.deepEqual(stockRecoveringParts(data), ["chart", "score", "fundamentals"]);
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

test("chooseRicherStockData prefers display partials with price chart and score over identity placeholders", () => {
  const identityOnly = partialStockDataFromTicker("US:LANES");
  const displayPartial = {
    requested_ticker: "US:LANES",
    market: "US",
    symbol: "LANES",
    name: "Lane Test",
    latest_price: 10,
    quality_score: 51,
    chart_series: [{ date: "2026-06-09", close: 9 }, { date: "2026-06-10", close: 10 }],
    key_metrics: [{ label: "현재가", value: "$10.00" }],
  } satisfies StockScoreResponse;

  assert.equal(chooseRicherStockData(displayPartial, identityOnly), displayPartial);
  assert.equal(chooseRicherStockData(identityOnly, displayPartial), displayPartial);
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
    value: "업데이트 반영",
    detail: "업데이트 확인",
    tone: "stale",
  });
});

test("scoreFreshnessSummary hides implementation cache labels", () => {
  const cachedScore = {
    requested_ticker: "KR:004020",
    server_cache: {
      state: "stale",
      source: implementationCacheSource,
      refresh_started: true,
      implementation_saved_at: "2026-06-10T06:50:00.000Z",
    },
  } satisfies StockScoreResponse;

  assert.deepEqual(scoreFreshnessSummary(cachedScore), {
    label: "점수 기준",
    value: "업데이트 반영",
    detail: "업데이트 확인",
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
    value: "최신 데이터",
    detail: "점수 반영 완료",
    tone: "fresh",
  });
});

test("scoreFreshnessTimeChip uses product-state copy instead of local minute chips", () => {
  const score = {
    server_cache: {
      state: "fresh",
      fetched_at: "2026-06-06T09:08:00.000Z",
    },
  } satisfies StockScoreResponse;

  assert.equal(scoreFreshnessTimeChip(score), "최신 데이터");
});

test("stockHeaderFreshnessTimeChip uses product-state copy instead of local time chips", () => {
  const score = {
    server_cache: {
      state: "fresh",
      fetched_at: "2026-06-06T09:08:00.000Z",
    },
  } satisfies StockScoreResponse;
  const olderQuote = {
    server_cache: {
      state: "stale",
      fetched_at: "2026-06-06T08:59:00.000Z",
    },
  } satisfies StockQuoteResponse;
  const refreshedQuote = {
    server_cache: {
      state: "fresh",
      fetched_at: "2026-06-06T09:12:00.000Z",
    },
  } satisfies StockQuoteResponse;

  assert.equal(stockHeaderFreshnessTimeChip(score, olderQuote), "최신 데이터");
  assert.equal(stockHeaderFreshnessTimeChip(score, refreshedQuote), "최신 데이터");
});

test("stockHeaderFreshnessTimeChip hides implementation cache labels and local time in the compact header", () => {
  const score = {
    server_cache: {
      state: "stale",
      source: implementationCacheSource,
      fetched_at: "2026-06-06T09:08:00.000Z",
    },
  } satisfies StockScoreResponse;

  assert.equal(stockHeaderFreshnessTimeChip(score, undefined), "업데이트 반영");
});

test("stockHeaderFreshnessTimeChip hides implementation cache labels and local time when a fresher quote is present", () => {
  const score = {
    server_cache: {
      state: "stale",
      source: implementationCacheSource,
      fetched_at: "2026-06-06T09:08:00.000Z",
    },
  } satisfies StockScoreResponse;
  const quote = {
    server_cache: {
      state: "fresh",
      source: "supabase",
      fetched_at: "2026-06-06T09:12:00.000Z",
    },
  } satisfies StockQuoteResponse;

  assert.equal(stockHeaderFreshnessTimeChip(score, quote), "최신 데이터");
});

test("header signal labels translate internal enums into Korean product copy", () => {
  assert.equal(signalLabel("price_momentum_positive"), "흐름 우호");
  assert.equal(signalLabel("price_risk_watch"), "리스크 확인");
  assert.equal(signalLabel("price_neutral"), "중립");
  assert.equal(signalLabel("HOLD"), "관망");
  assert.equal(signalLabel("unknown_internal_key"), "분류 전");
  assert.equal(riskLevelLabel("medium"), "보통");
  assert.equal(riskLevelLabel("HIGH"), "높음");
});

test("visible record entries hide fast-path implementation fields", () => {
  const visible = visibleRecordEntries({
    source: "pending_enrichment",
    quote_only_fast_path: true,
    detail_fast_path: true,
    pending_enrichment: true,
    message: "차트와 정식 재무 데이터는 백그라운드 점수 스냅샷에서 보강됩니다.",
    totalRevenue: 1234,
  });

  assert.deepEqual(visible, [["totalRevenue", 1234]]);
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

test("scoreConfidenceChips exposes score confidence without noisy missing values", () => {
  assert.deepEqual(
    scoreConfidenceChips({
      opportunity_confidence: 0.734,
      sia_snapshot: { confidence: 0.812 },
    }),
    [
      { label: "품질 근거", value: "81%" },
      { label: "기회 근거", value: "73%" },
    ],
  );

  assert.deepEqual(scoreConfidenceChips({ sia_snapshot: { confidence: Number.NaN } as any }), []);
});

test("priceVolatilitySummaryItems selects compact chart context from raw price metrics", () => {
  assert.deepEqual(
    priceVolatilitySummaryItems({
      currency: "USD",
      price_metrics: {
        rsi14: 63.25,
        atr14_pct: 0.034,
        sma50: 142.12,
        sma200: 118.55,
        avg_volume_60: 150_000_000,
        distance_from_52w_high: -0.081,
      },
    }),
    [
      { label: "RSI14", value: "63.25" },
      { label: "ATR14 비중", value: "3.4%" },
      { label: "50일 평균", value: "$142.12" },
      { label: "200일 평균", value: "$118.55" },
      { label: "60일 평균 거래량", value: "150,000,000" },
      { label: "52주 고점 거리", value: "-8.1%" },
    ],
  );
});

test("factorSummary avoids trading-status wording in quality reasons", () => {
  assert.equal(
    factorSummary({
      key: "health",
      label: "거래 안정성",
      score: 66,
      summary: "거래 상태, 유동성, 규모, 부채와 현금흐름 체력을 봐요.",
      metrics: [{ label: "60일 변동성", value: "12.0%" }],
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

test("dashboard metric display prioritizes average target price over raw recommendation mean", async () => {
  const helpers = await import("../src/components/stockDashboardHelpers");
  const metricDisplayLabel = helpers.metricDisplayLabel as undefined | ((item: { label?: string; value?: unknown }, data?: StockScoreResponse) => string | undefined);
  assert.equal(typeof metricDisplayLabel, "function");

  const usScore = {
    market: "US",
    currency: "USD",
    financials: {
      targetMeanPrice: 125,
      recommendationMean: 1.83,
    },
  } satisfies StockScoreResponse;

  assert.equal(metricDisplayLabel?.({ label: "투자의견 평균", value: "1.83" }, usScore), "평균 목표가");
  assert.equal(formatMetricDisplayValue({ label: "투자의견 평균", value: "1.83" }, usScore), "$125.00");
  assert.equal(formatMetricDisplayValue({ label: "투자의견 평균", value: "1.83" }, { market: "US", currency: "USD" }), "1.83 / 5");
});

test("dashboard marks neutral fallback components without usable evidence as scoreless", async () => {
  const helpers = await import("../src/components/stockDashboardHelpers");
  const componentHasDisplayableScore = helpers.componentHasDisplayableScore as undefined | ((component: { key?: string; score?: number; metrics?: Array<{ label?: string; value?: unknown }> }) => boolean);
  const componentScoreText = helpers.componentScoreText as undefined | ((component: { key?: string; score?: number; metrics?: Array<{ label?: string; value?: unknown }> }) => string);

  assert.equal(typeof componentHasDisplayableScore, "function");
  assert.equal(typeof componentScoreText, "function");

  const missingAnalyst = {
    key: "opportunity_analyst",
    label: "목표가 여지",
    score: 50,
    metrics: [
      { label: "목표가 여지", value: "-" },
      { label: "애널리스트 수", value: "-" },
      { label: "투자의견 평균", value: "-" },
    ],
  };
  const missingValuation = {
    key: "valuation",
    label: "밸류에이션",
    score: 50,
    metrics: [
      { label: "PER", value: "-" },
      { label: "Forward PER", value: "-" },
      { label: "PBR", value: "0.00" },
      { label: "시가총액", value: "$474.51B" },
    ],
  };
  const scoredMomentum = {
    key: "momentum",
    label: "모멘텀",
    score: 72.2,
    metrics: [
      { label: "1개월 수익률", value: "+1.6%" },
      { label: "3개월 수익률", value: "+20.4%" },
    ],
  };

  assert.equal(componentHasDisplayableScore?.(missingAnalyst), false);
  assert.equal(componentScoreText?.(missingAnalyst), "점수 없음");
  assert.equal(componentHasDisplayableScore?.(missingValuation), false);
  assert.equal(componentScoreText?.(missingValuation), "점수 없음");
  assert.equal(componentHasDisplayableScore?.(scoredMomentum), true);
  assert.equal(componentScoreText?.(scoredMomentum), "72.2 · 무난");
});

test("dashboard keeps internal fast-path placeholders out of investor-facing score cards", () => {
  const pendingProfitability = {
    key: "profitability",
    label: "수익성",
    score: 50,
    summary: "정식 재무 데이터가 도착하기 전까지 중립으로 둡니다.",
    metrics: [
      { label: "보강 상태", value: "대기" },
      { label: "근거", value: "가격 데이터 우선" },
    ],
  };
  const pendingHealth = {
    key: "health",
    label: "안정성",
    score: 66,
    summary: "재무 안정성 보강 전이라 변동성과 고점 대비 위치로 방어력을 추정합니다.",
    metrics: [
      { label: "60일 변동성", value: "-" },
      { label: "고점 대비", value: "-" },
    ],
  };
  const pendingValuation = {
    key: "valuation",
    label: "밸류에이션",
    score: 68,
    summary: "PER/PBR 보강 전에는 52주 가격 위치만 보수적으로 반영합니다.",
    metrics: [{ label: "52주 고점 대비", value: "-" }],
  };
  const pricedMomentum = {
    key: "momentum",
    label: "모멘텀",
    score: 72.2,
    metrics: [
      { label: "1개월", value: "+4.3%" },
      { label: "20일선", value: "$132.10" },
    ],
  };

  assert.equal(componentHasDisplayableScore(pendingProfitability), false);
  assert.equal(componentScoreText(pendingProfitability), "점수 없음");
  assert.equal(componentHasDisplayableScore(pendingHealth), false);
  assert.equal(componentHasDisplayableScore(pendingValuation), false);
  assert.equal(componentHasDisplayableScore(pricedMomentum), true);

  assert.deepEqual(visibleLabeledItems(pendingProfitability.metrics), []);
  assert.doesNotMatch(factorSummary(pendingProfitability), /보강|백그라운드|대기|정식/);
  assert.match(factorSummary(pendingProfitability), /자료|판단/);

  const extremes = strongestAndWeakest({
    components: [pendingProfitability, pendingHealth, pendingValuation, pricedMomentum],
  } as StockScoreResponse);
  assert.equal(extremes.strongest?.key, "momentum");
  assert.equal(extremes.weakest, undefined);
});

test("dashboard metric display suppresses impossible cashflow margin percentages", () => {
  assert.equal(formatMetricDisplayValue({ label: "OCF 마진", value: "+13443238808.8%" }), "-");
  assert.equal(formatMetricDisplayValue({ label: "OFC 마진", value: "+13443238808.8%" }), "-");
  assert.equal(formatMetricDisplayValue({ label: "FCF 마진", value: "+4908876066.4%" }), "-");
  assert.equal(formatMetricDisplayValue({ label: "FCF 마진", value: "+18.4%" }), "+18.4%");
});

test("dailyChangeText prefers quote label, then quote value, then cached score value", () => {
  const score = { price_metrics: { latest_change: -0.0123 } } satisfies StockScoreResponse;

  assert.equal(dailyChangeText(score, { latest_change_label: "+1.4%" }), "+1.4%");
  assert.equal(dailyChangeText(score, { latest_change: 0.021 }), "+2.1%");
  assert.equal(dailyChangeText(score, undefined), "-1.2%");
});

test("dailyChangeText ignores implausible quote changes when cached chart change is sane", () => {
  const score = { price_metrics: { latest_change: 0.104051 } } satisfies StockScoreResponse;

  assert.equal(dailyChangeText(score, { latest_change: 7.851375, latest_change_label: "+785.1%" }), "+10.4%");
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
  assert.equal(formatRecordValue("recommendationMean", 1.83), "1.83 / 5");
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
      { label: "FCF 마진", value: "+12.4%" },
      { label: "OFC 마진", value: "+14.2%" },
      { label: "거래가능여부", value: "Y" },
      { label: "신뢰도", value: "80.0%" },
    ]),
    [
      { label: "회사명", value: "삼성전자" },
      { label: "Forward PER (예상 PER)", value: "13.40", note: "yfinance" },
      { label: "FCF 마진 (잉여현금흐름률)", value: "+12.4%" },
      { label: "OCF 마진 (영업현금흐름률)", value: "+14.2%" },
      { label: "근거 충분도", value: "80.0%" },
    ],
  );
});

test("dashboard record labels avoid internal camelCase financial keys", () => {
  assert.equal(humanizeRecordKey("freeCashflow"), "FCF (잉여현금흐름)");
  assert.equal(humanizeRecordKey("grossMargins"), "매출총이익률");
  assert.equal(humanizeRecordKey("evToEbitda"), "EV/EBITDA (기업가치/상각전영업이익)");
  assert.equal(humanizeRecordKey("salesPerShare"), "SPS (주당매출)");
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

test("directInputSymbolItem creates direct entries for ticker-like input and deterministic aliases", () => {
  assert.deepEqual(directInputSymbolItem("삼전"), {
    key: "KR:005930",
    market: "KR",
    ticker: "005930",
    displayName: "삼전",
    subtitle: "KR:005930",
    exchange: "",
    exchangeName: "직접 입력",
    koreanName: "삼전",
    englishName: "005930",
    instrumentType: "STOCK",
  });
  assert.deepEqual(directInputSymbolItem("삼성전자"), {
    key: "KR:005930",
    market: "KR",
    ticker: "005930",
    displayName: "삼성전자",
    subtitle: "KR:005930",
    exchange: "",
    exchangeName: "직접 입력",
    koreanName: "삼성전자",
    englishName: "005930",
    instrumentType: "STOCK",
  });
  assert.equal(directInputSymbolItem("삼성"), undefined);
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
