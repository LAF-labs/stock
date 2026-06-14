import symbols from "@/data/symbols.generated.json";
import { safeErrorMessage } from "@/lib/errorSafety";
import { fetchWithTimeout, numericEnv, supabaseAdminConfig, supabaseHeaders } from "@/lib/supabaseRest";

export type SecFilingBackfillState = {
  jobId: string;
  status: "queued" | "running" | "completed" | "failed";
  since: string;
  cursor: number;
  totalTickers: number;
  batchSize: number;
  maxFilingsPerTicker: number;
  fetchDocLimit: number;
  processedTickers: number;
  rowsUpserted: number;
  skippedTickers: number;
  docFetches: number;
  companyFactsFetches: number;
  lockedBy?: string;
  lockedUntil?: string;
  lastError?: string;
  startedAt?: string;
  completedAt?: string;
};

type BackfillStateRow = {
  job_id: string;
  status: SecFilingBackfillState["status"];
  since: string;
  cursor: number;
  total_tickers: number;
  batch_size: number;
  max_filings_per_ticker: number;
  fetch_doc_limit: number;
  processed_tickers: number;
  rows_upserted: number;
  skipped_tickers: number;
  doc_fetches: number;
  company_facts_fetches: number;
  locked_by?: string | null;
  locked_until?: string | null;
  last_error?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
};

export type SecFilingBackfillRunResult = {
  tickers: number;
  rows: number;
  skipped: number;
  doc_fetches: number;
  company_facts_fetches: number;
};

const TABLE = "sec_filing_backfill_state";
const SELECT = "job_id,status,since,cursor,total_tickers,batch_size,max_filings_per_ticker,fetch_doc_limit,processed_tickers,rows_upserted,skipped_tickers,doc_fetches,company_facts_fetches,locked_by,locked_until,last_error,started_at,completed_at";

export function usBackfillTickers(): string[] {
  return (symbols as Array<Record<string, unknown>>)
    .filter((item) => item.market === "US" && typeof item.ticker === "string")
    .map((item) => `US:${item.ticker}`);
}

export function nextSecFilingBackfillState(
  state: SecFilingBackfillState,
  result: SecFilingBackfillRunResult,
  processedCount: number,
  nowIso: string
): SecFilingBackfillState {
  const cursor = Math.min(state.totalTickers, state.cursor + processedCount);
  const completed = cursor >= state.totalTickers;
  return {
    ...state,
    status: completed ? "completed" : "queued",
    cursor,
    processedTickers: cursor,
    rowsUpserted: state.rowsUpserted + result.rows,
    skippedTickers: state.skippedTickers + result.skipped,
    docFetches: state.docFetches + result.doc_fetches,
    companyFactsFetches: state.companyFactsFetches + result.company_facts_fetches,
    lockedBy: undefined,
    lockedUntil: undefined,
    lastError: undefined,
    startedAt: state.startedAt || nowIso,
    completedAt: completed ? nowIso : undefined,
  };
}

export async function readOrCreateSecFilingBackfillState(input: {
  jobId?: string;
  since?: string;
  batchSize?: number;
  maxFilingsPerTicker?: number;
  fetchDocLimit?: number;
}): Promise<SecFilingBackfillState> {
  const jobId = input.jobId || "default";
  const existing = await readSecFilingBackfillState(jobId);
  if (existing) return existing;
  const now = new Date().toISOString();
  const state: SecFilingBackfillState = {
    jobId,
    status: "queued",
    since: input.since || oneYearAgo(),
    cursor: 0,
    totalTickers: usBackfillTickers().length,
    batchSize: positive(input.batchSize, 40),
    maxFilingsPerTicker: positive(input.maxFilingsPerTicker, 80),
    fetchDocLimit: positive(input.fetchDocLimit, 40),
    processedTickers: 0,
    rowsUpserted: 0,
    skippedTickers: 0,
    docFetches: 0,
    companyFactsFetches: 0,
    startedAt: now,
  };
  await writeSecFilingBackfillState(state);
  return state;
}

export async function readSecFilingBackfillState(jobId = "default"): Promise<SecFilingBackfillState | undefined> {
  const config = supabaseAdminConfig();
  if (!config) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  const query = new URLSearchParams({
    select: SELECT,
    job_id: `eq.${jobId}`,
    limit: "1",
  });
  const response = await fetchWithTimeout(`${config.url}/rest/v1/${TABLE}?${query.toString()}`, {
    headers: supabaseHeaders(config.key),
    cache: "no-store",
  }, numericEnv("SEC_FILINGS_JOB_SUPABASE_TIMEOUT_MS", 8_000));
  if (!response.ok) throw new Error(`Backfill state read failed: HTTP ${response.status} ${await response.text().catch(() => "")}`);
  const rows = await response.json() as BackfillStateRow[];
  return rows[0] ? stateFromRow(rows[0]) : undefined;
}

export async function writeSecFilingBackfillState(state: SecFilingBackfillState): Promise<void> {
  const config = supabaseAdminConfig();
  if (!config) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  const response = await fetchWithTimeout(`${config.url}/rest/v1/${TABLE}?on_conflict=job_id`, {
    method: "POST",
    headers: {
      ...supabaseHeaders(config.key),
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rowFromState(state)),
  }, numericEnv("SEC_FILINGS_JOB_SUPABASE_TIMEOUT_MS", 8_000));
  if (!response.ok) throw new Error(`Backfill state write failed: HTTP ${response.status} ${await response.text().catch(() => "")}`);
}

export function stateIsLocked(state: SecFilingBackfillState, nowMs = Date.now()): boolean {
  const lockedUntilMs = Date.parse(state.lockedUntil || "");
  return state.status === "running" && Number.isFinite(lockedUntilMs) && lockedUntilMs > nowMs;
}

export function secFilingBackfillPublicError(error: unknown): string {
  return safeErrorMessage(error).slice(0, 1000);
}

function stateFromRow(row: BackfillStateRow): SecFilingBackfillState {
  return {
    jobId: row.job_id,
    status: row.status,
    since: row.since,
    cursor: row.cursor,
    totalTickers: row.total_tickers,
    batchSize: row.batch_size,
    maxFilingsPerTicker: row.max_filings_per_ticker,
    fetchDocLimit: row.fetch_doc_limit,
    processedTickers: row.processed_tickers,
    rowsUpserted: row.rows_upserted,
    skippedTickers: row.skipped_tickers,
    docFetches: row.doc_fetches,
    companyFactsFetches: row.company_facts_fetches,
    lockedBy: row.locked_by || undefined,
    lockedUntil: row.locked_until || undefined,
    lastError: row.last_error || undefined,
    startedAt: row.started_at || undefined,
    completedAt: row.completed_at || undefined,
  };
}

function rowFromState(state: SecFilingBackfillState): BackfillStateRow {
  return {
    job_id: state.jobId,
    status: state.status,
    since: state.since,
    cursor: state.cursor,
    total_tickers: state.totalTickers,
    batch_size: state.batchSize,
    max_filings_per_ticker: state.maxFilingsPerTicker,
    fetch_doc_limit: state.fetchDocLimit,
    processed_tickers: state.processedTickers,
    rows_upserted: state.rowsUpserted,
    skipped_tickers: state.skippedTickers,
    doc_fetches: state.docFetches,
    company_facts_fetches: state.companyFactsFetches,
    locked_by: state.lockedBy || null,
    locked_until: state.lockedUntil || null,
    last_error: state.lastError || null,
    started_at: state.startedAt || null,
    completed_at: state.completedAt || null,
  };
}

function positive(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value && value > 0 ? Math.floor(value) : fallback;
}

function oneYearAgo(): string {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - 1);
  return date.toISOString().slice(0, 10);
}
