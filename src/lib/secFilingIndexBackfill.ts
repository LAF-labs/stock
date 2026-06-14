import { summarizeSecFiling } from "@/lib/secFilingSummary";
import type { SecFilingListItem } from "@/lib/secFilings";

export type SecMasterIndexEntry = {
  cik: string;
  companyName: string;
  formType: string;
  filedAt: string;
  filename?: string;
};

export function parseMasterIndex(text: string): SecMasterIndexEntry[] {
  const rows: SecMasterIndexEntry[] = [];
  let inRows = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("----")) {
      inRows = true;
      continue;
    }
    if (!inRows) continue;
    const [cik, companyName, formType, filedDate, filename] = line.split("|");
    if (!cik || !companyName || !formType || !filedDate) continue;
    rows.push({
      cik: cik.padStart(10, "0"),
      companyName,
      formType,
      filedAt: `${filedDate}T00:00:00.000Z`,
      filename: filename || undefined,
    });
  }
  return rows;
}

export function indexEntryToFiling(entry: SecMasterIndexEntry, cikToTicker: Map<string, string>): SecFilingListItem | undefined {
  const symbol = cikToTicker.get(entry.cik);
  if (!symbol) return undefined;
  const summary = summarizeSecFiling({ formType: entry.formType, companyName: entry.companyName, ticker: `US:${symbol}` });
  return {
    ticker: `US:${symbol}`,
    symbol,
    cik: entry.cik,
    accessionNumber: accessionFromFilename(entry.filename) || `${entry.cik}-${entry.formType}-${entry.filedAt.slice(0, 10)}`,
    formType: entry.formType,
    companyName: entry.companyName,
    filedAt: entry.filedAt,
    summaryKo: summary.summaryKo,
    sourceUrl: entry.filename ? `https://www.sec.gov/Archives/${entry.filename}` : undefined,
    category: summary.category,
    importance: summary.importance,
    tags: summary.tags,
    facts: {},
  };
}

function accessionFromFilename(filename: string | undefined): string | undefined {
  return filename?.split("/").pop()?.replace(/\.txt$/i, "");
}
