import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import symbols from "@/data/symbols.generated.json";
import { enrichIndexFilingFromDocument, indexEntryToFiling, indexFilingNeedsDocumentFacts, parseMasterIndex } from "@/lib/secFilingIndexBackfill";
import { writeSecFilings, type SecFilingListItem } from "@/lib/secFilings";

const SEC_UA = process.env.STOCK_SEC_EDGAR_USER_AGENT || "LAF-labs stock filings admin@laflabs.ai";
let lastSecRequestAt = 0;

async function main() {
  loadCliEnvFiles();
  const since = arg("--since") || oneYearAgo();
  const dryRun = process.argv.includes("--dry-run");
  const quiet = process.argv.includes("--quiet");
  const chunkSize = positiveInt(arg("--chunk-size"), 250);
  const fetchDocLimit = positiveInt(arg("--fetch-doc-limit"), 0);
  const cikToTicker = await loadCikToTicker();
  const quarters = quartersSince(since);
  let rows = 0;
  let written = 0;
  let enriched = 0;
  const buffer: SecFilingListItem[] = [];

  for (const { year, quarter } of quarters) {
    const text = await fetchText(`https://www.sec.gov/Archives/edgar/full-index/${year}/QTR${quarter}/master.gz`);
    for (const entry of parseMasterIndex(text)) {
      if (entry.filedAt.slice(0, 10) < since) continue;
      let filing = indexEntryToFiling(entry, cikToTicker);
      if (!filing) continue;
      if (enriched < fetchDocLimit && filing.sourceUrl && indexFilingNeedsDocumentFacts(filing)) {
        const documentText = await fetchText(filing.sourceUrl).catch(() => "");
        if (documentText) {
          filing = enrichIndexFilingFromDocument(filing, documentText);
          enriched += 1;
        }
      }
      buffer.push(filing);
      rows += 1;
      if (buffer.length >= chunkSize) {
        const chunk = buffer.splice(0, buffer.length);
        if (!dryRun) await writeChunk(chunk);
        written += chunk.length;
        if (!quiet) console.error(`indexed=${rows} flushed=${written}`);
      }
    }
  }
  if (buffer.length) {
    if (!dryRun) await writeChunk(buffer);
    written += buffer.length;
  }
  console.log(JSON.stringify({ ok: true, since, dryRun, quarters: quarters.length, rows, written, enriched }));
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

async function loadCikToTicker(): Promise<Map<string, string>> {
  const allowed = new Set((symbols as Array<Record<string, unknown>>)
    .filter((item) => item.market === "US" && typeof item.ticker === "string")
    .map((item) => String(item.ticker).toUpperCase()));
  const payload = await fetchJson<{ fields?: string[]; data?: unknown[][] }>("https://www.sec.gov/files/company_tickers_exchange.json");
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

async function fetchJson<T>(url: string): Promise<T> {
  await throttleSec();
  const response = await fetch(url, { headers: { "User-Agent": SEC_UA, Accept: "application/json" } });
  if (!response.ok) throw new Error(`SEC HTTP ${response.status} ${url}`);
  return await response.json() as T;
}

async function fetchText(url: string): Promise<string> {
  await throttleSec();
  const response = await fetch(url, { headers: { "User-Agent": SEC_UA } });
  if (!response.ok) throw new Error(`SEC HTTP ${response.status} ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const text = url.endsWith(".gz") ? gunzipSync(bytes).toString("utf8") : bytes.toString("utf8");
  if (text.includes("Request Rate Threshold Exceeded")) throw new Error("SEC rate limit");
  return text;
}

async function throttleSec(): Promise<void> {
  const now = Date.now();
  const waitMs = Math.max(0, 150 - (now - lastSecRequestAt));
  if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
  lastSecRequestAt = Date.now();
}

function quartersSince(since: string): Array<{ year: number; quarter: number }> {
  const start = new Date(`${since}T00:00:00Z`);
  const end = new Date();
  const out: Array<{ year: number; quarter: number }> = [];
  for (let year = start.getUTCFullYear(); year <= end.getUTCFullYear(); year += 1) {
    const first = year === start.getUTCFullYear() ? Math.floor(start.getUTCMonth() / 3) + 1 : 1;
    const last = year === end.getUTCFullYear() ? Math.floor(end.getUTCMonth() / 3) + 1 : 4;
    for (let quarter = first; quarter <= last; quarter += 1) out.push({ year, quarter });
  }
  return out;
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function oneYearAgo(): string {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - 1);
  return date.toISOString().slice(0, 10);
}

function loadCliEnvFiles() {
  for (const name of [".env.local", ".env.supabase.local", ".env.vercel.local"]) {
    try {
      for (const rawLine of readFileSync(name, "utf8").split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#") || !line.includes("=")) continue;
        const [key, ...rest] = line.split("=");
        if (key && process.env[key] === undefined) process.env[key] = rest.join("=").trim().replace(/^['"]|['"]$/g, "");
      }
    } catch {}
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
