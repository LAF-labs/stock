import test from "node:test";
import assert from "node:assert/strict";

import {
  isTechnicalAnalysisPayload,
  safeInternalRedirectPath,
  technicalCoverageLabel,
  technicalSignals,
  technicalStatusCopy,
  technicalSummaryBullets,
  technicalToneLabel,
  technicalWarnings,
} from "../src/components/technicalAnalysisHelpers";
import type { TechnicalAnalysisPayload } from "../src/lib/technicalAnalysisTypes";

const payload: TechnicalAnalysisPayload = {
  type: "technical_analysis",
  version: "technical-v1",
  status: "limited",
  coverage_tier: "starter",
  bars: 15,
  data_window: { available_days: 15, required_days: 120, is_newly_listed: true },
  summary: { headline: "상장 초기라 빠른 신호만 참고하세요", tone: "limited", bullets: ["이평선 계산 전이에요."] },
  indicators: [],
  signals: [
    { key: "moving_average", title: "이평선", status: "limited", plain: "20·50일선 계산 전이에요.", evidence: "일봉 15개", rule: "20EMA와 50EMA의 위치를 봐요." },
  ],
  warnings: ["상장 초기 또는 데이터 부족 구간이에요."],
};

test("technical analysis helpers normalize beginner-facing copy", () => {
  assert.equal(isTechnicalAnalysisPayload(payload), true);
  assert.equal(technicalCoverageLabel(payload), "상장 초기");
  assert.equal(technicalStatusCopy(payload), "15개 일봉만 반영했어요. 빠른 신호 위주로 참고하세요.");
  assert.equal(technicalToneLabel("bullish"), "우호");
  assert.deepEqual(technicalSummaryBullets(payload), ["이평선 계산 전이에요."]);
  assert.deepEqual(technicalWarnings(payload), ["상장 초기 또는 데이터 부족 구간이에요."]);
  assert.equal(technicalSignals(payload)[0].tone, "insufficient");
});

test("safeInternalRedirectPath accepts only same-site relative redirects", () => {
  assert.equal(safeInternalRedirectPath("/?ticker=US%3AKO", "/?ticker=US%3AKO"), "/?ticker=US%3AKO");
  assert.equal(safeInternalRedirectPath("/technical?ticker=KR%3A005930#chart", "/"), "/technical?ticker=KR%3A005930#chart");

  assert.equal(safeInternalRedirectPath("https://evil.example/path", "/?ticker=US%3AKO"), "/?ticker=US%3AKO");
  assert.equal(safeInternalRedirectPath("//evil.example/path", "/?ticker=US%3AKO"), "/?ticker=US%3AKO");
  assert.equal(safeInternalRedirectPath("javascript:alert(1)", "/?ticker=US%3AKO"), "/?ticker=US%3AKO");
  assert.equal(safeInternalRedirectPath("/\\evil.example", "/?ticker=US%3AKO"), "/?ticker=US%3AKO");
});
