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

  assert.equal(judgment.model, "rule-v1");
  assert.equal(judgment.promptVersion, "stock-rule-judge-v1");
  assert.equal(judgment.headline, "수익성은 좋고 가격은 봐야 해요");
  assert.equal(
    judgment.body,
    "점수는 72.4점으로 괜찮지만 확인이 필요해요. 이익성은 강점이고 PER이 해외 Beverages 업종 기준 18.0배보다 높은 30.0배라 가격 부담은 함께 봐야 해요."
  );
  assert.equal(judgment.watch, "PER이 해외 Beverages 업종 상위권 기준 24.0배보다 높은지 먼저 확인해요.");
  assert.equal(judgment.tone, "cautious");
  assert.equal(judgment.cacheBucketStart, "2026-06-05T00:00:00.000Z");
  assert.doesNotMatch(`${judgment.headline} ${judgment.body} ${judgment.watch}`, /매수|매도|추천|목표가/);
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
    "점수는 68.7점으로 괜찮지만 확인이 필요해요. 모멘텀은 강점이고 업종 기준 PER/PBR이 들어오면 가격 부담을 더 정확히 볼 수 있어요."
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
    "점수는 67.0점으로 괜찮지만 확인이 필요해요. 모멘텀은 강점이고 PBR이 국내 반도체 업종 기준 1.4배보다 높은 2.4배라 가격 부담은 함께 봐야 해요."
  );
  assert.equal(judgment.watch, "PBR이 국내 반도체 업종 상위권 기준 2.0배보다 높은지 먼저 확인해요.");
  assert.equal(judgment.tone, "cautious");
});
