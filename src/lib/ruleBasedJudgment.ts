export type IndustryBenchmark = {
  scope?: "KR" | "OVERSEAS";
  market?: string;
  sector?: string;
  industry?: string;
  metric: string;
  period?: string;
  median?: number;
  p25?: number;
  p75?: number;
  sampleCount?: number;
  source?: string;
  providerGroupName?: string;
};

type CompactMetric = {
  label?: string;
  value?: unknown;
};

type CompactComponent = {
  label?: string;
  key?: string;
  score?: number;
  metrics?: CompactMetric[];
};

export type RuleJudgmentStock = {
  symbol?: unknown;
  market?: unknown;
  name?: unknown;
  latestBarDate?: unknown;
  score?: number;
  signal?: unknown;
  risk?: unknown;
  sector?: string;
  industry?: string;
  keyMetrics: CompactMetric[];
  valuation: CompactMetric[];
  strongest?: CompactComponent;
  weakest?: CompactComponent;
  components: CompactComponent[];
};

export type RuleBasedJudgment = {
  headline: string;
  body: string;
  watch: string;
  tone: "positive" | "neutral" | "cautious";
  model: string;
  promptVersion: string;
  cached?: boolean;
  cacheBucketStart?: string;
};

export type BuildRuleJudgmentOptions = {
  benchmark?: IndustryBenchmark;
  benchmarks?: IndustryBenchmark[];
  model?: string;
  promptVersion?: string;
  cacheBucketStart?: string;
};

const RULE_MODEL = "rule-v2";
const PROMPT_VERSION = "stock-rule-judge-v2";
const PROHIBITED_WORDS = /매수|매도|추천|목표가/g;

export function compactRuleJudgmentStock(raw: Record<string, unknown>): RuleJudgmentStock {
  const components = Array.isArray(raw.components)
    ? raw.components.slice(0, 5).map((item) => {
        const row = recordFromUnknown(item);
        return {
          label: stringFromUnknown(row.label),
          key: stringFromUnknown(row.key),
          score: finiteNumber(row.score),
          metrics: takeMetrics(row.metrics, 2),
        } satisfies CompactComponent;
      })
    : [];

  const ordered = [...components].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const weakest = [...components].sort((a, b) => (a.score ?? 101) - (b.score ?? 101));
  const profile = profileValues(raw.stock_profile);

  return {
    symbol: raw.symbol || raw.requested_ticker,
    market: raw.market,
    name: raw.name,
    latestBarDate: raw.latest_bar_date,
    score: finiteNumber(raw.score),
    signal: recordFromUnknown(raw.sia_snapshot).raw_signal,
    risk: recordFromUnknown(raw.sia_snapshot).risk_level,
    sector: stringFromUnknown(raw.sector) || profile.sector,
    industry: stringFromUnknown(raw.industry) || profile.industry,
    keyMetrics: takeMetrics(raw.key_metrics, 12),
    valuation: compactValuationMetrics(raw),
    strongest: ordered[0],
    weakest: weakest[0],
    components,
  };
}

export function tickerFromRuleJudgmentStock(stock: RuleJudgmentStock): string {
  return String(stock.symbol || "").trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
}

export function validRuleJudgmentStock(stock: RuleJudgmentStock, ticker = tickerFromRuleJudgmentStock(stock)): boolean {
  if (!ticker) return false;
  if (typeof stock.score !== "number" || !Number.isFinite(stock.score)) return false;
  return Array.isArray(stock.components) && stock.components.length > 0;
}

export function buildRuleBasedJudgment(stock: RuleJudgmentStock, options: BuildRuleJudgmentOptions = {}): RuleBasedJudgment {
  const score = roundOne(stock.score ?? 0);
  const strongestLabel = componentLabel(stock.strongest);
  const scoreMood = scoreMoodText(score);
  const valuation = valuationBenchmarkText(stock, options);
  const tone = valuation?.tone || scoreTone(score, stock.risk);
  const headline = headlineFor({ score, valuation, strongestLabel });
  const body = [
    `점수는 ${formatOne(score)}점으로 ${scoreMood}.`,
    secondSentence({ strongestLabel, valuation }),
  ].join(" ");
  const watch = watchSentence({ strongestLabel, valuation });

  return {
    headline: cleanText(headline),
    body: cleanText(body),
    watch: cleanText(watch),
    tone,
    model: options.model || RULE_MODEL,
    promptVersion: options.promptVersion || PROMPT_VERSION,
    cacheBucketStart: options.cacheBucketStart,
  };
}

export function cachedRuleBasedJudgment(
  value: Record<string, unknown>,
  options: { model?: string; promptVersion?: string; cacheBucketStart?: string } = {}
): RuleBasedJudgment | undefined {
  const headline = stringFromUnknown(value.headline);
  const body = stringFromUnknown(value.body);
  const watch = stringFromUnknown(value.watch);
  if (!headline || !body || !watch) return undefined;
  const tone = value.tone === "positive" || value.tone === "cautious" ? value.tone : "neutral";
  return {
    headline: cleanText(headline),
    body: cleanText(body),
    watch: cleanText(watch),
    tone,
    model: options.model || stringFromUnknown(value.model) || RULE_MODEL,
    promptVersion: options.promptVersion || stringFromUnknown(value.promptVersion) || PROMPT_VERSION,
    cached: true,
    cacheBucketStart: options.cacheBucketStart || stringFromUnknown(value.cacheBucketStart),
  };
}

function compactValuationMetrics(raw: Record<string, unknown>): CompactMetric[] {
  const rows = [
    metricByLabel(raw.key_metrics, ["PER"]),
    metricByLabel(raw.key_metrics, ["PBR"]),
    metricByLabel(raw.valuation_rows, ["PER"]),
    metricByLabel(raw.valuation_rows, ["PBR"]),
    metricByLabel(raw.valuation_rows, ["Forward PER"]),
    metricByLabel(raw.valuation_rows, ["EV/Revenue"]),
    metricByLabel(raw.valuation_rows, ["Price/Sales"]),
  ].filter((item): item is CompactMetric => Boolean(item));

  const unique = new Map<string, CompactMetric>();
  for (const row of rows) {
    const key = normalizeLabel(row.label);
    if (key && !unique.has(key)) unique.set(key, row);
  }
  return [...unique.values()].slice(0, 8);
}

function takeMetrics(value: unknown, count = 8): CompactMetric[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, count).map((item) => {
    const row = recordFromUnknown(item);
    return {
      label: stringFromUnknown(row.label),
      value: row.value,
    };
  });
}

function metricByLabel(value: unknown, labels: string[]): CompactMetric | undefined {
  if (!Array.isArray(value)) return undefined;
  const row = value.find((item) => {
    const label = stringFromUnknown(recordFromUnknown(item).label);
    return Boolean(label && labels.some((candidate) => normalizeLabel(label).includes(normalizeLabel(candidate))));
  });
  if (!row) return undefined;
  const record = recordFromUnknown(row);
  return {
    label: stringFromUnknown(record.label),
    value: record.value,
  };
}

function profileValues(value: unknown): { sector?: string; industry?: string } {
  if (!Array.isArray(value)) return {};
  const result: { sector?: string; industry?: string } = {};
  for (const item of value) {
    const row = recordFromUnknown(item);
    const label = stringFromUnknown(row.label) || "";
    const raw = stringFromUnknown(row.value);
    if (!raw) continue;
    if (label.includes("섹터") || /sector/i.test(label)) result.sector ||= raw;
    if (label.includes("산업") || /industry/i.test(label)) result.industry ||= raw;
  }
  return result;
}

function usableBenchmark(benchmark: IndustryBenchmark | undefined): IndustryBenchmark | undefined {
  if (!benchmark) return undefined;
  if (!["forward_per", "per", "ev_revenue", "psr", "pbr"].includes(benchmark.metric.toLowerCase())) return undefined;
  if ((benchmark.sampleCount ?? 0) < 8) return undefined;
  if (typeof benchmark.median !== "number" || !Number.isFinite(benchmark.median) || benchmark.median <= 0) return undefined;
  return benchmark;
}

function valuationBenchmarkText(stock: RuleJudgmentStock, options: BuildRuleJudgmentOptions) {
  const benchmarks = [options.benchmark, ...(options.benchmarks || [])]
    .map(usableBenchmark)
    .filter((item): item is IndustryBenchmark => Boolean(item));
  const candidates = [
    { label: "Forward PER", metric: "forward_per" },
    { label: "PER", metric: "per" },
    { label: "EV/Revenue", metric: "ev_revenue" },
    { label: "Price/Sales", metric: "psr" },
    { label: "PBR", metric: "pbr" },
  ] as const;
  for (const candidate of candidates) {
    const value = valuationNumber(stock, candidate.label);
    const benchmark = benchmarks.find((item) => item.metric.toLowerCase() === candidate.metric);
    if (typeof value === "number" && benchmark) return valuationMetricBenchmarkText(candidate.label, value, benchmark);
  }
  return undefined;
}

function valuationMetricBenchmarkText(label: "Forward PER" | "PER" | "EV/Revenue" | "Price/Sales" | "PBR", value: number, benchmark: IndustryBenchmark) {
  const median = benchmark.median ?? 0;
  const p25 = benchmark.p25;
  const p75 = benchmark.p75;
  const benchmarkLabel = benchmarkComparisonLabel(benchmark);
  const upperLabel = benchmarkUpperLabel(benchmark);
  if (typeof p25 === "number" && value <= p25) {
    return {
      body: `${label}이 ${benchmarkLabel} ${formatOne(median)}배보다 낮은 ${formatOne(value)}배라 가격 부담은 덜해 보여요.`,
      watch: `${label}이 ${benchmarkLowerLabel(benchmark)} ${formatOne(p25)}배 근처인지 먼저 확인해요.`,
      headline: "가격 부담은 낮아 보여요",
      tone: "positive" as const,
    };
  }
  if (value <= median) {
    return {
      body: `${label}이 ${benchmarkLabel} ${formatOne(median)}배와 비슷한 ${formatOne(value)}배라 가격 부담은 크지 않아 보여요.`,
      watch: `${label}이 ${benchmarkLabel} ${formatOne(median)}배를 계속 넘는지 확인해요.`,
      headline: "가격은 무난해 보여요",
      tone: "neutral" as const,
    };
  }
  if (typeof p75 === "number" && value > p75) {
    return {
      body: `${label}이 ${benchmarkLabel} ${formatOne(median)}배보다 높은 ${formatOne(value)}배라 가격 부담은 함께 봐야 해요.`,
      watch: `${label}이 ${upperLabel} ${formatOne(p75)}배보다 높은지 먼저 확인해요.`,
      headline: "가격은 봐야 해요",
      tone: "cautious" as const,
    };
  }
  return {
    body: `${label}이 ${benchmarkLabel} ${formatOne(median)}배보다 높은 ${formatOne(value)}배라 가격 부담은 함께 봐야 해요.`,
    watch: `${label}이 ${benchmarkLabel} ${formatOne(median)}배보다 계속 높은지 먼저 확인해요.`,
    headline: "가격은 봐야 해요",
    tone: "neutral" as const,
  };
}

function benchmarkComparisonLabel(benchmark: IndustryBenchmark): string {
  return `${benchmarkScopeText(benchmark)}${benchmarkIndustryPhrase(benchmark)} 기준`.trim();
}

function benchmarkUpperLabel(benchmark: IndustryBenchmark): string {
  return `${benchmarkScopeText(benchmark)}${benchmarkIndustryPhrase(benchmark)} 상위권 기준`.trim();
}

function benchmarkLowerLabel(benchmark: IndustryBenchmark): string {
  return `${benchmarkScopeText(benchmark)}${benchmarkIndustryPhrase(benchmark)} 하위권 기준`.trim();
}

function benchmarkScopeText(benchmark: IndustryBenchmark): string {
  if (benchmark.scope === "KR" || benchmark.market === "KR") return "국내 ";
  if (benchmark.scope === "OVERSEAS" || benchmark.market === "US") return "해외 ";
  return "";
}

function benchmarkIndustryText(benchmark: IndustryBenchmark): string {
  return meaningfulText(benchmark.industry) || meaningfulText(benchmark.providerGroupName) || meaningfulText(benchmark.sector) || "";
}

function benchmarkIndustryPhrase(benchmark: IndustryBenchmark): string {
  const industry = benchmarkIndustryText(benchmark);
  return industry ? `${industry} 업종` : "업종";
}

function secondSentence(input: { strongestLabel: string; valuation?: { body: string } }): string {
  if (input.valuation) return `${input.strongestLabel}은 강점이고 ${input.valuation.body}`;
  return `${input.strongestLabel}은 강점이고 업종 기준 PER/PBR이 들어오면 가격 부담을 더 정확히 볼 수 있어요.`;
}

function watchSentence(input: { strongestLabel: string; valuation?: { watch: string } }): string {
  if (input.valuation) return input.valuation.watch;
  return `${input.strongestLabel} 점수와 가격 부담 지표를 함께 확인해요.`;
}

function headlineFor(input: { score: number; valuation?: { headline: string; tone: "positive" | "neutral" | "cautious" }; strongestLabel: string }): string {
  if (input.valuation?.tone === "cautious" && input.strongestLabel === "이익성") return "수익성은 좋고 가격은 봐야 해요";
  if (input.valuation?.tone === "cautious") return `${input.strongestLabel}은 좋고 가격은 봐야 해요`;
  if (input.valuation?.tone === "positive" && input.score >= 65) return `${input.strongestLabel}과 가격이 좋아요`;
  if (input.score >= 80) return `${input.strongestLabel}이 좋아 보여요`;
  return "균형 있게 봐야 해요";
}

function scoreMoodText(score: number): string {
  if (score >= 80) return "좋은 편이에요";
  if (score >= 65) return "괜찮지만 확인이 필요해요";
  if (score >= 50) return "중간 수준이에요";
  return "조심해서 봐야 해요";
}

function scoreTone(score: number, risk: unknown): "positive" | "neutral" | "cautious" {
  if (String(risk || "").toUpperCase() === "HIGH") return "cautious";
  if (score >= 80) return "positive";
  if (score < 50) return "cautious";
  return "neutral";
}

function valuationNumber(stock: RuleJudgmentStock, label: string): number | undefined {
  const row = stock.valuation.find((item) => normalizeLabel(item.label) === normalizeLabel(label));
  return parseFiniteNumber(row?.value);
}

function componentLabel(component: CompactComponent | undefined): string {
  const label = component?.label?.trim();
  if (!label) return "주요 지표";
  if (label === "이익성") return "이익성";
  if (/profit|margin|수익/i.test(label)) return "수익성";
  return label;
}

function cleanText(value: string): string {
  return value.replace(PROHIBITED_WORDS, "").replace(/\s{2,}/g, " ").trim();
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}

function formatOne(value: number): string {
  return new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(roundOne(value));
}

function parseFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/u)?.[0];
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringFromUnknown(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function meaningfulText(value: unknown): string | undefined {
  const text = stringFromUnknown(value);
  return text && text !== "-" ? text : undefined;
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function normalizeLabel(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}
