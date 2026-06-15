import { readFileSync } from "node:fs";
import symbols from "@/data/symbols.generated.json";
import { buildDartDetailUrl, buildDartListUrl, dartDetailEndpointForReportName, dartDisclosureToFiling, enrichDartFilingWithDetail, filterUniqueDartFilings, type DartDetailEndpoint, type DartDetailRow, type DartDisclosureRow } from "@/lib/krDartFilings";
import { writeSecFilings, type SecFilingListItem } from "@/lib/secFilings";
import { supabaseAdminConfig } from "@/lib/supabaseRest";

const DART_BASE = "https://opendart.fss.or.kr";
let lastDartRequestAt = 0;

type DartDetailState = {
  remaining: number;
  calls: number;
  enriched: number;
  cache: Map<string, Promise<DartDetailRow[]>>;
};

async function main() {
  loadCliEnvFiles();
  const until = normalizeDate(arg("--until") || todayInKorea());
  const since = normalizeDate(arg("--since") || oneYearBefore(until));
  const dryRun = process.argv.includes("--dry-run");
  const quiet = process.argv.includes("--quiet");
  const chunkSize = positiveInt(arg("--chunk-size"), 250);
  const detailState = process.argv.includes("--enrich-details")
    ? { remaining: positiveInt(arg("--detail-limit"), 5_000), calls: 0, enriched: 0, cache: new Map<string, Promise<DartDetailRow[]>>() }
    : undefined;
  const apiKey = process.env.OPENDART_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENDART_API_KEY is required.");
  if (!dryRun && !supabaseAdminConfig()) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required unless --dry-run is used.");

  const allowedSymbols = loadAllowedKrSymbols();
  const seen = new Set<string>();
  const buffer: SecFilingListItem[] = [];
  let apiCalls = 0;
  let fetched = 0;
  let duplicates = 0;
  let rows = 0;
  let written = 0;
  let days = 0;

  for (const date of datesBetween(since, until)) {
    const result = await fetchDartFilingsForDate(date, apiKey, allowedSymbols, detailState);
    apiCalls += result.apiCalls;
    fetched += result.items.length;
    const unique = filterUniqueDartFilings(result.items, seen);
    duplicates += unique.duplicates;
    rows += unique.items.length;
    buffer.push(...unique.items);
    days += 1;
    if (!quiet) console.error(`${date} fetched=${result.items.length} unique=${unique.items.length} buffered=${buffer.length}`);
    while (buffer.length >= chunkSize) {
      const chunk = buffer.splice(0, chunkSize);
      if (!dryRun) await writeChunk(chunk);
      written += chunk.length;
    }
  }

  if (buffer.length) {
    if (!dryRun) await writeChunk(buffer);
    written += buffer.length;
  }

  console.log(JSON.stringify({
    ok: true,
    since,
    until,
    dryRun,
    days,
    apiCalls,
    fetched,
    rows,
    duplicates,
    written,
    detailCalls: detailState?.calls || 0,
    detailEnriched: detailState?.enriched || 0,
    detailRemaining: detailState?.remaining,
  }));
}

async function fetchDartFilingsForDate(date: string, apiKey: string, allowedSymbols: Set<string>, detailState?: DartDetailState): Promise<{ items: SecFilingListItem[]; apiCalls: number }> {
  const items: SecFilingListItem[] = [];
  let apiCalls = 0;
  for (const corpClass of ["Y", "K", "N"] as const) {
    let pageNo = 1;
    while (pageNo <= 50) {
      await throttleDart();
      apiCalls += 1;
      const response = await fetch(buildDartListUrl(DART_BASE, {
        apiKey,
        date: date.replace(/-/g, ""),
        corpClass,
        pageNo,
      }));
      if (!response.ok) throw new Error(`DART list HTTP ${response.status}`);
      const payload = await response.json() as { status?: string; message?: string; total_page?: number | string; list?: DartDisclosureRow[] };
      if (payload.status === "013") break;
      if (payload.status !== "000") throw new Error(`DART list ${payload.status || "unknown"} ${payload.message || ""}`.trim());
      for (const row of payload.list || []) {
        const filing = dartDisclosureToFiling(row, allowedSymbols);
        if (filing) items.push(detailState ? await enrichDartFiling(apiKey, filing, detailState) : filing);
      }
      const totalPage = Number(payload.total_page || 1);
      if (!Number.isFinite(totalPage) || pageNo >= totalPage) break;
      pageNo += 1;
    }
  }
  return { items, apiCalls };
}

async function enrichDartFiling(apiKey: string, filing: SecFilingListItem, state: DartDetailState): Promise<SecFilingListItem> {
  const endpoint = dartDetailEndpointForReportName(filing.formType);
  if (!endpoint) return filing;
  const date = filing.filedAt.slice(0, 10).replace(/-/g, "");
  const key = `${endpoint}:${filing.cik}:${endpoint === "majorstock" || endpoint === "elestock" ? "" : date}`;
  if (!state.cache.has(key)) {
    if (state.remaining <= 0) return filing;
    state.remaining -= 1;
    state.calls += 1;
  }
  try {
    const rows = await cachedDartDetailRows(apiKey, endpoint, filing.cik, date, state.cache, key);
    const detail = rows.find((row) => row.rcept_no === filing.accessionNumber);
    if (!detail) return filing;
    state.enriched += 1;
    return enrichDartFilingWithDetail(filing, detail);
  } catch {
    return filing;
  }
}

async function cachedDartDetailRows(apiKey: string, endpoint: DartDetailEndpoint, corpCode: string, date: string, cache: Map<string, Promise<DartDetailRow[]>>, key: string): Promise<DartDetailRow[]> {
  const cached = cache.get(key);
  if (cached) return cached;
  const request = fetchDartDetailRows(apiKey, endpoint, corpCode, date);
  cache.set(key, request);
  return request;
}

async function fetchDartDetailRows(apiKey: string, endpoint: DartDetailEndpoint, corpCode: string, date: string): Promise<DartDetailRow[]> {
  await throttleDart();
  const response = await fetch(buildDartDetailUrl(DART_BASE, endpoint, {
    apiKey,
    corpCode,
    date,
  }));
  if (!response.ok) throw new Error(`DART detail HTTP ${response.status}`);
  const payload = await response.json() as { status?: string; message?: string; list?: DartDetailRow[] };
  if (payload.status === "013" || payload.status === "014") return [];
  if (payload.status !== "000") throw new Error(`DART detail ${payload.status || "unknown"} ${payload.message || ""}`.trim());
  return payload.list || [];
}

async function writeChunk(items: SecFilingListItem[]): Promise<void> {
  try {
    await writeSecFilings(items, { throwOnError: true });
  } catch (error) {
    if (items.length <= 1) throw error;
    const middle = Math.ceil(items.length / 2);
    await writeChunk(items.slice(0, middle));
    await writeChunk(items.slice(middle));
  }
}

function loadAllowedKrSymbols(): Set<string> {
  return new Set((symbols as Array<Record<string, unknown>>)
    .filter((item) => item.market === "KR" && typeof item.ticker === "string")
    .map((item) => String(item.ticker).toUpperCase()));
}

async function throttleDart(): Promise<void> {
  const now = Date.now();
  const waitMs = Math.max(0, 100 - (now - lastDartRequestAt));
  if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
  lastDartRequestAt = Date.now();
}

function datesBetween(since: string, until: string): string[] {
  const start = new Date(`${since}T00:00:00Z`);
  const end = new Date(`${until}T00:00:00Z`);
  const out: string[] = [];
  for (const date = start; date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    out.push(date.toISOString().slice(0, 10));
  }
  return out;
}

function normalizeDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid date: ${value}`);
  return value;
}

function todayInKorea(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function oneYearBefore(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCFullYear(date.getUTCFullYear() - 1);
  return date.toISOString().slice(0, 10);
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function loadCliEnvFiles() {
  for (const name of [".env.local", ".env.supabase.local", ".env.vercel.local"]) {
    try {
      for (const rawLine of readFileSync(name, "utf8").split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#") || !line.includes("=")) continue;
        const [key, ...rest] = line.split("=");
        const value = rest.join("=").trim().replace(/^['"]|['"]$/g, "");
        if (key && value && process.env[key] === undefined) process.env[key] = value;
      }
    } catch {}
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
