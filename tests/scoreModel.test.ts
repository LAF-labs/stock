import test from "node:test";
import assert from "node:assert/strict";

import { SCORE_MODEL_VERSION } from "../src/lib/scoreModel";
import { isCurrentScorePayload } from "../src/lib/stockSnapshotCache";

test("score cache accepts only the current score model version", () => {
  assert.equal(isCurrentScorePayload({ ok: true, score_model_version: SCORE_MODEL_VERSION }), true);
  assert.equal(isCurrentScorePayload({ ok: true, sia_snapshot: { score_model_version: SCORE_MODEL_VERSION } }), true);
  assert.equal(isCurrentScorePayload({ ok: true, score_model_version: "legacy-yfinance-score-v1" }), false);
  assert.equal(isCurrentScorePayload({ ok: true, score: 72.4 }), false);
});
