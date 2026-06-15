import { formatSecCompactMoney, summarizeSecFiling } from "@/lib/secFilingSummary";
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

export type DartDetailEndpoint =
  | "piicDecsn"
  | "pifricDecsn"
  | "cvbdIsDecsn"
  | "bdwtIsDecsn"
  | "tsstkAqDecsn"
  | "tsstkDpDecsn"
  | "majorstock"
  | "elestock";

export type DartDetailRow = Record<string, string | undefined>;

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

export function buildDartDetailUrl(
  baseUrl: string,
  endpoint: DartDetailEndpoint,
  input: { apiKey: string; corpCode: string; date?: string }
): string {
  const query = new URLSearchParams({
    crtfc_key: input.apiKey,
    corp_code: input.corpCode,
  });
  if (endpoint !== "majorstock" && endpoint !== "elestock") {
    const date = (input.date || "").replace(/-/g, "");
    query.set("bgn_de", date);
    query.set("end_de", date);
  }
  return `${baseUrl.replace(/\/$/, "")}/api/${endpoint}.json?${query.toString()}`;
}

export function dartDetailEndpointForReportName(reportName: string): DartDetailEndpoint | undefined {
  const report = reportName.replace(/\s+/g, "");
  if (/유무상증자/.test(report)) return "pifricDecsn";
  if (/유상증자/.test(report)) return "piicDecsn";
  if (/전환사채|CB/.test(report)) return "cvbdIsDecsn";
  if (/신주인수권부사채|BW/.test(report)) return "bdwtIsDecsn";
  if (/자기주식.*취득/.test(report)) return "tsstkAqDecsn";
  if (/자기주식.*처분/.test(report)) return "tsstkDpDecsn";
  if (/대량보유|주식등의대량보유/.test(report)) return "majorstock";
  if (/임원.*주요주주|주요주주.*소유상황|특정증권.*소유상황/.test(report)) return "elestock";
  return undefined;
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

export function enrichDartFilingWithDetail(item: SecFilingListItem, detail: DartDetailRow): SecFilingListItem {
  if (detail.rcept_no && detail.rcept_no !== item.accessionNumber) return item;
  const facts = { ...item.facts, ...dartDetailFacts(item.formType, detail) };
  const summary = summarizeSecFiling({
    formType: item.formType,
    companyName: item.companyName,
    ticker: item.ticker,
    facts,
  });
  return {
    ...item,
    summaryKo: summary.summaryKo,
    category: summary.category,
    importance: summary.importance,
    tags: summary.tags,
    facts,
  };
}

function dartDetailFacts(reportName: string, row: DartDetailRow): Record<string, unknown> {
  const report = reportName.replace(/\s+/g, "");
  if (/유상증자|유무상증자/.test(report)) {
    return compactFacts({
      shares: sumNumbers(row, ["nstk_ostk_cnt", "nstk_estk_cnt"]),
      offeringAmount: sumFundingPurpose(row),
      fundingPurpose: fundingPurposeText(row),
      issueMethod: cleanText(row.ic_mthn),
      currency: "KRW",
    });
  }
  if (/전환사채|CB/.test(report)) {
    return compactFacts({
      bondAmount: numberFromDart(row.bd_fta) || numberFromDart(row.ovis_fta),
      conversionPrice: numberFromDart(row.cv_prc),
      conversionShares: numberFromDart(row.cvisstk_cnt),
      fundingPurpose: fundingPurposeText(row),
      currency: "KRW",
    });
  }
  if (/신주인수권부사채|BW/.test(report)) {
    return compactFacts({
      bondAmount: numberFromDart(row.bd_fta) || numberFromDart(row.ovis_fta),
      exercisePrice: numberFromDart(row.ex_prc),
      exerciseShares: numberFromDart(row.nstk_isstk_cnt),
      fundingPurpose: fundingPurposeText(row),
      currency: "KRW",
    });
  }
  if (/자기주식.*취득/.test(report)) {
    return compactFacts({
      treasuryShares: sumNumbers(row, ["aqpln_stk_ostk", "aqpln_stk_estk"]),
      treasuryValue: sumNumbers(row, ["aqpln_prc_ostk", "aqpln_prc_estk"]),
      transactionPurpose: cleanText(row.aq_pp),
      periodStart: cleanText(row.aqexpd_bgd),
      periodEnd: cleanText(row.aqexpd_edd),
      currency: "KRW",
    });
  }
  if (/자기주식.*처분/.test(report)) {
    return compactFacts({
      treasuryShares: sumNumbers(row, ["dppln_stk_ostk", "dppln_stk_estk"]),
      treasuryValue: sumNumbers(row, ["dppln_prc_ostk", "dppln_prc_estk"]),
      price: numberFromDart(row.dpstk_prc_ostk) || numberFromDart(row.dpstk_prc_estk),
      transactionPurpose: cleanText(row.dp_pp),
      periodStart: cleanText(row.dpprpd_bgd),
      periodEnd: cleanText(row.dpprpd_edd),
      currency: "KRW",
    });
  }
  if (/대량보유|주식등의대량보유/.test(report)) {
    return compactFacts({
      holderName: cleanText(row.repror),
      sharesOwnedAfter: numberFromDart(row.stkqy),
      ownershipChangeShares: numberFromDart(row.stkqy_irds),
      ownershipPercent: numberFromDart(row.stkrt),
      ownershipPercentChange: numberFromDart(row.stkrt_irds),
      reportReason: cleanText(row.report_resn),
      currency: "KRW",
    });
  }
  if (/임원.*주요주주|주요주주.*소유상황|특정증권.*소유상황/.test(report)) {
    return compactFacts({
      holderName: cleanText(row.repror),
      sharesOwnedAfter: numberFromDart(row.sp_stock_lmp_cnt),
      ownershipChangeShares: numberFromDart(row.sp_stock_lmp_irds_cnt),
      ownershipPercent: numberFromDart(row.sp_stock_lmp_rate),
      ownershipPercentChange: numberFromDart(row.sp_stock_lmp_irds_rate),
      currency: "KRW",
    });
  }
  return {};
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

function sumFundingPurpose(row: DartDetailRow): number | undefined {
  return sumNumbers(row, ["fdpp_fclt", "fdpp_bsninh", "fdpp_op", "fdpp_dtrp", "fdpp_ocsa", "fdpp_etc"]);
}

function fundingPurposeText(row: DartDetailRow): string | undefined {
  const parts = [
    ["시설자금", row.fdpp_fclt],
    ["영업양수자금", row.fdpp_bsninh],
    ["운영자금", row.fdpp_op],
    ["채무상환", row.fdpp_dtrp],
    ["타법인증권취득", row.fdpp_ocsa],
    ["기타", row.fdpp_etc],
  ]
    .map(([label, value]) => {
      const amount = numberFromDart(value);
      return amount && amount > 0 ? `${label} ${formatSecCompactMoney(amount, "KRW")}` : undefined;
    })
    .filter((value): value is string => Boolean(value));
  return parts.length ? parts.slice(0, 3).join(", ") : undefined;
}

function sumNumbers(row: DartDetailRow, keys: string[]): number | undefined {
  const total = keys.reduce((sum, key) => sum + (numberFromDart(row[key]) || 0), 0);
  return total > 0 ? total : undefined;
}

function numberFromDart(value: string | undefined): number | undefined {
  const text = value?.trim();
  if (!text || text === "-" || /해당사항\s*없음/.test(text)) return undefined;
  const negative = /^[-△]/.test(text);
  const digits = text.replace(/[,\s원주%]/g, "").replace(/^[-△]/, "").replace(/[^0-9.]/g, "");
  if (!digits) return undefined;
  const parsed = Number(digits);
  if (!Number.isFinite(parsed)) return undefined;
  return negative ? -parsed : parsed;
}

function cleanText(value: string | undefined): string | undefined {
  const text = value?.replace(/\s+/g, " ").trim();
  return text && text !== "-" && !/해당사항\s*없음/.test(text) ? text : undefined;
}

function compactFacts(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== ""));
}
