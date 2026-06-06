import { acquireRateLimit, apiLimitPolicy, fixedRateLimitKey } from "@/lib/apiRateLimit";
import { numericEnv } from "@/lib/supabaseRest";
import { appendBoundedOutput, subprocessErrorMessage, type BoundedOutput } from "@/lib/subprocessGuards";
import type { ScoreView, StockPayload } from "@/lib/stockSnapshotCache";

const SCRIPT_PATH = "scripts/fetch_yfinance_score.py";
const PYTHON_BIN = process.env.PYTHON_BIN || process.env.PYTHON || "python";
const SCORE_TIMEOUT_MS = 35_000;
const SCORE_OUTPUT_MAX_BYTES = 1_000_000;

async function acquireScoreCollectorSlot() {
  const result = await acquireRateLimit(
    fixedRateLimitKey("stock-score-collector-global"),
    apiLimitPolicy("stock_score_collector", 30, 60)
  );
  if (!result.allowed) {
    throw new Error(`collector_rate_limited_until_${result.resetAt}`);
  }
}

async function runPythonCollector(
  args: string[],
  timeoutMs: number,
  outputLimitBytes: number,
  exitLabel: string,
  timeoutLabel: string
): Promise<StockPayload> {
  const { spawn } = await import("node:child_process");

  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/env", [PYTHON_BIN, SCRIPT_PATH, ...args], {
      env: {
        ...process.env,
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
      },
      windowsHide: true,
    });

    let stdout: BoundedOutput = { value: "", truncated: false };
    let stderr: BoundedOutput = { value: "", truncated: false };
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${timeoutLabel} timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      const next = appendBoundedOutput(stdout.value, chunk, numericEnv("STOCK_COLLECTOR_OUTPUT_MAX_BYTES", outputLimitBytes));
      stdout = { value: next.value, truncated: stdout.truncated || next.truncated };
    });
    child.stderr.on("data", (chunk) => {
      const next = appendBoundedOutput(stderr.value, chunk, numericEnv("STOCK_COLLECTOR_OUTPUT_MAX_BYTES", outputLimitBytes));
      stderr = { value: next.value, truncated: stderr.truncated || next.truncated };
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      if (exitCode !== 0) {
        reject(new Error(subprocessErrorMessage(stderr, `${exitLabel} exited with ${exitCode}`)));
        return;
      }

      try {
        resolve(JSON.parse(stdout.value) as StockPayload);
      } catch {
        reject(new Error(`${exitLabel} did not return valid JSON.`));
      }
    });
  });
}

export async function runScoreCollector(ticker: string, view: ScoreView): Promise<StockPayload> {
  await acquireScoreCollectorSlot();
  return runPythonCollector([ticker, "--view", view], SCORE_TIMEOUT_MS, SCORE_OUTPUT_MAX_BYTES, "Python collector", "Stock lookup");
}
