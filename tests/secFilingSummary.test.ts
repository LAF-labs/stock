import test from "node:test";
import assert from "node:assert/strict";

import { summarizeSecFiling } from "../src/lib/secFilingSummary";

test("summarizes insider sale with share and dollar value", () => {
  const result = summarizeSecFiling({
    formType: "4",
    companyName: "Procore Technologies",
    facts: {
      insiderName: "Craig Courtemanche",
      saleShares: 56_122,
      saleValue: 2_530_000,
      optionExerciseShares: 56_122,
      sharesOwnedAfter: 919_704,
    },
  });

  assert.equal(result.category, "insider_transaction");
  assert.match(result.summaryKo, /Craig Courtemanche/);
  assert.match(result.summaryKo, /56,122주/);
  assert.match(result.summaryKo, /\$2\.5M/);
  assert.match(result.summaryKo, /옵션 행사/);
});

test("summarizes 8-K items in plain Korean", () => {
  const result = summarizeSecFiling({
    formType: "8-K",
    items: "2.02,9.01",
    facts: { fiscalPeriod: "Q2", revenue: 90_753_000_000, netIncome: 23_434_000_000, currency: "USD" },
  });

  assert.equal(result.category, "current_report");
  assert.match(result.summaryKo, /2분기 실적이 발표/);
  assert.match(result.summaryKo, /매출 약 \$90\.8B/);
  assert.match(result.summaryKo, /순이익 약 \$23\.4B/);
});

test("summarizes periodic reports with revenue and net income", () => {
  const result = summarizeSecFiling({
    formType: "10-Q",
    facts: { fiscalPeriod: "Q1", revenue: 16_740_000_000, netIncome: -120_000_000, currency: "USD" },
  });

  assert.equal(result.category, "periodic_report");
  assert.match(result.summaryKo, /1분기 실적이 발표/);
  assert.match(result.summaryKo, /매출 약 \$16\.7B/);
  assert.match(result.summaryKo, /순손실 약 \$120\.0M/);
});

test("summarizes offering forms with amount", () => {
  const result = summarizeSecFiling({
    formType: "S-3",
    facts: { offeringAmount: 750_000_000, shares: 12_000_000, price: 62.5, currency: "USD" },
  });

  assert.equal(result.category, "offering");
  assert.match(result.summaryKo, /증권 발행/);
  assert.match(result.summaryKo, /\$750\.0M/);
  assert.match(result.summaryKo, /12,000,000주/);
  assert.match(result.summaryKo, /주당 \$62\.50/);
});

test("summarizes schedule 13G index forms as major holder disclosures", () => {
  const result = summarizeSecFiling({ formType: "SCHEDULE 13G/A" });

  assert.equal(result.category, "major_holder");
  assert.equal(result.importance, "high");
  assert.match(result.summaryKo, /대량보유/);
});

test("summarizes Korean DART shareholder change reports", () => {
  const result = summarizeSecFiling({
    formType: "최대주주등소유주식변동신고서",
    ticker: "KR:005930",
    facts: { source: "DART", reportName: "최대주주등소유주식변동신고서" },
  });

  assert.equal(result.category, "major_holder");
  assert.match(result.summaryKo, /최대주주 측 보유 주식/);
});

test("summarizes Korean paid-in capital increases with amount and shares", () => {
  const result = summarizeSecFiling({
    formType: "유상증자결정",
    ticker: "KR:005930",
    facts: {
      source: "DART",
      reportName: "유상증자결정",
      shares: 3_000_000,
      offeringAmount: 15_000_000_000,
      fundingPurpose: "운영자금 100억원, 채무상환 50억원",
      issueMethod: "제3자배정증자",
      currency: "KRW",
    },
  });

  assert.equal(result.category, "offering");
  assert.match(result.summaryKo, /150억원/);
  assert.match(result.summaryKo, /3,000,000주/);
  assert.match(result.summaryKo, /운영자금 100억원, 채무상환 50억원/);
  assert.match(result.summaryKo, /제3자배정증자/);
});

test("summarizes Korean convertible bonds with conversion price and shares", () => {
  const result = summarizeSecFiling({
    formType: "전환사채권발행결정",
    ticker: "KR:005930",
    facts: {
      source: "DART",
      reportName: "전환사채권발행결정",
      bondAmount: 20_000_000_000,
      conversionPrice: 6_500,
      conversionShares: 3_076_923,
      currency: "KRW",
    },
  });

  assert.equal(result.category, "offering");
  assert.match(result.summaryKo, /200억원/);
  assert.match(result.summaryKo, /전환가 6,500원/);
  assert.match(result.summaryKo, /3,076,923주/);
});

test("keeps unknown forms safe and short", () => {
  const result = summarizeSecFiling({ formType: "X-17A-5", companyName: "Broker Dealer" });

  assert.equal(result.category, "other");
  assert.match(result.summaryKo, /SEC에 새 문서를 제출/);
  assert.ok(result.summaryKo.length < 100);
});
