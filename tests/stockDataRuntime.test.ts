import test from "node:test";
import assert from "node:assert/strict";

import {
  pythonCollectorEnabled,
  stockDataPendingPayload,
  stockDataRuntimeMode,
  stockDataUnavailablePayload,
  StockDataUnavailableError,
} from "../src/lib/stockDataRuntime";

test("Vercel runtime defaults to snapshot mode and disables Python collector", () => {
  const env = { VERCEL: "1" };

  assert.equal(stockDataRuntimeMode(env), "snapshot");
  assert.equal(pythonCollectorEnabled(env), false);
});

test("local runtime keeps Python collector available unless snapshot mode is requested", () => {
  assert.equal(stockDataRuntimeMode({}), "python");
  assert.equal(pythonCollectorEnabled({}), true);

  assert.equal(stockDataRuntimeMode({ STOCK_DATA_RUNTIME: "snapshot" }), "snapshot");
  assert.equal(pythonCollectorEnabled({ STOCK_DATA_RUNTIME: "snapshot" }), false);

  assert.equal(stockDataRuntimeMode({ STOCK_DATA_RUNTIME: "python" }), "python");
  assert.equal(pythonCollectorEnabled({ STOCK_DATA_RUNTIME: "python" }), true);
});

test("snapshot-only miss uses a stable public error contract", () => {
  const payload = stockDataUnavailablePayload({
    kind: "score",
    ticker: "US:KO",
    view: "detail",
    reason: "snapshot_miss",
  });

  assert.equal(payload.ok, false);
  assert.equal(payload.error, "snapshot_unavailable");
  assert.equal(payload.ticker, "US:KO");
  assert.equal(payload.view, "detail");
  assert.equal(payload.reason, "snapshot_miss");
});

test("StockDataUnavailableError carries status and JSON payload", () => {
  const error = new StockDataUnavailableError({
    kind: "quote",
    ticker: "KR:005930",
    reason: "refresh_background_only",
  });

  assert.equal(error.status, 503);
  assert.deepEqual(error.toPayload(), {
    ok: false,
    error: "snapshot_unavailable",
    message: "Stock data snapshot is not available yet.",
    kind: "quote",
    ticker: "KR:005930",
    reason: "refresh_background_only",
  });
});

test("snapshot pending payload exposes queued refresh metadata", () => {
  const payload = stockDataPendingPayload({
    kind: "score",
    ticker: "US:NVDA",
    view: "compare",
    reason: "snapshot_miss",
    retryAfterSeconds: 45,
    refreshRequest: { queued: true, job_id: "job-1", status: "queued" },
  });

  assert.deepEqual(payload, {
    ok: false,
    error: "snapshot_pending",
    message: "Stock data is being prepared. Please retry shortly.",
    kind: "score",
    ticker: "US:NVDA",
    view: "compare",
    reason: "snapshot_miss",
    retry_after_seconds: 45,
    refresh_request: {
      queued: true,
      job_id: "job-1",
      status: "queued",
    },
  });
});
