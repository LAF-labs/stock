import { appendFileSync } from "node:fs";

import { fetchWithTimeout, supabaseAdminConfig, supabaseHeaders, type SupabaseConfig } from "@/lib/supabaseRest";
import { loadLocalEnvFiles } from "./localEnv";

type RefreshKind = "quote" | "score" | "chart";

type QueueStatusOptions = {
  kind: RefreshKind;
  dueOnly: boolean;
  json: boolean;
  timeoutMs: number;
  githubOutputKey?: string;
  forceIfList?: string;
};

export async function refreshQueueStatus(config: SupabaseConfig, options: QueueStatusOptions, now = new Date()) {
  const url = new URL(`${config.url}/rest/v1/stock_refresh_jobs`);
  const nowIso = now.toISOString();
  url.searchParams.set("select", "id,status");
  url.searchParams.set("kind", `eq.${options.kind}`);
  url.searchParams.set("limit", "1");
  url.searchParams.set(
    "or",
    options.dueOnly
      ? `(and(status.eq.queued,run_after.lte.${nowIso}),and(status.eq.running,or(locked_until.lt.${nowIso},locked_until.is.null)))`
      : `(status.eq.queued,and(status.eq.running,or(locked_until.lt.${nowIso},locked_until.is.null)))`
  );

  const response = await fetchWithTimeout(
    url.toString(),
    {
      headers: {
        ...supabaseHeaders(config.key),
        "Range-Unit": "items",
        Range: "0-0",
      },
    },
    options.timeoutMs
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Supabase refresh queue status query failed: HTTP ${response.status} ${text.slice(0, 500)}`);
  }

  const rows = await response.json().catch(() => []);
  const row = Array.isArray(rows) ? rows[0] : undefined;
  const status = row && typeof row === "object" && !Array.isArray(row) ? String((row as Record<string, unknown>).status || "") : "";
  const matchingJobs = row ? 1 : 0;
  const queuedJobs = matchingJobs && status !== "running" ? 1 : 0;
  const staleRunningJobs = status === "running" ? 1 : 0;
  const forced = hasListItems(options.forceIfList);
  return {
    ok: true,
    kind: options.kind,
    due_only: options.dueOnly,
    matching_jobs: matchingJobs,
    queued_jobs: queuedJobs,
    stale_running_jobs: staleRunningJobs,
    forced,
    should_run: forced || matchingJobs > 0,
  };
}

export function parseQueueStatusOptions(argv: string[]): QueueStatusOptions {
  const options: QueueStatusOptions = {
    kind: "score",
    dueOnly: false,
    json: false,
    timeoutMs: 8_000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[index];
    };
    if (arg === "--kind") options.kind = parseKind(next());
    else if (arg === "--due-only") options.dueOnly = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--timeout-ms") options.timeoutMs = positiveInteger(next(), 8_000);
    else if (arg === "--github-output-key") options.githubOutputKey = next();
    else if (arg === "--force-if-list") options.forceIfList = next();
    else throw new Error(`Unsupported argument: ${arg}`);
  }

  return options;
}

export function writeGithubOutput(key: string | undefined, value: string) {
  if (!key || !process.env.GITHUB_OUTPUT) return;
  appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`, "utf8");
}

function hasListItems(value: string | undefined): boolean {
  return !!value?.split(",").some((item) => item.trim());
}

function parseKind(value: string): RefreshKind {
  const kind = value.trim().toLowerCase();
  if (kind === "quote" || kind === "score" || kind === "chart") return kind;
  throw new Error(`Unsupported refresh kind: ${value}`);
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function publicError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 1000) : "unknown";
}

function isMainModule(): boolean {
  return process.argv[1]?.endsWith("stock_refresh_queue_status.ts") === true;
}

async function main() {
  loadLocalEnvFiles();
  const options = parseQueueStatusOptions(process.argv.slice(2));
  const config = supabaseAdminConfig();
  if (!config) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  const payload = await refreshQueueStatus(config, options);
  writeGithubOutput(options.githubOutputKey, payload.should_run ? "1" : "0");
  if (options.json) console.log(JSON.stringify(payload, null, 2));
  else console.log(`${payload.kind} matching=${payload.matching_jobs} queued=${payload.queued_jobs} stale_running=${payload.stale_running_jobs} should_run=${payload.should_run ? "1" : "0"}`);
}

if (isMainModule()) {
  main().catch((error) => {
    console.error(publicError(error));
    process.exitCode = 2;
  });
}
