import { safeErrorMessage } from "@/lib/errorSafety";
import { fetchWithTimeout, numericEnv, supabaseAdminConfig, supabaseHeaders, supabaseReadConfig } from "@/lib/supabaseRest";
import { normalizeTickerRef } from "@/lib/tickerRef";

export type SecFilingListItem = {
  ticker: string;
  symbol: string;
  cik: string;
  accessionNumber: string;
  formType: string;
  companyName: string;
  filedAt: string;
  acceptedAt?: string;
  summaryKo: string;
  sourceUrl?: string;
  category: string;
  importance: "low" | "medium" | "high";
  tags: string[];
  facts: Record<string, unknown>;
};

export type ReadSecFilingsInput = {
  ticker: string;
  limit?: number;
  offset?: number;
  supabase?: boolean;
};

type SupabaseSecFilingRow = {
  ticker: string;
  symbol: string;
  cik: string;
  accession_number: string;
  form_type: string;
  company_name: string;
  filed_at: string;
  accepted_at?: string | null;
  summary_ko: string;
  source_url?: string | null;
  category: string;
  importance: "low" | "medium" | "high";
  tags: string[] | null;
  facts: Record<string, unknown> | null;
};

declare global {
  var __secFilingsMemoryStore: Map<string, SecFilingListItem> | undefined;
}

const TABLE = "sec_filings";
const SELECT_COLUMNS = "ticker,symbol,cik,accession_number,form_type,company_name,filed_at,accepted_at,summary_ko,source_url,category,importance,tags,facts";
const memoryStore = (globalThis.__secFilingsMemoryStore ??= new Map<string, SecFilingListItem>());

export function buildSecFilingsReadUrl(baseUrl: string, input: Required<Pick<ReadSecFilingsInput, "ticker" | "limit" | "offset">>): string {
  const query = new URLSearchParams({
    select: SELECT_COLUMNS,
    ticker: `eq.${normalizeTickerRef(input.ticker)}`,
    order: "filed_at.desc",
    limit: String(input.limit),
    offset: String(input.offset),
  });
  return `${baseUrl.replace(/\/$/, "")}/rest/v1/${TABLE}?${query.toString()}`;
}

export async function readSecFilings(input: ReadSecFilingsInput): Promise<{ items: SecFilingListItem[]; total: number }> {
  const limit = clampLimit(input.limit);
  const offset = Math.max(0, Math.floor(input.offset || 0));
  if (input.supabase !== false) {
    const stored = await readSupabaseSecFilings({ ticker: input.ticker, limit, offset });
    if (stored) return stored;
  }
  return readMemorySecFilings({ ticker: input.ticker, limit, offset });
}

export async function writeSecFilings(items: SecFilingListItem[], options: { supabase?: boolean; throwOnError?: boolean } = {}): Promise<void> {
  for (const item of items) {
    memoryStore.set(item.accessionNumber, normalizeItem(item));
  }
  if (options.supabase === false || !items.length) return;
  await writeSupabaseSecFilings(items.map(normalizeItem), Boolean(options.throwOnError));
}

export const secFilingsTestHooks = {
  resetMemory() {
    memoryStore.clear();
  },
};

function readMemorySecFilings(input: Required<Pick<ReadSecFilingsInput, "ticker" | "limit" | "offset">>) {
  const ticker = normalizeTickerRef(input.ticker);
  const all = [...memoryStore.values()]
    .filter((item) => item.ticker === ticker)
    .sort((left, right) => Date.parse(right.filedAt) - Date.parse(left.filedAt));
  return {
    items: all.slice(input.offset, input.offset + input.limit).map(cloneItem),
    total: all.length,
  };
}

async function readSupabaseSecFilings(input: Required<Pick<ReadSecFilingsInput, "ticker" | "limit" | "offset">>): Promise<{ items: SecFilingListItem[]; total: number } | undefined> {
  const config = supabaseReadConfig();
  if (!config) return undefined;
  try {
    const response = await fetchWithTimeout(
      buildSecFilingsReadUrl(config.url, input),
      {
        headers: {
          ...supabaseHeaders(config.key),
          Prefer: "count=exact",
        },
        cache: "no-store",
      },
      numericEnv("SEC_FILINGS_SUPABASE_READ_TIMEOUT_MS", 2_500)
    );
    if (!response.ok) return undefined;
    const rows = await response.json() as SupabaseSecFilingRow[];
    return {
      items: rows.map(rowFromSupabase),
      total: totalFromContentRange(response.headers.get("content-range")) ?? rows.length,
    };
  } catch {
    return undefined;
  }
}

async function writeSupabaseSecFilings(items: SecFilingListItem[], throwOnError: boolean): Promise<void> {
  const config = supabaseAdminConfig();
  if (!config) return;
  try {
    const response = await fetchWithTimeout(
      `${config.url}/rest/v1/${TABLE}?on_conflict=accession_number`,
      {
        method: "POST",
        headers: {
          ...supabaseHeaders(config.key),
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(items.map(rowToSupabase)),
      },
      numericEnv("SEC_FILINGS_SUPABASE_WRITE_TIMEOUT_MS", 10_000)
    );
    if (!response.ok) {
      const message = `sec_filings_write_failed HTTP ${response.status}`;
      if (throwOnError) throw new Error(message);
      console.warn("sec_filings_write_failed", { status: response.status });
    }
  } catch (error) {
    if (throwOnError) throw error;
    console.warn("sec_filings_write_failed", { error: safeErrorMessage(error) });
  }
}

function rowToSupabase(item: SecFilingListItem): SupabaseSecFilingRow {
  return {
    ticker: item.ticker,
    symbol: item.symbol,
    cik: item.cik,
    accession_number: item.accessionNumber,
    form_type: item.formType,
    company_name: item.companyName,
    filed_at: item.filedAt,
    accepted_at: item.acceptedAt || null,
    summary_ko: item.summaryKo,
    source_url: item.sourceUrl || null,
    category: item.category,
    importance: item.importance,
    tags: item.tags,
    facts: item.facts,
  };
}

function rowFromSupabase(row: SupabaseSecFilingRow): SecFilingListItem {
  return normalizeItem({
    ticker: row.ticker,
    symbol: row.symbol,
    cik: row.cik,
    accessionNumber: row.accession_number,
    formType: row.form_type,
    companyName: row.company_name,
    filedAt: row.filed_at,
    acceptedAt: row.accepted_at || undefined,
    summaryKo: row.summary_ko,
    sourceUrl: row.source_url || undefined,
    category: row.category,
    importance: row.importance,
    tags: row.tags || [],
    facts: row.facts || {},
  });
}

function normalizeItem(item: SecFilingListItem): SecFilingListItem {
  const ticker = normalizeTickerRef(item.ticker);
  return {
    ...item,
    ticker,
    symbol: item.symbol.trim().toUpperCase(),
    cik: item.cik.padStart(10, "0"),
    tags: [...item.tags],
    facts: { ...item.facts },
  };
}

function cloneItem(item: SecFilingListItem): SecFilingListItem {
  return {
    ...item,
    tags: [...item.tags],
    facts: { ...item.facts },
  };
}

function clampLimit(value: number | undefined): number {
  const parsed = Math.floor(value || 3);
  if (!Number.isFinite(parsed) || parsed < 1) return 3;
  return Math.min(parsed, 50);
}

function totalFromContentRange(value: string | null): number | undefined {
  const total = value?.match(/\/(\d+)$/)?.[1];
  if (!total) return undefined;
  const parsed = Number(total);
  return Number.isFinite(parsed) ? parsed : undefined;
}
