import test from "node:test";
import assert from "node:assert/strict";

import { SCORE_MODEL_VERSION } from "../src/lib/scoreModel";
import { isCurrentScorePayload } from "../src/lib/stockSnapshotCache";

const currentDualScorePayload = {
  ok: true,
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

test("score cache accepts only the current score model version", () => {
  assert.equal(isCurrentScorePayload(currentDualScorePayload), true);
  assert.equal(
    isCurrentScorePayload({
      ...currentDualScorePayload,
      score_model_version: undefined,
      sia_snapshot: { ...currentDualScorePayload.sia_snapshot, score_model_version: SCORE_MODEL_VERSION },
    }),
    true
  );
  assert.equal(isCurrentScorePayload({ ok: true, score_model_version: "legacy-yfinance-score-v1" }), false);
  assert.equal(isCurrentScorePayload({ ok: true, score: 72.4 }), false);
});

test("current score payload must include the dual score contract", () => {
  assert.equal(isCurrentScorePayload(currentDualScorePayload), true);
  assert.equal(
    isCurrentScorePayload({
      ok: true,
      score_model_version: SCORE_MODEL_VERSION,
      score: 72.4,
      sia_snapshot: { score_model_version: SCORE_MODEL_VERSION },
    }),
    false
  );
});

test("current score payload rejects stale nested versions and malformed confidence", () => {
  assert.equal(
    isCurrentScorePayload({
      ...currentDualScorePayload,
      sia_snapshot: {
        ...currentDualScorePayload.sia_snapshot,
        score_model_version: "old-model",
      },
    }),
    false
  );
  assert.equal(
    isCurrentScorePayload({
      ...currentDualScorePayload,
      opportunity_confidence: 1.4,
    }),
    false
  );
  assert.equal(
    isCurrentScorePayload({
      ...currentDualScorePayload,
      sia_snapshot: {
        ...currentDualScorePayload.sia_snapshot,
        confidence: Number.NaN,
      },
    }),
    false
  );
});

test("current score payload requires component key coverage", () => {
  assert.equal(
    isCurrentScorePayload({
      ...currentDualScorePayload,
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
      sia_snapshot: { ...currentDualScorePayload.sia_snapshot, confidence: 0.82 },
    }),
    true
  );
  assert.equal(
    isCurrentScorePayload({
      ...currentDualScorePayload,
      components: [{ key: "profitability" }],
    }),
    false
  );
});

test("current score payload requires usable component labels and scores", () => {
  assert.equal(
    isCurrentScorePayload({
      ...currentDualScorePayload,
      components: currentDualScorePayload.components.map(({ key }) => ({ key })),
    }),
    false
  );
  assert.equal(
    isCurrentScorePayload({
      ...currentDualScorePayload,
      components: currentDualScorePayload.components.map((component) =>
        component.key === "growth" ? { ...component, score: Number.NaN } : component
      ),
    }),
    false
  );
  assert.equal(
    isCurrentScorePayload({
      ...currentDualScorePayload,
      opportunity_components: currentDualScorePayload.opportunity_components.map((component) =>
        component.key === "opportunity_risk" ? { ...component, label: "" } : component
      ),
    }),
    false
  );
});
