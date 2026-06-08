import test from "node:test";
import assert from "node:assert/strict";

import { sanitizeSnapshotPayload, snapshotPayloadHasSensitiveKeys } from "../src/lib/snapshotPayloadSanitizer";

test("snapshot payload sanitizer removes nested secret and debug-like keys", () => {
  const payload = {
    ok: true,
    requested_ticker: "US:KO",
    latest_price: 72.25,
    key_metrics: [{ label: "PER", value: "24.1" }],
    fetch: { source: "market_data" },
    nested: {
      access_token: "token",
      accessToken: "token-camel",
      authorization: "Bearer secret",
      clientSecret: "secret-camel",
      raw_response: { provider: "private" },
      safe_note: "kept",
    },
    rows: [
      { label: "safe", value: 1, api_key: "hidden", apiKey: "hidden-camel" },
      { label: "also safe", value: 2 },
    ],
  };

  const sanitized = sanitizeSnapshotPayload(payload);

  assert.deepEqual(sanitized, {
    ok: true,
    requested_ticker: "US:KO",
    latest_price: 72.25,
    key_metrics: [{ label: "PER", value: "24.1" }],
    fetch: { source: "market_data" },
    nested: {
      safe_note: "kept",
    },
    rows: [
      { label: "safe", value: 1 },
      { label: "also safe", value: 2 },
    ],
  });
});

test("snapshot payload sensitive scan reports secret-like keys without flagging metric keys", () => {
  assert.equal(snapshotPayloadHasSensitiveKeys({ key_metrics: [], fetch: { source: "market_data" } }), false);
  assert.equal(snapshotPayloadHasSensitiveKeys({ config: { client_secret: "secret" } }), true);
});
