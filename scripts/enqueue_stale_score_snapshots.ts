import { fetchWithTimeout, supabaseAdminConfig, supabaseHeaders, type SupabaseConfig } from "@/lib/supabaseRest";
import { parseTickerRef } from "@/lib/tickerRef";
import { fetchRefreshTargetRows, scoreEnabledTargetTickers } from "./stock_operations_report";
import { loadLocalEnvFiles } from "./localEnv";

type ScoreView = "detail" | "compare" | "technical";

type StaleScoreRow = {
  ticker?: unknown;
  view_mode?: unknown;
  fetched_at?: unknown;
};

export type Options = {
  dryRun: boolean;
  json: boolean;
  staleHours: number;
  limit: number;
  views: ScoreView[];
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

const DEFAULT_STALE_HOURS = 24;
const DEFAULT_LIMIT = 50;
const DEFAULT_PRIORITY = 70;
const DEFAULT_TIMEOUT_MS = 15_000;

export function parseOptions(argv: string[], env: Record<string, string | undefined> = process.env): Options {
  const options: Options = {
    dryRun: false,
    json: false,
    staleHours: positiveNumber(env.STOCK_SCORE_STALE_HOURS, DEFAULT_STALE_HOURS),
    limit: positiveInteger(env.STOCK_STALE_SCORE_REFRESH_LIMIT, DEFAULT_LIMIT),
    views: parseViews(env.STOCK_STALE_SCORE_REFRESH_VIEWS || "detail,compare,technical"),
    priority: positiveInteger(env.STOCK_STALE_SCORE_REFRESH_PRIORITY, DEFAULT_PRIORITY),
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
    else if (arg === "--stale-hours") options.staleHours = positiveNumber(next(), options.staleHours);
    else if (arg === "--limit") options.limit = positiveInteger(next(), options.limit);
    else if (arg === "--views") options.views = parseViews(next());
    else if (arg === "--priority") options.priority = positiveInteger(next(), options.priority);
    else if (arg === "--timeout-ms") options.timeoutMs = positiveInteger(next(), options.timeoutMs);
    else throw new Error(`Unsupported argument: ${arg}`);
  }

  return options;
}

export async function enqueueStaleScoreSnapshots(config: SupabaseConfig, options: Options, now = new Date()): Promise<EnqueueSummary> {
  const cutoff = new Date(now.getTime() - options.staleHours * 3_600_000).toISOString();
  const nowIso = now.toISOString();
  const [staleRows, targetRows] = await Promise.all([
    fetchStaleScoreRows(config, options, cutoff, nowIso),
    fetchRefreshTargetRows({ url: config.url, key: config.key, timeoutMs: options.timeoutMs }),
  ]);
  const scoreEnabledTickers = scoreEnabledTargetTickers(targetRows);
  const rows: Array<Record<string, unknown>> = [];
  let queued = 0;
  let skipped = 0;

  for (const row of staleRows) {
    if (!isScoreEnabledRow(row, scoreEnabledTickers)) {
      rows.push({
        ticker: stringValue(row.ticker),
        view: scoreView(row.view_mode),
        status: "ignored",
        reason: "score target disabled",
      });
      skipped += 1;
      continue;
    }
    const result = await enqueueStaleRow(config, row, options);
    rows.push(result);
    if (result.status === "queued") queued += 1;
    else skipped += 1;
  }

  return {
    ok: rows.every((row) => row.status === "queued" || row.status === "dry_run" || row.status === "ignored"),
    dry_run: options.dryRun,
    cutoff,
    stale_rows: staleRows.length,
    queued,
    skipped,
    rows,
  };
}

function isScoreEnabledRow(row: StaleScoreRow, scoreEnabledTickers: Set<string>) {
  const ticker = stringValue(row.ticker);
  if (!ticker) return false;
  try {
    return scoreEnabledTickers.has(parseTickerRef(ticker).ticker);
  } catch {
    return false;
  }
}

async function fetchStaleScoreRows(config: SupabaseConfig, options: Options, cutoff: string, nowIso: string): Promise<StaleScoreRow[]> {
  const query = new URLSearchParams({
    select: "ticker,view_mode,fetched_at,expires_at",
    or: `(fetched_at.lt.${cutoff},expires_at.lte.${nowIso})`,
    view_mode: `in.(${options.views.join(",")})`,
    order: "fetched_at.asc",
    limit: String(options.limit),
  });
  const response = await fetchWithTimeout(
    `${config.url}/rest/v1/stock_score_snapshots?${query.toString()}`,
    { headers: supabaseHeaders(config.key) },
    options.timeoutMs
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Supabase stale score query failed: HTTP ${response.status} ${text.slice(0, 300)}`);
  }
  const payload = (await response.json()) as unknown;
  return Array.isArray(payload) ? payload.filter(isRecord) : [];
}

async function enqueueStaleRow(config: SupabaseConfig, row: StaleScoreRow, options: Options): Promise<Record<string, unknown>> {
  const ticker = stringValue(row.ticker);
  const view = scoreView(row.view_mode);
  if (!ticker || !view) return { ticker, view, status: "skipped", reason: "invalid stale score row" };

  try {
    const target = parseTickerRef(ticker);
    const body = {
      p_kind: "score",
      p_market: target.market,
      p_symbol: target.symbol,
      p_view_mode: view,
      p_priority: options.priority,
      p_payload: {
        reason: "stale_score_snapshot",
        reason_bucket: "stale_score_snapshot",
        requested_ticker: target.ticker,
        stale_fetched_at: stringValue(row.fetched_at) || null,
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
    return { ticker: target.ticker, view, status: options.dryRun ? "dry_run" : "queued" };
  } catch (error) {
    return { ticker, view, status: "skipped", reason: publicError(error) };
  }
}

function parseViews(raw: string): ScoreView[] {
  const unique: ScoreView[] = [];
  for (const part of raw.split(",")) {
    const view = scoreView(part);
    if (!view) throw new Error(`Unsupported score view: ${part}`);
    if (!unique.includes(view)) unique.push(view);
  }
  if (!unique.length) throw new Error("At least one score view is required.");
  return unique;
}

function scoreView(value: unknown): ScoreView | undefined {
  const view = stringValue(value)?.toLowerCase();
  if (view === "detail" || view === "compare" || view === "technical") return view;
  return undefined;
}

function positiveInteger(value: string | number | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function positiveNumber(value: string | number | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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
  const result = await enqueueStaleScoreSnapshots(config, options);
  if (options.json) console.log(JSON.stringify(result));
  else console.log(`stale_rows=${result.stale_rows} queued=${result.queued} skipped=${result.skipped}`);
  if (!result.ok) process.exitCode = 1;
}

const isCli = process.argv[1]?.endsWith("enqueue_stale_score_snapshots.ts");
if (isCli) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
