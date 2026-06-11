import { fetchWithTimeout, supabaseAdminConfig, supabaseHeaders, type SupabaseConfig } from "@/lib/supabaseRest";
import { loadLocalEnvFiles } from "./localEnv";

type PlanKind = "all" | "quote" | "score" | "chart";

export type Options = {
  json: boolean;
  kind: PlanKind;
  limit: number;
  timeoutMs: number;
};

export type PlanStockRefreshJobsResult = {
  ok?: boolean;
  candidates?: number;
  inserted?: number;
  by_kind?: Record<string, number>;
  [key: string]: unknown;
};

const DEFAULT_LIMIT = 50;
const DEFAULT_TIMEOUT_MS = 15_000;

export function parseOptions(argv: string[], env: Record<string, string | undefined> = process.env): Options {
  const options: Options = {
    json: false,
    kind: planKind(env.STOCK_REFRESH_PLANNER_KIND) || "all",
    limit: positiveInteger(env.STOCK_REFRESH_PLANNER_LIMIT, DEFAULT_LIMIT),
    timeoutMs: positiveInteger(env.STOCK_REFRESH_PLANNER_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[index];
    };
    if (arg === "--json") options.json = true;
    else if (arg === "--kind") options.kind = requiredPlanKind(next());
    else if (arg === "--limit") options.limit = positiveInteger(next(), options.limit);
    else if (arg === "--timeout-ms") options.timeoutMs = positiveInteger(next(), options.timeoutMs);
    else throw new Error(`Unsupported argument: ${arg}`);
  }

  return options;
}

export async function planStockRefreshJobs(config: SupabaseConfig, options: Options): Promise<PlanStockRefreshJobsResult> {
  const response = await fetchWithTimeout(
    `${config.url}/rest/v1/rpc/plan_stock_refresh_jobs`,
    {
      method: "POST",
      headers: supabaseHeaders(config.key),
      body: JSON.stringify({
        p_kind: options.kind,
        p_limit: options.limit,
      }),
    },
    options.timeoutMs
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Supabase refresh planner failed: HTTP ${response.status} ${text.slice(0, 500)}`);
  }
  const text = await response.text();
  return text ? (JSON.parse(text) as PlanStockRefreshJobsResult) : { ok: true };
}

function requiredPlanKind(value: string): PlanKind {
  const kind = planKind(value);
  if (!kind) throw new Error(`Unsupported planner kind: ${value}`);
  return kind;
}

function planKind(value: string | undefined): PlanKind | undefined {
  const kind = value?.trim().toLowerCase();
  if (kind === "all" || kind === "quote" || kind === "score" || kind === "chart") return kind;
  return undefined;
}

function positiveInteger(value: string | number | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

async function main() {
  loadLocalEnvFiles();
  const options = parseOptions(process.argv.slice(2));
  const config = supabaseAdminConfig();
  if (!config) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  const result = await planStockRefreshJobs(config, options);
  if (options.json) console.log(JSON.stringify(result));
  else console.log(`candidates=${result.candidates ?? 0} inserted=${result.inserted ?? 0}`);
  if (result.ok === false) process.exitCode = 1;
}

const isCli = process.argv[1]?.endsWith("plan_stock_refresh_jobs.ts");
if (isCli) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
