import test from "node:test";
import assert from "node:assert/strict";

import { SCORE_MODEL_VERSION } from "../src/lib/scoreModel";
import { readStockScoreSnapshotForDisplay } from "../src/lib/stockScoreSnapshotReader";
import { stockScoreCacheKey, type StoredScoreSnapshot } from "../src/lib/stockScoreContract";

const payload = {
  ok: true,
  requested_ticker: "KR:005930",
  market: "KR",
  symbol: "005930",
  name: "삼성전자",
  score_model_version: SCORE_MODEL_VERSION,
  score: 72.4,
  quality_score: 72.4,
  opportunity_score: 61.8,
  opportunity_confidence: 0.72,
  components: [
    { key: "profitability", label: "Profitability", score: 82.1 },
    { key: "growth", label: "Growth", score: 74.2 },
    { key: "health", label: "Health", score: 68.5 },
    { key: "momentum", label: "Momentum", score: 63.4 },
    { key: "valuation", label: "Valuation", score: 55.6 },
  ],
  opportunity_components: [
    { key: "opportunity_momentum", label: "Momentum setup", score: 66.1 },
    { key: "opportunity_growth", label: "Growth setup", score: 70.2 },
    { key: "opportunity_analyst", label: "Analyst upside", score: 58.3 },
    { key: "opportunity_liquidity", label: "Liquidity", score: 76.4 },
    { key: "opportunity_risk", label: "Risk control", score: 49.5 },
  ],
  sia_snapshot: {
    score_model_version: SCORE_MODEL_VERSION,
    confidence: 0.82,
    quality_score: 0.724,
    opportunity_score: 0.618,
  },
};

test("display score snapshot reader serves current memory snapshots without score generation", async () => {
  const memory = (globalThis.__stockScoreMemoryCache ??= new Map<string, StoredScoreSnapshot>());
  memory.clear();
  const fetchedAt = new Date().toISOString();
  memory.set(stockScoreCacheKey("KR:005930", "detail"), {
    ticker: "KR:005930",
    view: "detail",
    payload,
    fetchedAt,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });

  const result = await readStockScoreSnapshotForDisplay("005930", "detail");

  assert.equal(result?.payload.name, "삼성전자");
  assert.equal(result?.cache.state, "fresh");
  assert.equal(result?.cache.source, "memory");
  assert.equal((result?.payload.server_cache as Record<string, unknown>).refresh_started, undefined);
});

test("display score snapshot reader ignores expired snapshots instead of blocking", async () => {
  const memory = (globalThis.__stockScoreMemoryCache ??= new Map<string, StoredScoreSnapshot>());
  memory.clear();
  memory.set(stockScoreCacheKey("KR:005930", "detail"), {
    ticker: "KR:005930",
    view: "detail",
    payload,
    fetchedAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
    expiresAt: new Date(Date.now() - 44 * 24 * 60 * 60 * 1000).toISOString(),
  });

  const result = await readStockScoreSnapshotForDisplay("005930", "detail");

  assert.equal(result, undefined);
});
