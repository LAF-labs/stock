import test from "node:test";
import assert from "node:assert/strict";

import { dailyMasterIndexUrl, enrichIndexFilingFromDocument, indexEntryToFiling, parseMasterIndex, rankIndexFilingFactCandidates } from "../src/lib/secFilingIndexBackfill";

test("parses SEC master index rows into rule-summary filings", () => {
  const entries = parseMasterIndex(`
CIK|Company Name|Form Type|Date Filed|Filename
--------------------------------------------------------------------------------
320193|Apple Inc.|8-K|2026-06-10|edgar/data/320193/0000320193-26-000078.txt
`);

  assert.equal(entries.length, 1);
  const filing = indexEntryToFiling(entries[0], new Map([["0000320193", "AAPL"]]));

  assert.equal(filing?.ticker, "US:AAPL");
  assert.equal(filing?.filedAt, "2026-06-10T00:00:00.000Z");
  assert.equal(filing?.sourceUrl, "https://www.sec.gov/Archives/edgar/data/320193/0000320193-26-000078.txt");
  assert.match(filing?.summaryKo || "", /8-K/);
});

test("builds SEC daily master index URL from a filing date", () => {
  assert.equal(
    dailyMasterIndexUrl("2026-06-12"),
    "https://www.sec.gov/Archives/edgar/daily-index/2026/QTR2/master.20260612.idx"
  );
});

test("prioritizes high-value filing types for document fact fetching", () => {
  const filings = ["8-K", "424B5", "4", "10-Q"].map((formType, index) => {
    const filing = indexEntryToFiling({
      cik: String(index + 1).padStart(10, "0"),
      companyName: `Company ${index}`,
      formType,
      filedAt: "2026-06-12T00:00:00.000Z",
      filename: `edgar/data/${index + 1}/000000000${index}-26-000001.txt`,
    }, new Map([[String(index + 1).padStart(10, "0"), `T${index}`]]));
    assert.ok(filing);
    return filing;
  });

  assert.deepEqual(
    rankIndexFilingFactCandidates(filings).slice(0, 3).map((candidate) => candidate.filing.formType),
    ["10-Q", "424B5", "4"]
  );
});

test("enriches indexed form 4 summaries with sale shares and value", () => {
  const filing = indexEntryToFiling({
    cik: "0000320193",
    companyName: "Apple Inc.",
    formType: "4",
    filedAt: "2026-06-12T00:00:00.000Z",
    filename: "edgar/data/320193/0000320193-26-000129.txt",
  }, new Map([["0000320193", "AAPL"]]));
  assert.ok(filing);

  const enriched = enrichIndexFilingFromDocument(filing, `
    <rptOwnerName>Jane Doe</rptOwnerName>
    <nonDerivativeTransaction>
      <transactionCoding><transactionCode>S</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>5000</value></transactionShares>
        <transactionPricePerShare><value>180.50</value></transactionPricePerShare>
      </transactionAmounts>
      <postTransactionAmounts><sharesOwnedFollowingTransaction><value>12000</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
    </nonDerivativeTransaction>
  `);

  assert.match(enriched.summaryKo, /Jane Doe/);
  assert.match(enriched.summaryKo, /5,000주/);
  assert.match(enriched.summaryKo, /\$902\.5K/);
  assert.equal(enriched.facts.saleShares, 5000);
});

test("enriches indexed 8-K summaries with item and financial numbers", () => {
  const filing = indexEntryToFiling({
    cik: "0000789019",
    companyName: "Microsoft Corp",
    formType: "8-K",
    filedAt: "2026-06-12T00:00:00.000Z",
    filename: "edgar/data/789019/0000789019-26-000129.txt",
  }, new Map([["0000789019", "MSFT"]]));
  assert.ok(filing);

  const enriched = enrichIndexFilingFromDocument(filing, "Item 2.02 Results of Operations and Financial Condition. Revenue was $70.1 billion. Net income was $25.8 billion.");

  assert.equal(enriched.category, "current_report");
  assert.equal(enriched.importance, "high");
  assert.match(enriched.summaryKo, /매출 약 \$70\.1B/);
  assert.match(enriched.summaryKo, /순이익 약 \$25\.8B/);
});

test("enriches periodic summaries with SEC fiscal period tag", () => {
  const filing = indexEntryToFiling({
    cik: "0000320193",
    companyName: "Apple Inc.",
    formType: "10-Q",
    filedAt: "2026-06-12T00:00:00.000Z",
    filename: "edgar/data/320193/0000320193-26-000129.txt",
  }, new Map([["0000320193", "AAPL"]]));
  assert.ok(filing);

  const enriched = enrichIndexFilingFromDocument(filing, `
    <ix:nonNumeric name="dei:DocumentFiscalPeriodFocus" contextRef="c1">Q1</ix:nonNumeric>
    <ix:nonFraction unitRef="usd" contextRef="c1" name="us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax" scale="3">215,225</ix:nonFraction>
    <ix:nonFraction unitRef="usd" contextRef="prior" name="us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax" scale="3">242,125</ix:nonFraction>
    <ix:nonFraction unitRef="usd" contextRef="c1" name="us-gaap:NetIncomeLoss" sign="-" scale="3">53,191</ix:nonFraction>
  `);

  assert.equal(enriched.facts.fiscalPeriod, "Q1");
  assert.equal(enriched.facts.revenue, 215_225_000);
  assert.equal(enriched.facts.netIncome, -53_191_000);
  assert.match(enriched.summaryKo, /1분기 실적이 발표/);
  assert.match(enriched.summaryKo, /매출 약 \$215\.2M/);
  assert.match(enriched.summaryKo, /순손실 약 \$53\.2M/);
});

test("enriches offering summaries with shares, price, and total value", () => {
  const filing = indexEntryToFiling({
    cik: "0000000001",
    companyName: "Example Corp",
    formType: "424B5",
    filedAt: "2026-06-12T00:00:00.000Z",
    filename: "edgar/data/1/0000000001-26-000001.txt",
  }, new Map([["0000000001", "EX"]]));
  assert.ok(filing);

  const enriched = enrichIndexFilingFromDocument(filing, "We are offering 5,000,000 shares of common stock at $50.00 per share.");

  assert.equal(enriched.facts.shares, 5_000_000);
  assert.equal(enriched.facts.price, 50);
  assert.equal(enriched.facts.offeringAmount, 250_000_000);
  assert.match(enriched.summaryKo, /\$250\.0M/);
  assert.match(enriched.summaryKo, /5,000,000주/);
});

test("does not treat par value as offering price", () => {
  const filing = indexEntryToFiling({
    cik: "0000000001",
    companyName: "Example Corp",
    formType: "424B5",
    filedAt: "2026-06-12T00:00:00.000Z",
    filename: "edgar/data/1/0000000001-26-000001.txt",
  }, new Map([["0000000001", "EX"]]));
  assert.ok(filing);

  const enriched = enrichIndexFilingFromDocument(filing, "We are offering 5,000,000 shares of common stock, $0.01 par value per share.");

  assert.equal(enriched.facts.shares, 5_000_000);
  assert.equal(enriched.facts.price, undefined);
  assert.equal(enriched.facts.offeringAmount, undefined);
  assert.doesNotMatch(enriched.summaryKo, /\$0\.01|\$50\.0K/);
});

test("does not treat total price-to-public as per-share offering price", () => {
  const filing = indexEntryToFiling({
    cik: "0000000001",
    companyName: "Example Corp",
    formType: "424B5",
    filedAt: "2026-06-12T00:00:00.000Z",
    filename: "edgar/data/1/0000000001-26-000001.txt",
  }, new Map([["0000000001", "EX"]]));
  assert.ok(filing);

  const enriched = enrichIndexFilingFromDocument(filing, "Price to public $5,235,810. We are offering 681,155 shares of common stock.");

  assert.equal(enriched.facts.shares, 681_155);
  assert.equal(enriched.facts.price, undefined);
  assert.equal(enriched.facts.offeringAmount, undefined);
  assert.doesNotMatch(enriched.summaryKo, /\$5\.2M|\$3566\.4B/);
});
