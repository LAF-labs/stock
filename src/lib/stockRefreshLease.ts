import { randomUUID } from "node:crypto";
import { fetchWithTimeout, numericEnv, supabaseAdminConfig, supabaseHeaders } from "@/lib/supabaseRest";
import type { ScoreView } from "@/lib/stockSnapshotCache";
import type { StockDataKind } from "@/lib/stockDataRuntime";

type MarketCode = "US" | "KR";

export type AcquireStockRefreshLeaseInput = {
  kind: StockDataKind;
  ticker: string;
  view?: ScoreView;
  lockSeconds?: number;
  owner?: string;
};

export type StockRefreshLeaseResult = {
  acquired: boolean;
  source: "supabase" | "memory";
  owner: string;
  leaseUntil?: string;
  lockedBy?: string;
};

type ParsedTicker = {
  ticker: string;
  market: MarketCode;
  symbol: string;
};

type LeaseRpcRow = {
  acquired?: boolean;
  lease_until?: string;
  locked_by?: string;
};

declare global {
  var __stockRefreshLeases: Map<string, { leaseUntilMs: number; owner: string }> | undefined;
}

const LEASE_RPC = "acquire_stock_refresh_lease";
const memoryLeases = (globalThis.__stockRefreshLeases ??= new Map<string, { leaseUntilMs: number; owner: string }>());

export async function acquireStockRefreshLease(input: AcquireStockRefreshLeaseInput): Promise<StockRefreshLeaseResult> {
  const ticker = normalizeTickerRef(input.ticker);
  const parsed = parseTicker(ticker);
  const owner = input.owner || `vercel-${randomUUID()}`;
  const lockSeconds = clampLockSeconds(input.lockSeconds);
  const view = input.kind === "score" ? input.view || "detail" : undefined;
  const config = supabaseAdminConfig();

  if (config) {
    try {
      const response = await fetchWithTimeout(
        `${config.url}/rest/v1/rpc/${LEASE_RPC}`,
        {
          method: "POST",
          headers: supabaseHeaders(config.key),
          body: JSON.stringify({
            p_kind: input.kind,
            p_market: parsed.market,
            p_symbol: parsed.symbol,
            p_view_mode: view ?? null,
            p_lock_seconds: lockSeconds,
            p_locked_by: owner,
          }),
        },
        2_500
      );
      if (response.ok) {
        const payload = (await response.json()) as LeaseRpcRow[] | LeaseRpcRow;
        const row = Array.isArray(payload) ? payload[0] : payload;
        return {
          acquired: row?.acquired === true,
          source: "supabase",
          owner,
          leaseUntil: row?.lease_until,
          lockedBy: row?.locked_by,
        };
      }
      console.warn("stock_refresh_lease_acquire_failed", { ticker: parsed.ticker, kind: input.kind, status: response.status });
    } catch (error) {
      console.warn("stock_refresh_lease_acquire_failed", {
        ticker: parsed.ticker,
        kind: input.kind,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  return acquireMemoryLease({
    kind: input.kind,
    ticker: parsed.ticker,
    view,
    lockSeconds,
    owner,
  });
}

function acquireMemoryLease(input: {
  kind: StockDataKind;
  ticker: string;
  view?: ScoreView;
  lockSeconds: number;
  owner: string;
}): StockRefreshLeaseResult {
  const nowMs = Date.now();
  const key = leaseKey(input.kind, input.ticker, input.view);
  const current = memoryLeases.get(key);
  if (current && current.leaseUntilMs > nowMs) {
    return {
      acquired: false,
      source: "memory",
      owner: input.owner,
      leaseUntil: new Date(current.leaseUntilMs).toISOString(),
      lockedBy: current.owner,
    };
  }

  const leaseUntilMs = nowMs + input.lockSeconds * 1000;
  memoryLeases.set(key, { leaseUntilMs, owner: input.owner });
  pruneMemoryLeases(nowMs);
  return {
    acquired: true,
    source: "memory",
    owner: input.owner,
    leaseUntil: new Date(leaseUntilMs).toISOString(),
    lockedBy: input.owner,
  };
}

function pruneMemoryLeases(nowMs: number) {
  if (memoryLeases.size < numericEnv("STOCK_REFRESH_LEASE_MEMORY_MAX_ENTRIES", 5_000)) return;
  for (const [key, lease] of memoryLeases) {
    if (lease.leaseUntilMs <= nowMs) memoryLeases.delete(key);
  }
}

function leaseKey(kind: StockDataKind, ticker: string, view: ScoreView | undefined): string {
  return `${kind}:${ticker}:${view || ""}`;
}

function clampLockSeconds(value: number | undefined): number {
  const fallback = numericEnv("STOCK_REFRESH_LEASE_SECONDS", 30);
  const seconds = Number.isFinite(value) ? Number(value) : fallback;
  return Math.min(300, Math.max(5, Math.trunc(seconds)));
}

function normalizeTickerRef(value: string): string {
  const raw = value.trim().replace(/^!/, "").toUpperCase();
  if (raw.includes(":")) {
    const [market, symbolPart] = raw.split(":", 2);
    const symbol = (symbolPart || "").replace(/[^A-Z0-9.-]/g, "");
    if ((market === "US" || market === "KR") && symbol) return `${market}:${symbol}`;
  }

  const symbol = raw.replace(/[^A-Z0-9.-]/g, "");
  if (/^(?:\d{6}|Q\d{6})$/.test(symbol)) return `KR:${symbol}`;
  return `US:${symbol}`;
}

function parseTicker(ticker: string): ParsedTicker {
  const [marketPart, symbolPart] = ticker.split(":", 2);
  const market: MarketCode = marketPart === "KR" ? "KR" : "US";
  const symbol = (symbolPart || "").replace(/[^A-Z0-9.-]/g, "");
  return {
    ticker: `${market}:${symbol}`,
    market,
    symbol,
  };
}
