import test from "node:test";
import assert from "node:assert/strict";

import { planSelectivePrewarm } from "../src/lib/stockPrewarmPlanner";

test("search prewarm caps candidates and reads snapshots before provider work", () => {
  const plan = planSelectivePrewarm({
    reason: "search_candidates",
    tickers: ["US:KO", "US:NVDA", "US:AAPL", "US:MSFT", "US:TSLA", "US:META"],
    maxProviderCandidates: 3,
  });

  assert.deepEqual(plan.snapshotReads.map((item) => item.ticker), ["US:KO", "US:NVDA", "US:AAPL"]);
  assert.deepEqual(plan.providerCandidates.map((item) => item.ticker), ["US:KO", "US:NVDA", "US:AAPL"]);
  assert.equal(plan.droppedTickers.length, 3);
});

test("long-tail prewarm does not fan out provider work", () => {
  const plan = planSelectivePrewarm({
    reason: "long_tail",
    tickers: ["US:UNKNOWN1", "US:UNKNOWN2"],
  });

  assert.deepEqual(plan.snapshotReads.map((item) => item.ticker), ["US:UNKNOWN1", "US:UNKNOWN2"]);
  assert.deepEqual(plan.providerCandidates, []);
});
