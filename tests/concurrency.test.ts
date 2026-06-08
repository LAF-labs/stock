import test from "node:test";
import assert from "node:assert/strict";

import { mapWithConcurrency } from "../src/lib/concurrency";

test("mapWithConcurrency preserves result order while limiting active work", async () => {
  let active = 0;
  let maxActive = 0;

  const result = await mapWithConcurrency([1, 2, 3, 4], 2, async (value) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return value * 10;
  });

  assert.deepEqual(result, [10, 20, 30, 40]);
  assert.equal(maxActive, 2);
});
