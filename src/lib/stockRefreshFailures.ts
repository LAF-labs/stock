import { providerConfirmedEmptyMessage } from "@/lib/stockProviderErrors";
import { fetchWithTimeout, numericEnv, supabaseAdminConfig, supabaseHeaders } from "@/lib/supabaseRest";
import { parseTickerRef } from "@/lib/tickerRef";
import type { StockDisplayUnavailablePart, StockDisplayView } from "@/lib/stockDisplayTypes";

type RefreshFailureRow = {
  kind?: string;
  view_mode?: string | null;
  last_error?: string | null;
};

export async function readTerminalStockDisplayFailures(tickerRef: string, view: StockDisplayView): Promise<StockDisplayUnavailablePart[]> {
  const config = supabaseAdminConfig();
  if (!config) return [];
  const target = parseTickerRef(tickerRef);
  const query = new URLSearchParams({
    select: "kind,view_mode,last_error",
    market: `eq.${target.market}`,
    symbol: `eq.${target.symbol}`,
    status: "eq.dead",
    order: "updated_at.desc",
    limit: "30",
  });

  const response = await fetchWithTimeout(
    `${config.url}/rest/v1/stock_refresh_jobs?${query.toString()}`,
    { headers: supabaseHeaders(config.key), cache: "no-store" },
    terminalFailureReadTimeoutMs()
  );
  if (!response.ok) return [];
  const rows = (await response.json().catch(() => [])) as unknown;
  if (!Array.isArray(rows)) return [];
  return uniqueUnavailableParts(rows.flatMap((row) => terminalStockDisplayFailureParts(row, view)));
}

export function terminalStockDisplayFailureParts(row: unknown, displayView: StockDisplayView): StockDisplayUnavailablePart[] {
  if (!row || typeof row !== "object" || Array.isArray(row)) return [];
  const record = row as RefreshFailureRow;
  if (!record.last_error || !providerConfirmedEmptyMessage(record.last_error)) return [];
  const kind = record.kind?.toLowerCase();
  if (kind === "quote") return [{ part: "price", reason: "provider_confirmed_empty" }];
  if (kind === "chart") return [{ part: "chart", reason: "provider_confirmed_empty" }];
  if (kind === "score") {
    const view = record.view_mode?.toLowerCase();
    if (view === "technical" || displayView === "technical") return [{ part: "technical", reason: "provider_confirmed_empty" }];
    return [
      { part: "score", reason: "provider_confirmed_empty" },
      { part: "fundamentals", reason: "provider_confirmed_empty" },
      { part: "industryBenchmark", reason: "provider_confirmed_empty" },
    ];
  }
  return [];
}

function uniqueUnavailableParts(parts: StockDisplayUnavailablePart[]): StockDisplayUnavailablePart[] {
  const seen = new Set<string>();
  return parts.filter((part) => {
    const key = `${part.part}:${part.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function terminalFailureReadTimeoutMs(): number {
  return numericEnv("STOCK_TERMINAL_FAILURE_READ_TIMEOUT_MS", 700);
}
