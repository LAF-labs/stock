import test from "node:test";
import assert from "node:assert/strict";

import { buildStockDisplayPayload } from "../src/lib/stockDisplayModel";

test("display model returns identity-only payload while recovering core parts", async () => {
  const payload = await buildStockDisplayPayload({
    ticker: "KR:005930",
    view: "detail",
    sources: {
      identity: async () => ({ ticker: "KR:005930", market: "KR", symbol: "005930", name: "삼성전자" }),
      price: async () => undefined,
      chart: async () => undefined,
      score: async () => undefined,
    },
  });

  assert.equal(payload.ok, true);
  assert.equal(payload.identity.value.name, "삼성전자");
  assert.deepEqual(payload.completion.presentParts, ["identity"]);
  assert.deepEqual(payload.completion.recoveringParts, ["price", "chart", "score"]);
  assert.equal(payload.refresh.active, true);
});

test("display model keeps provider timeouts recoverable instead of terminal", async () => {
  const payload = await buildStockDisplayPayload({
    ticker: "US:KO",
    view: "technical",
    sources: {
      identity: async () => ({ ticker: "US:KO", market: "US", symbol: "KO", name: "Coca-Cola" }),
      price: async () => ({ latest_price: 60, latest_price_label: "$60.00" }),
      chart: async () => {
        throw new Error("provider timeout");
      },
      score: async () => undefined,
    },
  });

  assert.equal(payload.ok, true);
  assert.equal(payload.price?.value.latest_price, 60);
  assert.deepEqual(payload.completion.unavailableParts, []);
  assert.deepEqual(payload.completion.recoveringParts, ["chart", "technical"]);
});

test("display model marks chart and technical present independently", async () => {
  const payload = await buildStockDisplayPayload({
    ticker: "US:KO",
    view: "technical",
    sources: {
      identity: async () => ({ ticker: "US:KO", market: "US", symbol: "KO", name: "Coca-Cola" }),
      price: async () => ({ latest_price: 60 }),
      chart: async () => ({ chart_series: [{ date: "2026-06-08", close: 59 }, { date: "2026-06-09", close: 60 }] }),
      score: async () => ({ technical_analysis: { type: "technical_analysis", signals: [{ label: "상승 추세" }] } }),
    },
  });

  assert.equal(payload.chart?.value.chart_series instanceof Array, true);
  assert.equal(payload.technical?.value.type, "technical_analysis");
  assert.deepEqual(payload.completion.missingParts, []);
  assert.equal(payload.refresh.active, false);
});
