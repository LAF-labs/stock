export type StockDataRuntimeMode = "python" | "snapshot";
export type StockDataKind = "score" | "quote" | "chart";
export type StockDataUnavailableReason = "snapshot_miss" | "refresh_background_only" | "stale_refresh";
export type StockDataScoreView = "detail" | "compare" | "technical";

export type StockDataRuntimeEnv = Record<string, string | undefined>;

export type StockDataUnavailableInput = {
  kind: StockDataKind;
  ticker: string;
  view?: StockDataScoreView;
  reason: StockDataUnavailableReason;
};

export type StockDataUnavailablePayload = {
  ok: false;
  error: "snapshot_unavailable";
  message: string;
  kind: StockDataKind;
  ticker: string;
  view?: StockDataScoreView;
  reason: StockDataUnavailableReason;
};

export type StockDataPendingPayload = {
  ok: false;
  error: "snapshot_pending";
  message: string;
  kind: StockDataKind;
  ticker: string;
  view?: StockDataScoreView;
  reason: StockDataUnavailableReason;
  retry_after_seconds: number;
  refresh_request: {
    queued: boolean;
    job_id?: string;
    status?: string;
    reason?: string;
  };
};

const SNAPSHOT_ALIASES = new Set(["snapshot", "supabase", "cache", "cache-only", "readonly", "read-only"]);
const PYTHON_ALIASES = new Set(["python", "collector", "subprocess"]);
const TRUTHY = new Set(["1", "true", "yes", "on"]);
const DEFAULT_QUEUE_RETRY_AFTER_SECONDS = 300;
const DEFAULT_SCORE_MISS_RETRY_AFTER_SECONDS = 5;

export function stockDataRuntimeMode(env: StockDataRuntimeEnv = process.env): StockDataRuntimeMode {
  const raw = (env.STOCK_DATA_RUNTIME || env.STOCK_DATA_BACKEND || "").trim().toLowerCase();
  if (SNAPSHOT_ALIASES.has(raw)) return "snapshot";
  if (env.VERCEL === "1" && PYTHON_ALIASES.has(raw) && !allowVercelPythonRuntime(env)) return "snapshot";
  if (PYTHON_ALIASES.has(raw)) return "python";

  return env.VERCEL === "1" ? "snapshot" : "python";
}

export function pythonCollectorEnabled(env: StockDataRuntimeEnv = process.env): boolean {
  return stockDataRuntimeMode(env) === "python";
}

export function allowVercelPythonRuntime(env: StockDataRuntimeEnv = process.env): boolean {
  const raw = (env.STOCK_ALLOW_VERCEL_PYTHON_RUNTIME || "").trim().toLowerCase();
  return TRUTHY.has(raw);
}

export function stockDataUnavailablePayload(input: StockDataUnavailableInput): StockDataUnavailablePayload {
  return {
    ok: false,
    error: "snapshot_unavailable",
    message: "Stock data snapshot is not available yet.",
    kind: input.kind,
    ticker: input.ticker,
    ...(input.view ? { view: input.view } : {}),
    reason: input.reason,
  };
}

export function stockDataPendingRetryAfterSeconds(
  input?: Pick<StockDataUnavailableInput, "kind" | "reason">,
  env: StockDataRuntimeEnv = process.env
): number {
  if (input?.kind === "score" && input.reason === "snapshot_miss") {
    return positiveSeconds(env.STOCK_SCORE_MISS_RETRY_AFTER_SECONDS) ?? DEFAULT_SCORE_MISS_RETRY_AFTER_SECONDS;
  }

  return positiveSeconds(env.STOCK_REFRESH_QUEUE_RETRY_AFTER_SECONDS) ?? DEFAULT_QUEUE_RETRY_AFTER_SECONDS;
}

export function stockDataPendingPayload(
  input: StockDataUnavailableInput & {
    refreshRequest: StockDataPendingPayload["refresh_request"];
    retryAfterSeconds?: number;
  }
): StockDataPendingPayload {
  return {
    ok: false,
    error: "snapshot_pending",
    message: "Stock data is being prepared. Please retry shortly.",
    kind: input.kind,
    ticker: input.ticker,
    ...(input.view ? { view: input.view } : {}),
    reason: input.reason,
    retry_after_seconds: input.retryAfterSeconds ?? stockDataPendingRetryAfterSeconds(input),
    refresh_request: input.refreshRequest,
  };
}

function positiveSeconds(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export class StockDataUnavailableError extends Error {
  readonly status = 503;
  readonly payload: StockDataUnavailablePayload;

  constructor(input: StockDataUnavailableInput) {
    const payload = stockDataUnavailablePayload(input);
    super(payload.message);
    this.name = "StockDataUnavailableError";
    this.payload = payload;
  }

  toPayload(): StockDataUnavailablePayload {
    return this.payload;
  }
}

export function isStockDataUnavailableError(error: unknown): error is StockDataUnavailableError {
  return error instanceof StockDataUnavailableError;
}
