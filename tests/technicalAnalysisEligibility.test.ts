import test from "node:test";
import assert from "node:assert/strict";

import {
  detailPathForTicker,
  technicalAnalysisHrefForPayload,
  technicalEligibilityForTicker,
  technicalEligibilityFromPayload,
  technicalUnsupportedProductPayload,
} from "../src/lib/technicalAnalysisEligibility";

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

test("technical forced entry redirects to the detail page", () => {
  assert.equal(detailPathForTicker("KR:0194M0"), "/?ticker=KR%3A0194M0");
  assert.equal(detailPathForTicker("bad ticker"), "/?ticker=US%3AKO");
  assert.deepEqual(technicalUnsupportedProductPayload("KR:0194M0"), {
    ok: false,
    error: "technical_unsupported_product",
    ticker: "KR:0194M0",
    redirect_to: "/?ticker=KR%3A0194M0",
  });
});
