import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import { GET } from "../src/app/api/stock/detail-view/route";

test("stock detail-view endpoint returns partial model for a valid cold ticker", async () => {
  const response = await GET(new NextRequest("http://localhost/api/stock/detail-view?ticker=KR:005930"));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, "partial");
  assert.equal(payload.ticker, "KR:005930");
  assert.equal(payload.identity.symbol, "005930");
  assert.equal(payload.degradedReason, "identity_only");
  assert.equal(payload.parts.price.state, "refreshing");
  assert.equal(payload.nextPollMs, 1500);
  assert.match(response.headers.get("Cache-Control") || "", /max-age=0/);
});

test("stock detail-view endpoint returns irreversible failure for invalid ticker", async () => {
  const response = await GET(new NextRequest("http://localhost/api/stock/detail-view?ticker=KR:BAD"));
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.mode, "failed_irreversible");
  assert.equal(payload.error, "invalid_ticker");
  assert.match(response.headers.get("Cache-Control") || "", /no-store/);
});
