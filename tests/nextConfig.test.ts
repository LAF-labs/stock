import test from "node:test";
import assert from "node:assert/strict";

import nextConfig, { PYTHON_COLLECTOR_TRACE_INCLUDES, shouldIncludePythonCollector } from "../next.config";

test("Next config excludes Python collector by default", () => {
  assert.equal(shouldIncludePythonCollector({}), false);
});

test("Next config includes Python collector for local explicit legacy runtime", () => {
  assert.equal(shouldIncludePythonCollector({ STOCK_DATA_RUNTIME: "python" }), true);
  assert.equal(shouldIncludePythonCollector({ STOCK_DATA_BACKEND: "python" }), true);
  assert.equal(shouldIncludePythonCollector({ INCLUDE_PYTHON_COLLECTOR: "1" }), true);
});

test("Next config fails closed on Vercel unless Python runtime is explicitly allowed", () => {
  assert.equal(shouldIncludePythonCollector({ VERCEL: "1", STOCK_DATA_RUNTIME: "python" }), false);
  assert.equal(
    shouldIncludePythonCollector({
      VERCEL: "1",
      INCLUDE_PYTHON_COLLECTOR: "1",
      STOCK_ALLOW_VERCEL_PYTHON_RUNTIME: "1",
    }),
    true
  );
});

test("Next config Python tracing includes score helper modules only", () => {
  assert.deepEqual(PYTHON_COLLECTOR_TRACE_INCLUDES, [
    "./scripts/fetch_stock_score.py",
    "./scripts/stock_score/**/*.py",
    "./requirements.txt",
  ]);

  const config = nextConfig as {
    outputFileTracingIncludes?: Record<string, string[]>;
    outputFileTracingExcludes?: Record<string, string[]>;
  };

  assert.equal(config.outputFileTracingIncludes?.["/api/quote"], undefined);
  assert.deepEqual(config.outputFileTracingIncludes?.["/api/score"], undefined);
});
