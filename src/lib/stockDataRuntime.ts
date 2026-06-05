export type StockDataRuntimeMode = "python" | "snapshot";
export type StockDataKind = "score" | "quote";
export type StockDataUnavailableReason = "snapshot_miss" | "refresh_background_only";

export type StockDataRuntimeEnv = Record<string, string | undefined>;

export type StockDataUnavailableInput = {
  kind: StockDataKind;
  ticker: string;
  view?: "detail" | "compare";
  reason: StockDataUnavailableReason;
};

export type StockDataUnavailablePayload = {
  ok: false;
  error: "snapshot_unavailable";
  message: string;
  kind: StockDataKind;
  ticker: string;
  view?: "detail" | "compare";
  reason: StockDataUnavailableReason;
};

const SNAPSHOT_ALIASES = new Set(["snapshot", "supabase", "cache", "cache-only", "readonly", "read-only"]);
const PYTHON_ALIASES = new Set(["python", "collector", "subprocess"]);

export function stockDataRuntimeMode(env: StockDataRuntimeEnv = process.env): StockDataRuntimeMode {
  const raw = (env.STOCK_DATA_RUNTIME || env.STOCK_DATA_BACKEND || "").trim().toLowerCase();
  if (SNAPSHOT_ALIASES.has(raw)) return "snapshot";
  if (PYTHON_ALIASES.has(raw)) return "python";

  return env.VERCEL === "1" ? "snapshot" : "python";
}

export function pythonCollectorEnabled(env: StockDataRuntimeEnv = process.env): boolean {
  return stockDataRuntimeMode(env) === "python";
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
