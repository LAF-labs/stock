import { fetchWithTimeout, supabaseHeaders } from "@/lib/supabaseRest";
import { loadLocalEnvFiles } from "./localEnv";

export const RUNTIME_TABLE_CHECKS = [
  "public.stock_score_snapshots",
  "public.stock_quote_snapshots",
  "public.stock_chart_snapshots",
  "public.stock_refresh_jobs",
  "public.stock_api_rate_limits",
  "public.stock_refresh_leases",
  "public.stock_refresh_cooldowns",
  "public.stock_rule_judgments",
  "public.stock_industry_benchmarks",
  "public.stock_symbol_profiles",
  "public.market_calendar",
  "public.kis_access_tokens",
] as const;

export const RUNTIME_RPC_CHECKS = [
  "acquire_stock_api_rate_limit",
  "acquire_stock_refresh_cooldown",
  "acquire_stock_refresh_lease",
  "enqueue_stock_refresh_job",
  "claim_stock_refresh_jobs",
  "claim_stock_refresh_jobs_by_kind",
  "complete_stock_refresh_job",
  "fail_stock_refresh_job",
  "refresh_stock_industry_benchmarks",
  "acquire_kis_token_issue_lock",
] as const;

export const RUNTIME_RPC_SIGNATURE_CHECKS = [
  ["claim_stock_refresh_jobs", "p_worker_id text, p_limit integer, p_lock_seconds integer"],
  ["claim_stock_refresh_jobs_by_kind", "p_worker_id text, p_kind text, p_limit integer, p_lock_seconds integer"],
  ["complete_stock_refresh_job", "p_job_id uuid, p_worker_id text"],
  ["fail_stock_refresh_job", "p_job_id uuid, p_worker_id text, p_error text, p_retry_after_seconds integer, p_permanent boolean"],
] as const;

export const PUBLIC_READ_CHECKS = [
  ["stock_score_snapshots", "ticker"],
  ["stock_quote_snapshots", "ticker"],
  ["stock_chart_snapshots", "ticker"],
  ["stock_fundamental_snapshots", "market"],
  ["market_calendar", "market"],
  ["stock_industry_benchmarks", "metric"],
  ["stock_symbol_profiles", "market"],
  ["stock_symbol_industry_tags", "market"],
  ["industry_taxonomy_map", "taxonomy"],
  ["stock_rule_judgments", "ticker"],
  ["stock_ai_judgments", "ticker"],
] as const;

type JsonRecord = Record<string, unknown>;

export type ReadinessOptions = {
  json: boolean;
  timeoutMs: number;
};

export function readinessContractPayload(payload: JsonRecord) {
  const checkedTables = new Set(arrayOfStrings(payload.required_tables));
  const checkedRpcs = new Set(arrayOfStrings(payload.required_rpcs));
  const checkedRpcSignatures = new Set(arrayOfRpcSignatures(payload.required_rpc_signatures));
  const missingTables = RUNTIME_TABLE_CHECKS.filter((item) => !checkedTables.has(item));
  const missingRpcs = RUNTIME_RPC_CHECKS.filter((item) => !checkedRpcs.has(item));
  const missingRpcSignatures = payload.required_rpc_signatures === undefined
    ? []
    : RUNTIME_RPC_SIGNATURE_CHECKS
        .map(([name, identityArguments]) => `${name}(${identityArguments})`)
        .filter((item) => !checkedRpcSignatures.has(item));
  const missingRpcGrants = arrayOfStrings(payload.missing_rpc_grants);
  return {
    ok: missingTables.length === 0 && missingRpcs.length === 0 && missingRpcSignatures.length === 0 && missingRpcGrants.length === 0,
    missing_tables: missingTables,
    missing_rpcs: missingRpcs,
    missing_rpc_signatures: missingRpcSignatures,
    missing_rpc_grants: missingRpcGrants,
  };
}

export async function readinessPayload(url: string, key: string, timeoutMs: number): Promise<JsonRecord> {
  const response = await fetchWithTimeout(
    `${trimUrl(url)}/rest/v1/rpc/stock_runtime_readiness`,
    {
      method: "POST",
      headers: {
        ...supabaseHeaders(key),
        Accept: "application/json",
      },
      body: JSON.stringify({}),
    },
    timeoutMs
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Supabase readiness RPC failed with HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!isRecord(payload)) throw new Error("Supabase readiness RPC returned a non-object payload.");
  return payload;
}

export async function publicReadPayload(url: string, key: string, timeoutMs: number) {
  const failures: Array<Record<string, unknown>> = [];
  for (const [table, column] of PUBLIC_READ_CHECKS) {
    const endpoint = new URL(`${trimUrl(url)}/rest/v1/${table}`);
    endpoint.searchParams.set("select", column);
    endpoint.searchParams.set("limit", "1");
    try {
      const response = await fetchWithTimeout(
        endpoint.toString(),
        {
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            Accept: "application/json",
          },
        },
        timeoutMs
      );
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        failures.push({ table, status: response.status, message: text.slice(0, 300) });
      }
    } catch (error) {
      failures.push({ table, error: publicError(error) });
    }
  }
  return { ok: failures.length === 0, failures };
}

export async function runReadiness(options: ReadinessOptions) {
  loadLocalEnvFiles();
  const url = process.env.SUPABASE_URL?.trim().replace(/\/$/, "") || "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY?.trim() || "";
  if (!url || !serviceRoleKey || !publishableKey) {
    throw new Error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_PUBLISHABLE_KEY are required for readiness checks.");
  }

  const payload = await readinessPayload(url, serviceRoleKey, options.timeoutMs);
  payload.readiness_contract = readinessContractPayload(payload);
  payload.public_read = await publicReadPayload(url, publishableKey, options.timeoutMs);
  return payload;
}

export function readinessOk(payload: JsonRecord): boolean {
  return payload.ok === true && isOkRecord(payload.readiness_contract) && isOkRecord(payload.public_read);
}

export function parseReadinessOptions(argv: string[]): ReadinessOptions {
  const options: ReadinessOptions = { json: false, timeoutMs: 8_000 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[index];
    };
    if (arg === "--json") options.json = true;
    else if (arg === "--timeout") options.timeoutMs = positiveNumber(next(), 8) * 1000;
    else if (arg === "--timeout-ms") options.timeoutMs = positiveNumber(next(), 8_000);
    else throw new Error(`Unsupported argument: ${arg}`);
  }
  return options;
}

function trimUrl(url: string): string {
  return url.trim().replace(/\/$/, "");
}

function isOkRecord(value: unknown): boolean {
  return isRecord(value) && value.ok === true;
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function arrayOfRpcSignatures(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((item) => {
      const name = typeof item.name === "string" ? item.name : "";
      const identityArguments = typeof item.identity_arguments === "string" ? item.identity_arguments : "";
      return name && identityArguments ? `${name}(${identityArguments})` : "";
    })
    .filter(Boolean);
}

function positiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function publicError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 1000) : "unknown";
}

function isMainModule(): boolean {
  return process.argv[1]?.endsWith("supabase_runtime_readiness.ts") === true;
}

async function main() {
  const options = parseReadinessOptions(process.argv.slice(2));
  const payload = await runReadiness(options);
  if (options.json) console.log(JSON.stringify(payload, null, 2));
  else console.log(readinessOk(payload) ? "Supabase runtime readiness OK." : "Supabase runtime readiness failed.");
  process.exitCode = readinessOk(payload) ? 0 : 1;
}

if (isMainModule()) {
  main().catch((error) => {
    console.error(publicError(error));
    process.exitCode = 2;
  });
}
