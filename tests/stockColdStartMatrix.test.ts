import test from "node:test";
import assert from "node:assert/strict";

import {
  coldStartMatrixRequests,
  runStockColdStartMatrix,
  validateColdStartMatrixPayload,
} from "../scripts/verify_stock_cold_start_matrix.mjs";

test("cold start matrix covers stock and ETF tickers across display score and compare APIs", () => {
  const requests = coldStartMatrixRequests("https://stock.example", {
    tickers: ["US:FLNC", "US:SPY", "KR:489790", "KR:483240"],
  });

  assert.deepEqual(
    [...new Set(requests
      .filter((request: { feature: string }) => request.feature !== "score_batch_compare")
      .map((request: { ticker?: string }) => request.ticker)
      .filter(Boolean))],
    ["US:FLNC", "US:SPY", "KR:489790", "KR:483240"],
  );
  assert.equal(requests.some((request: { feature: string }) => request.feature === "detail_display"), true);
  assert.equal(requests.some((request: { feature: string }) => request.feature === "technical_display"), true);
  assert.equal(requests.some((request: { feature: string }) => request.feature === "compare_display"), true);
  assert.equal(requests.some((request: { feature: string }) => request.feature === "score_batch_compare"), true);
});

test("cold start matrix rejects enrichment-only skeleton recovery in display payloads", () => {
  const errors = validateColdStartMatrixPayload(
    {
      ok: true,
      ticker: "US:FLNC",
      identity: { value: { ticker: "US:FLNC", market: "US", symbol: "FLNC", name: "Fluence Energy" } },
      completion: {
        requiredParts: ["identity", "price", "chart", "score"],
        presentParts: ["identity", "price", "chart", "score"],
        missingParts: ["fundamentals"],
        recoveringParts: ["fundamentals", "industryBenchmark"],
        unavailableParts: [],
      },
      refresh: { active: true, staleParts: [], recoveringParts: ["fundamentals", "industryBenchmark"] },
      score: {
        value: {
          score: 47,
          quality_score: 47,
          fetch: { pending_enrichment: true },
          financials: { source: "pending_enrichment" },
        },
      },
    },
    { feature: "detail_display", ticker: "US:FLNC", url: "https://stock.example/api/stock/display" },
  );

  assert.equal(errors.some((error: string) => error.includes("enrichment-only")), true);
});

test("cold start matrix accepts visible fast-path display payloads without financial recovery", () => {
  const errors = validateColdStartMatrixPayload(
    {
      ok: true,
      ticker: "US:FLNC",
      identity: { value: { ticker: "US:FLNC", market: "US", symbol: "FLNC", name: "Fluence Energy" } },
      completion: {
        requiredParts: ["identity", "price", "chart", "score"],
        presentParts: ["identity", "price", "chart", "score"],
        missingParts: [],
        recoveringParts: [],
        unavailableParts: [],
      },
      refresh: { active: false, staleParts: [], recoveringParts: [] },
      score: {
        value: {
          score: 47,
          quality_score: 47,
          fetch: { pending_enrichment: true },
          financials: { source: "pending_enrichment" },
        },
      },
    },
    { feature: "detail_display", ticker: "US:FLNC", url: "https://stock.example/api/stock/display" },
  );

  assert.deepEqual(errors, []);
});

test("cold start matrix rejects recovering required display parts", () => {
  const errors = validateColdStartMatrixPayload(
    {
      ok: true,
      ticker: "US:AEHR",
      identity: { value: { ticker: "US:AEHR", market: "US", symbol: "AEHR", name: "Aehr Test Systems" } },
      completion: {
        requiredParts: ["identity", "price", "chart", "score"],
        presentParts: ["identity", "price", "score"],
        missingParts: ["chart"],
        recoveringParts: ["chart"],
        unavailableParts: [],
      },
      refresh: { active: true, staleParts: [], recoveringParts: ["chart"] },
      score: { value: { score: 55, quality_score: 55 } },
    },
    { feature: "compare_display", ticker: "US:AEHR", url: "https://stock.example/api/stock/display" },
  );

  assert.equal(errors.some((error: string) => error.includes("required display part")), true);
});

test("cold start matrix accepts explicit technical unsupported responses for ETFs only", () => {
  assert.deepEqual(
    validateColdStartMatrixPayload(
      { ok: false, error: "technical_unsupported_product", ticker: "US:SPY" },
      { feature: "score_technical", ticker: "US:SPY", url: "https://stock.example/api/score" },
    ),
    [],
  );

  const stockErrors = validateColdStartMatrixPayload(
    { ok: false, error: "technical_unsupported_product", ticker: "US:FLNC" },
    { feature: "score_technical", ticker: "US:FLNC", url: "https://stock.example/api/score" },
  );
  assert.equal(stockErrors.some((error: string) => error.includes("technical_unsupported_product")), true);
});

test("cold start matrix report treats expected ETF technical unsupported as pass", async () => {
  const fetchStub: typeof fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);

    if (url.includes("view=technical") && url.includes("/api/score?")) {
      return Response.json({ ok: false, error: "technical_unsupported_product", ticker: "US:SPY" }, { status: 400 });
    }
    if (url.includes("/api/stock/display")) {
      return Response.json({
        ok: true,
        ticker: "US:SPY",
        identity: { value: { ticker: "US:SPY", market: "US", symbol: "SPY", name: "SPY" } },
        completion: {
          requiredParts: url.includes("view=technical") ? ["identity", "price", "chart", "technical"] : ["identity", "price", "chart", "score"],
          presentParts: url.includes("view=technical") ? ["identity", "price", "chart", "technical"] : ["identity", "price", "chart", "score"],
          missingParts: [],
          recoveringParts: [],
          unavailableParts: [],
        },
        refresh: { active: false, staleParts: [], recoveringParts: [] },
      });
    }
    if (url.includes("/api/stock/detail-view")) {
      return Response.json({ ok: true, mode: "ready", ticker: "US:SPY" });
    }
    if (url.includes("/api/score/batch")) {
      return Response.json({ ok: true, results: [{ ok: true, ticker: "US:SPY" }] });
    }
    return Response.json({ ok: true, score: 50, quality_score: 50 });
  };

  const report = await runStockColdStartMatrix(
    { baseUrl: "https://stock.example", tickers: ["US:SPY"] },
    fetchStub,
  );

  assert.equal(report.ok, true);
});
