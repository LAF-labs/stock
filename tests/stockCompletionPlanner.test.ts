import test from "node:test";
import assert from "node:assert/strict";

import {
  planStockDisplayCompletion,
  planCompareDisplayCompletion,
  stockCompletionRefreshInput,
} from "../src/lib/stockCompletionPlanner";

test("detail identity-only display still owes price, chart, and score recovery", () => {
  const plan = planStockDisplayCompletion({
    ticker: "KR:005930",
    view: "detail",
    presentParts: ["identity"],
  });

  assert.deepEqual(plan.requiredParts, ["identity", "price", "chart", "score"]);
  assert.deepEqual(plan.missingParts, ["price", "chart", "score"]);
  assert.deepEqual(
    plan.actions.map((action) => action.kind),
    ["fetch_quote", "fetch_chart", "refresh_score"],
  );
  assert.equal(plan.actions[0].ticker, "KR:005930");
});

test("technical display recovers chart before technical analysis", () => {
  const plan = planStockDisplayCompletion({
    ticker: "US:KO",
    view: "technical",
    presentParts: ["identity", "price"],
  });

  assert.deepEqual(plan.requiredParts, ["identity", "price", "chart", "technical"]);
  assert.deepEqual(plan.missingParts, ["chart", "technical"]);
  assert.deepEqual(
    plan.actions.map((action) => action.kind),
    ["fetch_chart", "refresh_technical"],
  );
  assert.equal(plan.actions[0].priority < plan.actions[1].priority, true);
});

test("provider timeout does not make a core part unavailable", () => {
  const plan = planStockDisplayCompletion({
    ticker: "US:TIMEOUT",
    view: "detail",
    presentParts: ["identity", "price"],
    providerTimedOutParts: ["chart"],
  });

  assert.deepEqual(plan.missingParts, ["chart", "score"]);
  assert.deepEqual(plan.unavailableParts, []);
  assert.deepEqual(plan.recoveringParts, ["chart", "score"]);
});

test("compare completion dedupes repeated tickers and keeps per-ticker actions bounded", () => {
  const plans = planCompareDisplayCompletion([
    { ticker: "US:KO", presentParts: ["identity"] },
    { ticker: "US:KO", presentParts: ["identity"] },
    { ticker: "KR:005930", presentParts: ["identity", "price"] },
  ]);

  assert.equal(plans.length, 2);
  assert.deepEqual(plans.map((plan) => plan.ticker), ["US:KO", "KR:005930"]);
  assert.deepEqual(plans[0].actions.map((action) => action.kind), ["fetch_quote", "fetch_chart", "refresh_score"]);
  assert.deepEqual(plans[1].actions.map((action) => action.kind), ["fetch_chart", "refresh_score"]);
});

test("completion actions map to refresh queue inputs without user-facing pending state", () => {
  const plan = planStockDisplayCompletion({
    ticker: "US:KO",
    view: "technical",
    presentParts: ["identity", "price"],
  });

  assert.deepEqual(plan.actions.map(stockCompletionRefreshInput), [
    { kind: "chart", ticker: "US:KO", priority: 15, reason: "snapshot_miss" },
    { kind: "score", ticker: "US:KO", view: "technical", priority: 20, reason: "snapshot_miss" },
  ]);
});
