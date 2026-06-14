import test from "node:test";
import assert from "node:assert/strict";

import { stockDisplayPayloadFromEnvelope } from "../src/lib/stockDataProjectors";
import { degradedPart, readyPart, staleReadyPart, unavailablePart } from "../src/lib/stockPartState";
import type { StockDataEnvelope } from "../src/lib/stockDataEnvelopeTypes";

const generatedAt = "2026-06-12T00:00:00.000Z";

test("display projector treats enrichment gaps as optional when core detail data is visible", () => {
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
  assert.deepEqual(payload.completion.requiredParts, ["identity", "price", "chart", "score"]);
  assert.deepEqual(payload.completion.presentParts, ["identity", "price", "chart", "score"]);
  assert.deepEqual(payload.completion.missingParts, []);
  assert.deepEqual(payload.completion.recoveringParts, []);
  assert.equal(payload.refresh.active, false);
  assert.equal(payload.refresh.nextPollMs, undefined);
});

test("display projector still exposes known profile and industry data from pending fast-path scores", () => {
  const payload = stockDisplayPayloadFromEnvelope(envelope({
    price: readyPart({ latest_price: 24.97 }, "market-data", generatedAt),
    chart: readyPart({ chart_series: [{ date: "2026-06-11", close: 25.1 }, { date: "2026-06-12", close: 24.97 }] }, "market-data", generatedAt),
    score: degradedPart(
      {
        score: 47,
        quality_score: 47,
        key_metrics: [{ label: "현재가", value: "24.97달러" }],
        stock_profile: [{ label: "산업", value: "응용 소프트웨어" }],
        valuation_rows: [
          { label: "PBR", value: "-", note: "자산 자료가 확인되면 보여줄게요." },
          { label: "업종 평균 PBR", value: "3.12", note: "국내 응용 소프트웨어 업종 평균" },
        ],
        industry_benchmarks: [{ metric: "pbr", median: 3.12, sampleCount: 12 }],
        financials: { source: "pending_enrichment", detail_fast_path: true },
        fetch: { pending_enrichment: true, detail_fast_path: true },
      },
      "fast-path",
      "price_fast_path",
      generatedAt,
    ),
  }));

  assert.deepEqual(payload.completion.presentParts, ["identity", "price", "chart", "score", "fundamentals", "industryBenchmark"]);
  assert.deepEqual(payload.fundamentals?.value.key_metrics, [{ label: "현재가", value: "24.97달러" }]);
  assert.deepEqual(payload.fundamentals?.value.stock_profile, [{ label: "산업", value: "응용 소프트웨어" }]);
  assert.equal(payload.fundamentals?.value.financials, undefined);
  assert.equal(payload.fundamentals?.value.valuation_rows, undefined);
  assert.deepEqual(payload.industryBenchmark?.value.valuation_rows, [
    { label: "업종 평균 PBR", value: "3.12", note: "국내 응용 소프트웨어 업종 평균" },
  ]);
  assert.deepEqual(payload.completion.missingParts, []);
  assert.equal(payload.refresh.active, false);
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

test("display projector derives a visible score when price and chart are ready but score times out", () => {
  const payload = stockDisplayPayloadFromEnvelope(envelope({
    price: readyPart({
      latest_price: 12000,
      latest_price_label: "12,000원",
      latest_change: 0.015,
      latest_change_label: "+1.5%",
      currency: "KRW",
      volume: 123456,
      volume_label: "123,456",
    }, "market-data", generatedAt),
    chart: readyPart({
      chart_series: [
        { date: "2026-06-11", close: 11800 },
        { date: "2026-06-12", close: 12000 },
      ],
    }, "market-data", generatedAt),
  }));

  assert.equal(payload.score?.value.score, 50);
  assert.equal(payload.score?.value.data_quality, "market_data_fallback");
  assert.deepEqual(payload.fundamentals?.value.key_metrics, [
    { label: "현재가", value: "12,000원" },
    { label: "전일 대비", value: "+1.7%" },
    { label: "거래량", value: "123,456" },
  ]);
  assert.equal(payload.industryBenchmark?.value.benchmark_label, "미국 상장 종목");
  assert.deepEqual(payload.completion.requiredParts, ["identity", "price", "chart", "score"]);
  assert.deepEqual(payload.completion.presentParts, ["identity", "price", "chart", "score", "fundamentals", "industryBenchmark"]);
  assert.deepEqual(payload.completion.missingParts, []);
  assert.deepEqual(payload.completion.recoveringParts, []);
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
