import test from "node:test";
import assert from "node:assert/strict";

import { STOCK_QUERY_CACHE_MAX_AGE_MS } from "../src/components/QueryProvider";
import {
  STOCK_QUERY_MAX_PENDING_POLLS,
  compareQueryOptions,
  judgmentQueryOptions,
  quoteQueryOptions,
  quoteQueryDataFromRefreshResult,
  quoteQueryDataFromScore,
  scoreQueryOptions,
  shouldEnableSymbolSearch,
  stockPendingRetryDelayMs,
  stockQueryRefetchIntervalMs,
  stockQueryRefetchOnMount,
  stockQueryShouldPoll,
  stockQueryStaleTimesMs,
  symbolSearchQueryOptions,
  technicalScoreQueryOptions,
} from "../src/lib/stockQueryOptions";
import type { CompareQueryResult, QuoteQueryResult, QuoteRefreshMutationResult, ScoreQueryResult } from "../src/lib/stockQueryTypes";

test("stock query option factories use canonical keys and cache windows", () => {
  const score = scoreQueryOptions("KR:004020", "detail");
  const technical = technicalScoreQueryOptions("KR:004020");
  const quote = quoteQueryOptions("KR:004020");
  const compare = compareQueryOptions(["KR:004020", "US:KO"]);

  assert.deepEqual(score.queryKey, ["stock", "score", "detail", "KR:004020"]);
  assert.deepEqual(technical.queryKey, ["stock", "score", "technical", "KR:004020"]);
  assert.deepEqual(quote.queryKey, ["stock", "quote", "KR:004020"]);
  assert.deepEqual(compare.queryKey, ["stock", "compare", "KR:004020,US:KO"]);
  assert.equal(score.gcTime, STOCK_QUERY_CACHE_MAX_AGE_MS);
  assert.equal(quote.staleTime, stockQueryStaleTimesMs.quote);
  assert.equal(score.staleTime, stockQueryStaleTimesMs.score);
  assert.equal(technical.staleTime, stockQueryStaleTimesMs.technical);
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
  assert.equal(stockQueryRefetchIntervalMs(queuedPending, STOCK_QUERY_MAX_PENDING_POLLS), false);
  assert.equal(stockQueryShouldPoll(clientOnlyPending), false);
  assert.equal(stockQueryRefetchIntervalMs({ state: "ready", status: 200, payload: {}, data: {} }, 0), false);
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
