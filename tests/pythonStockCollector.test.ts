import test from "node:test";
import assert from "node:assert/strict";

import { scoreCollectorCommand } from "../src/lib/pythonStockCollector";

test("score collector uses project Python runner when Python env is not configured", () => {
  assert.deepEqual(scoreCollectorCommand({}, "linux"), ["bash", "scripts/run_python.sh", "scripts/fetch_stock_score.py"]);
});

test("score collector uses Python directly on Windows when Python env is not configured", () => {
  assert.deepEqual(scoreCollectorCommand({}, "win32"), ["python", "scripts/fetch_stock_score.py"]);
});

test("score collector honors explicit PYTHON_BIN", () => {
  assert.deepEqual(scoreCollectorCommand({ PYTHON_BIN: "/custom/python", PYTHON: "/ignored/python" }), ["/custom/python", "scripts/fetch_stock_score.py"]);
});

test("score collector falls back to explicit PYTHON when PYTHON_BIN is unset", () => {
  assert.deepEqual(scoreCollectorCommand({ PYTHON: "/usr/local/bin/python3" }), ["/usr/local/bin/python3", "scripts/fetch_stock_score.py"]);
});
