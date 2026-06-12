import test from "node:test";
import assert from "node:assert/strict";

import { stockDetailViewFromDisplayPayload } from "../src/lib/stockDetailViewModel";
import type { StockDisplayPayload } from "../src/lib/stockDisplayTypes";

function baseDisplayPayload(overrides: Partial<StockDisplayPayload> = {}): StockDisplayPayload {
  return {
    ok: true,
    ticker: "US:VLD",
    requestedTicker: "US:VLD",
    view: "detail",
    generatedAt: "2026-06-12T00:00:00.000Z",
    snapshotVersion: "display-v1",
    hotnessTier: "active",
    identity: {
      value: { ticker: "US:VLD", market: "US", symbol: "VLD", name: "Velo3D" },
      freshness: "fresh",
      source: "symbol-master",
    },
    completion: {
      requiredParts: ["identity", "price", "chart", "score"],
      presentParts: ["identity"],
      missingParts: ["price", "chart", "score"],
      recoveringParts: ["price", "chart", "score"],
      unavailableParts: [],
    },
    refresh: {
      active: true,
      staleParts: [],
      recoveringParts: ["price", "chart", "score"],
      nextPollMs: 1500,
    },
    capabilities: { canCompare: true, canTechnical: true },
    ...overrides,
  };
}

test("detail view returns degraded partial for identity-only display payload", () => {
  const view = stockDetailViewFromDisplayPayload(baseDisplayPayload());

  assert.equal(view.ok, true);
  assert.equal(view.mode, "partial");
  assert.equal(view.degradedReason, "identity_only");
  assert.equal(view.nextPollMs, 1500);
  assert.equal(view.identity.symbol, "VLD");
  assert.equal(view.parts.price.state, "refreshing");
  assert.equal(view.parts.chart.state, "refreshing");
  assert.equal(view.parts.score.state, "refreshing");
  assert.equal(view.sections.price, undefined);
});

test("detail view returns partial with visible price and chart sections", () => {
  const view = stockDetailViewFromDisplayPayload(baseDisplayPayload({
    price: {
      value: { latest_price: 12.34, latest_price_label: "$12.34" },
      freshness: "fresh",
      source: "market-data",
    },
    chart: {
      value: { chart_series: [{ date: "2026-06-11", close: 12 }, { date: "2026-06-12", close: 12.34 }] },
      freshness: "fresh",
      source: "market-data",
    },
    completion: {
      requiredParts: ["identity", "price", "chart", "score"],
      presentParts: ["identity", "price", "chart"],
      missingParts: ["score"],
      recoveringParts: ["score"],
      unavailableParts: [],
    },
    refresh: {
      active: true,
      staleParts: [],
      recoveringParts: ["score"],
      nextPollMs: 1500,
    },
  }));

  assert.equal(view.mode, "partial");
  assert.equal(view.degradedReason, undefined);
  assert.equal(view.sections.price?.latest_price, 12.34);
  assert.equal(Array.isArray(view.sections.chart?.chart_series), true);
  assert.equal(view.parts.price.state, "ready");
  assert.equal(view.parts.chart.state, "ready");
  assert.equal(view.parts.score.state, "refreshing");
});

test("detail view returns ready when no display parts are missing or recovering", () => {
  const view = stockDetailViewFromDisplayPayload(baseDisplayPayload({
    price: {
      value: { latest_price: 12.34 },
      freshness: "fresh",
      source: "market-data",
    },
    chart: {
      value: { chart_series: [{ date: "2026-06-11", close: 12 }, { date: "2026-06-12", close: 12.34 }] },
      freshness: "fresh",
      source: "market-data",
    },
    score: {
      value: { quality_score: 69, score: 69 },
      freshness: "fresh",
      source: "derived",
    },
    completion: {
      requiredParts: ["identity", "price", "chart", "score"],
      presentParts: ["identity", "price", "chart", "score"],
      missingParts: [],
      recoveringParts: [],
      unavailableParts: [],
    },
    refresh: {
      active: false,
      staleParts: [],
      recoveringParts: [],
    },
  }));

  assert.equal(view.mode, "ready");
  assert.equal(view.nextPollMs, undefined);
  assert.equal(view.parts.score.state, "ready");
  assert.equal(view.sections.score?.quality_score, 69);
});
