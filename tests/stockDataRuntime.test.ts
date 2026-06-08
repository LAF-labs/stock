import test from "node:test";
import assert from "node:assert/strict";

import {
  pythonCollectorEnabled,
  stockDataPendingRetryAfterSeconds,
  stockDataPendingPayload,
  stockDataRuntimeMode,
  stockDataUnavailablePayload,
  StockDataUnavailableError,
} from "../src/lib/stockDataRuntime";

const ORIGINAL_RETRY_AFTER = process.env.STOCK_REFRESH_QUEUE_RETRY_AFTER_SECONDS;
const ORIGINAL_ALLOW_VERCEL_PYTHON = process.env.STOCK_ALLOW_VERCEL_PYTHON_RUNTIME;

test.afterEach(() => {
  if (ORIGINAL_RETRY_AFTER === undefined) {
    delete process.env.STOCK_REFRESH_QUEUE_RETRY_AFTER_SECONDS;
  } else {
    process.env.STOCK_REFRESH_QUEUE_RETRY_AFTER_SECONDS = ORIGINAL_RETRY_AFTER;
  }
  if (ORIGINAL_ALLOW_VERCEL_PYTHON === undefined) {
    delete process.env.STOCK_ALLOW_VERCEL_PYTHON_RUNTIME;
  } else {
    process.env.STOCK_ALLOW_VERCEL_PYTHON_RUNTIME = ORIGINAL_ALLOW_VERCEL_PYTHON;
  }
});

test("Vercel runtime defaults to snapshot mode and disables Python collector", () => {
  const env = { VERCEL: "1" };

  assert.equal(stockDataRuntimeMode(env), "snapshot");
  assert.equal(pythonCollectorEnabled(env), false);
});

test("Vercel runtime fails closed to snapshot even when python mode is copied into env", () => {
  const env = { VERCEL: "1", STOCK_DATA_RUNTIME: "python" };

  assert.equal(stockDataRuntimeMode(env), "snapshot");
  assert.equal(pythonCollectorEnabled(env), false);
});

test("Vercel python runtime requires an explicit dangerous override", () => {
  const env = {
    VERCEL: "1",
    STOCK_DATA_RUNTIME: "python",
    STOCK_ALLOW_VERCEL_PYTHON_RUNTIME: "1",
  };

  assert.equal(stockDataRuntimeMode(env), "python");
  assert.equal(pythonCollectorEnabled(env), true);
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

test("snapshot pending payload can describe stale refresh work", () => {
  const payload = stockDataPendingPayload({
    kind: "quote",
    ticker: "US:KO",
    reason: "stale_refresh",
    retryAfterSeconds: 90,
    refreshRequest: { queued: true, job_id: "job-stale", status: "queued" },
  });

  assert.equal(payload.reason, "stale_refresh");
  assert.equal(payload.refresh_request.job_id, "job-stale");
  assert.equal(payload.retry_after_seconds, 90);
});

test("snapshot pending payload defaults to the queue worker cadence", () => {
  delete process.env.STOCK_REFRESH_QUEUE_RETRY_AFTER_SECONDS;

  assert.equal(stockDataPendingRetryAfterSeconds(), 300);

  const payload = stockDataPendingPayload({
    kind: "score",
    ticker: "US:POET",
    view: "detail",
    reason: "snapshot_miss",
    refreshRequest: { queued: true, job_id: "job-2", status: "queued" },
  });

  assert.equal(payload.retry_after_seconds, 300);
});

test("snapshot pending retry hint can be tuned by environment", () => {
  process.env.STOCK_REFRESH_QUEUE_RETRY_AFTER_SECONDS = "120";

  assert.equal(stockDataPendingRetryAfterSeconds(), 120);
});
