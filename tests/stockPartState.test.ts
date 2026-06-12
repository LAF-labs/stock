import test from "node:test";
import assert from "node:assert/strict";

import {
  degradedPart,
  partIsVisible,
  partValue,
  readyPart,
  refreshingPart,
  staleReadyPart,
  unavailablePart,
} from "../src/lib/stockPartState";

test("ready and stale-ready parts expose provider values", () => {
  const ready = readyPart({ latest_price: 10 }, "supabase", "2026-06-12T00:00:00.000Z");
  const stale = staleReadyPart({ latest_price: 9 }, "supabase", "2026-06-11T00:00:00.000Z");

  assert.equal(ready.state, "ready");
  assert.equal(stale.state, "stale_ready");
  assert.deepEqual(partValue(ready), { latest_price: 10 });
  assert.deepEqual(partValue(stale), { latest_price: 9 });
  assert.equal(partIsVisible(ready), true);
  assert.equal(partIsVisible(stale), true);
});

test("refreshing and unavailable parts never expose fake values", () => {
  const refreshing = refreshingPart("snapshot_miss");
  const unavailable = unavailablePart("not_reported");

  assert.equal(partValue(refreshing), undefined);
  assert.equal(partValue(unavailable), undefined);
  assert.equal(partIsVisible(refreshing), false);
  assert.equal(partIsVisible(unavailable), false);
});

test("degraded fast-path parts are visible while preserving their confidence reason", () => {
  const degraded = degradedPart(
    { score: 47, quality_score: 47 },
    "market-data",
    "price_fast_path",
    "2026-06-12T00:00:00.000Z",
  );

  assert.equal(degraded.state, "degraded");
  assert.equal(degraded.reason, "price_fast_path");
  assert.deepEqual(partValue(degraded), { score: 47, quality_score: 47 });
  assert.equal(partIsVisible(degraded), true);
});
