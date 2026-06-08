export function scenarioRequests(baseUrl: string, options?: Record<string, unknown>): Array<{ name: string; url: string }>;
export function classifyStockLatencyPayload(payload: unknown): { state: string; ready_parts: string[]; pending_parts: string[] };
export function providerGuardViolations(payload: unknown): string[];
export function runStockLatencyLoadTest(
  options?: Record<string, unknown>,
  fetchImpl?: typeof fetch
): Promise<{ ok: boolean; rows: Array<{ ok: boolean }> }>;
