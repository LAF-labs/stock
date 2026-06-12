const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
export const STOCK_RULE_JUDGMENT_PROMPT_VERSION = "stock-rule-judge-v4";

type JudgmentBenchmarkTokenInput = {
  scope?: string;
  market?: string;
  sector?: string;
  industry?: string;
  metric?: string;
  period?: string;
  median?: number;
  sampleCount?: number;
  source?: string;
};

export function judgmentBucketStart(date = new Date(), bucketMs = SIX_HOURS_MS): string {
  const time = Number.isFinite(date.getTime()) ? date.getTime() : Date.now();
  return new Date(Math.floor(time / bucketMs) * bucketMs).toISOString();
}

export function judgmentCacheKeyFor(model: string, date = new Date(), promptVersion = STOCK_RULE_JUDGMENT_PROMPT_VERSION, benchmarkToken = "bench:legacy"): string {
  return `${model}:${promptVersion}:${judgmentBucketStart(date)}:${benchmarkToken}`;
}

export function judgmentBenchmarkCacheToken(benchmarks: JudgmentBenchmarkTokenInput[] | undefined): string {
  if (!benchmarks?.length) return "bench:none";
  const parts = benchmarks
    .map((item) =>
      [
        item.scope || "",
        item.market || "",
        item.period || "",
        item.metric || "",
        item.sector || "",
        item.industry || "",
        numberToken(item.median),
        numberToken(item.sampleCount),
      ].join(":")
    )
    .sort();
  return `bench:${parts.join("|")}`;
}

function numberToken(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}
