import { fetchWithTimeout, numericEnv, supabaseAdminConfig, supabaseHeaders } from "@/lib/supabaseRest";

export type JudgmentJobInput = {
  ticker: string;
  stock: Record<string, unknown>;
  cacheDate: string;
  cacheKey: string;
  cacheBucketStart: string;
  model: string;
  promptVersion: string;
};

export type JudgmentJobRequest = {
  p_kind: "judgment";
  p_market: "US" | "KR";
  p_symbol: string;
  p_view_mode: null;
  p_priority: number;
  p_payload: {
    ticker: string;
    cache_date: string;
    cache_key: string;
    cache_bucket_start: string;
    model: string;
    prompt_version: string;
    stock: Record<string, unknown>;
  };
};

export type JudgmentJob = {
  id: string;
  kind?: string;
  market?: string;
  symbol?: string;
  status?: string;
};

export function judgmentJobsEnabled(): boolean {
  return process.env.STOCK_AI_JUDGMENT_ASYNC === "1";
}

export function buildJudgmentJobRequest(input: JudgmentJobInput): JudgmentJobRequest {
  const target = judgmentTarget(input.ticker, input.stock);
  return {
    p_kind: "judgment",
    p_market: target.market,
    p_symbol: target.symbol,
    p_view_mode: null,
    p_priority: numericEnv("STOCK_AI_JUDGMENT_JOB_PRIORITY", 40),
    p_payload: {
      ticker: input.ticker,
      cache_date: input.cacheDate,
      cache_key: input.cacheKey,
      cache_bucket_start: input.cacheBucketStart,
      model: input.model,
      prompt_version: input.promptVersion,
      stock: input.stock,
    },
  };
}

export async function enqueueJudgmentJob(input: JudgmentJobInput): Promise<JudgmentJob | undefined> {
  const config = supabaseAdminConfig();
  if (!config) return undefined;

  try {
    const response = await fetchWithTimeout(
      `${config.url}/rest/v1/rpc/enqueue_stock_refresh_job`,
      {
        method: "POST",
        headers: supabaseHeaders(config.key),
        body: JSON.stringify(buildJudgmentJobRequest(input)),
      },
      numericEnv("STOCK_AI_JUDGMENT_JOB_TIMEOUT_MS", 2_000)
    );
    if (!response.ok) return undefined;
    const payload = (await response.json()) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
    const row = payload as Record<string, unknown>;
    return typeof row.id === "string" ? (row as JudgmentJob) : undefined;
  } catch {
    return undefined;
  }
}

function judgmentTarget(ticker: string, stock: Record<string, unknown>): { market: "US" | "KR"; symbol: string } {
  const rawMarket = typeof stock.market === "string" ? stock.market.toUpperCase() : "";
  const market = rawMarket === "KR" || /^\d{6}$/.test(ticker) ? "KR" : "US";
  const rawSymbol = typeof stock.symbol === "string" ? stock.symbol : ticker;
  const symbol = rawSymbol
    .toUpperCase()
    .replace(/^(US|KR):/, "")
    .replace(/[^A-Z0-9.-]/g, "");
  return {
    market,
    symbol: symbol || ticker,
  };
}
