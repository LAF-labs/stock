import test from "node:test";
import assert from "node:assert/strict";

import {
  detailPathForTicker,
  technicalAnalysisHrefForPayload,
  technicalEligibilityForTicker,
  technicalEligibilityFromPayload,
  technicalUnsupportedProductPayload,
} from "../src/lib/technicalAnalysisEligibility";

const originalFetch = globalThis.fetch;
const originalEnv = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

function restore() {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test.afterEach(restore);

test("technical analysis allows ordinary single stocks", () => {
  const eligibility = technicalEligibilityFromPayload({
    requested_ticker: "KR:005930",
    market: "KR",
    symbol: "005930",
    name: "삼성전자",
    industry_profile: { asset_class: "stock" },
  });

  assert.deepEqual(eligibility, { eligible: true, ticker: "KR:005930" });
  assert.equal(technicalAnalysisHrefForPayload({ requested_ticker: "KR:005930", name: "삼성전자" }), "/technical?ticker=KR%3A005930");
});

test("technical analysis blocks ETF and derivative-like products", () => {
  assert.deepEqual(
    technicalEligibilityFromPayload({
      requested_ticker: "KR:0194M0",
      market: "KR",
      symbol: "0194M0",
      name: "ACE 삼성전자단일종목레버리지",
      industry_profile: { asset_class: "etf" },
    }),
    { eligible: false, ticker: "KR:0194M0", reason: "unsupported_product" }
  );

  assert.equal(
    technicalAnalysisHrefForPayload({
      requested_ticker: "KR:0194M0",
      name: "ACE 삼성전자단일종목레버리지",
      industry_profile: { asset_class: "etf" },
    }),
    undefined
  );
});

test("technical analysis blocks product-like names even when symbol master marks stock", async () => {
  assert.deepEqual(await technicalEligibilityForTicker("KR:0194M0"), {
    eligible: false,
    ticker: "KR:0194M0",
    reason: "unsupported_product",
  });
});

test("technical eligibility does not wait for remote symbol search on local exact misses", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "anon-key";

  let remoteCalls = 0;
  globalThis.fetch = (async () => {
    remoteCalls += 1;
    return Response.json([]);
  }) as typeof fetch;

  const eligibility = await technicalEligibilityForTicker("US:ZZZLOCALMISS");

  assert.deepEqual(eligibility, { eligible: true, ticker: "US:ZZZLOCALMISS" });
  assert.equal(remoteCalls, 0);
});

test("technical forced entry redirects to the detail page", () => {
  assert.equal(detailPathForTicker("KR:0194M0"), "/?ticker=KR%3A0194M0");
  assert.equal(detailPathForTicker("삼전"), "/?ticker=KR%3A005930");
  assert.equal(detailPathForTicker("bad ticker"), "/?ticker=US%3AKO");
  assert.equal(detailPathForTicker("US:BRK/B"), "/?ticker=US%3ABRK.B");
  assert.equal(detailPathForTicker("KR:F70100026"), "/?ticker=US%3AKO");
  assert.deepEqual(technicalUnsupportedProductPayload("KR:0194M0"), {
    ok: false,
    error: "technical_unsupported_product",
    ticker: "KR:0194M0",
    redirect_to: "/?ticker=KR%3A0194M0",
  });
});
