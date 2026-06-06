import { fetchWithTimeout, supabaseHeaders } from "@/lib/supabaseRest";
import { loadLocalEnvFiles } from "./localEnv";

export const DEFAULT_SCORE_MODEL_VERSION = "score-v5-dual-quality-opportunity-2026-06-05";

type JsonRecord = Record<string, unknown>;
type ThresholdDirection = "max" | "min";
type ThresholdValueKind = "number" | "count";
type ThresholdRule = readonly [key: string, direction: ThresholdDirection, label: string, path: readonly string[], valueKind: ThresholdValueKind];

export const THRESHOLD_RULES = [
  ["max_total_refresh_jobs", "max", "refresh_queue.total_jobs", ["refresh_queue", "total_jobs"], "number"],
  ["max_queued_refresh_jobs", "max", "refresh_queue.queued_jobs", ["refresh_queue", "queued_jobs"], "number"],
  ["max_dead_refresh_jobs", "max", "refresh_queue.dead_jobs", ["refresh_queue", "dead_jobs"], "number"],
  ["max_stale_running_refresh_jobs", "max", "refresh_queue.stale_running_jobs", ["refresh_queue", "stale_running_jobs"], "number"],
  ["max_due_refresh_age_minutes", "max", "refresh_queue.oldest_due_age_minutes", ["refresh_queue", "oldest_due_age_minutes"], "number"],
  ["max_stale_score_snapshots", "max", "score_calibration.stale_snapshots", ["score_calibration", "stale_snapshots"], "number"],
  ["min_current_score_model_rate", "min", "score_calibration.current_model_rate", ["score_calibration", "current_model_rate"], "number"],
  ["max_duplicate_score_rate", "max", "score_calibration.duplicate_score_rate", ["score_calibration", "duplicate_score_rate"], "number"],
  [
    "max_low_confidence_high_score",
    "max",
    "score_calibration.low_confidence_high_score_count",
    ["score_calibration", "low_confidence_high_score_count"],
    "number",
  ],
  ["max_stale_quote_rate", "max", "quote_freshness.stale_rate", ["quote_freshness", "stale_rate"], "number"],
  ["max_missing_quote_price", "max", "quote_freshness.missing_price_count", ["quote_freshness", "missing_price_count"], "number"],
  [
    "max_expired_industry_benchmark_rows",
    "max",
    "industry_benchmarks.expired_rows",
    ["industry_benchmarks", "expired_rows"],
    "number",
  ],
  [
    "max_low_sample_industry_benchmark_rows",
    "max",
    "industry_benchmarks.low_sample_rows",
    ["industry_benchmarks", "low_sample_rows"],
    "number",
  ],
  ["max_market_calendar_thin_markets", "max", "market_calendar.missing_or_thin_markets", ["market_calendar", "missing_or_thin_markets"], "count"],
] as const satisfies readonly ThresholdRule[];

const THRESHOLD_ARGS = new Map(THRESHOLD_RULES.map(([key]) => [`--${key.replaceAll("_", "-")}`, key]));

export type SupabaseReportConfig = {
  url: string;
  key: string;
  timeoutMs: number;
};

export type OperationsOptions = {
  json: boolean;
  failOnThreshold: boolean;
  sampleLimit: number;
  scoreStaleHours: number;
  expectedScoreModelVersion: string;
  thresholds: Record<string, number>;
  supabaseUrl?: string;
  supabaseKey?: string;
  timeoutMs: number;
};

export function summarizeQueueRows(rows: JsonRecord[], now = new Date()) {
  const byStatus: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  let oldestRunAfter: string | null = null;
  let total = 0;
  let staleRunning = 0;

  for (const row of rows) {
    const jobs = intValue(row.jobs);
    const status = stringValue(row.status)?.toLowerCase() || "unknown";
    const kind = stringValue(row.kind)?.toLowerCase() || "unknown";
    total += jobs;
    byStatus[status] = (byStatus[status] || 0) + jobs;
    byKind[kind] = (byKind[kind] || 0) + jobs;
    staleRunning += intValue(row.stale_running_jobs);
    const runAfter = stringValue(row.oldest_run_after);
    if (runAfter && (oldestRunAfter === null || runAfter < oldestRunAfter)) oldestRunAfter = runAfter;
  }

  const oldestRunAfterDate = parseDateTime(oldestRunAfter);
  const oldestDueAgeMinutes = oldestRunAfterDate && oldestRunAfterDate.getTime() <= now.getTime()
    ? rounded((now.getTime() - oldestRunAfterDate.getTime()) / 60_000, 1)
    : null;

  return {
    total_jobs: total,
    queued_jobs: byStatus.queued || 0,
    running_jobs: byStatus.running || 0,
    dead_jobs: byStatus.dead || 0,
    succeeded_jobs: byStatus.succeeded || 0,
    failed_jobs: byStatus.failed || 0,
    stale_running_jobs: staleRunning,
    oldest_run_after: oldestRunAfter,
    oldest_due_age_minutes: oldestDueAgeMinutes,
    by_status: byStatus,
    by_kind: byKind,
  };
}

export function summarizeScoreSnapshots(
  rows: JsonRecord[],
  expectedModelVersion = DEFAULT_SCORE_MODEL_VERSION,
  now = new Date(),
  staleAfterHours = 24
) {
  const scores: number[] = [];
  const qualityScores: number[] = [];
  const opportunityScores: number[] = [];
  const confidences: number[] = [];
  const duplicateBuckets = new Map<number, number>();
  let missingModel = 0;
  let currentModel = 0;
  let stale = 0;
  let lowConfidenceHighScore = 0;

  for (const row of rows) {
    const payload = isRecord(row.payload) ? row.payload : {};
    const score = finiteNumber(payload.score);
    const quality = finiteNumber(payload.quality_score);
    const opportunity = finiteNumber(payload.opportunity_score);
    const confidence = payloadConfidence(payload);
    const model = scoreModelVersion(row, payload);

    if (model === undefined) missingModel += 1;
    else if (model === expectedModelVersion) currentModel += 1;
    if (isStaleSnapshot(row, now, staleAfterHours)) stale += 1;

    if (score !== undefined) {
      scores.push(score);
      const bucket = Number(score.toFixed(1));
      duplicateBuckets.set(bucket, (duplicateBuckets.get(bucket) || 0) + 1);
      if (confidence !== undefined && confidence < 0.5 && score > 60.0) lowConfidenceHighScore += 1;
    }
    if (quality !== undefined) qualityScores.push(quality);
    if (opportunity !== undefined) opportunityScores.push(opportunity);
    if (confidence !== undefined) confidences.push(confidence);
  }

  const duplicateItems = [...duplicateBuckets.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .map(([score, count]) => ({ score, count }));
  const duplicateMembers = duplicateItems.reduce((sum, item) => sum + item.count, 0);

  return {
    total_snapshots: rows.length,
    current_model_snapshots: currentModel,
    current_model_rate: rows.length ? rounded(currentModel / rows.length, 3) : 0.0,
    missing_model_count: missingModel,
    missing_model_rate: rows.length ? rounded(missingModel / rows.length, 3) : 0.0,
    stale_snapshots: stale,
    score_min: scores.length ? rounded(Math.min(...scores)) : null,
    score_max: scores.length ? rounded(Math.max(...scores)) : null,
    score_mean: scores.length ? rounded(mean(scores)) : null,
    quality_mean: qualityScores.length ? rounded(mean(qualityScores)) : null,
    opportunity_mean: opportunityScores.length ? rounded(mean(opportunityScores)) : null,
    confidence_mean: confidences.length ? rounded(mean(confidences), 3) : null,
    low_confidence_high_score_count: lowConfidenceHighScore,
    duplicate_score_bucket_count: duplicateItems.length,
    duplicate_score_rate: rows.length ? rounded(duplicateMembers / rows.length, 3) : 0.0,
    max_duplicate_bucket_size: duplicateItems[0]?.count || 0,
    top_duplicate_scores: duplicateItems.slice(0, 10),
  };
}

export function summarizeQuoteSnapshots(rows: JsonRecord[], now = new Date(), staleAfterHours = 2) {
  let stale = 0;
  let missingPrice = 0;
  const byMarket: Record<string, number> = {};
  const byCacheState: Record<string, number> = {};

  for (const row of rows) {
    const payload = isRecord(row.payload) ? row.payload : {};
    const market = stringValue(payload.market) || (String(row.ticker || "").startsWith("KR:") ? "KR" : "US");
    byMarket[market] = (byMarket[market] || 0) + 1;
    const serverCache = isRecord(payload.server_cache) ? payload.server_cache : {};
    const state = stringValue(serverCache.state) || "unknown";
    byCacheState[state] = (byCacheState[state] || 0) + 1;
    if (finiteNumber(payload.latest_price) === undefined) missingPrice += 1;
    if (isStaleSnapshot(row, now, staleAfterHours)) stale += 1;
  }

  return {
    total_snapshots: rows.length,
    stale_snapshots: stale,
    stale_rate: rows.length ? rounded(stale / rows.length, 3) : 0.0,
    missing_price_count: missingPrice,
    by_market: byMarket,
    by_cache_state: byCacheState,
  };
}

export function summarizeIndustryBenchmarks(rows: JsonRecord[], now = new Date()) {
  let expired = 0;
  let lowSample = 0;
  const byMetric: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  let newestAsOf: string | null = null;
  let oldestAsOf: string | null = null;

  for (const row of rows) {
    const metric = stringValue(row.metric) || "unknown";
    const source = stringValue(row.source) || "unknown";
    byMetric[metric] = (byMetric[metric] || 0) + 1;
    bySource[source] = (bySource[source] || 0) + 1;
    const sampleCount = intValue(row.sample_count);
    if (sampleCount && sampleCount < 8) lowSample += 1;
    const expiresAt = parseDateTime(stringValue(row.expires_at));
    if (expiresAt && expiresAt.getTime() <= now.getTime()) expired += 1;
    const asOf = stringValue(row.as_of_date);
    if (asOf) {
      if (newestAsOf === null || asOf > newestAsOf) newestAsOf = asOf;
      if (oldestAsOf === null || asOf < oldestAsOf) oldestAsOf = asOf;
    }
  }

  return {
    total_rows: rows.length,
    expired_rows: expired,
    low_sample_rows: lowSample,
    oldest_as_of_date: oldestAsOf,
    newest_as_of_date: newestAsOf,
    by_metric: byMetric,
    by_source: bySource,
  };
}

export function summarizeMarketCalendar(rows: JsonRecord[], expectedDays = 30) {
  const byMarket: Record<string, { rows: number; open_days: number; last_trade_date: string | null }> = {};
  for (const row of rows) {
    const market = stringValue(row.market) || "unknown";
    const item = byMarket[market] || { rows: 0, open_days: 0, last_trade_date: null };
    item.rows += 1;
    if (row.is_open === true) item.open_days += 1;
    const tradeDate = stringValue(row.trade_date);
    if (tradeDate && (item.last_trade_date === null || tradeDate > item.last_trade_date)) item.last_trade_date = tradeDate;
    byMarket[market] = item;
  }
  const missingOrThinMarkets = ["KR", "US"].filter((market) => (byMarket[market]?.rows || 0) < Math.max(5, Math.floor(expectedDays / 3)));
  return {
    total_rows: rows.length,
    expected_days: expectedDays,
    missing_or_thin_markets: missingOrThinMarkets,
    by_market: byMarket,
  };
}

export function evaluateOperationsThresholds(payload: JsonRecord, thresholds: Record<string, number>) {
  const violations: Array<Record<string, unknown>> = [];
  for (const [key, direction, label, path, valueKind] of THRESHOLD_RULES) {
    const actual = valueKind === "count" ? nestedCount(payload, path) : nestedNumber(payload, path);
    if (direction === "min") addMinViolation(violations, thresholds, key, label, actual);
    else addMaxViolation(violations, thresholds, key, label, actual);
  }
  return {
    configured: Object.keys(thresholds).length > 0,
    ok: violations.length === 0,
    violations,
  };
}

export async function fetchSupabaseReport(
  config: SupabaseReportConfig,
  sampleLimit = 500,
  staleAfterHours = 24,
  expectedModelVersion = DEFAULT_SCORE_MODEL_VERSION
) {
  const rawOperations = await postSupabaseRpc(config, "stock_operations_report", { p_score_stale_hours: staleAfterHours });
  const refreshQueueRows = isRecord(rawOperations) && Array.isArray(rawOperations.refresh_queue) ? rawOperations.refresh_queue.filter(isRecord) : [];
  const [scoreRows, quoteRows, benchmarkRows, calendarRows] = await Promise.all([
    fetchScoreSnapshotRows(config, sampleLimit),
    fetchQuoteSnapshotRows(config, sampleLimit),
    fetchIndustryBenchmarkRows(config, sampleLimit),
    fetchMarketCalendarRows(config),
  ]);
  const generatedAt = new Date();
  generatedAt.setMilliseconds(0);
  return {
    ok: true,
    generated_at: generatedAt.toISOString().replace(".000Z", "+00:00"),
    refresh_queue: summarizeQueueRows(refreshQueueRows, generatedAt),
    score_snapshots: isRecord(rawOperations) && isRecord(rawOperations.score_snapshots) ? rawOperations.score_snapshots : {},
    score_calibration: summarizeScoreSnapshots(scoreRows, expectedModelVersion, generatedAt, staleAfterHours),
    quote_freshness: summarizeQuoteSnapshots(quoteRows, generatedAt),
    industry_benchmarks: summarizeIndustryBenchmarks(benchmarkRows, generatedAt),
    market_calendar: summarizeMarketCalendar(calendarRows),
  };
}

export async function fetchScoreSnapshotRows(config: SupabaseReportConfig, sampleLimit: number) {
  return fetchRows(config, "stock_score_snapshots", {
    view_mode: "eq.detail",
    select: "ticker,view_mode,payload,fetched_at,expires_at,score_model_version",
    order: "fetched_at.desc",
    limit: boundedLimit(sampleLimit),
  });
}

export async function fetchQuoteSnapshotRows(config: SupabaseReportConfig, sampleLimit: number) {
  return fetchRows(config, "stock_quote_snapshots", {
    select: "ticker,payload,fetched_at,expires_at",
    order: "fetched_at.desc",
    limit: boundedLimit(sampleLimit),
  });
}

export async function fetchIndustryBenchmarkRows(config: SupabaseReportConfig, sampleLimit: number) {
  return fetchRows(config, "stock_industry_benchmarks", {
    select: "scope,market,sector,industry,metric,source,as_of_date,expires_at,sample_count",
    order: "updated_at.desc",
    limit: boundedLimit(sampleLimit),
  });
}

export async function fetchMarketCalendarRows(config: SupabaseReportConfig, days = 30) {
  return fetchRows(config, "market_calendar", {
    trade_date: `gte.${new Date().toISOString().slice(0, 10)}`,
    select: "market,trade_date,is_open,open_at,close_at,next_open_at",
    order: "trade_date.asc,market.asc",
    limit: String(Math.max(10, days * 3)),
  });
}

export async function postSupabaseRpc(config: SupabaseReportConfig, name: string, body: JsonRecord) {
  const response = await fetchWithTimeout(
    `${trimUrl(config.url)}/rest/v1/rpc/${name}`,
    {
      method: "POST",
      headers: supabaseHeaders(config.key),
      body: JSON.stringify(body),
    },
    config.timeoutMs
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Supabase RPC ${name} failed: HTTP ${response.status} ${text.slice(0, 500)}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

async function fetchRows(config: SupabaseReportConfig, table: string, params: Record<string, string>) {
  const query = new URLSearchParams(params);
  const response = await fetchWithTimeout(
    `${trimUrl(config.url)}/rest/v1/${table}?${query.toString()}`,
    { headers: supabaseHeaders(config.key) },
    config.timeoutMs
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Supabase ${table} query failed: HTTP ${response.status} ${text.slice(0, 500)}`);
  }
  const text = await response.text();
  const payload = text ? JSON.parse(text) : [];
  return Array.isArray(payload) ? payload.filter(isRecord) : [];
}

export function supabaseReportConfig(options: OperationsOptions): SupabaseReportConfig {
  loadLocalEnvFiles();
  const url = (options.supabaseUrl || process.env.SUPABASE_URL || "").trim().replace(/\/$/, "");
  const key = (options.supabaseKey || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  return { url, key, timeoutMs: options.timeoutMs };
}

export function parseOperationsOptions(argv: string[], env: Record<string, string | undefined> = process.env): OperationsOptions {
  const options: OperationsOptions = {
    json: false,
    failOnThreshold: false,
    sampleLimit: 500,
    scoreStaleHours: 24,
    expectedScoreModelVersion: env.EXPECTED_SCORE_MODEL_VERSION || DEFAULT_SCORE_MODEL_VERSION,
    thresholds: {},
    timeoutMs: 15_000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[index];
    };
    const thresholdKey = THRESHOLD_ARGS.get(arg);
    if (thresholdKey) {
      options.thresholds[thresholdKey] = Number(next());
    } else if (arg === "--json") options.json = true;
    else if (arg === "--fail-on-threshold") options.failOnThreshold = true;
    else if (arg === "--supabase-url") options.supabaseUrl = next();
    else if (arg === "--supabase-key") options.supabaseKey = next();
    else if (arg === "--timeout-seconds") options.timeoutMs = positiveNumber(next(), 15) * 1000;
    else if (arg === "--timeout-ms") options.timeoutMs = positiveNumber(next(), 15_000);
    else if (arg === "--sample-limit") options.sampleLimit = positiveInteger(next(), 500);
    else if (arg === "--score-stale-hours") options.scoreStaleHours = positiveInteger(next(), 24);
    else if (arg === "--expected-score-model-version") options.expectedScoreModelVersion = next();
    else throw new Error(`Unsupported argument: ${arg}`);
  }

  for (const [key, value] of Object.entries(options.thresholds)) {
    if (!Number.isFinite(value)) throw new Error(`Invalid threshold ${key}`);
  }
  return options;
}

export async function runOperationsReport(options: OperationsOptions) {
  const payload = await fetchSupabaseReport(supabaseReportConfig(options), options.sampleLimit, options.scoreStaleHours, options.expectedScoreModelVersion);
  return {
    ...payload,
    thresholds: evaluateOperationsThresholds(payload, options.thresholds),
  };
}

function scoreModelVersion(row: JsonRecord, payload: JsonRecord): string | undefined {
  const direct = stringValue(row.score_model_version) || stringValue(payload.score_model_version);
  if (direct) return direct;
  const snapshot = isRecord(payload.sia_snapshot) ? payload.sia_snapshot : {};
  return stringValue(snapshot.score_model_version);
}

function payloadConfidence(payload: JsonRecord): number | undefined {
  const snapshot = isRecord(payload.sia_snapshot) ? payload.sia_snapshot : {};
  return finiteNumber(snapshot.confidence);
}

function isStaleSnapshot(row: JsonRecord, now: Date, staleAfterHours: number): boolean {
  const expiresAt = parseDateTime(stringValue(row.expires_at));
  const fetchedAt = parseDateTime(stringValue(row.fetched_at));
  if (expiresAt && expiresAt.getTime() <= now.getTime()) return true;
  if (fetchedAt) return now.getTime() - fetchedAt.getTime() > Math.max(1, staleAfterHours) * 3_600_000;
  return false;
}

function parseDateTime(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

function intValue(value: unknown): number {
  if (typeof value === "boolean") return 0;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function rounded(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function nestedNumber(payload: JsonRecord, path: readonly string[]): number | undefined {
  let current: unknown = payload;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return finiteNumber(current);
}

function nestedCount(payload: JsonRecord, path: readonly string[]): number | undefined {
  let current: unknown = payload;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  if (Array.isArray(current)) return current.length;
  if (isRecord(current)) return Object.keys(current).length;
  return finiteNumber(current);
}

function addMaxViolation(violations: Array<Record<string, unknown>>, thresholds: Record<string, number>, key: string, path: string, actual?: number) {
  const threshold = thresholds[key];
  if (threshold === undefined || actual === undefined || actual <= threshold) return;
  violations.push({
    key,
    path,
    operator: "<=",
    threshold,
    actual: rounded(actual, 3),
    message: `${path} is ${rounded(actual, 3)}, above threshold ${threshold}`,
  });
}

function addMinViolation(violations: Array<Record<string, unknown>>, thresholds: Record<string, number>, key: string, path: string, actual?: number) {
  const threshold = thresholds[key];
  if (threshold === undefined || actual === undefined || actual >= threshold) return;
  violations.push({
    key,
    path,
    operator: ">=",
    threshold,
    actual: rounded(actual, 3),
    message: `${path} is ${rounded(actual, 3)}, below threshold ${threshold}`,
  });
}

function boundedLimit(sampleLimit: number): string {
  return String(Math.max(1, Math.min(Math.floor(sampleLimit), 5000)));
}

function trimUrl(url: string): string {
  return url.trim().replace(/\/$/, "");
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function publicError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 1000) : "unknown";
}

function printHumanReport(payload: JsonRecord) {
  const queue = isRecord(payload.refresh_queue) ? payload.refresh_queue : {};
  const calibration = isRecord(payload.score_calibration) ? payload.score_calibration : {};
  const quotes = isRecord(payload.quote_freshness) ? payload.quote_freshness : {};
  const benchmarks = isRecord(payload.industry_benchmarks) ? payload.industry_benchmarks : {};
  const calendar = isRecord(payload.market_calendar) ? payload.market_calendar : {};
  console.log(`generated_at=${payload.generated_at}`);
  console.log(
    `queue total=${queue.total_jobs} queued=${queue.queued_jobs} running=${queue.running_jobs} dead=${queue.dead_jobs} ` +
      `stale_running=${queue.stale_running_jobs} oldest_due_age_minutes=${queue.oldest_due_age_minutes}`
  );
  console.log(
    `scores total=${calibration.total_snapshots} current_model=${calibration.current_model_snapshots} stale=${calibration.stale_snapshots} ` +
      `mean=${calibration.score_mean} min=${calibration.score_min} max=${calibration.score_max} duplicates=${calibration.duplicate_score_rate}`
  );
  if (Object.keys(quotes).length) {
    console.log(`quotes total=${quotes.total_snapshots} stale=${quotes.stale_snapshots} stale_rate=${quotes.stale_rate} missing_price=${quotes.missing_price_count}`);
  }
  if (Object.keys(benchmarks).length) {
    console.log(`benchmarks total=${benchmarks.total_rows} expired=${benchmarks.expired_rows} low_sample=${benchmarks.low_sample_rows} newest_as_of=${benchmarks.newest_as_of_date}`);
  }
  if (Object.keys(calendar).length) console.log(`calendar total=${calendar.total_rows} thin_markets=${JSON.stringify(calendar.missing_or_thin_markets || [])}`);
  const thresholds = isRecord(payload.thresholds) ? payload.thresholds : {};
  if (thresholds.configured) {
    const violations = Array.isArray(thresholds.violations) ? thresholds.violations : [];
    console.log(`thresholds ok=${thresholds.ok} violations=${violations.length}`);
    for (const violation of violations) {
      if (isRecord(violation)) console.log(`threshold_violation ${violation.message}`);
    }
  }
}

function isMainModule(): boolean {
  return process.argv[1]?.endsWith("stock_operations_report.ts") === true;
}

async function main() {
  const options = parseOperationsOptions(process.argv.slice(2));
  const payload = await runOperationsReport(options);
  if (options.json) console.log(JSON.stringify(payload, null, 2));
  else printHumanReport(payload);
  const thresholdsOk = isRecord(payload.thresholds) ? payload.thresholds.ok : undefined;
  process.exitCode = options.failOnThreshold && thresholdsOk !== true ? 1 : 0;
}

if (isMainModule()) {
  main().catch((error) => {
    console.error(publicError(error));
    process.exitCode = 2;
  });
}
