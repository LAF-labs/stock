import { summarizeSecFiling } from "@/lib/secFilingSummary";
import type { SecFilingListItem } from "@/lib/secFilings";

export type DartDisclosureRow = {
  corp_code: string;
  corp_name: string;
  stock_code?: string;
  corp_cls?: string;
  report_nm: string;
  rcept_no: string;
  rcept_dt: string;
  flr_nm?: string;
  rm?: string;
};

export function buildDartListUrl(
  baseUrl: string,
  input: { apiKey: string; date: string; corpClass: "Y" | "K" | "N"; pageNo: number }
): string {
  const query = new URLSearchParams({
    crtfc_key: input.apiKey,
    bgn_de: input.date,
    end_de: input.date,
    corp_cls: input.corpClass,
    page_no: String(input.pageNo),
    page_count: "100",
    sort: "date",
    sort_mth: "desc",
  });
  return `${baseUrl.replace(/\/$/, "")}/api/list.json?${query.toString()}`;
}

export function dartDisclosureToFiling(row: DartDisclosureRow, allowedSymbols: Set<string>): SecFilingListItem | undefined {
  const symbol = normalizeStockCode(row.stock_code);
  if (!symbol || !allowedSymbols.has(symbol)) return undefined;
  const reportName = cleanReportName(row.report_nm, row.corp_name);
  const ticker = `KR:${symbol}`;
  const facts = {
    source: "DART",
    reportName,
    corpClass: row.corp_cls,
    stockCode: symbol,
    filerName: row.flr_nm,
    remark: row.rm,
    currency: "KRW",
  };
  const summary = summarizeSecFiling({ formType: reportName, companyName: row.corp_name, ticker, facts });
  return {
    ticker,
    symbol,
    cik: row.corp_code,
    accessionNumber: row.rcept_no,
    formType: reportName,
    companyName: row.corp_name,
    filedAt: dartDateToIso(row.rcept_dt),
    summaryKo: summary.summaryKo,
    sourceUrl: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${encodeURIComponent(row.rcept_no)}`,
    category: summary.category,
    importance: summary.importance,
    tags: summary.tags,
    facts,
  };
}

export function filterUniqueDartFilings(items: SecFilingListItem[], seen = new Set<string>()): { items: SecFilingListItem[]; duplicates: number } {
  const unique: SecFilingListItem[] = [];
  let duplicates = 0;
  for (const item of items) {
    if (seen.has(item.accessionNumber)) {
      duplicates += 1;
      continue;
    }
    seen.add(item.accessionNumber);
    unique.push(item);
  }
  return { items: unique, duplicates };
}

function cleanReportName(value: string, corpName: string): string {
  return value
    .replace(new RegExp(`^\\[${escapeRegex(corpName)}\\]\\s*`), "")
    .replace(/\s+/g, " ")
    .trim();
}

function dartDateToIso(value: string): string {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z` : new Date().toISOString();
}

function normalizeStockCode(value: string | undefined): string | undefined {
  const code = value?.trim().toUpperCase();
  return code && /^[0-9A-Z]{6}$/.test(code) ? code : undefined;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
