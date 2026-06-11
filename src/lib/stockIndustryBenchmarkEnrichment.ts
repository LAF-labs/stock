import { getIndustryBenchmarksForStock } from "@/lib/industryBenchmarks";
import { compactRuleJudgmentStock, type IndustryBenchmark } from "@/lib/ruleBasedJudgment";

type LabeledMetricRow = {
  label?: string;
  value?: unknown;
  note?: string;
  [key: string]: unknown;
};

const BENCHMARK_LABELS: Record<string, string> = {
  forward_per: "업종 기준 Forward PER",
  per: "업종 기준 PER",
  ev_revenue: "업종 기준 EV/Revenue",
  psr: "업종 기준 Price/Sales",
  pbr: "업종 기준 PBR",
};

const METRIC_ORDER = new Map(Object.keys(BENCHMARK_LABELS).map((metric, index) => [metric, index]));

export async function enrichStockPayloadWithIndustryBenchmarks<T extends Record<string, unknown>>(payload: T): Promise<T & Record<string, unknown>> {
  if (payload.ok === false) return payload as T & Record<string, unknown>;

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
  const rows = Array.isArray(value)
    ? value.map((item) => ({ ...recordFromUnknown(item) }))
    : [];
  const indexByLabel = new Map<string, number>();
  rows.forEach((row, index) => {
    const label = cleanText(row.label);
    if (label) indexByLabel.set(label, index);
  });

  for (const benchmark of benchmarks) {
    const label = BENCHMARK_LABELS[benchmark.metric.toLowerCase()];
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

function benchmarkNote(benchmark: IndustryBenchmark): string {
  const scope = benchmark.scope === "KR" || benchmark.market === "KR" ? "국내 " : "해외 ";
  const industry = cleanText(benchmark.industry) || cleanText(benchmark.providerGroupName) || cleanText(benchmark.sector);
  return industry ? `${scope}${industry} 업종 기준` : `${scope}전체 시장 기준`;
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
