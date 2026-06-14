import test from "node:test";
import assert from "node:assert/strict";

import {
  chooseDashboardLoadState,
  stockDashboardQueryEnablement,
  stockDetailViewPrimaryEnabled,
  type DashboardLoadState,
} from "../src/components/useStockDashboardQueries";
import * as stockDashboardQueries from "../src/components/useStockDashboardQueries";
import type { StockDetailViewResponse } from "../src/lib/stockDetailViewTypes";

test("detail-view primary disables automatic legacy score display and quote reads", () => {
  assert.deepEqual(stockDashboardQueryEnablement({ enabled: true, detailViewPrimary: true }), {
    detailView: true,
    score: false,
    display: false,
    quote: false,
  });
});

test("detail-view primary can be explicitly opted out", () => {
  assert.equal(stockDetailViewPrimaryEnabled({ NEXT_PUBLIC_STOCK_DETAIL_VIEW_PRIMARY: "0" }), false);
  assert.deepEqual(stockDashboardQueryEnablement({ enabled: true, detailViewPrimary: false }), {
    detailView: true,
    score: true,
    display: true,
    quote: true,
  });
});

test("dashboard query state keeps a ready score result over a partial detail-view result", () => {
  const detailPartial: DashboardLoadState = {
    status: "partial",
    data: { ok: true, requested_ticker: "US:FLNC", symbol: "FLNC", quality_score: 50 },
    pending: { message: "pending", ticker: "US:FLNC", queued: true },
  };
  const scoreReady: DashboardLoadState = {
    status: "success",
    data: { ok: true, requested_ticker: "US:FLNC", symbol: "FLNC", quality_score: 61 },
  };

  assert.equal(chooseDashboardLoadState(detailPartial, scoreReady), scoreReady);
});

test("dashboard query state still prefers a ready detail-view result when it is complete", () => {
  const detailReady: DashboardLoadState = {
    status: "success",
    data: { ok: true, requested_ticker: "US:NOW", symbol: "NOW", quality_score: 72 },
  };
  const scoreReady: DashboardLoadState = {
    status: "success",
    data: { ok: true, requested_ticker: "US:NOW", symbol: "NOW", quality_score: 68 },
  };

  assert.equal(chooseDashboardLoadState(detailReady, scoreReady), detailReady);
});

test("detail-view pending state reflects queued recovery work", () => {
  const pendingFromResult = (stockDashboardQueries as {
    detailViewPendingFromResult?: (result: StockDetailViewResponse, ticker: string) => { queued: boolean; message: string; retryAfterSeconds?: number };
  }).detailViewPendingFromResult;
  assert.equal(typeof pendingFromResult, "function");

  const recovering: StockDetailViewResponse = {
    ok: true,
    mode: "partial",
    ticker: "US:LH",
    requestedTicker: "US:LH",
    view: "detail",
    generatedAt: "2026-06-14T05:45:00.000Z",
    snapshotVersion: "display-v1",
    nextPollMs: 1500,
    identity: { ticker: "US:LH", market: "US", symbol: "LH", name: "Labcorp" },
    sections: {},
    parts: {
      price: { state: "ready" },
      chart: { state: "refreshing" },
      score: { state: "ready" },
      financials: { state: "missing" },
      analyst: { state: "missing" },
    },
    jobs: [{ part: "chart", state: "queued" }],
  };

  assert.deepEqual(pendingFromResult?.(recovering, "US:LH"), {
    message: "부족한 데이터가 들어오면 자동으로 업데이트해요.",
    ticker: "US:LH",
    queued: true,
    retryAfterSeconds: 2,
  });
});

test("detail-view pending state does not promise updates for missing-only partials", () => {
  const pendingFromResult = (stockDashboardQueries as {
    detailViewPendingFromResult?: (result: StockDetailViewResponse, ticker: string) => { queued: boolean; message: string; retryAfterSeconds?: number };
  }).detailViewPendingFromResult;
  assert.equal(typeof pendingFromResult, "function");

  const missingOnly: StockDetailViewResponse = {
    ok: true,
    mode: "partial",
    ticker: "US:VLD",
    requestedTicker: "US:VLD",
    view: "detail",
    generatedAt: "2026-06-14T05:45:00.000Z",
    snapshotVersion: "display-v1",
    identity: { ticker: "US:VLD", market: "US", symbol: "VLD", name: "Velo3D" },
    sections: {},
    parts: {
      price: { state: "missing" },
      chart: { state: "missing" },
      score: { state: "missing" },
      financials: { state: "missing" },
      analyst: { state: "missing" },
    },
    jobs: [],
  };

  assert.deepEqual(pendingFromResult?.(missingOnly, "US:VLD"), {
    message: "현재 제공 가능한 데이터만 표시했어요.",
    ticker: "US:VLD",
    queued: false,
  });
});

test("detail-view pending state treats stale-only partials without polling metadata as static", () => {
  const pendingFromResult = (stockDashboardQueries as {
    detailViewPendingFromResult?: (result: StockDetailViewResponse, ticker: string) => { queued: boolean; message: string; retryAfterSeconds?: number };
  }).detailViewPendingFromResult;
  assert.equal(typeof pendingFromResult, "function");

  const staleOnly: StockDetailViewResponse = {
    ok: true,
    mode: "partial",
    ticker: "US:STALE",
    requestedTicker: "US:STALE",
    view: "detail",
    generatedAt: "2026-06-14T05:45:00.000Z",
    snapshotVersion: "display-v1",
    identity: { ticker: "US:STALE", market: "US", symbol: "STALE", name: "Stale Co" },
    sections: {
      price: { latest_price: 10 },
    },
    parts: {
      price: { state: "stale_ready" },
      chart: { state: "missing" },
      score: { state: "missing" },
      financials: { state: "missing" },
      analyst: { state: "missing" },
    },
    jobs: [],
  };

  assert.deepEqual(pendingFromResult?.(staleOnly, "US:STALE"), {
    message: "현재 제공 가능한 데이터만 표시했어요.",
    ticker: "US:STALE",
    queued: false,
  });
});
