import test from "node:test";
import assert from "node:assert/strict";

import { acquireStockProviderBudget, stockProviderBudgetTestHooks } from "../src/lib/stockProviderBudget";

test.afterEach(() => {
  stockProviderBudgetTestHooks.resetMemory();
});

test("provider budget blocks calls after the configured token bucket is exhausted", async () => {
  const input = {
    provider: "kis" as const,
    market: "KR" as const,
    endpointKind: "quote" as const,
    credentialKey: "test-key",
    limit: 2,
    windowSeconds: 60,
  };

  assert.equal((await acquireStockProviderBudget(input)).allowed, true);
  assert.equal((await acquireStockProviderBudget(input)).allowed, true);

  const third = await acquireStockProviderBudget(input);
  assert.equal(third.allowed, false);
  assert.equal(third.limit, 2);
});

test("provider budget is isolated by endpoint kind and market", async () => {
  const base = {
    provider: "kis" as const,
    credentialKey: "test-key",
    limit: 1,
    windowSeconds: 60,
  };

  assert.equal((await acquireStockProviderBudget({ ...base, market: "KR", endpointKind: "quote" })).allowed, true);
  assert.equal((await acquireStockProviderBudget({ ...base, market: "KR", endpointKind: "quote" })).allowed, false);
  assert.equal((await acquireStockProviderBudget({ ...base, market: "KR", endpointKind: "chart" })).allowed, true);
  assert.equal((await acquireStockProviderBudget({ ...base, market: "US", endpointKind: "quote" })).allowed, true);
});
