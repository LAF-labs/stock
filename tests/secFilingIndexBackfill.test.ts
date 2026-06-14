import test from "node:test";
import assert from "node:assert/strict";

import { indexEntryToFiling, parseMasterIndex } from "../src/lib/secFilingIndexBackfill";

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
