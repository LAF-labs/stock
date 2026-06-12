export type ColdStartMatrixRequest = {
  feature: string;
  ticker?: string;
  url: string;
};

export function coldStartMatrixRequests(
  baseUrl: string,
  options?: { tickers?: string[] },
): ColdStartMatrixRequest[];

export function validateColdStartMatrixPayload(
  payload: unknown,
  request: ColdStartMatrixRequest,
): string[];

export function runStockColdStartMatrix(
  options?: { baseUrl?: string; tickers?: string[]; timeoutMs?: number },
  fetchImpl?: typeof fetch,
): Promise<{
  ok: boolean;
  base_url: string;
  tickers: string[];
  requests: number;
  p50_ms: number | null;
  p95_ms: number | null;
  rows: Array<{
    feature: string;
    ticker?: string;
    url: string;
    status: number;
    duration_ms: number;
    ok: boolean;
    errors: string[];
    summary: Record<string, unknown>;
  }>;
}>;
