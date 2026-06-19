import test from "node:test";
import assert from "node:assert/strict";

import { readMarketCapRequestParams } from "../src/app/api/market-cap/route";

test("readMarketCapRequestParams accepts one scope and one sector filter", () => {
  const params = readMarketCapRequestParams(new URL("https://example.test/api/market-cap?scope=overseas&sector=Technology"));

  assert.deepEqual(params, {
    scope: "overseas",
    sector: "Technology",
  });
});

test("readMarketCapRequestParams accepts legacy market aliases for scoped snapshots", () => {
  assert.deepEqual(readMarketCapRequestParams(new URL("https://example.test/api/market-cap?market=KR")), {
    scope: "domestic",
    sector: undefined,
  });
  assert.deepEqual(readMarketCapRequestParams(new URL("https://example.test/api/market-cap?market=US")), {
    scope: "overseas",
    sector: undefined,
  });
});

test("readMarketCapRequestParams falls back to all scope and drops blank sectors", () => {
  const params = readMarketCapRequestParams(new URL("https://example.test/api/market-cap?scope=bad&sector=%20"));

  assert.deepEqual(params, {
    scope: "all",
    sector: undefined,
  });
});
