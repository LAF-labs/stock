import test from "node:test";
import assert from "node:assert/strict";

import { technicalDisplayTerminalUnavailable } from "../src/components/useTechnicalAnalysisQueries";
import type { StockDisplayPayload } from "../src/lib/stockDisplayTypes";

test("technical display terminal unavailable is derived from completion instead of missing chart data alone", () => {
  const payload = {
    ok: true,
    ticker: "US:VLD",
    requestedTicker: "US:VLD",
    view: "technical",
    generatedAt: "2026-06-12T00:00:00.000Z",
    snapshotVersion: "test",
    hotnessTier: "long_tail",
    identity: { value: { ticker: "US:VLD", market: "US", symbol: "VLD", name: "VLD" }, freshness: "fresh", source: "symbol-master" },
    completion: {
      requiredParts: ["identity", "price", "chart", "technical"],
      presentParts: ["identity"],
      missingParts: [],
      recoveringParts: [],
      unavailableParts: [
        { part: "chart", reason: "provider_confirmed_empty" },
        { part: "technical", reason: "provider_confirmed_empty" },
      ],
    },
    refresh: { active: false, staleParts: [], recoveringParts: [] },
    capabilities: { canCompare: true, canTechnical: true },
  } satisfies StockDisplayPayload;

  assert.equal(technicalDisplayTerminalUnavailable(payload), true);
  assert.equal(technicalDisplayTerminalUnavailable({ ...payload, completion: { ...payload.completion, recoveringParts: ["chart"] } }), false);
});
