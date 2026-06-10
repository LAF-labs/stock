import { acquireRateLimit, apiLimitPolicy, fixedRateLimitKey } from "@/lib/apiRateLimit";
import { numericEnv } from "@/lib/supabaseRest";
import { appendBoundedOutput, subprocessErrorMessage, type BoundedOutput } from "@/lib/subprocessGuards";
import type { ScoreView, StockPayload } from "@/lib/stockScoreContract";

const SCRIPT_PATH = "scripts/fetch_stock_score.py";
const PYTHON_RUNNER_PATH = "scripts/run_python.sh";
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

export function scoreCollectorCommand(env: Record<string, string | undefined> = process.env, platform = process.platform): string[] {
  const configuredPython = env.PYTHON_BIN || env.PYTHON;
  if (configuredPython) return [configuredPython, SCRIPT_PATH];
  if (platform === "win32") return ["python", SCRIPT_PATH];
  return ["bash", PYTHON_RUNNER_PATH, SCRIPT_PATH];
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
    const [command, ...commandArgs] = scoreCollectorCommand(process.env);
    const child = spawn(/* turbopackIgnore: true */ command, [...commandArgs, ...args], {
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
