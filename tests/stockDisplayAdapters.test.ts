import test from "node:test";
import assert from "node:assert/strict";

import { stockScoreDataFromDisplayPayload } from "../src/components/stockDisplayAdapters";
import type { StockDisplayPayload } from "../src/lib/stockDisplayTypes";

test("display payload adapter promotes identity, price, chart, and score without pending copy", () => {
  const adapted = stockScoreDataFromDisplayPayload(displayPayload({
    price: { latest_price: 187400, latest_price_label: "187,400원", currency: "KRW" },
    chart: { chart_series: [{ date: "2026-06-09", close: 180000 }, { date: "2026-06-10", close: 187400 }] },
    score: { score: 72, quality_score: 72, components: [{ key: "momentum", label: "가격 흐름", score: 72 }] },
  }));

  assert.equal(adapted.requested_ticker, "KR:005930");
  assert.equal(adapted.name, "삼성전자");
  assert.equal(adapted.latest_price, 187400);
  assert.equal(adapted.chart_series?.length, 2);
  assert.equal(adapted.quality_score, 72);
  assert.equal(JSON.stringify(adapted).includes("snapshot_pending"), false);
  assert.equal(JSON.stringify(adapted).includes("브라우저 캐시"), false);
});

test("display payload adapter keeps identity usable when other parts are still recovering", () => {
  const adapted = stockScoreDataFromDisplayPayload(displayPayload({}));

  assert.equal(adapted.requested_ticker, "KR:005930");
  assert.equal(adapted.symbol, "005930");
  assert.equal(adapted.name, "삼성전자");
  assert.equal(adapted.server_cache?.state, "recovering");
});

function displayPayload(parts: {
  price?: Record<string, unknown>;
  chart?: Record<string, unknown>;
  score?: Record<string, unknown>;
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
