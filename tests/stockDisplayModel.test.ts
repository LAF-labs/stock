import test from "node:test";
import assert from "node:assert/strict";

import { buildStockDisplayPayload, displayLaneTimeoutMs } from "../src/lib/stockDisplayModel";

test("display model default lane deadlines stay under the first-paint budget", () => {
  assert.equal(displayLaneTimeoutMs("price"), 900);
  assert.equal(displayLaneTimeoutMs("chart"), 1_000);
  assert.equal(displayLaneTimeoutMs("score"), 1_200);
});

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

test("display model normalizes legacy app names in score payloads", async () => {
  const payload = await buildStockDisplayPayload({
    ticker: "KR:005930",
    view: "detail",
    sources: {
      identity: async () => ({ ticker: "KR:005930", market: "KR", symbol: "005930", name: "삼성전자" }),
      price: async () => ({ latest_price: 70000 }),
      chart: async () => ({ chart_series: [{ date: "2026-06-09", close: 69000 }, { date: "2026-06-10", close: 70000 }] }),
      score: async () => ({ app: "Stock Score Reader", score: 70, quality_score: 70 }),
    },
  });

  assert.equal(payload.score?.value.app, "스톡스토커");
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

test("display model keeps fast-path score visible while recovering fundamentals and industry benchmarks", async () => {
  const payload = await buildStockDisplayPayload({
    ticker: "US:GMAB",
    view: "detail",
    sources: {
      identity: async () => ({ ticker: "US:GMAB", market: "US", symbol: "GMAB", name: "젠맵(ADR)" }),
      price: async () => ({ latest_price: 24.97, market_cap: 16_600_000_000, currency: "USD" }),
      chart: async () => ({ chart_series: [{ date: "2026-06-09", close: 25.1 }, { date: "2026-06-10", close: 24.97 }] }),
      score: async () => ({
        ok: true,
        score_model_version: "score-v5-dual-quality-opportunity-2026-06-05",
        score: 47,
        quality_score: 47,
        chart_series: [{ date: "2026-06-09", close: 25.1 }, { date: "2026-06-10", close: 24.97 }],
        key_metrics: [{ label: "현재가", value: "$24.97" }],
        valuation_rows: [{ label: "현재가", value: "$24.97" }],
        fetch: { pending_enrichment: true, detail_fast_path: true },
        financials: { source: "pending_enrichment", detail_fast_path: true },
      }),
    },
  });

  assert.equal(payload.score?.value.quality_score, 47);
  assert.deepEqual(payload.completion.presentParts, ["identity", "price", "chart", "score"]);
  assert.deepEqual(payload.completion.missingParts, ["fundamentals", "industryBenchmark"]);
  assert.deepEqual(payload.completion.recoveringParts, ["fundamentals", "industryBenchmark"]);
  assert.equal(payload.refresh.active, true);
});

test("display model starts price chart and score lanes without waiting for slow identity", async () => {
  const started: string[] = [];
  let releaseIdentity: (() => void) | undefined;
  const identityReady = new Promise<void>((resolve) => {
    releaseIdentity = resolve;
  });

  const payloadPromise = buildStockDisplayPayload({
    ticker: "US:LANES",
    view: "detail",
    sources: {
      identity: async () => {
        await identityReady;
        return { ticker: "US:LANES", market: "US", symbol: "LANES", name: "Lane Test" };
      },
      price: async () => {
        started.push("price");
        return { latest_price: 10 };
      },
      chart: async () => {
        started.push("chart");
        return { chart_series: [{ date: "2026-06-09", close: 9 }, { date: "2026-06-10", close: 10 }] };
      },
      score: async () => {
        started.push("score");
        return { score: 51, quality_score: 51 };
      },
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(started.sort(), ["chart", "price", "score"]);

  releaseIdentity?.();
  const payload = await payloadPromise;
  assert.equal(payload.identity.value.name, "Lane Test");
  assert.equal(payload.price?.value.latest_price, 10);
});
