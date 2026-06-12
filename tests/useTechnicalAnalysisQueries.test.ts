import test from "node:test";
import assert from "node:assert/strict";

import { technicalDisplayTerminalUnavailable, technicalStateFromQuery } from "../src/components/useTechnicalAnalysisQueries";
import type { StockDisplayPayload } from "../src/lib/stockDisplayTypes";
import type { StockScoreResponse } from "../src/lib/types";

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

test("terminal insufficient history keeps technical ready payload in partial unavailable mode", () => {
  const data = {
    requested_ticker: "US:SPCX",
    symbol: "SPCX",
    market: "US",
    name: "SpaceX",
    latest_price: 135,
    chart_series: [{ date: "2026-06-11", close: 135 }],
    technical_analysis: {
      type: "technical_analysis",
      status: "limited",
      summary: { headline: "데이터가 부족해요" },
    },
  } as unknown as StockScoreResponse;

  const state = technicalStateFromQuery(
    "US:SPCX",
    { state: "ready", status: 200, data, payload: data },
    undefined,
    false,
    undefined,
    data,
    true,
  );

  assert.equal(state.status, "partial");
  assert.equal(state.ticker, "US:SPCX");
  assert.equal(state.terminalUnavailable, true);
  assert.equal(state.pending, undefined);
});
