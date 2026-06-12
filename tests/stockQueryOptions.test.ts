import test from "node:test";
import assert from "node:assert/strict";

import { STOCK_QUERY_CACHE_MAX_AGE_MS } from "../src/components/QueryProvider";
import {
  STOCK_QUERY_MAX_PENDING_POLLS,
  compareQueryOptions,
  detailViewQueryOptions,
  displayQueryResultFromPayload,
  displayQueryOptions,
  judgmentQueryOptions,
  quoteQueryOptions,
  quoteQueryDataFromRefreshResult,
  quoteQueryDataFromDisplayPayload,
  quoteQueryDataFromScore,
  quoteQueryUpdatedAtFromDisplayPayload,
  scoreQueryOptions,
  shouldEnableSymbolSearch,
  stockDetailViewRefetchIntervalMs,
  stockPendingRetryDelayMs,
  stockQueryRefetchIntervalMs,
  stockQueryRefetchOnMount,
  stockQueryShouldPoll,
  stockQueryStaleTimesMs,
  symbolSearchQueryOptions,
  technicalScoreQueryOptions,
} from "../src/lib/stockQueryOptions";
import type { CompareQueryResult, DisplayQueryResult, QuoteQueryResult, QuoteRefreshMutationResult, ScoreQueryResult } from "../src/lib/stockQueryTypes";
import type { StockDetailViewResponse } from "../src/lib/stockDetailViewTypes";
import type { StockDisplayPayload } from "../src/lib/stockDisplayTypes";
import type { StockScoreResponse } from "../src/lib/types";

test("stock query option factories use canonical keys and cache windows", () => {
  const score = scoreQueryOptions("KR:004020", "detail");
  const display = displayQueryOptions("KR:004020", "detail");
  const technical = technicalScoreQueryOptions("KR:004020");
  const quote = quoteQueryOptions("KR:004020");
  const compare = compareQueryOptions(["KR:004020", "US:KO"]);

  assert.deepEqual(display.queryKey, ["stock", "display", "detail", "KR:004020"]);
  assert.deepEqual(score.queryKey, ["stock", "score", "detail", "KR:004020"]);
  assert.deepEqual(technical.queryKey, ["stock", "score", "technical", "KR:004020"]);
  assert.deepEqual(quote.queryKey, ["stock", "quote", "KR:004020"]);
  assert.deepEqual(compare.queryKey, ["stock", "compare", "KR:004020,US:KO"]);
  assert.equal(score.gcTime, STOCK_QUERY_CACHE_MAX_AGE_MS);
  assert.equal(quote.staleTime, stockQueryStaleTimesMs.quote);
  assert.equal(score.staleTime, stockQueryStaleTimesMs.score);
  assert.equal(technical.staleTime, stockQueryStaleTimesMs.technical);
});

test("display query polls from refresh metadata instead of pending state names", () => {
  const display: DisplayQueryResult = {
    state: "ready",
    status: 200,
    payload: {},
    data: {
      ok: true,
      ticker: "KR:005930",
      requestedTicker: "KR:005930",
      view: "detail",
      generatedAt: "2026-06-10T00:00:00.000Z",
      snapshotVersion: "display-v1",
      hotnessTier: "active",
      identity: { value: { ticker: "KR:005930", market: "KR", symbol: "005930", name: "삼성전자" }, freshness: "fresh", source: "symbol-master" },
      completion: {
        requiredParts: ["identity", "price", "chart", "score"],
        presentParts: ["identity"],
        missingParts: ["price", "chart", "score"],
        recoveringParts: ["price", "chart", "score"],
        unavailableParts: [],
      },
      refresh: { active: true, staleParts: [], recoveringParts: ["price", "chart", "score"], nextPollMs: 1500 },
      capabilities: { canCompare: true, canTechnical: true },
    },
  };

  assert.equal(stockQueryShouldPoll(display), true);
  assert.equal(stockQueryRefetchIntervalMs(display, 0), 1500);
  assert.equal(stockQueryRefetchIntervalMs(display, STOCK_QUERY_MAX_PENDING_POLLS + 10), 1500);
});

test("display query result can be seeded from server-rendered payload", () => {
  const payload: StockDisplayPayload = {
    ok: true,
    ticker: "KR:005930",
    requestedTicker: "KR:005930",
    view: "detail",
    generatedAt: "2026-06-10T00:00:00.000Z",
    snapshotVersion: "display-v1",
    hotnessTier: "active",
    identity: {
      value: { ticker: "KR:005930", market: "KR", symbol: "005930", name: "삼성전자" },
      freshness: "fresh",
      source: "symbol-master",
    },
    price: {
      value: { requested_ticker: "KR:005930", market: "KR", symbol: "005930", latest_price: 187_400 },
      freshness: "fresh",
      source: "market-data",
    },
    completion: {
      requiredParts: ["identity", "price", "chart", "score"],
      presentParts: ["identity", "price"],
      missingParts: ["chart", "score"],
      recoveringParts: ["chart", "score"],
      unavailableParts: [],
    },
    refresh: {
      active: true,
      staleParts: [],
      recoveringParts: ["chart", "score"],
      nextPollMs: 1500,
    },
    capabilities: { canCompare: true, canTechnical: true },
  };

  const result = displayQueryResultFromPayload(payload);

  assert.equal(result.state, "ready");
  assert.equal(result.status, 200);
  assert.equal(result.data, payload);
  assert.equal(result.payload, payload);
  assert.equal(stockQueryShouldPoll(result), true);
  assert.equal(stockQueryRefetchOnMount(result), true);
  assert.equal(stockQueryRefetchIntervalMs(result, 0), 1500);
});

test("detail-view query options poll from nextPollMs while recovering", () => {
  const option = detailViewQueryOptions("US:VLD", "detail");
  assert.deepEqual(option.queryKey, ["stock", "detail-view", "detail", "US:VLD"]);

  const partial: StockDetailViewResponse = {
    ok: true,
    mode: "partial",
    ticker: "US:VLD",
    requestedTicker: "US:VLD",
    view: "detail",
    generatedAt: "2026-06-12T00:00:00.000Z",
    snapshotVersion: "display-v1",
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
  };

  assert.equal(stockDetailViewRefetchIntervalMs(partial), 1500);
  assert.equal(stockDetailViewRefetchIntervalMs({ ...partial, mode: "ready", nextPollMs: undefined }), false);
  assert.equal(stockDetailViewRefetchIntervalMs({ ok: false, mode: "failed_irreversible", error: "invalid_ticker", message: "bad" }), false);
});

test("compare query option keeps order and disables empty batches", () => {
  assert.notDeepEqual(compareQueryOptions(["KR:004020", "US:KO"]).queryKey, compareQueryOptions(["US:KO", "KR:004020"]).queryKey);
  assert.equal(compareQueryOptions([]).enabled, false);
  assert.equal(compareQueryOptions(["US:KO"]).enabled, true);
});

test("symbol search query option uses long-lived cache and short query guard", () => {
  assert.equal(shouldEnableSymbolSearch("k"), false);
  assert.equal(shouldEnableSymbolSearch("ko"), true);
  const option = symbolSearchQueryOptions("  ko  ", "US");
  assert.deepEqual(option.queryKey, ["stock", "symbols", "US", "ko"]);
  assert.equal(option.enabled, true);
  assert.equal(option.staleTime, stockQueryStaleTimesMs.symbols);
});

test("judgment query option is disabled until stable input hash and payload exist", () => {
  assert.equal(judgmentQueryOptions({ ticker: "US:KO", scoreVersion: "v1", inputHash: "", payload: {} }).enabled, false);
  assert.equal(judgmentQueryOptions({ ticker: "US:KO", scoreVersion: "v1", inputHash: "abc", payload: undefined }).enabled, false);
  const option = judgmentQueryOptions({ ticker: "US:KO", scoreVersion: "v1", inputHash: "abc", payload: { requested_ticker: "US:KO" } });
  assert.equal(option.enabled, true);
  assert.deepEqual(option.queryKey, ["stock", "judgment", "US:KO", "v1", "abc"]);
});

test("pending polling follows the shared backoff and stops on non-pollable states", () => {
  assert.equal(stockPendingRetryDelayMs(0), 1_000);
  assert.equal(stockPendingRetryDelayMs(3), 5_000);
  assert.equal(stockPendingRetryDelayMs(99), 60_000);

  const queuedPending: ScoreQueryResult = {
    state: "pending",
    status: 202,
    payload: { error: "snapshot_pending" },
    error: "snapshot_pending",
    message: "pending",
    queued: true,
  };
  const clientOnlyPending: ScoreQueryResult = {
    ...queuedPending,
    queued: false,
    retryAfterSeconds: undefined,
  };

  assert.equal(stockQueryShouldPoll(queuedPending), true);
  assert.equal(stockQueryRefetchIntervalMs(queuedPending, 2), 3_000);
  assert.equal(stockQueryRefetchIntervalMs(queuedPending, STOCK_QUERY_MAX_PENDING_POLLS), 60_000);
  assert.equal(stockQueryRefetchIntervalMs(queuedPending, STOCK_QUERY_MAX_PENDING_POLLS + 8), 60_000);
  assert.equal(stockQueryShouldPoll(clientOnlyPending), false);
  assert.equal(stockQueryRefetchIntervalMs({ state: "ready", status: 200, payload: {}, data: {} }, 0), false);
});

test("ready-looking quote-only fast path keeps polling until full detail data lands", () => {
  const fastPath: ScoreQueryResult = {
    state: "ready",
    status: 200,
    payload: {
      ok: true,
      requested_ticker: "KR:064350",
      chart_series: [],
      fetch: { quote_only_fast_path: true, pending_enrichment: true },
    },
    data: {
      requested_ticker: "KR:064350",
      symbol: "064350",
      chart_series: [],
      fetch: { quote_only_fast_path: true, pending_enrichment: true },
    } as StockScoreResponse,
  };

  assert.equal(stockQueryShouldPoll(fastPath), true);
  assert.equal(stockQueryRefetchOnMount(fastPath), "always");
  assert.equal(stockQueryRefetchIntervalMs(fastPath, 0), 1_000);
});

test("ready-looking enriched chart fast path still polls when financial enrichment is pending", () => {
  const fastPath: ScoreQueryResult = {
    state: "ready",
    status: 200,
    payload: {
      ok: true,
      requested_ticker: "US:GMAB",
      chart_series: [{ date: "2026-06-09", close: 25.1 }, { date: "2026-06-10", close: 24.97 }],
      fetch: { pending_enrichment: true, detail_fast_path: true },
      financials: { source: "pending_enrichment", detail_fast_path: true },
    },
    data: {
      requested_ticker: "US:GMAB",
      symbol: "GMAB",
      chart_series: [{ date: "2026-06-09", close: 25.1 }, { date: "2026-06-10", close: 24.97 }],
      fetch: { pending_enrichment: true, detail_fast_path: true },
      financials: { source: "pending_enrichment", detail_fast_path: true },
    } as StockScoreResponse,
  };

  assert.equal(stockQueryShouldPoll(fastPath), true);
  assert.equal(stockQueryRefetchOnMount(fastPath), "always");
  assert.equal(stockQueryRefetchIntervalMs(fastPath, 0), 1_000);
});

test("persisted stock data refetches on mount without freezing placeholder views", () => {
  const identityOnlyPartial: ScoreQueryResult = {
    state: "partial",
    status: 200,
    payload: { type: "partial_stock_snapshot", requested_ticker: "KR:004020" },
    data: { requested_ticker: "KR:004020", symbol: "004020" },
    pending: {
      state: "pending",
      status: 202,
      payload: { error: "snapshot_pending", ticker: "KR:004020" },
      error: "snapshot_pending",
      message: "pending",
      queued: false,
    },
  };

  assert.equal(stockQueryRefetchOnMount(identityOnlyPartial), "always");
  assert.equal(stockQueryRefetchOnMount({ state: "pending", status: 202, payload: { error: "snapshot_pending" }, error: "snapshot_pending", message: "pending", queued: false }), "always");
  assert.equal(stockQueryRefetchOnMount({ state: "ready", status: 200, payload: {}, data: { requested_ticker: "KR:004020" } }), true);
  assert.equal(stockQueryRefetchOnMount({ state: "unsupported", status: 200, payload: {}, error: "technical_unsupported_product" }), false);
});

test("quote refresh pending keeps the previous ready quote visible in query data", () => {
  const previous: QuoteQueryResult = {
    state: "ready",
    status: 200,
    payload: { requested_ticker: "KR:004020", latest_price: 28_550 },
    data: { type: "quote", requested_ticker: "KR:004020", market: "KR", symbol: "004020", name: "현대제철", latest_price: 28_550 },
  };
  const pending: QuoteRefreshMutationResult = {
    state: "pending",
    status: 202,
    payload: { error: "snapshot_pending", ticker: "KR:004020", refresh_request: { queued: true } },
    error: "snapshot_pending",
    message: "pending",
    ticker: "KR:004020",
    queued: true,
  };

  const next = quoteQueryDataFromRefreshResult(pending, previous);

  assert.equal(next?.state, "partial");
  assert.equal(next?.data.latest_price, 28_550);
  assert.equal(next?.pending?.queued, true);
});

test("quote refresh cooldown does not replace shared quote query data", () => {
  const previous: QuoteQueryResult = {
    state: "ready",
    status: 200,
    payload: { requested_ticker: "US:KO", latest_price: 61 },
    data: { type: "quote", requested_ticker: "US:KO", market: "US", symbol: "KO", name: "Coca-Cola", latest_price: 61 },
  };
  const cooldown: QuoteRefreshMutationResult = {
    state: "cooldown",
    status: 429,
    payload: { refresh_cooldown: { next_allowed_at: "2026-06-10T07:00:00.000Z" } },
    data: { type: "quote", requested_ticker: "US:KO", market: "US", symbol: "KO", latest_price: 62 },
    message: "cooldown",
    nextAllowedAt: "2026-06-10T07:00:00.000Z",
  };

  assert.equal(quoteQueryDataFromRefreshResult(cooldown, previous), previous);
});

test("ready score data seeds quote query data only for the matching ticker", () => {
  const seeded = quoteQueryDataFromScore(
    {
      requested_ticker: "KR:004020",
      market: "KR",
      symbol: "004020",
      name: "현대제철",
      currency: "KRW",
      latest_price: 28_550,
      latest_price_label: "28,550원",
      latest_bar_date: "2026-06-10",
      server_cache: { state: "fresh" },
    },
    "KR:004020",
  );

  assert.equal(seeded?.state, "ready");
  assert.equal(seeded?.data.name, "현대제철");
  assert.equal(seeded?.data.latest_price, 28_550);
  assert.equal(
    quoteQueryDataFromScore({ requested_ticker: "KR:004020", market: "KR", symbol: "004020", latest_price: 28_550 }, "US:KO"),
    undefined,
  );
});

test("display price payload can seed quote query data without an immediate quote round trip", () => {
  const payload: StockDisplayPayload = {
    ok: true,
    ticker: "KR:005930",
    requestedTicker: "KR:005930",
    view: "detail",
    generatedAt: "2026-06-10T00:00:00.000Z",
    snapshotVersion: "display-v1",
    hotnessTier: "active",
    identity: {
      value: { ticker: "KR:005930", market: "KR", symbol: "005930", name: "삼성전자", exchange: "KOSPI" },
      freshness: "fresh",
      source: "symbol-master",
    },
    price: {
      value: {
        requested_ticker: "KR:005930",
        market: "KR",
        symbol: "005930",
        name: "삼성전자",
        currency: "KRW",
        latest_price: 187_400,
        latest_price_label: "187,400원",
        latest_bar_date: "2026-06-10",
        server_cache: { fetched_at: "2026-06-09T23:59:00.000Z" },
      },
      freshness: "fresh",
      source: "market-data",
    },
    completion: {
      requiredParts: ["identity", "price", "chart", "score"],
      presentParts: ["identity", "price"],
      missingParts: ["chart", "score"],
      recoveringParts: ["chart", "score"],
      unavailableParts: [],
    },
    refresh: { active: true, staleParts: [], recoveringParts: ["chart", "score"], nextPollMs: 1500 },
    capabilities: { canCompare: true, canTechnical: true },
  };

  const seeded = quoteQueryDataFromDisplayPayload(payload);

  assert.equal(seeded?.state, "ready");
  assert.equal(seeded?.data.name, "삼성전자");
  assert.equal(seeded?.data.latest_price, 187_400);
  assert.equal(seeded?.data.exchange, "KOSPI");
  assert.equal(quoteQueryUpdatedAtFromDisplayPayload(payload), Date.parse("2026-06-09T23:59:00.000Z"));
  assert.equal(quoteQueryDataFromDisplayPayload({ ...payload, price: undefined }), undefined);
});

test("partial polling only continues when nested pending work is queued", () => {
  const partial: ScoreQueryResult = {
    state: "partial",
    status: 200,
    payload: { type: "partial_stock_snapshot" },
    data: { requested_ticker: "US:KO" },
    pending: {
      state: "pending",
      status: 202,
      payload: { error: "snapshot_pending" },
      error: "snapshot_pending",
      message: "pending",
      queued: true,
    },
  };
  assert.equal(stockQueryShouldPoll(partial), true);
});

test("compare polling retries any pending member so stale active batches self-heal", () => {
  const clientOnlyPending: ScoreQueryResult = {
    state: "pending",
    status: 202,
    payload: { error: "snapshot_pending" },
    error: "snapshot_pending",
    message: "pending",
    queued: false,
    retryAfterSeconds: undefined,
  };
  const clientOnlyPartial: ScoreQueryResult = {
    state: "partial",
    status: 200,
    payload: { type: "partial_stock_snapshot" },
    data: { requested_ticker: "US:APLT" },
    pending: clientOnlyPending,
  };
  const compareWithPending: CompareQueryResult = {
    state: "partial",
    status: 200,
    payload: {},
    results: [
      {
        ticker: "US:APLT",
        result: clientOnlyPartial,
      },
      {
        ticker: "US:APOG",
        result: {
          state: "ready",
          status: 200,
          payload: {},
          data: { requested_ticker: "US:APOG", symbol: "APOG" },
        },
      },
    ],
  };

  assert.equal(stockQueryShouldPoll(clientOnlyPending), false);
  assert.equal(stockQueryShouldPoll(clientOnlyPartial), false);
  assert.equal(stockQueryShouldPoll(compareWithPending), true);
  assert.equal(stockQueryRefetchIntervalMs(compareWithPending, 1, "compare"), 2_000);
});
