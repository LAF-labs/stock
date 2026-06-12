import test from "node:test";
import assert from "node:assert/strict";

import {
  chartPartFromResult,
  pricePartFromQuoteResult,
  scorePartFromResult,
} from "../src/lib/stockDataEnvelopeAdapters";

test("quote cache result becomes a ready price part", () => {
  const part = pricePartFromQuoteResult({
    payload: { latest_price: 21, latest_price_label: "$21.00" },
    cache: {
      state: "fresh",
      source: "supabase",
      ticker: "US:CPNG",
      fetchedAt: "2026-06-12T00:00:00.000Z",
      expiresAt: "2026-06-12T00:01:00.000Z",
    },
  });

  assert.equal(part?.state, "ready");
  assert.equal(part?.value.latest_price, 21);
});

test("stale chart cache result remains visible while refresh is active", () => {
  const part = chartPartFromResult({
    payload: {
      chart_series: [{ date: "2026-06-11", close: 20 }, { date: "2026-06-12", close: 21 }],
    },
    cache: {
      state: "stale",
      source: "supabase",
      ticker: "US:CPNG",
      fetchedAt: "2026-06-11T00:00:00.000Z",
      expiresAt: "2026-06-11T01:00:00.000Z",
      refreshStarted: true,
    },
  });

  assert.equal(part?.state, "stale_ready");
  assert.equal(part?.value.chart_series instanceof Array, true);
});

test("price fast-path score becomes degraded score data, not a fake financial part", () => {
  const part = scorePartFromResult({
    payload: {
      ok: true,
      score: 47,
      quality_score: 47,
      data_quality: "price_fast_path",
      fetch: { pending_enrichment: true },
      financials: { source: "pending_enrichment" },
    },
    cache: {
      state: "miss",
      source: "market-data",
      ticker: "US:FLNC",
      view: "detail",
      fetchedAt: "2026-06-12T00:00:00.000Z",
      expiresAt: "2026-06-12T00:01:00.000Z",
    },
  });

  assert.equal(part?.state, "degraded");
  assert.equal(part?.reason, "price_fast_path");
  assert.equal(part?.value.quality_score, 47);
});

test("quote-only and identity-only fast paths keep distinct degraded reasons", () => {
  const quoteOnly = scorePartFromResult({
    payload: {
      ok: true,
      score: 50,
      data_quality: "quote_fast_path",
      fetch: { quote_only_fast_path: true },
    },
  });
  const identityOnly = scorePartFromResult({
    payload: {
      ok: true,
      score: 50,
      data_quality: "identity_fast_path",
      fetch: { identity_only_fast_path: true },
    },
  });

  assert.equal(quoteOnly?.state, "degraded");
  assert.equal(quoteOnly?.reason, "quote_fast_path");
  assert.equal(identityOnly?.state, "degraded");
  assert.equal(identityOnly?.reason, "identity_fast_path");
});
