import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getStockQuote } from "@/lib/stockQuoteCache";
import { getStockScore, type ScoreView, type StockPayload } from "@/lib/stockSnapshotCache";
import { QUOTE_CACHE_FRESH_SECONDS, QUOTE_CACHE_STALE_SECONDS } from "@/lib/quoteContract";
import { fetchWithTimeout, supabaseAdminConfig, supabaseHeaders, type SupabaseConfig } from "@/lib/supabaseRest";
import { parseTickerRef } from "@/lib/tickerRef";
import { loadLocalEnvFiles } from "./localEnv";
import { readinessContractPayload } from "./supabase_runtime_readiness";

export { loadLocalEnvFiles } from "./localEnv";

type RefreshKind = "quote" | "score";
type WorkerMode = "quote" | "score" | "all";

type RefreshJob = {
  id?: unknown;
  kind?: unknown;
  market?: unknown;
  symbol?: unknown;
  view_mode?: unknown;
  attempts?: unknown;
};

type PublishSummary = {
  ok: boolean;
  dry_run: boolean;
  mode: WorkerMode;
  tickers: number;
  rows: Array<Record<string, unknown>>;
  queue_jobs: number;
  queue_rows: Array<Record<string, unknown>>;
};

type Options = {
  dryRun: boolean;
  json: boolean;
  drainQueue: boolean;
  mode: WorkerMode;
  tickers: string[];
  views: ScoreView[];
  skipQuote: boolean;
  skipScore: boolean;
  queueLimit: number;
  queueLockSeconds: number;
  workerId: string;
  sleepSeconds: number;
  timeoutMs: number;
  allowScorePythonFallback: boolean;
};

export function parseTickerArgs(values: string[]): string[] {
  const unique: string[] = [];
  for (const value of values) {
    for (const part of value.split(",")) {
      const candidate = part.trim();
      if (!candidate || candidate.startsWith("#")) continue;
      const parsed = parseTickerRef(candidate);
      if (!unique.includes(parsed.ticker)) unique.push(parsed.ticker);
    }
  }
  return unique;
}

export function parseViews(raw: string): ScoreView[] {
  const unique: ScoreView[] = [];
  for (const part of raw.split(",")) {
    const view = part.trim().toLowerCase();
    if (view !== "detail" && view !== "compare" && view !== "technical") {
      throw new Error(`Unsupported score view: ${view}`);
    }
    if (!unique.includes(view)) unique.push(view);
  }
  return unique;
}

export function retryAfterSeconds(job: RefreshJob): number {
  const attempts = positiveInteger(job.attempts, 1);
  return Math.min(3600, Math.max(120, 60 * 2 ** Math.max(1, attempts)));
}

export function permanentRefreshFailure(error: string): boolean {
  const normalized = error.trim().toLowerCase();
  return ["invalid_ticker", "kis_not_found", "not_found", "unsupported refresh job kind", "unsupported score view", "404"].some((marker) =>
    normalized.includes(marker)
  );
}

export async function claimRefreshJobs(config: SupabaseConfig, options: Options): Promise<RefreshJob[]> {
  if (options.mode === "all") {
    return postRpc<RefreshJob[]>(config, "claim_stock_refresh_jobs", {
      p_worker_id: options.workerId,
      p_limit: options.queueLimit,
      p_lock_seconds: options.queueLockSeconds,
    }, options.timeoutMs);
  }

  return postRpc<RefreshJob[]>(config, "claim_stock_refresh_jobs_by_kind", {
    p_worker_id: options.workerId,
    p_kind: options.mode,
    p_limit: options.queueLimit,
    p_lock_seconds: options.queueLockSeconds,
  }, options.timeoutMs);
}

export async function assertRefreshWorkerReadiness(config: SupabaseConfig, options: Pick<Options, "timeoutMs">): Promise<void> {
  const payload = await postRpc<Record<string, unknown>>(config, "stock_runtime_readiness", {}, options.timeoutMs);
  const contract = readinessContractPayload(payload);
  if (contract.ok) return;
  throw new Error(
    [
      "Supabase runtime readiness failed before queue drain.",
      `missing_tables=${contract.missing_tables.join(",") || "none"}`,
      `missing_rpcs=${contract.missing_rpcs.join(",") || "none"}`,
    ].join(" ")
  );
}

export async function completeRefreshJob(config: SupabaseConfig, workerId: string, jobId: string, timeoutMs: number) {
  await postRpc(config, "complete_stock_refresh_job", { p_job_id: jobId, p_worker_id: workerId }, timeoutMs);
}

export async function failRefreshJob(config: SupabaseConfig, workerId: string, jobId: string, error: string, retrySeconds: number, timeoutMs: number) {
  await postRpc(
    config,
    "fail_stock_refresh_job",
    {
      p_job_id: jobId,
      p_worker_id: workerId,
      p_error: error.slice(0, 1000),
      p_retry_after_seconds: retrySeconds,
      p_permanent: permanentRefreshFailure(error),
    },
    timeoutMs
  );
}

async function postRpc<T = unknown>(config: SupabaseConfig, name: string, body: Record<string, unknown>, timeoutMs: number): Promise<T> {
  const response = await fetchWithTimeout(
    `${config.url}/rest/v1/rpc/${name}`,
    {
      method: "POST",
      headers: supabaseHeaders(config.key),
      body: JSON.stringify(body),
    },
    timeoutMs
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Supabase RPC ${name} failed: HTTP ${response.status} ${text.slice(0, 300)}`);
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

export async function upsertQuoteSnapshot(config: SupabaseConfig, ticker: string, payload: StockPayload, fetchedAt?: string, expiresAt?: string, staleExpiresAt?: string) {
  const target = parseTickerRef(ticker);
  const fetched = validIso(fetchedAt) || new Date().toISOString();
  const expires = validIso(expiresAt) || new Date(Date.parse(fetched) + QUOTE_CACHE_FRESH_SECONDS * 1000).toISOString();
  const stale = validIso(staleExpiresAt) || new Date(Math.max(Date.parse(expires), Date.parse(fetched) + QUOTE_CACHE_STALE_SECONDS * 1000)).toISOString();
  const response = await fetchWithTimeout(
    `${config.url}/rest/v1/stock_quote_snapshots?on_conflict=ticker`,
    {
      method: "POST",
      headers: {
        ...supabaseHeaders(config.key),
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        ticker: target.ticker,
        market: target.market,
        symbol: target.symbol,
        source: "kis",
        payload,
        fetched_at: fetched,
        expires_at: expires,
        stale_expires_at: stale,
      }),
    },
    5_000
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Supabase quote snapshot upsert failed: HTTP ${response.status} ${text.slice(0, 300)}`);
  }
}

function assertFreshQuoteRefresh(cache: { source?: string; refreshError?: string }, ticker: string) {
  if (cache.refreshError) throw new Error(cache.refreshError);
  if (cache.source !== "market-data") {
    throw new Error(`quote_refresh_not_performed:${ticker}`);
  }
}

async function publishTicker(ticker: string, options: Options, config?: SupabaseConfig) {
  const row: Record<string, unknown> = { ticker, quote: null, scores: {}, errors: [] as Array<Record<string, unknown>> };
  if (!options.skipQuote) {
    try {
      if (!options.dryRun) {
        const result = await getStockQuote(ticker, { forceRefresh: true });
        assertFreshQuoteRefresh(result.cache, ticker);
        if (config) await upsertQuoteSnapshot(config, ticker, result.payload, result.cache.fetchedAt, result.cache.expiresAt, result.cache.staleExpiresAt);
      }
      row.quote = options.dryRun ? "dry_run" : "published";
    } catch (error) {
      row.quote = "error";
      (row.errors as Array<Record<string, unknown>>).push({ kind: "quote", error: publicError(error) });
    }
  }

  if (!options.skipScore) {
    for (const view of options.views) {
      try {
        if (!options.allowScorePythonFallback) {
          throw new Error("score publishing requires --allow-score-python-fallback until the Rust score worker owns durable snapshots");
        }
        if (!options.dryRun) await getStockScore(ticker, view, { forceRefresh: true });
        (row.scores as Record<string, unknown>)[view] = options.dryRun ? "dry_run" : "published";
      } catch (error) {
        (row.scores as Record<string, unknown>)[view] = "error";
        (row.errors as Array<Record<string, unknown>>).push({ kind: "score", view, error: publicError(error) });
      }
    }
  }
  return row;
}

export async function publishQueueJob(job: RefreshJob, config: SupabaseConfig, options: Options) {
  const jobId = stringValue(job.id);
  const kind = stringValue(job.kind)?.toLowerCase() as RefreshKind | undefined;
  const ticker = jobTicker(job);
  const rawView = stringValue(job.view_mode)?.toLowerCase();
  const view = rawView ? scoreViewValue(rawView) : "detail";
  const row: Record<string, unknown> = { job_id: jobId, kind, ticker, view: kind === "score" ? view || rawView : undefined, status: null, errors: [] as Array<Record<string, unknown>> };

  try {
    if (!jobId) throw new Error("claimed job is missing id");
    if (kind === "quote") {
      const result = await getStockQuote(ticker, { forceRefresh: true });
      assertFreshQuoteRefresh(result.cache, ticker);
      await upsertQuoteSnapshot(config, ticker, result.payload, result.cache.fetchedAt, result.cache.expiresAt, result.cache.staleExpiresAt);
    } else if (kind === "score") {
      if (!view) {
        throw new Error(`unsupported score view: ${String(rawView || "")}`);
      }
      if (!options.allowScorePythonFallback) {
        throw new Error("score job requires legacy score fallback worker");
      }
      await getStockScore(ticker, view, { forceRefresh: true });
    } else {
      throw new Error(`unsupported refresh job kind: ${String(kind || "")}`);
    }
    await completeRefreshJob(config, options.workerId, jobId, options.timeoutMs);
    row.status = "succeeded";
  } catch (error) {
    const message = publicError(error);
    row.status = "failed";
    (row.errors as Array<Record<string, unknown>>).push({ error: message });
    if (jobId) {
      await failRefreshJob(config, options.workerId, jobId, message, retryAfterSeconds(job), options.timeoutMs);
    }
  }

  return row;
}

export async function drainRefreshQueue(config: SupabaseConfig, options: Options) {
  const jobs = await claimRefreshJobs(config, options);
  const rows: Array<Record<string, unknown>> = [];
  for (let index = 0; index < jobs.length; index += 1) {
    if (index > 0 && options.sleepSeconds > 0) await sleep(options.sleepSeconds * 1000);
    rows.push(await publishQueueJob(jobs[index], config, options));
  }
  return rows;
}

export async function run(options: Options): Promise<PublishSummary> {
  if (!options.allowScorePythonFallback) {
    process.env.STOCK_DATA_RUNTIME = "snapshot";
    process.env.STOCK_DATA_BACKEND = "snapshot";
  }

  const config = options.dryRun ? undefined : supabaseAdminConfig();
  if (!options.dryRun && !config) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required unless --dry-run is used.");
  }

  if (options.drainQueue && config) await assertRefreshWorkerReadiness(config, options);
  const queueRows = options.drainQueue && config ? await drainRefreshQueue(config, options) : [];
  const rows: Array<Record<string, unknown>> = [];
  for (let index = 0; index < options.tickers.length; index += 1) {
    if (index > 0 && options.sleepSeconds > 0) await sleep(options.sleepSeconds * 1000);
    rows.push(await publishTicker(options.tickers[index], options, config));
  }

  return {
    ok: !rows.some(hasErrors) && !queueRows.some(hasErrors),
    dry_run: options.dryRun,
    mode: options.mode,
    tickers: options.tickers.length,
    rows,
    queue_jobs: queueRows.length,
    queue_rows: queueRows,
  };
}

export function parseOptions(argv: string[], env: Record<string, string | undefined> = process.env): Options {
  const tickers: string[] = [];
  let views = "detail,compare";
  let mode: WorkerMode = "quote";
  const options = {
    dryRun: false,
    json: false,
    drainQueue: false,
    skipQuote: false,
    skipScore: true,
    queueLimit: positiveInteger(env.STOCK_SNAPSHOT_QUEUE_LIMIT, 50),
    queueLockSeconds: positiveInteger(env.STOCK_SNAPSHOT_QUEUE_LOCK_SECONDS, 900),
    workerId: env.STOCK_SNAPSHOT_WORKER_ID || `stock-snapshot-ts-${process.pid}`,
    sleepSeconds: positiveNumber(env.STOCK_SNAPSHOT_SLEEP_SECONDS, 0),
    timeoutMs: positiveInteger(env.STOCK_SNAPSHOT_SUPABASE_TIMEOUT_MS, 15_000),
    allowScorePythonFallback: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[index];
    };
    if (arg === "--ticker") tickers.push(next());
    else if (arg === "--tickers") tickers.push(next());
    else if (arg === "--views") views = next();
    else if (arg === "--kind" || arg === "--queue-kind") mode = parseMode(next());
    else if (arg === "--drain-queue" || arg === "--from-queue") options.drainQueue = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--skip-quote") options.skipQuote = true;
    else if (arg === "--include-score") options.skipScore = false;
    else if (arg === "--skip-score") options.skipScore = true;
    else if (arg === "--allow-score-python-fallback") options.allowScorePythonFallback = true;
    else if (arg === "--queue-limit") options.queueLimit = positiveInteger(next(), options.queueLimit);
    else if (arg === "--queue-lock-seconds") options.queueLockSeconds = positiveInteger(next(), options.queueLockSeconds);
    else if (arg === "--worker-id") options.workerId = next();
    else if (arg === "--sleep-seconds") options.sleepSeconds = positiveNumber(next(), options.sleepSeconds);
    else if (arg === "--timeout-ms") options.timeoutMs = positiveInteger(next(), options.timeoutMs);
    else throw new Error(`Unsupported argument: ${arg}`);
  }

  const parsedViews = parseViews(views);
  const parsedTickers = parseTickerArgs(tickers);
  if (!parsedTickers.length && !options.drainQueue) throw new Error("At least one ticker is required unless --drain-queue is used.");
  if (options.skipQuote && options.skipScore) throw new Error("At least one of quote or score publishing must be enabled.");
  if (!options.allowScorePythonFallback && (mode !== "quote" || !options.skipScore)) {
    throw new Error("Score publishing requires --allow-score-python-fallback. Use the legacy Python score worker for score jobs.");
  }

  return {
    ...options,
    mode,
    tickers: parsedTickers,
    views: parsedViews,
  };
}

function parseMode(value: string): WorkerMode {
  const mode = value.trim().toLowerCase();
  if (mode === "quote" || mode === "score" || mode === "all") return mode;
  throw new Error(`Unsupported queue kind: ${value}`);
}

function jobTicker(job: RefreshJob): string {
  const market = stringValue(job.market) || "US";
  const symbol = stringValue(job.symbol) || "";
  return parseTickerRef(`${market}:${symbol}`).ticker;
}

function scoreViewValue(value: unknown): ScoreView | undefined {
  return value === "detail" || value === "compare" || value === "technical" ? value : undefined;
}

function hasErrors(row: Record<string, unknown>): boolean {
  return Array.isArray(row.errors) && row.errors.length > 0;
}

function publicError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 1000) : "unknown";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function validIso(value: string | undefined): string | undefined {
  return value && Number.isFinite(Date.parse(value)) ? value : undefined;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isMainModule(): boolean {
  return process.argv[1] ? fileURLToPath(import.meta.url) === resolve(process.argv[1]) : false;
}

async function main() {
  loadLocalEnvFiles();
  const options = parseOptions(process.argv.slice(2));
  const payload = await run(options);
  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    for (const row of payload.rows) console.log(`${row.ticker} quote=${row.quote} errors=${Array.isArray(row.errors) ? row.errors.length : 0}`);
    for (const row of payload.queue_rows) console.log(`${row.job_id} ${row.kind} ${row.ticker} status=${row.status}`);
    console.log(payload.ok ? "OK" : "FAILED");
  }
  process.exitCode = payload.ok ? 0 : 1;
}

if (isMainModule()) {
  main().catch((error) => {
    console.error(publicError(error));
    process.exitCode = 2;
  });
}
