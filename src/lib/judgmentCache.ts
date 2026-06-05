const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

export function judgmentBucketStart(date = new Date(), bucketMs = SIX_HOURS_MS): string {
  const time = Number.isFinite(date.getTime()) ? date.getTime() : Date.now();
  return new Date(Math.floor(time / bucketMs) * bucketMs).toISOString();
}

export function judgmentCacheKeyFor(model: string, date = new Date(), promptVersion = "stock-rule-judge-v3"): string {
  return `${model}:${promptVersion}:${judgmentBucketStart(date)}`;
}
