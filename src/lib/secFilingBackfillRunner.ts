import symbols from "@/data/symbols.generated.json";
import { summarizeSecFiling, type SecFilingFacts } from "@/lib/secFilingSummary";
import { writeSecFilings, type SecFilingListItem } from "@/lib/secFilings";

export type SecFilingBackfillOptions = {
  allUs: boolean;
  tickers: string[];
  since: string;
  limitTickers: number;
  maxFilingsPerTicker: number;
  fetchDocLimit: number;
  json: boolean;
  dryRun: boolean;
};

type CikEntry = { cik: string; ticker: string; title: string };
type SecSubmission = {
  name?: string;
  tickers?: string[];
  filings?: {
    recent?: {
      accessionNumber?: string[];
      filingDate?: string[];
      acceptanceDateTime?: string[];
      reportDate?: string[];
      form?: string[];
      primaryDocument?: string[];
      items?: string[];
    };
  };
};

const SEC_ARCHIVES = "https://www.sec.gov/Archives/edgar/data";
const SEC_DATA = "https://data.sec.gov";
const SEC_WWW = "https://www.sec.gov";
const DEFAULT_USER_AGENT = "LAF-labs stock filings admin@laflabs.ai";
const IMPORTANT_FORMS = new Set(["3", "4", "5", "8-K", "8-K/A", "10-Q", "10-Q/A", "10-K", "10-K/A", "144"]);

let lastSecRequestAt = 0;
const companyFactsCache = new Map<string, Promise<Record<string, unknown>>>();

export async function backfillSecFilings(options: SecFilingBackfillOptions) {
  const cikMap = await loadCikMap();
  const tickers = targetTickers(options);
  if (!tickers.length) throw new Error("Use --ticker, --tickers, or --all-us.");

  const rows: SecFilingListItem[] = [];
  const sample: SecFilingListItem[] = [];
  let rowCount = 0;
  let docFetches = 0;
  let companyFactsFetches = 0;
  let skipped = 0;
  let processed = 0;
  const sinceMs = Date.parse(options.since);

  for (const ticker of tickers) {
    processed += 1;
    const entry = cikMap.get(stripUsPrefix(ticker));
    if (!entry) {
      skipped += 1;
      continue;
    }
    const submission = await fetchSecJson<SecSubmission>(`${SEC_DATA}/submissions/CIK${entry.cik}.json`);
    const recent = submission.filings?.recent;
    const forms = recent?.form || [];
    const factsByFiledDate = new Map<string, SecFilingFacts>();
    let addedForTicker = 0;

    for (let index = 0; index < forms.length && addedForTicker < options.maxFilingsPerTicker; index += 1) {
      const formType = forms[index];
      const filedAt = dateString(recent?.filingDate?.[index]);
      if (!formType || !filedAt || Date.parse(filedAt) < sinceMs) continue;
      const accessionNumber = recent?.accessionNumber?.[index];
      const primaryDocument = recent?.primaryDocument?.[index] || "";
      if (!accessionNumber) continue;

      const sourceUrl = primaryDocument
        ? primaryDocumentUrl(entry.cik, accessionNumber, primaryDocument)
        : accessionIndexUrl(entry.cik, accessionNumber);
      const facts: SecFilingFacts = {};
      const cleanForm = formType.toUpperCase();

      const wantsFinancialFacts = ["10-Q", "10-Q/A", "10-K", "10-K/A"].includes(cleanForm)
        || ((cleanForm === "8-K" || cleanForm === "8-K/A") && (recent?.items?.[index] || "").includes("2.02"));
      if (wantsFinancialFacts && !factsByFiledDate.has(filedAt)) {
        const willFetchCompanyFacts = !companyFactsCache.has(entry.cik);
        const financialFacts = await fetchCompanyFinancialFacts(entry.cik, filedAt).catch(() => ({}));
        if (willFetchCompanyFacts) companyFactsFetches += 1;
        factsByFiledDate.set(filedAt, financialFacts);
      }
      Object.assign(facts, factsByFiledDate.get(filedAt));

      if (docFetches < options.fetchDocLimit && shouldFetchPrimaryDocument(cleanForm, primaryDocument)) {
        const documentText = await fetchSecText(sourceUrl).catch(() => "");
        if (documentText) {
          Object.assign(facts, extractDocumentFacts(cleanForm, documentText));
          docFetches += 1;
        }
      }

      const summary = summarizeSecFiling({
        formType,
        companyName: submission.name || entry.title,
        ticker: `US:${entry.ticker}`,
        items: recent?.items?.[index],
        facts,
      });
      const row: SecFilingListItem = {
        ticker: `US:${entry.ticker}`,
        symbol: entry.ticker,
        cik: entry.cik,
        accessionNumber,
        formType,
        companyName: submission.name || entry.title,
        filedAt,
        acceptedAt: acceptanceDate(recent?.acceptanceDateTime?.[index]),
        summaryKo: summary.summaryKo,
        sourceUrl,
        category: summary.category,
        importance: summary.importance,
        tags: summary.tags,
        facts: compactFacts(facts),
      };
      rowCount += 1;
      if (sample.length < 5) sample.push(row);
      rows.push(row);
      if (!options.dryRun && rows.length >= 250) {
        await writeSecFilings(rows.splice(0, rows.length));
      }
      addedForTicker += 1;
    }
    if (!options.json && processed % 50 === 0) {
      console.error(`processed=${processed}/${tickers.length} rows=${rowCount} skipped=${skipped}`);
    }
  }

  if (!options.dryRun && rows.length) await writeSecFilings(rows);
  return {
    ok: true,
    dry_run: options.dryRun,
    since: options.since,
    tickers: tickers.length,
    rows: rowCount,
    skipped,
    doc_fetches: docFetches,
    company_facts_fetches: companyFactsFetches,
    sample,
  };
}

function targetTickers(options: SecFilingBackfillOptions): string[] {
  const requested = options.allUs ? loadUsSymbols() : options.tickers;
  const tickers = [...new Set(requested.map((ticker) => `US:${stripUsPrefix(ticker)}`).filter((ticker) => ticker.length > 3))];
  return options.limitTickers > 0 ? tickers.slice(0, options.limitTickers) : tickers;
}

function loadUsSymbols(): string[] {
  return (symbols as Array<Record<string, unknown>>)
    .filter((item) => item.market === "US" && typeof item.ticker === "string")
    .map((item) => `US:${item.ticker}`);
}

async function loadCikMap(): Promise<Map<string, CikEntry>> {
  const payload = await fetchSecJson<{ fields?: string[]; data?: unknown[][] }>(`${SEC_WWW}/files/company_tickers_exchange.json`);
  const fields = payload.fields || [];
  const data = payload.data || [];
  const cikIndex = fields.indexOf("cik");
  const tickerIndex = fields.indexOf("ticker");
  const titleIndex = fields.indexOf("name");
  const map = new Map<string, CikEntry>();
  for (const row of data) {
    const ticker = String(row[tickerIndex] || "").toUpperCase();
    const cik = String(row[cikIndex] || "").padStart(10, "0");
    if (!ticker || !cik) continue;
    map.set(ticker, { ticker, cik, title: String(row[titleIndex] || ticker) });
  }
  return map;
}

async function fetchCompanyFinancialFacts(cik: string, filedAt: string): Promise<SecFilingFacts> {
  if (!companyFactsCache.has(cik)) {
    companyFactsCache.set(cik, fetchSecJson<Record<string, unknown>>(`${SEC_DATA}/api/xbrl/companyfacts/CIK${cik}.json`));
  }
  const payload = await companyFactsCache.get(cik)!;
  const facts = ((payload.facts as Record<string, unknown> | undefined)?.["us-gaap"] || {}) as Record<string, unknown>;
  return {
    revenue: latestUsdFact(facts, filedAt, ["RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "Revenues", "SalesRevenueNet"]),
    netIncome: latestUsdFact(facts, filedAt, ["NetIncomeLoss"]),
    currency: "USD",
  };
}

function latestUsdFact(facts: Record<string, unknown>, filedAt: string, concepts: string[]): number | undefined {
  const filedMs = Date.parse(filedAt);
  const candidates: Array<{ filed: number; end: number; value: number }> = [];
  for (const concept of concepts) {
    const units = ((facts[concept] as Record<string, unknown> | undefined)?.units || {}) as Record<string, unknown>;
    const usd = Array.isArray(units.USD) ? units.USD as Array<Record<string, unknown>> : [];
    for (const item of usd) {
      const value = Number(item.val);
      const filed = Date.parse(String(item.filed || ""));
      const end = Date.parse(String(item.end || ""));
      if (Number.isFinite(value) && Number.isFinite(filed) && filed <= filedMs + 7 * 24 * 60 * 60 * 1000) {
        candidates.push({ filed, end: Number.isFinite(end) ? end : 0, value });
      }
    }
    if (candidates.length) break;
  }
  candidates.sort((left, right) => right.filed - left.filed || right.end - left.end);
  return candidates[0]?.value;
}

function extractDocumentFacts(formType: string, text: string): SecFilingFacts {
  if (["3", "4", "5"].includes(formType)) return extractOwnershipFacts(text);
  if (formType === "144") return extractPlannedSaleFacts(text);
  if (formType.startsWith("SC 13D") || formType.startsWith("SC 13G")) return extractStakeFacts(text);
  if (/^(S|F)-[13]\b/.test(formType) || formType.startsWith("424B")) return extractOfferingFacts(text);
  return {};
}

function extractOwnershipFacts(xml: string): SecFilingFacts {
  const facts: SecFilingFacts = {
    insiderName: tagValue(xml, "rptOwnerName"),
    currency: "USD",
  };
  for (const block of xml.match(/<nonDerivativeTransaction[\s\S]*?<\/nonDerivativeTransaction>/g) || []) {
    addTransactionFacts(facts, block);
  }
  for (const block of xml.match(/<derivativeTransaction[\s\S]*?<\/derivativeTransaction>/g) || []) {
    addTransactionFacts(facts, block);
  }
  return facts;
}

function addTransactionFacts(facts: SecFilingFacts, block: string): void {
  const code = tagValue(block, "transactionCode");
  const shares = numberValue(tagValue(block, "transactionShares"));
  const price = numberValue(tagValue(block, "transactionPricePerShare"));
  const after = numberValue(tagValue(block, "sharesOwnedFollowingTransaction"));
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

function extractPlannedSaleFacts(text: string): SecFilingFacts {
  return {
    plannedSaleShares: firstNumber(tagValue(text, "noOfUnitsSold")),
    plannedSaleValue: firstNumber(tagValue(text, "aggregateMarketValue")) || moneyFromText(text),
    currency: "USD",
  };
}

function extractStakeFacts(text: string): SecFilingFacts {
  return {
    holderName: tagValue(text, "reportingPersonName") || tagValue(text, "nameOfReportingPerson"),
    ownershipPercent: firstNumber(text.match(/([\d.]+)\s*%/i)?.[1]),
  };
}

function extractOfferingFacts(text: string): SecFilingFacts {
  return {
    offeringAmount: moneyFromText(text),
    shares: firstNumber(text.match(/([\d,]+(?:\.\d+)?)\s+(?:shares|ordinary shares|common stock)/i)?.[1]),
    currency: "USD",
  };
}

function moneyFromText(text: string): number | undefined {
  const match = text.match(/\$\s*([\d,.]+)\s*(billion|million|thousand|bn|m|k)?/i);
  if (!match) return undefined;
  const base = firstNumber(match[1]);
  const unit = (match[2] || "").toLowerCase();
  if (!base) return undefined;
  if (unit === "billion" || unit === "bn") return base * 1_000_000_000;
  if (unit === "million" || unit === "m") return base * 1_000_000;
  if (unit === "thousand" || unit === "k") return base * 1_000;
  return base;
}

function shouldFetchPrimaryDocument(formType: string, primaryDocument: string): boolean {
  return Boolean(primaryDocument) && (IMPORTANT_FORMS.has(formType) || formType.startsWith("SC 13") || /^(S|F)-[13]\b/.test(formType) || formType.startsWith("424B"));
}

async function fetchSecJson<T>(url: string): Promise<T> {
  const response = await fetchSec(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`SEC HTTP ${response.status} ${url}`);
  return await response.json() as T;
}

async function fetchSecText(url: string): Promise<string> {
  const response = await fetchSec(url, { headers: { Accept: "text/plain,text/html,application/xml" } });
  if (!response.ok) throw new Error(`SEC HTTP ${response.status} ${url}`);
  return await response.text();
}

async function fetchSec(url: string, init: RequestInit): Promise<Response> {
  const now = Date.now();
  const waitMs = Math.max(0, 135 - (now - lastSecRequestAt));
  if (waitMs) await new Promise((resolveTimer) => setTimeout(resolveTimer, waitMs));
  lastSecRequestAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "User-Agent": process.env.STOCK_SEC_EDGAR_USER_AGENT || DEFAULT_USER_AGENT,
        ...init.headers,
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

function primaryDocumentUrl(cik: string, accessionNumber: string, primaryDocument: string): string {
  const rawDocument = primaryDocument.replace(/^xsl[^/]+\//i, "");
  return `${SEC_ARCHIVES}/${Number(cik)}/${accessionNumber.replace(/-/g, "")}/${rawDocument}`;
}

function accessionIndexUrl(cik: string, accessionNumber: string): string {
  return `${SEC_ARCHIVES}/${Number(cik)}/${accessionNumber.replace(/-/g, "")}/`;
}

function dateString(value: string | undefined): string | undefined {
  return value ? `${value}T00:00:00.000Z` : undefined;
}

function acceptanceDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/, "$1-$2-$3T$4:$5:$6Z");
  return Number.isFinite(Date.parse(normalized)) ? normalized : undefined;
}

function tagValue(text: string, tag: string): string | undefined {
  const match = text.match(new RegExp(`<${tag}>\\s*(?:<value>)?\\s*([^<]+)`, "i"));
  return match?.[1]?.trim();
}

function numberValue(value: string | undefined): number | undefined {
  return firstNumber(value);
}

function firstNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function compactFacts(facts: SecFilingFacts): Record<string, unknown> {
  return Object.fromEntries(Object.entries(facts).filter(([, value]) => value !== undefined && value !== null && value !== 0));
}

function stripUsPrefix(ticker: string): string {
  return ticker.trim().replace(/^US:/i, "").toUpperCase();
}

export const secFilingBackfillRunnerTestHooks = {
  extractOwnershipFacts,
  extractPlannedSaleFacts,
};
