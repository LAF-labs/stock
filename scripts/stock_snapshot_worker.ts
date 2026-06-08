import { setTimeout as sleepMs } from "node:timers/promises";

import {
  assertRefreshWorkerReadiness,
  drainRefreshQueue,
  parseOptions as parseDrainOptions,
  type Options as DrainOptions,
} from "./publish_stock_snapshots";
import { loadLocalEnvFiles } from "./localEnv";
import { supabaseAdminConfig, type SupabaseConfig } from "@/lib/supabaseRest";

export type WorkerLane = "quote" | "chart" | "score";

export type WorkerOptions = {
  dryRun: boolean;
  json: boolean;
  lanes: WorkerLane[];
  maxPasses?: number;
  idleSleepMs: number;
  laneSleepMs: number;
  queueLimit: number;
  queueLockSeconds: number;
  timeoutMs: number;
  workerId: string;
  allowScorePythonFallback: boolean;
};

export type WorkerLaneResult = {
  lane: WorkerLane;
  ok: boolean;
  rows: Array<Record<string, unknown>>;
  error?: string;
};

export type WorkerPassResult = {
  ok: boolean;
  lanes: WorkerLaneResult[];
};

export type WorkerPassDependencies = {
  config?: SupabaseConfig;
  readiness?: (config: SupabaseConfig, options: Pick<DrainOptions, "timeoutMs">) => Promise<void>;
  drain?: (config: SupabaseConfig, options: DrainOptions) => Promise<Array<Record<string, unknown>>>;
  sleep?: (ms: number) => Promise<void>;
};

export type WorkerLoopDependencies = WorkerPassDependencies & {
  pass?: (options: WorkerOptions, dependencies: WorkerPassDependencies) => Promise<WorkerPassResult>;
  onPass?: (result: WorkerPassResult, passIndex: number) => void;
};

const DEFAULT_IDLE_SLEEP_MS = 4000;
const DEFAULT_LANE_SLEEP_MS = 250;
const DEFAULT_QUEUE_LIMIT = 25;
const DEFAULT_QUEUE_LOCK_SECONDS = 900;
const DEFAULT_TIMEOUT_MS = 15_000;

export function parseWorkerOptions(argv: string[], env: Record<string, string | undefined> = process.env): WorkerOptions {
  const allowScorePythonFallback = truthy(env.STOCK_SNAPSHOT_ALLOW_SCORE_FALLBACK);
  const options: WorkerOptions = {
    dryRun: false,
    json: false,
    lanes: parseLanes(env.STOCK_SNAPSHOT_WORKER_LANES || (allowScorePythonFallback ? "quote,chart,score" : "quote,chart")),
    maxPasses: undefined,
    idleSleepMs: positiveInteger(env.STOCK_SNAPSHOT_WORKER_IDLE_MS, DEFAULT_IDLE_SLEEP_MS),
    laneSleepMs: positiveInteger(env.STOCK_SNAPSHOT_WORKER_LANE_SLEEP_MS, DEFAULT_LANE_SLEEP_MS),
    queueLimit: positiveInteger(env.STOCK_SNAPSHOT_QUEUE_LIMIT, DEFAULT_QUEUE_LIMIT),
    queueLockSeconds: positiveInteger(env.STOCK_SNAPSHOT_QUEUE_LOCK_SECONDS, DEFAULT_QUEUE_LOCK_SECONDS),
    timeoutMs: positiveInteger(env.STOCK_SNAPSHOT_SUPABASE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    workerId: env.STOCK_SNAPSHOT_WORKER_ID || `stock-snapshot-worker-${process.pid}`,
    allowScorePythonFallback,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[index];
    };

    if (arg === "--lanes") options.lanes = parseLanes(next());
    else if (arg === "--once") options.maxPasses = 1;
    else if (arg === "--max-passes") options.maxPasses = positiveInteger(next(), 1);
    else if (arg === "--idle-ms") options.idleSleepMs = positiveInteger(next(), options.idleSleepMs);
    else if (arg === "--lane-sleep-ms") options.laneSleepMs = positiveInteger(next(), options.laneSleepMs);
    else if (arg === "--queue-limit") options.queueLimit = positiveInteger(next(), options.queueLimit);
    else if (arg === "--queue-lock-seconds") options.queueLockSeconds = positiveInteger(next(), options.queueLockSeconds);
    else if (arg === "--timeout-ms") options.timeoutMs = positiveInteger(next(), options.timeoutMs);
    else if (arg === "--worker-id") options.workerId = next();
    else if (arg === "--allow-score-python-fallback") options.allowScorePythonFallback = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--json") options.json = true;
    else throw new Error(`Unsupported argument: ${arg}`);
  }

  if (options.lanes.includes("score") && !options.allowScorePythonFallback) {
    throw new Error("Score lane requires --allow-score-python-fallback until the durable TS/Rust score worker owns score snapshots.");
  }

  return options;
}

export function buildDrainOptions(lane: WorkerLane, options: WorkerOptions): DrainOptions {
  const args = [
    "--drain-queue",
    "--kind",
    lane,
    "--worker-id",
    `${options.workerId}:${lane}`,
    "--queue-limit",
    String(options.queueLimit),
    "--queue-lock-seconds",
    String(options.queueLockSeconds),
    "--timeout-ms",
    String(options.timeoutMs),
  ];
  if (options.dryRun) args.push("--dry-run");
  if (options.json) args.push("--json");
  if (options.allowScorePythonFallback) args.push("--allow-score-python-fallback");
  return parseDrainOptions(args, {});
}

export async function runWorkerPass(options: WorkerOptions, dependencies: WorkerPassDependencies = {}): Promise<WorkerPassResult> {
  const config = dependencies.config || supabaseAdminConfig();
  if (!options.dryRun && !config) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");

  const readiness = dependencies.readiness || assertRefreshWorkerReadiness;
  const drain = dependencies.drain || drainRefreshQueue;
  const sleep = dependencies.sleep || sleepMs;
  const lanes: WorkerLaneResult[] = [];

  if (config) await readiness(config, { timeoutMs: options.timeoutMs });

  for (let index = 0; index < options.lanes.length; index += 1) {
    const lane = options.lanes[index];
    const drainOptions = buildDrainOptions(lane, options);
    try {
      const rows = config ? await drain(config, drainOptions) : [];
      lanes.push({ lane, ok: !rows.some(hasErrors), rows });
    } catch (error) {
      lanes.push({ lane, ok: false, rows: [], error: publicError(error) });
    }
    if (index < options.lanes.length - 1 && options.laneSleepMs > 0) await sleep(options.laneSleepMs);
  }

  return {
    ok: lanes.every((lane) => lane.ok),
    lanes,
  };
}

export async function runWorkerLoop(options: WorkerOptions, dependencies: WorkerLoopDependencies = {}): Promise<WorkerPassResult[]> {
  const pass = dependencies.pass || runWorkerPass;
  const sleep = dependencies.sleep || sleepMs;
  const results: WorkerPassResult[] = [];
  let passIndex = 0;

  while (options.maxPasses === undefined || passIndex < options.maxPasses) {
    const result = await pass(options, dependencies);
    results.push(result);
    dependencies.onPass?.(result, passIndex);
    passIndex += 1;
    if (options.maxPasses !== undefined && passIndex >= options.maxPasses) break;
    if (options.idleSleepMs > 0) await sleep(options.idleSleepMs);
  }

  return results;
}

function parseLanes(value: string): WorkerLane[] {
  const unique: WorkerLane[] = [];
  for (const part of value.split(",")) {
    const lane = part.trim().toLowerCase();
    if (!lane) continue;
    if (lane !== "quote" && lane !== "chart" && lane !== "score") throw new Error(`Unsupported worker lane: ${part}`);
    if (!unique.includes(lane)) unique.push(lane);
  }
  if (!unique.length) throw new Error("At least one worker lane is required.");
  return unique;
}

function positiveInteger(value: string | number | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function truthy(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes";
}

function hasErrors(row: Record<string, unknown>): boolean {
  return Array.isArray(row.errors) && row.errors.length > 0;
}

function publicError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 1000) : "unknown";
}

function printPass(result: WorkerPassResult, passIndex: number, json: boolean) {
  if (json) {
    console.log(JSON.stringify({ pass: passIndex + 1, ...result }));
    return;
  }
  const laneSummary = result.lanes.map((lane) => `${lane.lane}:${lane.ok ? "ok" : "failed"}`).join(" ");
  console.log(`[stock-snapshot-worker] pass=${passIndex + 1} ok=${result.ok} ${laneSummary}`);
}

async function main() {
  loadLocalEnvFiles();
  const options = parseWorkerOptions(process.argv.slice(2));
  await runWorkerLoop(options, {
    onPass: (result, index) => printPass(result, index, options.json),
  });
}

const isCli = process.argv[1]?.endsWith("stock_snapshot_worker.ts");
if (isCli) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
