export function stockScorePayloadNeedsEnrichment(payload: unknown): boolean {
  const record = recordFromUnknown(payload);
  if (!record) return false;

  const fetch = recordFromUnknown(record.fetch);
  const financials = recordFromUnknown(record.financials);
  const dataQuality = stringFromUnknown(record.data_quality)?.toLowerCase();
  const quoteOnly =
    flagFromRecord(fetch, "quote_only_fast_path") ||
    flagFromRecord(financials, "quote_only_fast_path") ||
    dataQuality === "quote_fast_path";
  const identityOnly =
    flagFromRecord(fetch, "identity_only_fast_path") ||
    flagFromRecord(financials, "identity_only_fast_path") ||
    dataQuality === "identity_fast_path";
  if (quoteOnly || identityOnly) return true;

  const pendingEnrichment =
    flagFromRecord(fetch, "pending_enrichment") ||
    flagFromRecord(financials, "pending_enrichment") ||
    stringFromUnknown(financials?.source)?.toLowerCase() === "pending_enrichment";
  return pendingEnrichment;
}

export function stockScorePayloadIsDurable(payload: unknown): boolean {
  return !stockScorePayloadNeedsEnrichment(payload);
}

export function stockScorePayloadIsRefreshingStale(payload: unknown): boolean {
  const record = recordFromUnknown(payload);
  if (!record) return false;
  const cache = recordFromUnknown(record.server_cache);
  return stringFromUnknown(cache?.state)?.toLowerCase() === "stale" && flagFromRecord(cache, "refresh_started");
}

export function hasUsableChartSeries(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  let usable = 0;
  for (const point of value) {
    const record = recordFromUnknown(point);
    if (!record) continue;
    const date = stringFromUnknown(record.date);
    const close = numberFromUnknown(record.close);
    if (date && close !== undefined) usable += 1;
    if (usable >= 2) return true;
  }
  return false;
}

function recordFromUnknown(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringFromUnknown(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberFromUnknown(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function flagFromRecord(record: Record<string, unknown> | undefined, key: string): boolean {
  return record?.[key] === true;
}
