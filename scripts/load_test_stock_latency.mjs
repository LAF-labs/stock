#!/usr/bin/env node

import { performance } from "node:perf_hooks";

const DEFAULT_HOT_TICKER = "US:KO";
const DEFAULT_COLD_TICKER = "US:POET";

export function scenarioRequests(baseUrl, options = {}) {
  const base = String(baseUrl || "http://localhost:3000").replace(/\/$/, "");
  const hotTicker = options.hotTicker || DEFAULT_HOT_TICKER;
  const coldTicker = options.coldTicker || DEFAULT_COLD_TICKER;
  const compareTickers = options.compareTickers || [hotTicker, coldTicker];
  return [
    { name: "hot_detail", url: `${base}/api/score?${new URLSearchParams({ ticker: hotTicker, partial: "1" })}` },
    { name: "cold_detail", url: `${base}/api/score?${new URLSearchParams({ ticker: coldTicker, partial: "1" })}` },
    { name: "hot_technical", url: `${base}/api/score?${new URLSearchParams({ ticker: hotTicker, view: "technical", partial: "1" })}` },
    { name: "cold_technical", url: `${base}/api/score?${new URLSearchParams({ ticker: coldTicker, view: "technical", partial: "1" })}` },
    { name: "mixed_compare", url: `${base}/api/score/batch?${new URLSearchParams({ tickers: compareTickers.join(","), partial: "1" })}` },
  ];
}

export function classifyStockLatencyPayload(payload) {
  if (!payload || typeof payload !== "object") return { state: "error", ready_parts: [], pending_parts: [] };
  const hasExplicitState =
    payload.ok === true ||
    payload.ok === false ||
    typeof payload.type === "string" ||
    (payload.parts && typeof payload.parts === "object" && !Array.isArray(payload.parts));
  if (!hasExplicitState) return { state: "error", ready_parts: [], pending_parts: [] };
  if (payload.ok === false && (payload.error === "snapshot_pending" || payload.error === "snapshot_unavailable")) {
    return { state: "pending", ready_parts: [], pending_parts: ["snapshot"] };
  }
  if (payload.ok === false) return { state: "error", ready_parts: [], pending_parts: [] };

  const parts = payload.parts && typeof payload.parts === "object" && !Array.isArray(payload.parts) ? payload.parts : {};
  const readyParts = [];
  const pendingParts = [];
  for (const [name, status] of Object.entries(parts)) {
    const state = status && typeof status === "object" ? status.state : undefined;
    if (state === "fresh" || state === "stale") readyParts.push(name);
    if (state === "pending" || state === "miss") pendingParts.push(name);
  }
  if (payload.type === "partial_stock_snapshot" || pendingParts.length) {
    return { state: readyParts.length ? "partial" : "pending", ready_parts: readyParts, pending_parts: pendingParts };
  }
  return { state: "ready", ready_parts: readyParts, pending_parts: pendingParts };
}

export function providerGuardViolations(payload) {
  const violations = [];
  const record = payload && typeof payload === "object" ? payload : {};
  const runtimeProviderCall = record.runtime_provider_call;
  if (runtimeProviderCall) violations.push(`runtime_provider_call:${runtimeProviderCall}`);
  const serverCache = record.server_cache && typeof record.server_cache === "object" ? record.server_cache : {};
  const source = typeof serverCache.source === "string" ? serverCache.source.toLowerCase() : "";
  if (["python", "yfinance", "kis", "provider"].includes(source)) violations.push(`server_cache.source:${source}`);
  return violations;
}

export async function runStockLatencyLoadTest(options = {}, fetchImpl = fetch) {
  const requests = scenarioRequests(options.baseUrl, options);
  const iterations = Math.max(1, Number(options.iterations || 1));
  const rows = [];

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (const request of requests) {
      const started = performance.now();
      let payload = {};
      let status = 0;
      let ok = false;
      let error;
      try {
        const response = await fetchImpl(request.url, { headers: { Accept: "application/json" }, cache: "no-store" });
        status = response.status;
        ok = response.ok;
        payload = await response.json();
      } catch (caught) {
        error = caught instanceof Error ? caught.message : "unknown";
      }
      const durationMs = Math.round((performance.now() - started) * 10) / 10;
      rows.push({
        iteration,
        scenario: request.name,
        status,
        ok,
        duration_ms: durationMs,
        classification: classifyStockLatencyPayload(payload),
        provider_guard_violations: providerGuardViolations(payload),
        error,
      });
    }
  }

  const warmupIterations = Math.max(0, Number(options.warmupIterations || 0));
  const measuredRows = rows.filter((row) => row.iteration >= warmupIterations);
  const durations = measuredRows.map((row) => row.duration_ms).sort((a, b) => a - b);
  const providerViolations = rows.flatMap((row) => row.provider_guard_violations.map((violation) => ({ scenario: row.scenario, violation })));
  const p50Ms = percentile(durations, 0.5);
  const p95Ms = percentile(durations, 0.95);
  const maxP95Ms = positiveNumber(options.maxP95Ms);
  const latencyBudgetOk = maxP95Ms === undefined || (p95Ms !== null && p95Ms <= maxP95Ms);
  return {
    ok: rows.every((row) => row.ok && !row.error && row.provider_guard_violations.length === 0) && latencyBudgetOk,
    iterations,
    requests: rows.length,
    warmup_iterations: warmupIterations,
    warmup_requests: rows.length - measuredRows.length,
    measured_requests: measuredRows.length,
    p50_ms: p50Ms,
    p95_ms: p95Ms,
    latency_budget_ok: latencyBudgetOk,
    latency_budget: maxP95Ms === undefined ? undefined : { max_p95_ms: maxP95Ms },
    provider_guard_ok: providerViolations.length === 0,
    provider_guard_violations: providerViolations,
    rows,
  };
}

function percentile(values, quantile) {
  if (!values.length) return null;
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * quantile) - 1));
  return values[index];
}

function parseCliOptions(argv, env = process.env) {
  const options = {
    baseUrl: env.STOCK_LATENCY_BASE_URL || "http://localhost:3000",
    hotTicker: env.STOCK_LATENCY_HOT_TICKER || DEFAULT_HOT_TICKER,
    coldTicker: env.STOCK_LATENCY_COLD_TICKER || DEFAULT_COLD_TICKER,
    iterations: Number(env.STOCK_LATENCY_ITERATIONS || 1),
    warmupIterations: Number(env.STOCK_LATENCY_WARMUP_ITERATIONS || 0),
    maxP95Ms: positiveNumber(env.STOCK_LATENCY_MAX_P95_MS),
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[index];
    };
    if (arg === "--base-url") options.baseUrl = next();
    else if (arg === "--hot-ticker") options.hotTicker = next();
    else if (arg === "--cold-ticker") options.coldTicker = next();
    else if (arg === "--iterations") options.iterations = Number(next());
    else if (arg === "--warmup-iterations") options.warmupIterations = Number(next());
    else if (arg === "--max-p95-ms") options.maxP95Ms = positiveNumber(next());
    else if (arg === "--json") options.json = true;
    else throw new Error(`Unsupported argument: ${arg}`);
  }
  return options;
}

function positiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  const report = await runStockLatencyLoadTest(options);
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`stock latency ok=${report.ok} p50=${report.p50_ms}ms p95=${report.p95_ms}ms requests=${report.requests}`);
  }
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1]?.endsWith("load_test_stock_latency.mjs")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
