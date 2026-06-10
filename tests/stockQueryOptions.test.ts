import test from "node:test";
import assert from "node:assert/strict";

import { STOCK_QUERY_CACHE_MAX_AGE_MS } from "../src/components/QueryProvider";
import {
  STOCK_QUERY_MAX_PENDING_POLLS,
  compareQueryOptions,
  judgmentQueryOptions,
  quoteQueryOptions,
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
import type { CompareQueryResult, ScoreQueryResult } from "../src/lib/stockQueryTypes";

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

test("non-ready persisted stock data refetches on mount instead of freezing placeholder views", () => {
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
  assert.equal(stockQueryRefetchOnMount({ state: "ready", status: 200, payload: {}, data: { requested_ticker: "KR:004020" } }), false);
});

test("partial and compare polling only continue when nested pending work is queued", () => {
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
  const compare: CompareQueryResult = {
    state: "partial",
    status: 200,
    payload: {},
    results: [{ ticker: "US:KO", result: partial }],
  };

  assert.equal(stockQueryShouldPoll(partial), true);
  assert.equal(stockQueryShouldPoll(compare), true);
  assert.equal(stockQueryRefetchIntervalMs(compare, 1, "compare"), 2_000);
});
