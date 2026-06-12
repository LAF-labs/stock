import { getIndustryBenchmarksForStock } from "@/lib/industryBenchmarks";
import { industryBenchmarkEligibilityFromPayload } from "@/lib/industryBenchmarkEligibility";
import { compactRuleJudgmentStock, type IndustryBenchmark } from "@/lib/ruleBasedJudgment";

type LabeledMetricRow = {
  label?: string;
  value?: unknown;
  note?: string;
  [key: string]: unknown;
};

const BENCHMARK_LABELS: Record<string, string> = {
  forward_per: "Forward PER",
  per: "PER",
  ev_revenue: "EV/Revenue",
  psr: "Price/Sales",
  pbr: "PBR",
};

const LEGACY_BENCHMARK_LABELS = new Map(
  Object.entries(BENCHMARK_LABELS).map(([metric, label]) => [metric, `업종 기준 ${label}`])
);

const METRIC_ORDER = new Map(Object.keys(BENCHMARK_LABELS).map((metric, index) => [metric, index]));

export async function enrichStockPayloadWithIndustryBenchmarks<T extends Record<string, unknown>>(payload: T): Promise<T & Record<string, unknown>> {
  if (payload.ok === false) return payload as T & Record<string, unknown>;
  if (!industryBenchmarkEligibilityFromPayload(payload).eligible) return payload as T & Record<string, unknown>;

  const stock = compactRuleJudgmentStock(payload);
  const benchmarks = (await getIndustryBenchmarksForStock(stock))
    .filter(usableBenchmark)
    .sort((left, right) => metricRank(left.metric) - metricRank(right.metric));
  if (!benchmarks.length) return payload as T & Record<string, unknown>;

  return {
    ...payload,
    industry_benchmarks: mergeIndustryBenchmarks(payload.industry_benchmarks, benchmarks),
    valuation_rows: mergeBenchmarkRows(payload.valuation_rows, benchmarks),
  } as T & Record<string, unknown>;
}

function mergeBenchmarkRows(value: unknown, benchmarks: IndustryBenchmark[]): LabeledMetricRow[] {
  const rows: LabeledMetricRow[] = [];
  const indexByLabel = new Map<string, number>();

  if (Array.isArray(value)) {
    for (const item of value) {
      const row = { ...recordFromUnknown(item) };
      const label = cleanText(row.label);
      const canonicalBenchmarkLabel = canonicalBenchmarkLabelFor(label);
      if (canonicalBenchmarkLabel) row.label = canonicalBenchmarkLabel;
      const key = canonicalBenchmarkLabel || label;
      if (canonicalBenchmarkLabel && indexByLabel.has(canonicalBenchmarkLabel)) {
        const existingIndex = indexByLabel.get(canonicalBenchmarkLabel)!;
        rows[existingIndex] = { ...rows[existingIndex], ...row };
        continue;
      }
      if (key) indexByLabel.set(key, rows.length);
      rows.push(row);
    }
  }

  rows.forEach((row, index) => {
    const label = cleanText(row.label);
    if (label) indexByLabel.set(label, index);
  });

  for (const benchmark of benchmarks) {
    const label = benchmarkLabel(benchmark);
    if (!label || typeof benchmark.median !== "number") continue;
    const row = {
      label,
      value: formatBenchmarkValue(benchmark.median),
      note: benchmarkNote(benchmark),
      metric: benchmark.metric.toLowerCase(),
      source: benchmark.source,
      sample_count: benchmark.sampleCount,
    };
    const existingIndex = indexByLabel.get(label);
    if (existingIndex === undefined) {
      indexByLabel.set(label, rows.length);
      rows.push(row);
    } else {
      rows[existingIndex] = { ...rows[existingIndex], ...row };
    }
  }

  return rows;
}

function mergeIndustryBenchmarks(value: unknown, benchmarks: IndustryBenchmark[]): IndustryBenchmark[] {
  const byMetric = new Map<string, IndustryBenchmark>();
  if (Array.isArray(value)) {
    for (const item of value) {
      const row = recordFromUnknown(item) as Partial<IndustryBenchmark>;
      const metric = cleanText(row.metric)?.toLowerCase();
      if (metric) byMetric.set(metric, row as IndustryBenchmark);
    }
  }
  for (const benchmark of benchmarks) {
    byMetric.set(benchmark.metric.toLowerCase(), benchmark);
  }
  return [...byMetric.values()].sort((left, right) => metricRank(left.metric) - metricRank(right.metric));
}

function usableBenchmark(benchmark: IndustryBenchmark): boolean {
  return !!BENCHMARK_LABELS[benchmark.metric.toLowerCase()]
    && typeof benchmark.median === "number"
    && Number.isFinite(benchmark.median)
    && benchmark.median > 0;
}

function metricRank(metric: string): number {
  return METRIC_ORDER.get(metric.toLowerCase()) ?? METRIC_ORDER.size;
}

function canonicalBenchmarkLabelFor(label: string | undefined): string | undefined {
  if (!label) return undefined;
  for (const [metric, metricLabel] of Object.entries(BENCHMARK_LABELS)) {
    const currentLabel = `업종 평균 ${metricLabel}`;
    if (label === currentLabel || label === LEGACY_BENCHMARK_LABELS.get(metric)) return currentLabel;
  }
  return undefined;
}

function benchmarkLabel(benchmark: IndustryBenchmark): string | undefined {
  const metricLabel = BENCHMARK_LABELS[benchmark.metric.toLowerCase()];
  if (!metricLabel) return undefined;
  return `${benchmarkScopeLabel(benchmark)} ${metricLabel}`;
}

function benchmarkNote(benchmark: IndustryBenchmark): string {
  const scope = benchmark.scope === "KR" || benchmark.market === "KR" ? "국내 " : "해외 ";
  const industry = cleanText(benchmark.industry) || cleanText(benchmark.providerGroupName);
  if (industry) return `${scope}${industry} 업종 평균`;
  return `${scope}업종 평균`;
}

function benchmarkScopeLabel(benchmark: IndustryBenchmark): string {
  void benchmark;
  return "업종 평균";
}

function formatBenchmarkValue(value: number): string {
  return value.toFixed(2);
}

function cleanText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
