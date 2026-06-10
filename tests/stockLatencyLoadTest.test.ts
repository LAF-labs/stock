import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyStockLatencyPayload,
  providerGuardViolations,
  runStockLatencyLoadTest,
  scenarioRequests,
} from "../scripts/load_test_stock_latency.mjs";

test("stock latency load test builds hot cold and compare scenarios", () => {
  const requests = scenarioRequests("https://stock.example", {
    hotTicker: "US:KO",
    coldTicker: "US:POET",
    compareTickers: ["US:KO", "US:POET"],
  });

  assert.deepEqual(
    requests.map((request: { name: string }) => request.name),
    ["hot_detail", "cold_detail", "hot_technical", "cold_technical", "mixed_compare"]
  );
  assert.equal(requests[0].url, "https://stock.example/api/score?ticker=US%3AKO&partial=1");
  assert.equal(requests[2].url, "https://stock.example/api/score?ticker=US%3AKO&view=technical&partial=1");
  assert.equal(requests[4].url, "https://stock.example/api/score/batch?tickers=US%3AKO%2CUS%3APOET&partial=1");
});

test("stock latency load test classifies ready partial and pending payloads", () => {
  assert.equal(classifyStockLatencyPayload({ ok: true, parts: { score: { state: "fresh" } } }).state, "ready");
  assert.equal(classifyStockLatencyPayload({ ok: true, type: "partial_stock_snapshot", parts: { score: { state: "pending" }, quote: { state: "fresh" } } }).state, "partial");
  assert.equal(classifyStockLatencyPayload({ ok: false, error: "snapshot_pending" }).state, "pending");
  assert.equal(classifyStockLatencyPayload({ ok: false, error: "collector_unreachable" }).state, "error");
});

test("stock latency load test flags request-path provider execution markers", () => {
  assert.deepEqual(providerGuardViolations({ server_cache: { source: "supabase" } }), []);
  assert.deepEqual(providerGuardViolations({ runtime_provider_call: "yfinance" }), ["runtime_provider_call:yfinance"]);
  assert.deepEqual(providerGuardViolations({ server_cache: { source: "python" } }), ["server_cache.source:python"]);
});

test("stock latency load test fails non-2xx responses", async () => {
  const report = await runStockLatencyLoadTest(
    { baseUrl: "https://stock.example", iterations: 1 },
    async () => Response.json({ ok: false, error: "rate_limited" }, { status: 429 })
  );

  assert.equal(report.ok, false);
  assert.equal(report.rows.every((row: { ok: boolean }) => row.ok === false), true);
});

test("stock latency load test fails when p95 exceeds the configured budget", async () => {
  const report = await runStockLatencyLoadTest(
    { baseUrl: "https://stock.example", iterations: 1, maxP95Ms: 1 },
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return Response.json({ ok: true, parts: { score: { state: "fresh" } } });
    }
  );

  assert.equal(report.ok, false);
  assert.equal(report.latency_budget_ok, false);
  assert.equal(report.latency_budget?.max_p95_ms, 1);
});

test("stock latency load test can exclude warmup iterations from latency budget", async () => {
  let call = 0;
  const report = await runStockLatencyLoadTest(
    { baseUrl: "https://stock.example", iterations: 2, warmupIterations: 1, maxP95Ms: 100 },
    async () => {
      call += 1;
      await new Promise((resolve) => setTimeout(resolve, call <= 5 ? 30 : 1));
      return Response.json({ ok: true, parts: { score: { state: "fresh" } } });
    }
  );

  assert.equal(report.ok, true);
  assert.equal(report.latency_budget_ok, true);
  assert.equal(report.measured_requests, 5);
  assert.equal(report.warmup_requests, 5);
});
