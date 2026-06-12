import test from "node:test";
import assert from "node:assert/strict";
import { judgmentBenchmarkCacheToken, judgmentCacheKeyFor, judgmentBucketStart } from "../src/lib/judgmentCache";
import { batchStatusFromResults } from "../src/lib/apiGuards";
import { safeErrorMessage } from "../src/lib/errorSafety";
import { appendBoundedOutput } from "../src/lib/subprocessGuards";

test("judgment cache key stays stable inside a six-hour bucket", () => {
  const first = new Date("2026-06-05T00:10:00.000Z");
  const second = new Date("2026-06-05T05:59:59.000Z");

  assert.equal(judgmentBucketStart(first), "2026-06-05T00:00:00.000Z");
  assert.equal(judgmentCacheKeyFor("rule-v1", first), judgmentCacheKeyFor("rule-v1", second));
});

test("judgment cache key changes on the next six-hour bucket", () => {
  const before = new Date("2026-06-05T05:59:59.000Z");
  const after = new Date("2026-06-05T06:00:00.000Z");

  assert.notEqual(judgmentCacheKeyFor("rule-v1", before), judgmentCacheKeyFor("rule-v1", after));
});

test("judgment cache key changes when industry benchmark coverage changes", () => {
  const date = new Date("2026-06-05T00:10:00.000Z");
  const emptyToken = judgmentBenchmarkCacheToken([]);
  const benchmarkToken = judgmentBenchmarkCacheToken([
    {
      scope: "OVERSEAS",
      market: "US",
      sector: "필수소비재",
      industry: "음식료·외식",
      metric: "per",
      period: "quarter",
      median: 22.74,
      sampleCount: 23,
      source: "score_snapshot",
    },
  ]);

  assert.equal(emptyToken, "bench:none");
  assert.match(benchmarkToken, /^bench:OVERSEAS:US:quarter:per:필수소비재:음식료·외식:22\.74:23$/);
  assert.notEqual(judgmentCacheKeyFor("rule-v1", date, "stock-rule-judge-v4", emptyToken), judgmentCacheKeyFor("rule-v1", date, "stock-rule-judge-v4", benchmarkToken));
});

test("batch status reports total collector outage as 502", () => {
  assert.equal(batchStatusFromResults([{ ok: false }, { ok: false }]), 502);
  assert.equal(batchStatusFromResults([{ ok: false }, { ok: true }]), 200);
  assert.equal(batchStatusFromResults([]), 400);
});

test("batch status reports snapshot pending as accepted work", () => {
  assert.equal(
    batchStatusFromResults([
      { ok: false, error: "snapshot_pending" },
      { ok: false, error: "snapshot_pending" },
    ]),
    202
  );
  assert.equal(batchStatusFromResults([{ ok: false, error: "snapshot_pending" }, { ok: true }]), 200);
  assert.equal(batchStatusFromResults([{ ok: false, error: "refresh_queue_unavailable" }]), 502);
});

test("batch status keeps invalid ticker results client-correctable", () => {
  assert.equal(batchStatusFromResults([{ ok: false, error: "invalid_ticker" }]), 400);
  assert.equal(batchStatusFromResults([{ ok: false, error: "snapshot_pending" }, { ok: false, error: "invalid_ticker" }]), 202);
});

test("subprocess output is bounded and marked when truncated", () => {
  const result = appendBoundedOutput("abc", "defgh", 6);

  assert.equal(result.value, "abcdef");
  assert.equal(result.truncated, true);
});

test("safe error message redacts configured secret values", () => {
  const originalServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalAppKey = process.env.STOCK_API_APP_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "secret-service-role-value";
  process.env.STOCK_API_APP_KEY = "secret-stock-app-key-value";
  try {
    const message = safeErrorMessage(
      new Error("failed with secret-service-role-value secret-stock-app-key-value and Bearer abcdefghijklmnopqrstuvwxyz")
    );

    assert.doesNotMatch(message, /secret-service-role-value/);
    assert.doesNotMatch(message, /secret-stock-app-key-value/);
    assert.doesNotMatch(message, /abcdefghijklmnopqrstuvwxyz/);
    assert.match(message, /\[redacted\]/);
  } finally {
    if (originalServiceRole === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRole;
    }
    if (originalAppKey === undefined) {
      delete process.env.STOCK_API_APP_KEY;
    } else {
      process.env.STOCK_API_APP_KEY = originalAppKey;
    }
  }
});
