import test from "node:test";
import assert from "node:assert/strict";

import { stockDisplayPayloadFromEnvelope } from "../src/lib/stockDataProjectors";
import { degradedPart, readyPart, staleReadyPart, unavailablePart } from "../src/lib/stockPartState";
import type { StockDataEnvelope } from "../src/lib/stockDataEnvelopeTypes";

const generatedAt = "2026-06-12T00:00:00.000Z";

test("display projector shows degraded score while continuing financial enrichment", () => {
  const payload = stockDisplayPayloadFromEnvelope(envelope({
    price: readyPart({ latest_price: 24.97 }, "market-data", generatedAt),
    chart: readyPart({ chart_series: [{ date: "2026-06-11", close: 25.1 }, { date: "2026-06-12", close: 24.97 }] }, "market-data", generatedAt),
    score: degradedPart(
      {
        score: 47,
        quality_score: 47,
        fetch: { pending_enrichment: true },
        financials: { source: "pending_enrichment" },
      },
      "fast-path",
      "price_fast_path",
      generatedAt,
    ),
  }));

  assert.equal(payload.score?.value.quality_score, 47);
  assert.equal(payload.score?.freshness, "fallback");
  assert.deepEqual(payload.completion.requiredParts, ["identity", "price", "chart", "score", "fundamentals", "industryBenchmark"]);
  assert.deepEqual(payload.completion.presentParts, ["identity", "price", "chart", "score"]);
  assert.deepEqual(payload.completion.missingParts, ["fundamentals", "industryBenchmark"]);
  assert.deepEqual(payload.completion.recoveringParts, ["fundamentals", "industryBenchmark"]);
  assert.equal(payload.refresh.active, true);
  assert.equal(payload.refresh.nextPollMs, 1500);
});

test("display projector keeps stale visible parts on screen without promising active recovery", () => {
  const payload = stockDisplayPayloadFromEnvelope(envelope({
    price: staleReadyPart({ latest_price: 21 }, "supabase", "2026-06-11T00:00:00.000Z"),
    chart: readyPart({ chart_series: [{ date: "2026-06-11", close: 20 }, { date: "2026-06-12", close: 21 }] }, "supabase", generatedAt),
    score: readyPart({ score: 61, quality_score: 61 }, "derived", generatedAt),
  }));

  assert.equal(payload.price?.value.latest_price, 21);
  assert.equal(payload.price?.freshness, "stale");
  assert.deepEqual(payload.completion.recoveringParts, []);
  assert.deepEqual(payload.refresh.staleParts, ["price"]);
  assert.equal(payload.refresh.active, false);
  assert.equal(payload.refresh.nextPollMs, undefined);
});

test("display projector normalizes stale quote change fields from usable chart rows", () => {
  const payload = stockDisplayPayloadFromEnvelope(envelope({
    price: readyPart({
      currency: "USD",
      latest_price: 103.03,
      latest_price_label: "$103.03",
      previous_close: 11.64,
      latest_change: 7.851375,
      latest_change_label: "+785.1%",
      price_metrics: { price: 103.03, previous_close: 11.64, latest_change: 7.851375 },
    }, "supabase", generatedAt),
    chart: readyPart({
      chart_series: [
        { date: "2026-06-10", close: 93.32 },
        { date: "2026-06-11", close: 103.03 },
      ],
    }, "market-data", generatedAt),
    score: readyPart({ score: 61, quality_score: 61 }, "derived", generatedAt),
  }));

  assert.equal(payload.price?.value.previous_close, 93.32);
  assert.equal(payload.price?.value.latest_change, 0.104051);
  assert.equal(payload.price?.value.latest_change_label, "+10.4%");
  assert.deepEqual(payload.price?.value.price_metrics, { price: 103.03, previous_close: 93.32, latest_change: 0.104051 });
});

test("display projector marks provider-empty required parts unavailable instead of recovering", () => {
  const payload = stockDisplayPayloadFromEnvelope(envelope({
    price: unavailablePart("provider_confirmed_empty", generatedAt),
    chart: readyPart({ chart_series: [{ date: "2026-06-11", close: 20 }, { date: "2026-06-12", close: 21 }] }, "supabase", generatedAt),
    score: readyPart({ score: 61, quality_score: 61 }, "derived", generatedAt),
  }));

  assert.deepEqual(payload.completion.missingParts, []);
  assert.deepEqual(payload.completion.recoveringParts, []);
  assert.deepEqual(payload.completion.unavailableParts, [{ part: "price", reason: "provider_confirmed_empty" }]);
  assert.equal(payload.refresh.active, false);
});

function envelope(parts: Partial<StockDataEnvelope["parts"]>): StockDataEnvelope {
  return {
    ticker: "US:FLNC",
    requestedTicker: "US:FLNC",
    view: "detail",
    generatedAt,
    hotnessTier: "active",
    parts: {
      identity: readyPart({ ticker: "US:FLNC", market: "US", symbol: "FLNC", name: "Fluence Energy" }, "symbol-master", generatedAt),
      ...parts,
    },
  };
}
