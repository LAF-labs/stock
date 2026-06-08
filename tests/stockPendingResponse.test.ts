import test from "node:test";
import assert from "node:assert/strict";

import { enqueueStockPendingPayload, stockPendingJsonResponse } from "../src/lib/stockPendingResponse";

const ORIGINAL_ENV = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

test.afterEach(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

test("stock pending response exposes refresh queue outage instead of accepted work", async () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  const payload = await enqueueStockPendingPayload({
    kind: "score",
    ticker: "US:NVDA",
    view: "detail",
    priority: 20,
    reason: "snapshot_miss",
  });
  const response = stockPendingJsonResponse(payload);

  assert.equal(payload.error, "refresh_queue_unavailable");
  assert.equal(payload.refresh_request.queued, false);
  assert.equal(payload.refresh_request.reason, "missing_supabase_admin_config");
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), null);
});

test("stock pending response keeps retry headers only for queued refresh work", () => {
  const response = stockPendingJsonResponse({
    ok: false,
    error: "snapshot_pending",
    message: "Stock data is being prepared. Please retry shortly.",
    kind: "quote",
    ticker: "US:KO",
    reason: "snapshot_miss",
    retry_after_seconds: 120,
    refresh_request: { queued: true, job_id: "job-1", status: "queued" },
  });

  assert.equal(response.status, 202);
  assert.equal(response.headers.get("retry-after"), "120");
});

test("stock pending response preserves stale refresh reasons", async () => {
  const response = stockPendingJsonResponse({
    ok: false,
    error: "snapshot_pending",
    message: "Stock data is being prepared. Please retry shortly.",
    kind: "quote",
    ticker: "US:KO",
    reason: "stale_refresh",
    retry_after_seconds: 90,
    refresh_request: { queued: true, job_id: "job-stale", status: "queued" },
  });
  const body = (await response.json()) as Record<string, unknown>;

  assert.equal(response.status, 202);
  assert.equal(body.reason, "stale_refresh");
  assert.equal(response.headers.get("retry-after"), "90");
});
