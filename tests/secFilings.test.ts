import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSecFilingsReadUrl,
  readSecFilings,
  writeSecFilings,
  secFilingsTestHooks,
  type SecFilingListItem,
} from "../src/lib/secFilings";

test("sec filing store dedupes by accession and returns newest rows first", async () => {
  secFilingsTestHooks.resetMemory();
  await writeSecFilings([
    filing({ accessionNumber: "0001", ticker: "US:AAPL", filedAt: "2026-06-10T00:00:00Z", summaryKo: "old" }),
    filing({ accessionNumber: "0002", ticker: "US:AAPL", filedAt: "2026-06-12T00:00:00Z", summaryKo: "new" }),
    filing({ accessionNumber: "0001", ticker: "US:AAPL", filedAt: "2026-06-11T00:00:00Z", summaryKo: "updated" }),
    filing({ accessionNumber: "0003", ticker: "US:MSFT", filedAt: "2026-06-13T00:00:00Z", summaryKo: "other" }),
  ], { supabase: false });

  const result = await readSecFilings({ ticker: "us:aapl", limit: 10, offset: 0, supabase: false });

  assert.equal(result.total, 2);
  assert.deepEqual(result.items.map((item) => item.accessionNumber), ["0002", "0001"]);
  assert.equal(result.items[1].summaryKo, "updated");
});

test("sec filing read url selects ticker rows with range pagination", () => {
  const url = buildSecFilingsReadUrl("https://example.supabase.co", { ticker: "US:NVDA", limit: 10, offset: 20 });

  assert.equal(
    url,
    "https://example.supabase.co/rest/v1/sec_filings?select=ticker%2Csymbol%2Ccik%2Caccession_number%2Cform_type%2Ccompany_name%2Cfiled_at%2Caccepted_at%2Csummary_ko%2Csource_url%2Ccategory%2Cimportance%2Ctags%2Cfacts&ticker=eq.US%3ANVDA&order=filed_at.desc&limit=10&offset=20"
  );
});

function filing(overrides: Partial<SecFilingListItem>): SecFilingListItem {
  return {
    ticker: "US:AAPL",
    symbol: "AAPL",
    cik: "0000320193",
    accessionNumber: "0000",
    formType: "8-K",
    companyName: "Apple Inc.",
    filedAt: "2026-06-10T00:00:00Z",
    acceptedAt: "2026-06-10T00:00:00Z",
    summaryKo: "실적 발표 공시예요.",
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/320193/0000/index.html",
    category: "current_report",
    importance: "medium",
    tags: ["8-K"],
    facts: {},
    ...overrides,
  };
}
