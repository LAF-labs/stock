#!/usr/bin/env node

import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";

const DEFAULT_TICKERS = ["US:FLNC", "US:SPY", "KR:489790", "KR:483240"];
const DEFAULT_TIMEOUT_MS = 20_000;
const require = createRequire(import.meta.url);
const symbolMaster = require("../src/data/symbols.generated.json");
const instrumentTypeByTicker = new Map(symbolMaster.map((item) => [`${item.market}:${item.ticker}`, item.instrumentType]));

export function coldStartMatrixRequests(baseUrl, options = {}) {
  const base = String(baseUrl || "http://localhost:3000").replace(/\/$/, "");
  const tickers = Array.isArray(options.tickers) && options.tickers.length ? options.tickers : DEFAULT_TICKERS;
  const requests = [];

  for (const ticker of tickers) {
    requests.push({
      feature: "detail_display",
      ticker,
      url: `${base}/api/stock/display?${new URLSearchParams({ ticker, view: "detail" })}`,
    });
    requests.push({
      feature: "detail_view",
      ticker,
      url: `${base}/api/stock/detail-view?${new URLSearchParams({ ticker, view: "detail" })}`,
    });
    requests.push({
      feature: "score_detail",
      ticker,
      url: `${base}/api/score?${new URLSearchParams({ ticker, partial: "1" })}`,
    });
    requests.push({
      feature: "technical_display",
      ticker,
      url: `${base}/api/stock/display?${new URLSearchParams({ ticker, view: "technical" })}`,
    });
    requests.push({
      feature: "technical_view",
      ticker,
      url: `${base}/api/stock/detail-view?${new URLSearchParams({ ticker, view: "technical" })}`,
    });
    requests.push({
      feature: "score_technical",
      ticker,
      url: `${base}/api/score?${new URLSearchParams({ ticker, view: "technical", partial: "1" })}`,
    });
    requests.push({
      feature: "compare_display",
      ticker,
      url: `${base}/api/stock/display?${new URLSearchParams({ ticker, view: "compare" })}`,
    });
  }

  requests.push({
    feature: "score_batch_compare",
    ticker: tickers.join(","),
    url: `${base}/api/score/batch?${new URLSearchParams({ tickers: tickers.join(","), partial: "1" })}`,
  });

  return requests;
}

export function validateColdStartMatrixPayload(payload, request) {
  const errors = [];
  const record = objectValue(payload);
  if (!record) return ["payload is not an object"];

  if (isExpectedUnsupportedPayload(record, request)) {
    return [];
  }

  if (record.ok === false && (record.error === "snapshot_pending" || record.error === "snapshot_unavailable")) {
    errors.push(`unexpected ${record.error}`);
  } else if (record.ok === false && request.feature !== "score_batch_compare") {
    errors.push(`unexpected error payload: ${stringValue(record.error) || "unknown"}`);
  }

  if (request.feature.endsWith("_display")) {
    validateDisplayPayload(record, request, errors);
  } else if (request.feature.endsWith("_view")) {
    validateDetailViewPayload(record, request, errors);
  } else if (request.feature === "score_batch_compare") {
    validateBatchPayload(record, errors);
  } else {
    validateScorePayload(record, errors);
  }

  if (JSON.stringify(record).includes("snapshot_pending")) {
    errors.push("payload leaks snapshot_pending");
  }
  return errors;
}

export async function runStockColdStartMatrix(options = {}, fetchImpl = fetch) {
  const requests = coldStartMatrixRequests(options.baseUrl, options);
  const timeoutMs = positiveNumber(options.timeoutMs) || DEFAULT_TIMEOUT_MS;
  const rows = [];

  for (const request of requests) {
    const started = performance.now();
    let status = 0;
    let payload = undefined;
    let error = undefined;
    try {
      const response = await fetchJsonWithTimeout(request.url, timeoutMs, fetchImpl);
      status = response.status;
      payload = response.payload;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    const durationMs = Math.round((performance.now() - started) * 10) / 10;
    const validationErrors = error ? [error] : validateColdStartMatrixPayload(payload, request);
    const statusOk = status >= 200 && status < 300 || isExpectedUnsupportedPayload(objectValue(payload), request);
    rows.push({
      ...request,
      status,
      duration_ms: durationMs,
      ok: statusOk && validationErrors.length === 0,
      errors: validationErrors,
      summary: summarizePayload(payload),
    });
  }

  const durations = rows.map((row) => row.duration_ms).sort((a, b) => a - b);
  return {
    ok: rows.every((row) => row.ok),
    base_url: String(options.baseUrl || "http://localhost:3000").replace(/\/$/, ""),
    tickers: Array.isArray(options.tickers) && options.tickers.length ? options.tickers : DEFAULT_TICKERS,
    requests: rows.length,
    p50_ms: percentile(durations, 0.5),
    p95_ms: percentile(durations, 0.95),
    rows,
  };
}

function validateDisplayPayload(record, request, errors) {
  if (record.ok !== true) errors.push("display payload is not ok");
  if (!objectValue(record.identity)?.value) errors.push("display payload has no identity value");
  const completion = objectValue(record.completion);
  if (!completion) {
    errors.push("display payload has no completion object");
    return;
  }
  const recoveringParts = stringArray(completion.recoveringParts);
  const requiredParts = stringArray(completion.requiredParts);
  if (request.feature === "technical_display" && !arrayEquals(requiredParts, ["identity", "price", "chart", "technical"])) {
    errors.push(`unexpected technical requiredParts: ${requiredParts.join(",")}`);
  }
  if ((request.feature === "detail_display" || request.feature === "compare_display") && !arrayEquals(requiredParts, ["identity", "price", "chart", "score"])) {
    errors.push(`unexpected requiredParts: ${requiredParts.join(",")}`);
  }
  const hasPendingEnrichmentScore = scoreNeedsEnrichment(objectValue(record.score)?.value);
  if (hasPendingEnrichmentScore && recoveringParts.some((part) => part === "fundamentals" || part === "industryBenchmark")) {
    errors.push("enrichment-only financial recovery is still visible");
  }
}

function validateDetailViewPayload(record, _request, errors) {
  const mode = stringValue(record.mode);
  if (!mode) errors.push("detail-view payload has no mode");
  if (mode === "failed_irreversible") errors.push("detail-view failed irreversibly");
  const data = objectValue(record.data);
  const identity = objectValue(record.identity) || objectValue(data?.identity);
  if (!identity && !stringValue(record.ticker)) errors.push("detail-view payload has no identity or ticker");
}

function validateScorePayload(record, errors) {
  if (record.ok === true) return;
  if (record.type === "partial_stock_snapshot") {
    const parts = objectValue(record.parts);
    if (!parts || Object.keys(parts).length === 0) errors.push("partial score payload has no parts");
    return;
  }
  if (record.ok === false) errors.push(`score payload failed: ${stringValue(record.error) || "unknown"}`);
}

function isExpectedUnsupportedPayload(record, request) {
  return request.feature === "score_technical"
    && record.ok === false
    && record.error === "technical_unsupported_product"
    && isEtfTicker(request.ticker);
}

function isEtfTicker(ticker) {
  return ticker ? instrumentTypeByTicker.get(ticker) === "ETF" : false;
}

function validateBatchPayload(record, errors) {
  if (record.ok === false) {
    errors.push(`batch payload failed: ${stringValue(record.error) || "unknown"}`);
    return;
  }
  const results = Array.isArray(record.results) ? record.results : Array.isArray(record.items) ? record.items : undefined;
  if (!results || results.length === 0) errors.push("batch payload has no results");
}

function summarizePayload(payload) {
  const record = objectValue(payload);
  if (!record) return {};
  const completion = objectValue(record.completion);
  const refresh = objectValue(record.refresh);
  return {
    ok: record.ok,
    type: record.type,
    mode: record.mode,
    ticker: record.ticker,
    presentParts: completion ? stringArray(completion.presentParts) : undefined,
    recoveringParts: completion ? stringArray(completion.recoveringParts) : refresh ? stringArray(refresh.recoveringParts) : undefined,
    unavailableParts: completion ? stringArray(completion.unavailableParts) : undefined,
  };
}

function scoreNeedsEnrichment(value) {
  const score = objectValue(value);
  if (!score) return false;
  const fetch = objectValue(score.fetch);
  const financials = objectValue(score.financials);
  const dataQuality = stringValue(score.data_quality)?.toLowerCase();
  return Boolean(
    dataQuality === "price_fast_path" ||
    dataQuality === "quote_fast_path" ||
    dataQuality === "identity_fast_path" ||
    fetch?.pending_enrichment === true ||
    fetch?.quote_only_fast_path === true ||
    fetch?.identity_only_fast_path === true ||
    financials?.pending_enrichment === true ||
    financials?.quote_only_fast_path === true ||
    financials?.identity_only_fast_path === true ||
    stringValue(financials?.source)?.toLowerCase() === "pending_enrichment",
  );
}

async function fetchJsonWithTimeout(url, timeoutMs, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    let payload;
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }
    return { status: response.status, payload };
  } finally {
    clearTimeout(timer);
  }
}

function parseCliOptions(argv, env = process.env) {
  const options = {
    baseUrl: env.STOCK_COLD_MATRIX_BASE_URL || "http://localhost:3000",
    tickers: parseTickers(env.STOCK_COLD_MATRIX_TICKERS) || DEFAULT_TICKERS,
    timeoutMs: positiveNumber(env.STOCK_COLD_MATRIX_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
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
    else if (arg === "--tickers") options.tickers = parseTickers(next()) || DEFAULT_TICKERS;
    else if (arg === "--timeout-ms") options.timeoutMs = positiveNumber(next()) || DEFAULT_TIMEOUT_MS;
    else if (arg === "--json") options.json = true;
    else throw new Error(`Unsupported argument: ${arg}`);
  }
  return options;
}

function printReport(report) {
  console.log(`cold-start matrix ok=${report.ok} requests=${report.requests} p50=${report.p50_ms}ms p95=${report.p95_ms}ms`);
  for (const row of report.rows) {
    const status = row.ok ? "ok" : "fail";
    const suffix = row.errors.length ? ` errors=${row.errors.join(" | ")}` : "";
    console.log(`${status} ${row.feature} ${row.ticker} ${row.status} ${row.duration_ms}ms${suffix}`);
  }
}

function parseTickers(value) {
  if (!value) return undefined;
  const tickers = String(value).split(",").map((item) => item.trim()).filter(Boolean);
  return tickers.length ? tickers : undefined;
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

function stringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function arrayEquals(left, right) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function percentile(values, quantile) {
  if (!values.length) return null;
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * quantile) - 1));
  return values[index];
}

function positiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  const report = await runStockColdStartMatrix(options);
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else printReport(report);
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1]?.endsWith("verify_stock_cold_start_matrix.mjs")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
