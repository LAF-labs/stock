import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { fetchWithTimeout, supabaseAdminConfig, supabaseHeaders, type SupabaseConfig } from "@/lib/supabaseRest";
import { loadLocalEnvFiles, ROOT } from "./localEnv";

type SymbolMasterRow = {
  market?: unknown;
  ticker?: unknown;
  exchange?: unknown;
  exchangeName?: unknown;
  koreanName?: unknown;
  englishName?: unknown;
  instrumentType?: unknown;
  standardCode?: unknown;
};

export type RefreshTargetRow = {
  market: "US" | "KR";
  symbol: string;
  ticker: string;
  exchange: string | null;
  instrument_type: string;
  enabled: boolean;
  tier: "cold_stock" | "etf" | "inactive";
  quote_interval_seconds: number | null;
  score_detail_interval_seconds: number | null;
  score_compare_interval_seconds: number | null;
  score_technical_interval_seconds: number | null;
  chart_interval_seconds: number | null;
  quote_priority: number;
  score_detail_priority: number;
  score_compare_priority: number;
  score_technical_priority: number;
  chart_priority: number;
  source: "symbol_master";
  metadata: Record<string, unknown>;
};

export type Options = {
  dryRun: boolean;
  json: boolean;
  symbolsFile: string;
  batchSize: number;
  limit: number;
  timeoutMs: number;
};

export const stockRefreshTargetIntervals = {
  hot: { quote: 300, score: 1_800, technical: 900, chart: 900 },
  warm: { quote: 900, score: 3_600, technical: 3_600, chart: 3_600 },
  coldStock: { quote: 86_400, score: 604_800, technical: 604_800, chart: 604_800 },
  etf: { quote: 86_400 },
} as const;

const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_TIMEOUT_MS = 20_000;
const QUOTE_ONLY_TIER = "etf";
const ETF_NAME_PREFIXES = [
  "1Q",
  "ACE",
  "ARIRANG",
  "FOCUS",
  "HANARO",
  "HK",
  "KBSTAR",
  "KIWOOM",
  "KOACT",
  "KODEX",
  "KOSEF",
  "PLUS",
  "RISE",
  "SOL",
  "TIME",
  "TIGER",
  "TREX",
  "WON",
  "BNK ",
  "IBK ",
  "DAISHIN",
  "마이티",
  "파워",
];
const ETF_NAME_TERMS = [
  "ETF",
  "ETN",
  "TDF",
  "공모주",
  "국채",
  "나스닥",
  "데일리",
  "레버리지",
  "미국채",
  "버퍼",
  "상장지수",
  "선물",
  "액티브",
  "인덱스",
  "인버스",
  "채권",
  "커버드콜",
  "타겟",
  "혼합",
  "S&P500",
];

export function buildRefreshTargetRow(row: SymbolMasterRow): RefreshTargetRow {
  const market = marketValue(row.market);
  const symbol = stringValue(row.ticker)?.toUpperCase();
  if (!market || !symbol) throw new Error("invalid symbol master row");

  const sourceInstrumentType = (stringValue(row.instrumentType) || "UNKNOWN").toUpperCase();
  const exchange = stringValue(row.exchange)?.toUpperCase() || null;
  const name = stringValue(row.koreanName) || stringValue(row.englishName) || symbol;
  const instrumentType = refreshTargetInstrumentType({
    market,
    symbol,
    exchange,
    name,
    sourceInstrumentType,
  });
  const base = {
    market,
    symbol,
    ticker: `${market}:${symbol}`,
    exchange,
    instrument_type: instrumentType,
    quote_priority: 80,
    score_detail_priority: 90,
    score_compare_priority: 95,
    score_technical_priority: 85,
    chart_priority: 90,
    source: "symbol_master" as const,
    metadata: {
      name,
      exchange_name: stringValue(row.exchangeName) || null,
      standard_code: stringValue(row.standardCode) || null,
      source_instrument_type: sourceInstrumentType,
    },
  };

  if (instrumentType === "STOCK") {
    return {
      ...base,
      enabled: true,
      tier: "cold_stock",
      quote_interval_seconds: stockRefreshTargetIntervals.coldStock.quote,
      score_detail_interval_seconds: stockRefreshTargetIntervals.coldStock.score,
      score_compare_interval_seconds: stockRefreshTargetIntervals.coldStock.score,
      score_technical_interval_seconds: stockRefreshTargetIntervals.coldStock.technical,
      chart_interval_seconds: stockRefreshTargetIntervals.coldStock.chart,
    };
  }

  if (instrumentType === "ETF" || instrumentType === "PREFERRED_STOCK" || instrumentType === "KONEX_STOCK") {
    return quoteOnlyTargetRow(base);
  }

  return {
    ...base,
    enabled: false,
    tier: "inactive",
    quote_interval_seconds: null,
    score_detail_interval_seconds: null,
    score_compare_interval_seconds: null,
    score_technical_interval_seconds: null,
    chart_interval_seconds: null,
  };
}

function quoteOnlyTargetRow(base: Omit<RefreshTargetRow, "enabled" | "tier" | "quote_interval_seconds" | "score_detail_interval_seconds" | "score_compare_interval_seconds" | "score_technical_interval_seconds" | "chart_interval_seconds">): RefreshTargetRow {
  return {
    ...base,
    enabled: true,
    tier: QUOTE_ONLY_TIER,
    quote_interval_seconds: stockRefreshTargetIntervals.etf.quote,
    score_detail_interval_seconds: null,
    score_compare_interval_seconds: null,
    score_technical_interval_seconds: null,
    chart_interval_seconds: null,
  };
}

function refreshTargetInstrumentType({
  market,
  symbol,
  exchange,
  name,
  sourceInstrumentType,
}: {
  market: "US" | "KR";
  symbol: string;
  exchange: string | null;
  name: string;
  sourceInstrumentType: string;
}): string {
  if (market === "KR" && exchange === "KONEX") return "KONEX_STOCK";
  if (isPreferredShareName(symbol, name)) return "PREFERRED_STOCK";
  if (sourceInstrumentType === "ETF" || isEtfLikeName(name)) return "ETF";
  return sourceInstrumentType;
}

function isPreferredShareName(symbol: string, name: string): boolean {
  const compactName = name.replace(/\s+/g, "").toUpperCase();
  return (
    /(?:[0-9]+)?우(?:B|C)?(?:\(전환\))?$/.test(compactName) ||
    compactName.includes("우선주") ||
    compactName.includes("우선") ||
    /\/P(R|FD?)?$/i.test(symbol)
  );
}

function isEtfLikeName(name: string): boolean {
  const upperName = name.toUpperCase();
  return (
    ETF_NAME_PREFIXES.some((prefix) => upperName.startsWith(prefix)) ||
    ETF_NAME_TERMS.some((term) => upperName.includes(term.toUpperCase()))
  );
}

export function refreshTargetRowsFromSymbols(symbols: SymbolMasterRow[]): RefreshTargetRow[] {
  const rows: RefreshTargetRow[] = [];
  const seen = new Set<string>();
  for (const symbol of symbols) {
    try {
      const row = buildRefreshTargetRow(symbol);
      const key = `${row.market}:${row.symbol}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    } catch {
      continue;
    }
  }
  return rows;
}

export function parseOptions(argv: string[], env: Record<string, string | undefined> = process.env): Options {
  const options: Options = {
    dryRun: false,
    json: false,
    symbolsFile: env.STOCK_SYMBOLS_FILE || resolve(ROOT, "src/data/symbols.generated.json"),
    batchSize: positiveInteger(env.STOCK_REFRESH_TARGET_SEED_BATCH_SIZE, DEFAULT_BATCH_SIZE),
    limit: positiveInteger(env.STOCK_REFRESH_TARGET_SEED_LIMIT, 0),
    timeoutMs: positiveInteger(env.STOCK_REFRESH_TARGET_SEED_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[index];
    };
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--symbols-file") options.symbolsFile = next();
    else if (arg === "--batch-size") options.batchSize = positiveInteger(next(), options.batchSize);
    else if (arg === "--limit") options.limit = positiveInteger(next(), options.limit);
    else if (arg === "--timeout-ms") options.timeoutMs = positiveInteger(next(), options.timeoutMs);
    else throw new Error(`Unsupported argument: ${arg}`);
  }

  return options;
}

export async function seedStockRefreshTargets(config: SupabaseConfig | undefined, options: Options) {
  const raw = JSON.parse(readFileSync(options.symbolsFile, "utf8")) as unknown;
  if (!Array.isArray(raw)) throw new Error("symbols file must contain an array");
  const allRows = refreshTargetRowsFromSymbols(raw.filter(isRecord));
  const rows = options.limit > 0 ? allRows.slice(0, options.limit) : allRows;
  let upserted = 0;

  if (!options.dryRun) {
    if (!config) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required unless --dry-run is used.");
    for (let index = 0; index < rows.length; index += options.batchSize) {
      const batch = rows.slice(index, index + options.batchSize);
      await upsertTargetBatch(config, batch, options.timeoutMs);
      upserted += batch.length;
    }
  }

  const byTier: Record<string, number> = {};
  for (const row of rows) byTier[row.tier] = (byTier[row.tier] || 0) + 1;

  return {
    ok: true,
    dry_run: options.dryRun,
    input_symbols: raw.length,
    target_rows: rows.length,
    upserted: options.dryRun ? 0 : upserted,
    by_tier: byTier,
  };
}

async function upsertTargetBatch(config: SupabaseConfig, rows: RefreshTargetRow[], timeoutMs: number) {
  if (!rows.length) return;
  const response = await fetchWithTimeout(
    `${config.url}/rest/v1/stock_refresh_targets?on_conflict=market,symbol`,
    {
      method: "POST",
      headers: {
        ...supabaseHeaders(config.key),
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(rows),
    },
    timeoutMs
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Supabase target upsert failed: HTTP ${response.status} ${text.slice(0, 500)}`);
  }
}

function marketValue(value: unknown): "US" | "KR" | undefined {
  const market = stringValue(value)?.toUpperCase();
  return market === "US" || market === "KR" ? market : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function positiveInteger(value: string | number | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function main() {
  loadLocalEnvFiles();
  const options = parseOptions(process.argv.slice(2));
  const config = options.dryRun ? undefined : supabaseAdminConfig();
  const result = await seedStockRefreshTargets(config, options);
  if (options.json) console.log(JSON.stringify(result));
  else console.log(`target_rows=${result.target_rows} upserted=${result.upserted}`);
}

const isCli = process.argv[1]?.endsWith("seed_stock_refresh_targets.ts");
if (isCli) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
