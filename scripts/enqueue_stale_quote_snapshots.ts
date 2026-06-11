import { fetchWithTimeout, supabaseAdminConfig, supabaseHeaders, type SupabaseConfig } from "@/lib/supabaseRest";
import { parseTickerRef } from "@/lib/tickerRef";
import { loadLocalEnvFiles } from "./localEnv";

type StaleQuoteRow = {
  ticker?: unknown;
  market?: unknown;
  symbol?: unknown;
  stale_expires_at?: unknown;
};

export type Options = {
  dryRun: boolean;
  json: boolean;
  limit: number;
  priority: number;
  timeoutMs: number;
};

type EnqueueSummary = {
  ok: boolean;
  dry_run: boolean;
  cutoff: string;
  stale_rows: number;
  queued: number;
  skipped: number;
  rows: Array<Record<string, unknown>>;
};

const DEFAULT_LIMIT = 50;
const DEFAULT_PRIORITY = 50;
const DEFAULT_TIMEOUT_MS = 15_000;

export function parseOptions(argv: string[], env: Record<string, string | undefined> = process.env): Options {
  const options: Options = {
    dryRun: false,
    json: false,
    limit: positiveInteger(env.STOCK_STALE_QUOTE_REFRESH_LIMIT, DEFAULT_LIMIT),
    priority: positiveInteger(env.STOCK_STALE_QUOTE_REFRESH_PRIORITY, DEFAULT_PRIORITY),
    timeoutMs: positiveInteger(env.STOCK_SNAPSHOT_SUPABASE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[index];
    };
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--limit") options.limit = positiveInteger(next(), options.limit);
    else if (arg === "--priority") options.priority = positiveInteger(next(), options.priority);
    else if (arg === "--timeout-ms") options.timeoutMs = positiveInteger(next(), options.timeoutMs);
    else throw new Error(`Unsupported argument: ${arg}`);
  }

  return options;
}

export async function enqueueStaleQuoteSnapshots(config: SupabaseConfig, options: Options, now = new Date()): Promise<EnqueueSummary> {
  const cutoff = now.toISOString();
  const staleRows = await fetchStaleQuoteRows(config, options, cutoff);
  const rows: Array<Record<string, unknown>> = [];
  let queued = 0;
  let skipped = 0;

  for (const row of staleRows) {
    const result = await enqueueStaleRow(config, row, options);
    rows.push(result);
    if (result.status === "queued") queued += 1;
    else skipped += 1;
  }

  return {
    ok: rows.every((row) => row.status === "queued" || row.status === "dry_run"),
    dry_run: options.dryRun,
    cutoff,
    stale_rows: staleRows.length,
    queued,
    skipped,
    rows,
  };
}

async function fetchStaleQuoteRows(config: SupabaseConfig, options: Options, cutoff: string): Promise<StaleQuoteRow[]> {
  const query = new URLSearchParams({
    select: "ticker,market,symbol,stale_expires_at",
    stale_expires_at: `lte.${cutoff}`,
    order: "stale_expires_at.asc",
    limit: String(options.limit),
  });
  const response = await fetchWithTimeout(
    `${config.url}/rest/v1/stock_quote_snapshots?${query.toString()}`,
    { headers: supabaseHeaders(config.key) },
    options.timeoutMs
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Supabase stale quote query failed: HTTP ${response.status} ${text.slice(0, 300)}`);
  }
  const payload = (await response.json()) as unknown;
  return Array.isArray(payload) ? payload.filter(isRecord) : [];
}

async function enqueueStaleRow(config: SupabaseConfig, row: StaleQuoteRow, options: Options): Promise<Record<string, unknown>> {
  const ticker = stringValue(row.ticker) || targetFromMarketSymbol(row);
  if (!ticker) return { ticker, status: "skipped", reason: "invalid stale quote row" };

  try {
    const target = parseTickerRef(ticker);
    const body = {
      p_kind: "quote",
      p_market: target.market,
      p_symbol: target.symbol,
      p_view_mode: null,
      p_priority: options.priority,
      p_payload: {
        reason: "stale_quote_snapshot",
        reason_bucket: "stale_quote_snapshot",
        requested_ticker: target.ticker,
        stale_expires_at: stringValue(row.stale_expires_at) || null,
      },
    };
    if (!options.dryRun) {
      const response = await fetchWithTimeout(
        `${config.url}/rest/v1/rpc/enqueue_stock_refresh_job`,
        {
          method: "POST",
          headers: supabaseHeaders(config.key),
          body: JSON.stringify(body),
        },
        options.timeoutMs
      );
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`HTTP ${response.status} ${text.slice(0, 300)}`);
      }
    }
    return { ticker: target.ticker, status: options.dryRun ? "dry_run" : "queued" };
  } catch (error) {
    return { ticker, status: "skipped", reason: publicError(error) };
  }
}

function targetFromMarketSymbol(row: StaleQuoteRow): string | undefined {
  const market = stringValue(row.market);
  const symbol = stringValue(row.symbol);
  return market && symbol ? `${market}:${symbol}` : undefined;
}

function positiveInteger(value: string | number | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function publicError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 1000) : "unknown";
}

async function main() {
  loadLocalEnvFiles();
  const options = parseOptions(process.argv.slice(2));
  const config = supabaseAdminConfig();
  if (!config) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  const result = await enqueueStaleQuoteSnapshots(config, options);
  if (options.json) console.log(JSON.stringify(result));
  else console.log(`stale_rows=${result.stale_rows} queued=${result.queued} skipped=${result.skipped}`);
  if (!result.ok) process.exitCode = 1;
}

const isCli = process.argv[1]?.endsWith("enqueue_stale_quote_snapshots.ts");
if (isCli) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
