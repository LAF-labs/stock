import test from "node:test";
import assert from "node:assert/strict";

import { apiPayloadMessage, readClientApiPayload } from "../src/components/clientApi";

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
