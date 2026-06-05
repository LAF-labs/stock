import test from "node:test";
import assert from "node:assert/strict";
import { judgmentCacheKeyFor, judgmentBucketStart } from "../src/lib/judgmentCache";
import { batchStatusFromResults } from "../src/lib/apiGuards";
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

test("batch status reports total collector outage as 502", () => {
  assert.equal(batchStatusFromResults([{ ok: false }, { ok: false }]), 502);
  assert.equal(batchStatusFromResults([{ ok: false }, { ok: true }]), 200);
  assert.equal(batchStatusFromResults([]), 400);
});

test("subprocess output is bounded and marked when truncated", () => {
  const result = appendBoundedOutput("abc", "defgh", 6);

  assert.equal(result.value, "abcdef");
  assert.equal(result.truncated, true);
});
