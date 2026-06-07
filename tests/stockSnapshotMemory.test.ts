import test from "node:test";
import assert from "node:assert/strict";

import { stockSnapshotCacheTestHooks } from "../src/lib/stockSnapshotCache";

const originalMaxBytes = process.env.STOCK_SCORE_MEMORY_CACHE_MAX_PAYLOAD_BYTES;

test.afterEach(() => {
  if (originalMaxBytes === undefined) {
    delete process.env.STOCK_SCORE_MEMORY_CACHE_MAX_PAYLOAD_BYTES;
  } else {
    process.env.STOCK_SCORE_MEMORY_CACHE_MAX_PAYLOAD_BYTES = originalMaxBytes;
  }
});

test("score memory cache skips payloads over the configured byte budget", () => {
  process.env.STOCK_SCORE_MEMORY_CACHE_MAX_PAYLOAD_BYTES = "120";
  const baseSnapshot = {
    ticker: "US:KO",
    view: "detail" as const,
    fetchedAt: "2026-06-07T00:00:00.000Z",
    expiresAt: "2026-06-07T01:00:00.000Z",
  };

  assert.equal(stockSnapshotCacheTestHooks.shouldRememberSnapshot({ ...baseSnapshot, payload: { ok: true, score: 70 } }), true);
  assert.equal(
    stockSnapshotCacheTestHooks.shouldRememberSnapshot({
      ...baseSnapshot,
      payload: { ok: true, score: 70, chart_series: Array.from({ length: 30 }, (_, index) => ({ date: `2026-01-${String(index + 1).padStart(2, "0")}`, close: 100 + index })) },
    }),
    false
  );
});
