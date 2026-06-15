import symbols from "@/data/symbols.generated.json";
import { buildDartDetailUrl, buildDartListUrl, dartDetailEndpointForReportName, dartDisclosureToFiling, enrichDartFilingWithDetail, type DartDetailEndpoint, type DartDetailRow, type DartDisclosureRow } from "@/lib/krDartFilings";
import { dailyMasterIndexUrl, enrichIndexFilingFromDocument, indexEntryToFiling, parseMasterIndex, rankIndexFilingFactCandidates } from "@/lib/secFilingIndexBackfill";
import { writeSecFilings, type SecFilingListItem } from "@/lib/secFilings";
import { safeErrorMessage } from "@/lib/errorSafety";
import { envValue, fetchWithTimeout, numericEnv } from "@/lib/supabaseRest";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const SEC_UA = process.env.STOCK_SEC_EDGAR_USER_AGENT || "LAF-labs stock filings admin@laflabs.ai";
const DART_BASE = "https://opendart.fss.or.kr";
let lastSecRequestAt = 0;
let lastDartRequestAt = 0;

export async function GET(request: NextRequest) {
  return runDailyIndexJob(request);
}

export async function POST(request: NextRequest) {
  return runDailyIndexJob(request);
}

async function runDailyIndexJob(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  try {
    const dates = request.nextUrl.searchParams.get("date")
      ? [request.nextUrl.searchParams.get("date")!]
      : recentDates(numericEnv("SEC_FILINGS_DAILY_LOOKBACK_DAYS", 7));
    const cikToTicker = await loadCikToTicker();
    let indexDays = 0;
    let scanned = 0;
    let rows = 0;
    let enriched = 0;
    let dartRows = 0;
    const factFetchLimit = numericEnv("SEC_FILINGS_DAILY_FACT_FETCH_LIMIT", 80);
    const dartDetailBudget = { remaining: numericEnv("DART_FILINGS_DAILY_DETAIL_FETCH_LIMIT", 120) };
    const dartApiKey = envValue("OPENDART_API_KEY");
    const krSymbols = loadAllowedKrSymbols();

    for (const date of dates) {
      const text = await fetchDailyIndex(date);
      if (text) {
        indexDays += 1;
        const filings: SecFilingListItem[] = [];
        for (const entry of parseMasterIndex(text)) {
          scanned += 1;
          const filing = indexEntryToFiling(entry, cikToTicker);
          if (filing) filings.push(filing);
        }
        for (const candidate of rankIndexFilingFactCandidates(filings)) {
          if (enriched >= factFetchLimit) break;
          const filing = candidate.filing;
          if (!filing.sourceUrl) continue;
          const documentText = await fetchSecText(filing.sourceUrl).catch(() => "");
          if (!documentText) continue;
          filings[candidate.index] = enrichIndexFilingFromDocument(filing, documentText);
          enriched += 1;
        }
        rows += filings.length;
        for (let index = 0; index < filings.length; index += 250) {
          await writeSecFilings(filings.slice(index, index + 250), { throwOnError: true });
        }
      }
      if (dartApiKey) {
        const dartFilings = await fetchDartFilings(date, dartApiKey, krSymbols, dartDetailBudget);
        dartRows += dartFilings.length;
        for (let index = 0; index < dartFilings.length; index += 250) {
          await writeSecFilings(dartFilings.slice(index, index + 250), { throwOnError: true });
        }
      }
    }

    return NextResponse.json({ ok: true, dates, indexDays, scanned, rows, enriched, dartRows }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: safeErrorMessage(error) }, { status: 500 });
  }
}

async function fetchSecText(url: string): Promise<string> {
  await throttleSec();
  const response = await fetchWithTimeout(url, {
    headers: { "User-Agent": SEC_UA, Accept: "text/plain,text/html,application/xml" },
    cache: "no-store",
  }, 20_000);
  if (!response.ok) throw new Error(`SEC document HTTP ${response.status}`);
  const text = await response.text();
  if (text.includes("Request Rate Threshold Exceeded")) throw new Error("SEC rate limit");
  return text;
}

async function fetchDailyIndex(date: string): Promise<string | undefined> {
  await throttleSec();
  const response = await fetchWithTimeout(dailyMasterIndexUrl(date), {
    headers: { "User-Agent": SEC_UA },
    cache: "no-store",
  }, 20_000);
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`SEC daily index HTTP ${response.status}`);
  return await response.text();
}

async function fetchDartFilings(date: string, apiKey: string, allowedSymbols: Set<string>, detailBudget: { remaining: number }): Promise<SecFilingListItem[]> {
  const filings: SecFilingListItem[] = [];
  const detailCache = new Map<string, Promise<DartDetailRow[]>>();
  for (const corpClass of ["Y", "K", "N"] as const) {
    let pageNo = 1;
    while (pageNo <= 50) {
      await throttleDart();
      const response = await fetchWithTimeout(buildDartListUrl(DART_BASE, {
        apiKey,
        date: date.replace(/-/g, ""),
        corpClass,
        pageNo,
      }), { cache: "no-store" }, 20_000);
      if (!response.ok) throw new Error(`DART list HTTP ${response.status}`);
      const payload = await response.json() as { status?: string; message?: string; total_page?: number | string; list?: DartDisclosureRow[] };
      if (payload.status === "013") break;
      if (payload.status !== "000") throw new Error(`DART list ${payload.status || "unknown"} ${payload.message || ""}`.trim());
      for (const row of payload.list || []) {
        const filing = dartDisclosureToFiling(row, allowedSymbols);
        if (filing) filings.push(await enrichDartFiling(apiKey, filing, detailCache, detailBudget));
      }
      const totalPage = Number(payload.total_page || 1);
      if (!Number.isFinite(totalPage) || pageNo >= totalPage) break;
      pageNo += 1;
    }
  }
  return filings;
}

async function enrichDartFiling(apiKey: string, filing: SecFilingListItem, cache: Map<string, Promise<DartDetailRow[]>>, detailBudget: { remaining: number }): Promise<SecFilingListItem> {
  const endpoint = dartDetailEndpointForReportName(filing.formType);
  if (!endpoint) return filing;
  const date = filing.filedAt.slice(0, 10).replace(/-/g, "");
  const key = `${endpoint}:${filing.cik}:${endpoint === "majorstock" || endpoint === "elestock" ? "" : date}`;
  if (!cache.has(key)) {
    if (detailBudget.remaining <= 0) return filing;
    detailBudget.remaining -= 1;
  }
  try {
    const rows = await cachedDartDetailRows(apiKey, endpoint, filing.cik, date, cache, key);
    const detail = rows.find((row) => row.rcept_no === filing.accessionNumber);
    return detail ? enrichDartFilingWithDetail(filing, detail) : filing;
  } catch {
    return filing;
  }
}

async function cachedDartDetailRows(
  apiKey: string,
  endpoint: DartDetailEndpoint,
  corpCode: string,
  date: string,
  cache: Map<string, Promise<DartDetailRow[]>>,
  key: string
): Promise<DartDetailRow[]> {
  const cached = cache.get(key);
  if (cached) return cached;
  const request = fetchDartDetailRows(apiKey, endpoint, corpCode, date);
  cache.set(key, request);
  return request;
}

async function fetchDartDetailRows(apiKey: string, endpoint: DartDetailEndpoint, corpCode: string, date: string): Promise<DartDetailRow[]> {
  await throttleDart();
  const response = await fetchWithTimeout(buildDartDetailUrl(DART_BASE, endpoint, {
    apiKey,
    corpCode,
    date,
  }), { cache: "no-store" }, 20_000);
  if (!response.ok) throw new Error(`DART detail HTTP ${response.status}`);
  const payload = await response.json() as { status?: string; message?: string; list?: DartDetailRow[] };
  if (payload.status === "013" || payload.status === "014") return [];
  if (payload.status !== "000") throw new Error(`DART detail ${payload.status || "unknown"} ${payload.message || ""}`.trim());
  return payload.list || [];
}

async function loadCikToTicker(): Promise<Map<string, string>> {
  const allowed = new Set((symbols as Array<Record<string, unknown>>)
    .filter((item) => item.market === "US" && typeof item.ticker === "string")
    .map((item) => String(item.ticker).toUpperCase()));
  await throttleSec();
  const response = await fetchWithTimeout("https://www.sec.gov/files/company_tickers_exchange.json", {
    headers: { "User-Agent": SEC_UA, Accept: "application/json" },
    cache: "no-store",
  }, 20_000);
  if (!response.ok) throw new Error(`SEC ticker map HTTP ${response.status}`);
  const payload = await response.json() as { fields?: string[]; data?: unknown[][] };
  const fields = payload.fields || [];
  const cikIndex = fields.indexOf("cik");
  const tickerIndex = fields.indexOf("ticker");
  const map = new Map<string, string>();
  for (const row of payload.data || []) {
    const ticker = String(row[tickerIndex] || "").toUpperCase();
    const cik = String(row[cikIndex] || "").padStart(10, "0");
    if (allowed.has(ticker) && !map.has(cik)) map.set(cik, ticker);
  }
  return map;
}

function loadAllowedKrSymbols(): Set<string> {
  return new Set((symbols as Array<Record<string, unknown>>)
    .filter((item) => item.market === "KR" && typeof item.ticker === "string")
    .map((item) => String(item.ticker).toUpperCase()));
}

async function throttleSec(): Promise<void> {
  const now = Date.now();
  const waitMs = Math.max(0, 150 - (now - lastSecRequestAt));
  if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
  lastSecRequestAt = Date.now();
}

async function throttleDart(): Promise<void> {
  const now = Date.now();
  const waitMs = Math.max(0, 100 - (now - lastDartRequestAt));
  if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
  lastDartRequestAt = Date.now();
}

function recentDates(days: number): string[] {
  const count = Math.max(1, Math.min(14, Math.floor(days)));
  const dates: string[] = [];
  const date = new Date();
  for (let index = 0; index < count; index += 1) {
    dates.push(date.toISOString().slice(0, 10));
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return dates;
}

function authorized(request: NextRequest): boolean {
  const secrets = [envValue("SEC_FILINGS_JOB_SECRET"), envValue("CRON_SECRET")].filter(Boolean);
  if (!secrets.length) return process.env.NODE_ENV !== "production";
  const candidate = request.headers.get("x-refresh-secret") || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(candidate && secrets.includes(candidate));
}
