import { summarizeSecFiling, type SecFilingFacts } from "@/lib/secFilingSummary";
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

export function dailyMasterIndexUrl(date: string | Date): string {
  const value = typeof date === "string" ? new Date(`${date}T00:00:00Z`) : date;
  const year = value.getUTCFullYear();
  const month = value.getUTCMonth();
  const quarter = Math.floor(month / 3) + 1;
  const yyyymmdd = `${year}${String(month + 1).padStart(2, "0")}${String(value.getUTCDate()).padStart(2, "0")}`;
  return `https://www.sec.gov/Archives/edgar/daily-index/${year}/QTR${quarter}/master.${yyyymmdd}.idx`;
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

export function indexFilingNeedsDocumentFacts(filing: SecFilingListItem): boolean {
  const form = filing.formType.trim().toUpperCase();
  return ["3", "4", "5", "8-K", "8-K/A", "10-Q", "10-Q/A", "10-K", "10-K/A", "144"].includes(form)
    || isBeneficialOwnershipForm(form)
    || isOfferingForm(form);
}

export function enrichIndexFilingFromDocument(filing: SecFilingListItem, text: string): SecFilingListItem {
  const form = filing.formType.trim().toUpperCase();
  const facts = extractFacts(form, text);
  const items = form === "8-K" || form === "8-K/A" ? extract8KItems(text) : undefined;
  const summary = summarizeSecFiling({
    formType: filing.formType,
    companyName: filing.companyName,
    ticker: filing.ticker,
    items,
    facts,
  });
  return {
    ...filing,
    summaryKo: summary.summaryKo,
    category: summary.category,
    importance: summary.importance,
    tags: summary.tags,
    facts: compactFacts(facts),
  };
}

function accessionFromFilename(filename: string | undefined): string | undefined {
  return filename?.split("/").pop()?.replace(/\.txt$/i, "");
}

function extractFacts(form: string, text: string): SecFilingFacts {
  if (["3", "4", "5"].includes(form)) return extractOwnershipFacts(text);
  if (form === "144") return {
    plannedSaleShares: firstNumber(tagValue(text, "noOfUnitsSold")),
    plannedSaleValue: firstNumber(tagValue(text, "aggregateMarketValue")) || moneyFromText(text),
    currency: "USD",
  };
  if (form === "8-K" || form === "8-K/A" || form.startsWith("10-Q") || form.startsWith("10-K")) {
    return {
      revenue: moneyAfter(text, /(?:revenue|revenues|net sales)[^$.]{0,80}\$/i),
      netIncome: moneyAfter(text, /(?:net income|net earnings)[^$.]{0,80}\$/i),
      currency: "USD",
    };
  }
  if (isBeneficialOwnershipForm(form)) return {
    holderName: tagValue(text, "reportingPersonName") || tagValue(text, "nameOfReportingPerson"),
    ownershipPercent: firstNumber(text.match(/([\d.]+)\s*%/i)?.[1]),
  };
  if (isOfferingForm(form)) return {
    ...offeringFacts(text),
    currency: "USD",
  };
  return {};
}

function offeringFacts(text: string): SecFilingFacts {
  const shares = firstNumber(text.match(/([\d,]+(?:\.\d+)?)\s+(?:shares|ordinary shares|common stock)/i)?.[1]);
  const price = priceFromText(text);
  return {
    shares,
    price,
    offeringAmount: shares && price ? shares * price : offeringAmountFromText(text),
  };
}

function priceFromText(text: string): number | undefined {
  return firstNumber(
    text.match(/(?:public offering price|offering price|price to public)[\s\S]{0,160}?\$\s*([\d,.]+)/i)?.[1]
      || text.match(/(?:offer|offering)[\s\S]{0,160}?\bat\s*\$\s*([\d,.]+)\s*(?:per share|a share|per ordinary share)/i)?.[1]
  );
}

function offeringAmountFromText(text: string): number | undefined {
  const match = text.match(/(?:gross proceeds|aggregate offering price|total offering|offering amount)[\s\S]{0,160}?\$\s*([\d,.]+)\s*(billion|million|thousand|bn|m|k)?/i);
  return match ? moneyFromParts(match[1], match[2]) : undefined;
}

function extractOwnershipFacts(text: string): SecFilingFacts {
  const facts: SecFilingFacts = {
    insiderName: tagValue(text, "rptOwnerName"),
    currency: "USD",
  };
  for (const block of text.match(/<nonDerivativeTransaction[\s\S]*?<\/nonDerivativeTransaction>/g) || []) addTransactionFacts(facts, block);
  for (const block of text.match(/<derivativeTransaction[\s\S]*?<\/derivativeTransaction>/g) || []) addTransactionFacts(facts, block);
  return facts;
}

function addTransactionFacts(facts: SecFilingFacts, block: string): void {
  const code = tagValue(block, "transactionCode");
  const shares = firstNumber(tagValue(block, "transactionShares"));
  const price = firstNumber(tagValue(block, "transactionPricePerShare"));
  const after = firstNumber(tagValue(block, "sharesOwnedFollowingTransaction"));
  const value = shares && price ? shares * price : undefined;
  if (after) facts.sharesOwnedAfter = after;
  if (code === "S") {
    facts.saleShares = (facts.saleShares || 0) + (shares || 0);
    facts.saleValue = (facts.saleValue || 0) + (value || 0);
  } else if (code === "P") {
    facts.purchaseShares = (facts.purchaseShares || 0) + (shares || 0);
    facts.purchaseValue = (facts.purchaseValue || 0) + (value || 0);
  } else if (code === "M") {
    facts.optionExerciseShares = (facts.optionExerciseShares || 0) + (shares || 0);
  } else if (code === "A") {
    facts.acquiredShares = (facts.acquiredShares || 0) + (shares || 0);
  } else if (code === "D") {
    facts.disposedShares = (facts.disposedShares || 0) + (shares || 0);
  }
}

function extract8KItems(text: string): string[] {
  return [...text.matchAll(/Item\s+(\d+\.\d+)/gi)].map((match) => match[1]);
}

function moneyAfter(text: string, prefix: RegExp): number | undefined {
  const start = text.search(prefix);
  if (start < 0) return undefined;
  return moneyFromText(text.slice(start, start + 220));
}

function moneyFromText(text: string): number | undefined {
  const match = text.match(/\$\s*([\d,.]+)\s*(billion|million|thousand|bn|m|k)?/i);
  if (!match) return undefined;
  return moneyFromParts(match[1], match[2]);
}

function moneyFromParts(value: string | undefined, unitValue: string | undefined): number | undefined {
  const base = firstNumber(value);
  const unit = (unitValue || "").toLowerCase();
  if (!base) return undefined;
  if (unit === "billion" || unit === "bn") return base * 1_000_000_000;
  if (unit === "million" || unit === "m") return base * 1_000_000;
  if (unit === "thousand" || unit === "k") return base * 1_000;
  return base;
}

function tagValue(text: string, tag: string): string | undefined {
  const match = text.match(new RegExp(`<${tag}>\\s*(?:<value>)?\\s*([^<]+)`, "i"));
  return match?.[1]?.trim();
}

function firstNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isOfferingForm(form: string): boolean {
  return /^(S|F)-[13]\b/.test(form) || form.startsWith("424B") || form === "POS AM";
}

function isBeneficialOwnershipForm(form: string): boolean {
  return form.startsWith("SC 13D")
    || form.startsWith("SC 13G")
    || form.startsWith("SCHEDULE 13D")
    || form.startsWith("SCHEDULE 13G");
}

function compactFacts(facts: SecFilingFacts): Record<string, unknown> {
  return Object.fromEntries(Object.entries(facts).filter(([, value]) => value !== undefined && value !== null && value !== 0));
}
