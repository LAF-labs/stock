import {
  degradedPart,
  readyPart,
  staleReadyPart,
  type DegradedReason,
  type PartState,
} from "@/lib/stockPartState";
import type { StockChartResult } from "@/lib/stockChartCache";
import type { StockQuoteResult } from "@/lib/stockQuoteCache";
import type { StockPayload, StockScoreResult } from "@/lib/stockScoreContract";

type CacheLike = {
  state?: string;
  source?: string;
  ticker?: string;
  view?: string;
  fetchedAt?: string;
  expiresAt?: string;
  staleExpiresAt?: string;
  refreshStarted?: boolean;
  refreshError?: string;
};

export function pricePartFromQuoteResult(result: StockQuoteResult | undefined): PartState<StockPayload> | undefined {
  if (!result || result.payload.ok === false) return undefined;
  return visiblePayloadPart(result.payload, result.cache);
}

export function chartPartFromResult(result: StockChartResult | undefined): PartState<Record<string, unknown>> | undefined {
  if (!result || result.payload.ok === false) return undefined;
  return visiblePayloadPart(result.payload, result.cache);
}

export function scorePartFromResult(result: Pick<StockScoreResult, "payload"> & { cache?: CacheLike } | undefined): PartState<StockPayload> | undefined {
  if (!result || result.payload.ok === false) return undefined;
  const cache = result.cache || cacheFromServerCache(result.payload.server_cache);
  const fetchedAt = cache?.fetchedAt || new Date().toISOString();
  const source = normalizedSource(cache?.source, fastPathReason(result.payload) ? "fast-path" : "derived");
  const degradedReason = fastPathReason(result.payload);

  if (degradedReason) return degradedPart(result.payload, source, degradedReason, fetchedAt);
  return visiblePayloadPart(result.payload, cache, "derived");
}

export function pricePartFromPayload(payload: StockPayload | undefined): PartState<StockPayload> | undefined {
  if (!payload || payload.ok === false) return undefined;
  return visiblePayloadPart(payload, cacheFromServerCache(payload.server_cache), "market-data");
}

export function chartPartFromPayload(payload: Record<string, unknown> | undefined): PartState<Record<string, unknown>> | undefined {
  if (!payload || payload.ok === false) return undefined;
  return visiblePayloadPart(payload, cacheFromServerCache(payload.server_cache), "market-data");
}

export function scorePartFromPayload(payload: StockPayload | undefined): PartState<StockPayload> | undefined {
  return scorePartFromResult(payload ? { payload } : undefined);
}

function visiblePayloadPart<T extends Record<string, unknown>>(payload: T, cache?: CacheLike, defaultSource = "supabase"): PartState<T> {
  const fetchedAt = cache?.fetchedAt || new Date().toISOString();
  const expiresAt = cache?.expiresAt;
  const source = normalizedSource(cache?.source, defaultSource);
  if (cache?.state === "stale") return staleReadyPart(payload, source, fetchedAt, expiresAt);
  return readyPart(payload, source, fetchedAt, expiresAt);
}

function cacheFromServerCache(value: unknown): CacheLike | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  return {
    state: stringValue(record.state),
    source: stringValue(record.source),
    fetchedAt: stringValue(record.fetchedAt) || stringValue(record.fetched_at),
    expiresAt: stringValue(record.expiresAt) || stringValue(record.expires_at),
  };
}

function fastPathReason(payload: StockPayload): DegradedReason | undefined {
  const fetch = recordValue(payload.fetch);
  const financials = recordValue(payload.financials);
  const dataQuality = stringValue(payload.data_quality)?.toLowerCase();

  if (flag(fetch, "identity_only_fast_path") || flag(financials, "identity_only_fast_path") || dataQuality === "identity_fast_path") {
    return "identity_fast_path";
  }
  if (flag(fetch, "quote_only_fast_path") || flag(financials, "quote_only_fast_path") || dataQuality === "quote_fast_path") {
    return "quote_fast_path";
  }
  if (
    flag(fetch, "pending_enrichment") ||
    flag(financials, "pending_enrichment") ||
    stringValue(financials?.source)?.toLowerCase() === "pending_enrichment" ||
    dataQuality === "price_fast_path"
  ) {
    return "price_fast_path";
  }
  return undefined;
}

function normalizedSource(source: string | undefined, fallback: string): string {
  if (!source) return fallback;
  if (source === "collector") return "derived";
  return source;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function flag(record: Record<string, unknown> | undefined, key: string): boolean {
  return record?.[key] === true;
}
