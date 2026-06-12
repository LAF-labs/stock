export type PartUnavailableReason = "provider_empty" | "provider_confirmed_empty" | "unsupported" | "not_reported" | "no_history" | "configuration";
export type PartRefreshReason = "snapshot_miss" | "stale_refresh" | "provider_rate_limited" | "provider_timeout";
export type DegradedReason = "price_fast_path" | "quote_fast_path" | "identity_fast_path";

export type PartState<T> =
  | { state: "ready"; value: T; source: string; fetchedAt: string; expiresAt?: string }
  | { state: "stale_ready"; value: T; source: string; fetchedAt: string; expiresAt?: string; refreshActive: true }
  | { state: "refreshing"; reason: PartRefreshReason; jobId?: string; startedAt?: string }
  | { state: "unavailable"; reason: PartUnavailableReason; checkedAt?: string }
  | { state: "degraded"; value: T; source: string; reason: DegradedReason; fetchedAt: string };

export function readyPart<T>(value: T, source: string, fetchedAt: string, expiresAt?: string): PartState<T> {
  return expiresAt ? { state: "ready", value, source, fetchedAt, expiresAt } : { state: "ready", value, source, fetchedAt };
}

export function staleReadyPart<T>(value: T, source: string, fetchedAt: string, expiresAt?: string): PartState<T> {
  return expiresAt
    ? { state: "stale_ready", value, source, fetchedAt, expiresAt, refreshActive: true }
    : { state: "stale_ready", value, source, fetchedAt, refreshActive: true };
}

export function refreshingPart(reason: PartRefreshReason, jobId?: string, startedAt?: string): PartState<never> {
  return {
    state: "refreshing",
    reason,
    ...(jobId ? { jobId } : {}),
    ...(startedAt ? { startedAt } : {}),
  };
}

export function unavailablePart(reason: PartUnavailableReason, checkedAt?: string): PartState<never> {
  return {
    state: "unavailable",
    reason,
    ...(checkedAt ? { checkedAt } : {}),
  };
}

export function degradedPart<T>(value: T, source: string, reason: DegradedReason, fetchedAt: string): PartState<T> {
  return { state: "degraded", value, source, reason, fetchedAt };
}

export function partValue<T>(part: PartState<T> | undefined): T | undefined {
  if (!part) return undefined;
  if (part.state === "ready" || part.state === "stale_ready" || part.state === "degraded") return part.value;
  return undefined;
}

export function partIsVisible<T>(part: PartState<T> | undefined): boolean {
  return partValue(part) !== undefined;
}
