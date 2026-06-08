import policy from "../../shared/stock-cache-policy.json";

export type StockCachePolicyKey = keyof typeof policy;

export type StockCachePolicy = {
  fresh_seconds: number;
  stale_seconds: number;
};

const policies = policy as Record<string, StockCachePolicy>;

export function stockCachePolicyFor(key: StockCachePolicyKey): StockCachePolicy {
  const normalizedKey = String(key);
  const entry = policies[normalizedKey];
  if (!entry || !positiveInteger(entry.fresh_seconds) || !positiveInteger(entry.stale_seconds)) {
    throw new Error(`Unknown stock cache policy: ${normalizedKey}`);
  }
  if (entry.fresh_seconds > entry.stale_seconds) {
    throw new Error(`Invalid stock cache policy expiry order: ${normalizedKey}`);
  }
  return entry;
}

export function stockCachePolicyFreshSeconds(key: StockCachePolicyKey): number {
  return stockCachePolicyFor(key).fresh_seconds;
}

export function stockCachePolicyStaleSeconds(key: StockCachePolicyKey): number {
  return stockCachePolicyFor(key).stale_seconds;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
