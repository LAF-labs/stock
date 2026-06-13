import test from "node:test";
import assert from "node:assert/strict";

import {
  chooseDashboardLoadState,
  stockDashboardQueryEnablement,
  stockDetailViewPrimaryEnabled,
  type DashboardLoadState,
} from "../src/components/useStockDashboardQueries";

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
