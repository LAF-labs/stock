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
  opportunity_components: [],
  sia_snapshot: {
    score_model_version: SCORE_MODEL_VERSION,
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
