import test from "node:test";
import assert from "node:assert/strict";

import {
  readMemoryDisplaySnapshot,
  writeMemoryDisplaySnapshot,
  stockDisplaySnapshotStoreTestHooks,
} from "../src/lib/stockDisplaySnapshotStore";

test.afterEach(() => {
  stockDisplaySnapshotStoreTestHooks.resetMemory();
});

test("display snapshot store reads and writes product-shaped snapshots from memory", () => {
  writeMemoryDisplaySnapshot({
    ticker: "KR:005930",
    view: "detail",
    snapshotVersion: "v1",
    generatedAt: "2026-06-10T00:00:00.000Z",
    hotnessTier: "active",
    parts: {
      identity: {
        value: { ticker: "KR:005930", name: "삼성전자", market: "KR", symbol: "005930" },
        freshness: "fresh",
        source: "symbol-master",
      },
    },
    completion: {
      requiredParts: ["identity", "price", "chart", "score"],
      presentParts: ["identity"],
      missingParts: ["price", "chart", "score"],
      recoveringParts: ["price", "chart", "score"],
      unavailableParts: [],
    },
  });

  const snapshot = readMemoryDisplaySnapshot("KR:005930", "detail");

  assert.equal(snapshot?.ticker, "KR:005930");
  assert.equal(snapshot?.parts.identity?.value.name, "삼성전자");
  assert.deepEqual(snapshot?.completion.recoveringParts, ["price", "chart", "score"]);
});
