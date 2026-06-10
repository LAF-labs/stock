import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import { GET } from "../src/app/api/stock/display/route";

test("stock display endpoint returns displayable payload instead of pending for valid cold ticker", async () => {
  const response = await GET(new NextRequest("http://localhost/api/stock/display?ticker=KR:005930&view=detail"));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.ticker, "KR:005930");
  assert.equal(payload.identity.value.symbol, "005930");
  assert.deepEqual(payload.completion.recoveringParts, ["price", "chart", "score"]);
  assert.equal(JSON.stringify(payload).includes("snapshot_pending"), false);
  assert.match(response.headers.get("Cache-Control") || "", /max-age=0/);
  assert.match(response.headers.get("Vercel-CDN-Cache-Control") || "", /s-maxage=3/);
});

test("technical display endpoint keeps chart recovery separate from user-facing failure", async () => {
  const response = await GET(new NextRequest("http://localhost/api/stock/display?ticker=US:KO&view=technical"));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.ticker, "US:KO");
  assert.equal(payload.completion.recoveringParts.includes("chart"), true);
  assert.equal(payload.completion.recoveringParts.includes("technical"), true);
  assert.equal(payload.refresh.active, true);
});
