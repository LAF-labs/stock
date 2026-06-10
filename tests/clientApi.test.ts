import test from "node:test";
import assert from "node:assert/strict";

import { apiPayloadMessage, readClientApiPayload } from "../src/components/clientApi";
import { canSchedulePendingRetry, pendingRetryDelayMs, technicalPendingRetryDelayMs } from "../src/components/usePendingRetry";

test("readClientApiPayload rejects empty and malformed payloads with user-facing messages", async () => {
  await assert.rejects(
    () => readClientApiPayload(new Response("", { status: 200 })),
    /서버 응답이 비어 있어요/
  );

  await assert.rejects(
    () => readClientApiPayload(new Response("not-json", { status: 502 })),
    /서버 오류 응답을 읽지 못했어요. \(HTTP 502\)/
  );
});

test("readClientApiPayload parses object payloads and extracts safe messages", async () => {
  const payload = await readClientApiPayload(Response.json({ ok: false, error: "snapshot_pending", message: "준비 중" }));

  assert.deepEqual(payload, { ok: false, error: "snapshot_pending", message: "준비 중" });
  assert.equal(apiPayloadMessage(payload, "fallback"), "준비 중");
  assert.equal(apiPayloadMessage({ error: "rate_limited" }, "fallback"), "rate_limited");
  assert.equal(apiPayloadMessage({}, "fallback"), "fallback");
});

test("pending retry delay uses short interactive polling instead of queue retry hints", () => {
  assert.equal(pendingRetryDelayMs(300, 0, () => 0.5), 1_000);
  assert.equal(pendingRetryDelayMs(300, 1, () => 0.5), 2_000);
  assert.equal(pendingRetryDelayMs(300, 2, () => 0.5), 3_000);
  assert.equal(pendingRetryDelayMs(300, 9, () => 0.5), 60_000);
  assert.equal(pendingRetryDelayMs(undefined, 0, () => 0), 850);
});

test("technical pending retry uses short polling instead of the queue retry hint", () => {
  assert.equal(technicalPendingRetryDelayMs(300, 0, () => 0.5), 1_000);
  assert.equal(technicalPendingRetryDelayMs(300, 1, () => 0.5), 2_000);
  assert.equal(technicalPendingRetryDelayMs(300, 2, () => 0.5), 3_000);
  assert.equal(technicalPendingRetryDelayMs(300, 9, () => 0.5), 60_000);
  assert.equal(technicalPendingRetryDelayMs(1, 0, () => 0), 850);
});

test("pending retry scheduler caps attempts and pauses while hidden", () => {
  assert.equal(canSchedulePendingRetry({ attempt: 0, maxAttempts: 3, visibilityState: "visible" }), true);
  assert.equal(canSchedulePendingRetry({ attempt: 3, maxAttempts: 3, visibilityState: "visible" }), false);
  assert.equal(canSchedulePendingRetry({ attempt: 0, maxAttempts: 3, visibilityState: "hidden" }), false);
});
