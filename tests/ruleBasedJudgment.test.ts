import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRuleBasedJudgment,
  compactRuleJudgmentStock,
  type IndustryBenchmark,
} from "../src/lib/ruleBasedJudgment";

const benchmark: IndustryBenchmark = {
  market: "US",
  scope: "OVERSEAS",
  period: "quarter",
  metric: "per",
  sector: "Consumer Defensive",
  industry: "Beverages",
  median: 18,
  p25: 14,
  p75: 24,
  sampleCount: 32,
};

test("rule judgment flags expensive PER against industry benchmark", () => {
  const stock = compactRuleJudgmentStock({
    market: "US",
    symbol: "KO",
    name: "Coca-Cola Co",
    score: 72.4,
    sia_snapshot: { risk_level: "LOW" },
    components: [
      { label: "이익성", score: 82.1 },
      { label: "밸류에이션", score: 42.0 },
    ],
    stock_profile: [
      { label: "산업", value: "Beverages" },
      { label: "섹터", value: "Consumer Defensive" },
    ],
    valuation_rows: [{ label: "PER", value: "29.98" }],
  });

  const judgment = buildRuleBasedJudgment(stock, {
    benchmark,
    cacheBucketStart: "2026-06-05T00:00:00.000Z",
  });

  assert.equal(judgment.model, "rule-v2");
  assert.equal(judgment.promptVersion, "stock-rule-judge-v4");
  assert.equal(judgment.headline, "수익성은 좋고 가격은 봐야 해요");
  assert.equal(
    judgment.body,
    "점수는 72.4점으로 괜찮지만 확인이 필요해요. 이익성은 강점이고 PER이 해외 Beverages 업종 평균 18.0배보다 높은 30.0배라 가격 부담은 함께 봐야 해요."
  );
  assert.equal(judgment.watch, "PER이 해외 Beverages 업종 상위권 평균 24.0배보다 높은지 먼저 확인해요.");
  assert.equal(judgment.tone, "cautious");
  assert.equal(judgment.cacheBucketStart, "2026-06-05T00:00:00.000Z");
  assert.doesNotMatch(`${judgment.headline} ${judgment.body} ${judgment.watch}`, /매수|매도|추천|목표가/);
});

test("rule judgment prefers Forward PER benchmark before trailing PER", () => {
  const stock = compactRuleJudgmentStock({
    market: "US",
    symbol: "NVDA",
    name: "NVIDIA Corp",
    score: 82.9,
    sia_snapshot: { risk_level: "LOW" },
    components: [
      { label: "이익성", score: 96.6 },
      { label: "밸류에이션", score: 80.7 },
    ],
    stock_profile: [
      { label: "산업", value: "Semiconductors" },
      { label: "섹터", value: "Technology" },
    ],
    valuation_rows: [
      { label: "PER", value: "33.0" },
      { label: "Forward PER", value: "17.3" },
      { label: "PBR", value: "26.7" },
    ],
  });

  const judgment = buildRuleBasedJudgment(stock, {
    benchmarks: [
      {
        market: "US",
        scope: "OVERSEAS",
        metric: "per",
        sector: "Technology",
        industry: "Semiconductors",
        median: 22,
        p25: 16,
        p75: 35,
        sampleCount: 20,
      },
      {
        market: "US",
        scope: "OVERSEAS",
        metric: "forward_per",
        sector: "Technology",
        industry: "Semiconductors",
        median: 24,
        p25: 18,
        p75: 38,
        sampleCount: 20,
      },
    ],
    cacheBucketStart: "2026-06-05T00:00:00.000Z",
  });

  assert.equal(judgment.headline, "이익성과 가격이 좋아요");
  assert.match(judgment.body, /Forward PER이 해외 Semiconductors 업종 평균 24\.0배/);
  assert.doesNotMatch(judgment.body, /PER이 해외 Semiconductors 업종 평균 22\.0배/);
  assert.equal(judgment.tone, "positive");
});

test("rule judgment stays useful without industry benchmark", () => {
  const stock = compactRuleJudgmentStock({
    market: "KR",
    symbol: "005930",
    name: "삼성전자",
    score: 68.7,
    components: [{ label: "모멘텀", score: 71.2 }],
    valuation_rows: [{ label: "PBR", value: "1.25" }],
  });

  const judgment = buildRuleBasedJudgment(stock, {
    cacheBucketStart: "2026-06-05T00:00:00.000Z",
  });

  assert.equal(judgment.headline, "균형 있게 봐야 해요");
  assert.equal(
    judgment.body,
    "점수는 68.7점으로 괜찮지만 확인이 필요해요. 모멘텀은 강점이고 업종 평균 PER/PBR이 들어오면 가격 부담을 더 정확히 볼 수 있어요."
  );
  assert.equal(judgment.watch, "모멘텀 점수와 가격 부담 지표를 함께 확인해요.");
  assert.equal(judgment.tone, "neutral");
});

test("rule judgment can use PBR industry benchmark when PER is missing", () => {
  const stock = compactRuleJudgmentStock({
    market: "KR",
    symbol: "005930",
    name: "삼성전자",
    score: 67,
    components: [{ label: "모멘텀", score: 74.2 }],
    valuation_rows: [{ label: "PBR", value: "2.41" }],
  });

  const judgment = buildRuleBasedJudgment(stock, {
    benchmarks: [
      {
        market: "KR",
        scope: "KR",
        metric: "pbr",
        sector: "Technology",
        industry: "반도체",
        median: 1.4,
        p25: 0.9,
        p75: 2.0,
        sampleCount: 12,
      },
    ],
    cacheBucketStart: "2026-06-05T00:00:00.000Z",
  });

  assert.equal(judgment.headline, "모멘텀은 좋고 가격은 봐야 해요");
  assert.equal(
    judgment.body,
    "점수는 67.0점으로 괜찮지만 확인이 필요해요. 모멘텀은 강점이고 PBR이 국내 반도체 업종 평균 1.4배보다 높은 2.4배라 가격 부담은 함께 봐야 해요."
  );
  assert.equal(judgment.watch, "PBR이 국내 반도체 업종 상위권 평균 2.0배보다 높은지 먼저 확인해요.");
  assert.equal(judgment.tone, "cautious");
});

test("rule judgment ignores zero valuation placeholders", () => {
  const stock = compactRuleJudgmentStock({
    market: "US",
    symbol: "QQQ",
    name: "INVESCO QQQ TRUST",
    score: 57,
    components: [
      { label: "거래 안정성", score: 90.8 },
      { label: "밸류에이션", score: 50 },
    ],
    valuation_rows: [
      { label: "PER", value: "-" },
      { label: "Forward PER", value: "-" },
      { label: "PBR", value: "0.00" },
    ],
  });

  const judgment = buildRuleBasedJudgment(stock, {
    benchmarks: [
      {
        market: "US",
        scope: "OVERSEAS",
        metric: "pbr",
        sector: "ETF",
        industry: "",
        median: 4.8,
        p25: 3.1,
        p75: 6.2,
        sampleCount: 20,
      },
    ],
    cacheBucketStart: "2026-06-05T00:00:00.000Z",
  });

  assert.doesNotMatch(judgment.body, /PBR이 .*0\.0배/);
  assert.match(judgment.body, /업종 평균 PER\/PBR이 들어오면/);
  assert.equal(judgment.watch, "거래 안정성 점수와 가격 부담 지표를 함께 확인해요.");
});

test("rule judgment mentions high opportunity separately from cautious quality", () => {
  const stock = compactRuleJudgmentStock({
    market: "KR",
    symbol: "108490",
    name: "로보티즈",
    quality_score: 38.9,
    opportunity_score: 68.4,
    sia_snapshot: { risk_level: "HIGH" },
    components: [
      { label: "모멘텀", score: 76.2 },
      { label: "밸류에이션", score: 0.0 },
    ],
    valuation_rows: [{ label: "Forward PER", value: "176.7" }],
  });

  const judgment = buildRuleBasedJudgment(stock, {
    cacheBucketStart: "2026-06-05T00:00:00.000Z",
  });

  assert.match(judgment.body, /기회 점수는 68\.4점/);
  assert.equal(judgment.tone, "cautious");
});
