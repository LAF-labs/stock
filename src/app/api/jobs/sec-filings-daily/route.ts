import symbols from "@/data/symbols.generated.json";
import { dailyMasterIndexUrl, indexEntryToFiling, parseMasterIndex } from "@/lib/secFilingIndexBackfill";
import { writeSecFilings, type SecFilingListItem } from "@/lib/secFilings";
import { safeErrorMessage } from "@/lib/errorSafety";
import { envValue, fetchWithTimeout, numericEnv } from "@/lib/supabaseRest";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const SEC_UA = process.env.STOCK_SEC_EDGAR_USER_AGENT || "LAF-labs stock filings admin@laflabs.ai";

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

    for (const date of dates) {
      const text = await fetchDailyIndex(date);
      if (!text) continue;
      indexDays += 1;
      const filings: SecFilingListItem[] = [];
      for (const entry of parseMasterIndex(text)) {
        scanned += 1;
        const filing = indexEntryToFiling(entry, cikToTicker);
        if (filing) filings.push(filing);
      }
      rows += filings.length;
      for (let index = 0; index < filings.length; index += 250) {
        await writeSecFilings(filings.slice(index, index + 250), { throwOnError: true });
      }
    }

    return NextResponse.json({ ok: true, dates, indexDays, scanned, rows }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: safeErrorMessage(error) }, { status: 500 });
  }
}

async function fetchDailyIndex(date: string): Promise<string | undefined> {
  const response = await fetchWithTimeout(dailyMasterIndexUrl(date), {
    headers: { "User-Agent": SEC_UA },
    cache: "no-store",
  }, 20_000);
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`SEC daily index HTTP ${response.status}`);
  return await response.text();
}

async function loadCikToTicker(): Promise<Map<string, string>> {
  const allowed = new Set((symbols as Array<Record<string, unknown>>)
    .filter((item) => item.market === "US" && typeof item.ticker === "string")
    .map((item) => String(item.ticker).toUpperCase()));
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
