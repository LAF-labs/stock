import test from "node:test";
import assert from "node:assert/strict";

import { stockDisplayPayloadIsComplete, stockScoreDataFromDisplayPayload } from "../src/components/stockDisplayAdapters";
import type { StockDisplayPayload } from "../src/lib/stockDisplayTypes";

test("display payload adapter promotes identity, price, chart, and score without pending copy", () => {
  const adapted = stockScoreDataFromDisplayPayload(displayPayload({
    price: { latest_price: 187400, latest_price_label: "187,400원", currency: "KRW", market_cap: 3_100_000_000_000 },
    chart: { chart_series: [{ date: "2026-06-09", close: 180000 }, { date: "2026-06-10", close: 187400 }] },
    score: { score: 72, quality_score: 72, components: [{ key: "momentum", label: "가격 흐름", score: 72 }] },
  }));

  assert.equal(adapted.requested_ticker, "KR:005930");
  assert.equal(adapted.name, "삼성전자");
  assert.equal(adapted.latest_price, 187400);
  assert.equal(adapted.market_cap, 3_100_000_000_000);
  assert.equal(adapted.chart_series?.length, 2);
  assert.equal(adapted.quality_score, 72);
  assert.equal(JSON.stringify(adapted).includes("snapshot_pending"), false);
  assert.equal(JSON.stringify(adapted).includes("브라우저 캐시"), false);
});

test("display payload adapter keeps identity usable when other parts are still recovering", () => {
  const payload = displayPayload({});
  const adapted = stockScoreDataFromDisplayPayload(payload);

  assert.equal(adapted.requested_ticker, "KR:005930");
  assert.equal(adapted.symbol, "005930");
  assert.equal(adapted.name, "삼성전자");
  assert.equal(adapted.server_cache?.state, "recovering");
  assert.equal(stockDisplayPayloadIsComplete(payload), false);
});

test("display payload adapter merges financial sections without duplicate valuation rows", () => {
  const adapted = stockScoreDataFromDisplayPayload(displayPayload({
    score: { score: 72, quality_score: 72 },
    fundamentals: {
      key_metrics: [{ label: "시가총액", value: "1조원" }],
      valuation_rows: [
        { label: "Forward PER", value: "21.4" },
        { label: "업종 평균 PER", value: "24.0" },
      ],
    },
    industryBenchmark: {
      industry_benchmarks: [{ metric: "per", value: 24 }],
      valuation_rows: [{ label: "업종 평균 PER", value: "24.0" }],
    },
  }));

  assert.deepEqual(adapted.valuation_rows?.map((row) => row.label), ["Forward PER", "업종 평균 PER"]);
  assert.equal((adapted.industry_benchmarks as unknown[] | undefined)?.length, 1);
});

test("display payload adapter merges score price metrics behind live price metrics", () => {
  const adapted = stockScoreDataFromDisplayPayload(displayPayload({
    price: { price_metrics: { latest_change: 0.012 } },
    chart: { price_metrics: { avg_volume_60: 100_000 } },
    score: { price_metrics: { rsi14: 63.2, sma50: 142.1, latest_change: 0.01 } },
  }));

  assert.deepEqual(adapted.price_metrics, {
    rsi14: 63.2,
    sma50: 142.1,
    avg_volume_60: 100_000,
    latest_change: 0.012,
  });
});

test("display payload completeness separates full data from recoverable partials", () => {
  assert.equal(stockDisplayPayloadIsComplete(displayPayload({
    price: { latest_price: 187400 },
    chart: { chart_series: [{ date: "2026-06-09", close: 180000 }, { date: "2026-06-10", close: 187400 }] },
    score: { score: 72, quality_score: 72 },
  })), true);
  assert.equal(stockDisplayPayloadIsComplete(displayPayload({})), false);
});

function displayPayload(parts: {
  price?: Record<string, unknown>;
  chart?: Record<string, unknown>;
  score?: Record<string, unknown>;
  fundamentals?: Record<string, unknown>;
  industryBenchmark?: Record<string, unknown>;
  news?: Record<string, unknown>;
}): StockDisplayPayload {
  return {
    ok: true,
    ticker: "KR:005930",
    requestedTicker: "KR:005930",
    view: "detail",
    generatedAt: "2026-06-10T00:00:00.000Z",
    snapshotVersion: "display-v1",
    hotnessTier: "active",
    identity: {
      value: { ticker: "KR:005930", market: "KR", symbol: "005930", name: "삼성전자" },
      freshness: "fresh",
      source: "symbol-master",
    },
    ...(parts.price ? { price: { value: parts.price, freshness: "fresh", source: "market-data" as const } } : {}),
    ...(parts.chart ? { chart: { value: parts.chart, freshness: "fresh", source: "market-data" as const } } : {}),
    ...(parts.score ? { score: { value: parts.score, freshness: "fresh", source: "derived" as const } } : {}),
    ...(parts.fundamentals ? { fundamentals: { value: parts.fundamentals, freshness: "fresh", source: "derived" as const } } : {}),
    ...(parts.industryBenchmark ? { industryBenchmark: { value: parts.industryBenchmark, freshness: "fresh", source: "derived" as const } } : {}),
    ...(parts.news ? { news: { value: parts.news, freshness: "fresh", source: "derived" as const } } : {}),
    completion: {
      requiredParts: ["identity", "price", "chart", "score"],
      presentParts: ["identity", ...Object.keys(parts)] as StockDisplayPayload["completion"]["presentParts"],
      missingParts: [],
      recoveringParts: Object.keys(parts).length ? [] : ["price", "chart", "score"],
      unavailableParts: [],
    },
    refresh: {
      active: Object.keys(parts).length === 0,
      staleParts: [],
      recoveringParts: Object.keys(parts).length ? [] : ["price", "chart", "score"],
    },
    capabilities: {
      canCompare: true,
      canTechnical: true,
      technicalHref: "/technical?ticker=KR%3A005930",
    },
  };
}
