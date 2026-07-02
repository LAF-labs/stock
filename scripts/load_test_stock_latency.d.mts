export function scenarioRequests(baseUrl: string, options?: Record<string, unknown>): Array<{ name: string; url: string }>;
export function classifyStockLatencyPayload(payload: unknown): { state: string; ready_parts: string[]; pending_parts: string[] };
export function providerGuardViolations(payload: unknown): string[];
export function runStockLatencyLoadTest(
  options?: Record<string, unknown>,
  fetchImpl?: typeof fetch
): Promise<{
  ok: boolean;
  requests: number;
  warmup_iterations: number;
  warmup_requests: number;
  measured_requests: number;
  p50_ms: number | null;
  p95_ms: number | null;
  hard_ok: boolean;
  latency_budget_ok: boolean;
  latency_budget?: { max_p95_ms: number; enforced: boolean };
  rows: Array<{ ok: boolean }>;
}>;
