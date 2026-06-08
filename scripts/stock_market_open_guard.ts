import { appendFileSync } from "node:fs";
import { fetchWithTimeout, supabaseHeaders } from "@/lib/supabaseRest";
import { loadLocalEnvFiles } from "./localEnv";

type Market = "US" | "KR";

type MarketExpectation = {
  market: Market;
  tradeDate: string;
};

type CalendarRow = {
  market?: unknown;
  trade_date?: unknown;
  is_open?: unknown;
};

type GuardResult = {
  run: boolean;
  reason: "market_open" | "all_markets_closed" | "calendar_missing";
  openMarkets: Market[];
  missingMarkets: Market[];
};

const MARKETS: Market[] = ["US", "KR"];

export function marketTradeDate(market: Market, now = new Date()): string {
  const timeZone = market === "KR" ? "Asia/Seoul" : "America/New_York";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

export function evaluateMarketOpenRows(rows: CalendarRow[], expected: MarketExpectation[]): GuardResult {
  const openMarkets: Market[] = [];
  const missingMarkets: Market[] = [];

  for (const item of expected) {
    const row = rows.find((candidate) => candidate.market === item.market && candidate.trade_date === item.tradeDate);
    if (!row) {
      missingMarkets.push(item.market);
      continue;
    }
    if (row.is_open === true) openMarkets.push(item.market);
  }

  if (missingMarkets.length) {
    return { run: true, reason: "calendar_missing", openMarkets, missingMarkets };
  }
  if (openMarkets.length) {
    return { run: true, reason: "market_open", openMarkets, missingMarkets };
  }
  return { run: false, reason: "all_markets_closed", openMarkets, missingMarkets };
}

async function fetchCalendarRows(url: string, key: string, expected: MarketExpectation[], timeoutMs: number): Promise<CalendarRow[]> {
  const markets = [...new Set(expected.map((item) => item.market))];
  const dates = [...new Set(expected.map((item) => item.tradeDate))];
  const query = new URLSearchParams({
    select: "market,trade_date,is_open",
    market: `in.(${markets.join(",")})`,
    trade_date: `in.(${dates.join(",")})`,
  });
  const response = await fetchWithTimeout(`${url.replace(/\/$/, "")}/rest/v1/market_calendar?${query.toString()}`, {
    headers: supabaseHeaders(key),
  }, timeoutMs);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Supabase market calendar query failed: HTTP ${response.status} ${text.slice(0, 300)}`);
  }
  const payload = (await response.json()) as unknown;
  return Array.isArray(payload) ? payload : [];
}

function writeGithubOutput(result: GuardResult) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  appendFileSync(
    outputPath,
    [
      `run=${result.run ? "1" : "0"}`,
      `reason=${result.reason}`,
      `open_markets=${result.openMarkets.join(",")}`,
      `missing_markets=${result.missingMarkets.join(",")}`,
      "",
    ].join("\n")
  );
}

async function main() {
  loadLocalEnvFiles();
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");

  const now = new Date();
  const expected = MARKETS.map((market) => ({ market, tradeDate: marketTradeDate(market, now) }));
  const rows = await fetchCalendarRows(url, key, expected, Number(process.env.STOCK_MARKET_GUARD_TIMEOUT_MS || 10_000));
  const result = evaluateMarketOpenRows(rows, expected);
  writeGithubOutput(result);
  console.log(JSON.stringify({ ok: true, expected, ...result }, null, 2));
}

if (process.argv[1]?.endsWith("stock_market_open_guard.ts")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
