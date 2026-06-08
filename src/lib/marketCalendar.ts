import { fetchWithTimeout, numericEnv, supabaseReadConfig, supabaseHeaders } from "@/lib/supabaseRest";
import { QUOTE_CACHE_FRESH_SECONDS } from "@/lib/quoteContract";
import { stockCachePolicyFreshSeconds } from "@/lib/stockCachePolicy";

export type MarketCode = "KR" | "US";
export type MarketSessionState = "open" | "closed" | "holiday" | "unknown";

export type MarketSession = {
  market: MarketCode;
  state: MarketSessionState;
  source: "supabase" | "fallback";
  tradeDate: string;
  openAt?: string;
  closeAt?: string;
  nextOpenAt?: string;
  cacheUntil?: string;
  isEarlyClose?: boolean;
  reason?: string;
};

type CalendarRow = {
  market: MarketCode;
  trade_date: string;
  is_open: boolean;
  open_at?: string | null;
  close_at?: string | null;
  next_open_at?: string | null;
  is_early_close?: boolean | null;
};

const MARKET_CALENDAR_TABLE = "market_calendar";
const MARKET_TIME_ZONES: Record<MarketCode, string> = {
  KR: "Asia/Seoul",
  US: "America/New_York",
};

const FALLBACK_HOURS: Record<MarketCode, { openHour: number; openMinute: number; closeHour: number; closeMinute: number }> = {
  KR: { openHour: 9, openMinute: 0, closeHour: 15, closeMinute: 30 },
  US: { openHour: 9, openMinute: 30, closeHour: 16, closeMinute: 0 },
};

export function marketFromTicker(ticker: string): MarketCode {
  return ticker.toUpperCase().startsWith("KR:") ? "KR" : "US";
}

export function secondsUntil(iso: string | undefined, nowMs = Date.now(), fallback = 60): number {
  if (!iso) return fallback;
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(60, Math.ceil((parsed - nowMs) / 1000));
}

export function quoteOpenTtlSeconds(market: MarketCode): number {
  const base = numericEnv("STOCK_QUOTE_CACHE_OPEN_SECONDS", QUOTE_CACHE_FRESH_SECONDS);
  return numericEnv(`STOCK_QUOTE_${market}_CACHE_OPEN_SECONDS`, base);
}

export function scoreOpenTtlSeconds(view: "detail" | "compare" | "technical"): number {
  const policyDefault = view === "technical" ? stockCachePolicyFreshSeconds("technical") : stockCachePolicyFreshSeconds("score");
  const base = numericEnv("STOCK_SCORE_CACHE_FRESH_SECONDS", policyDefault);
  const name =
    view === "compare"
      ? "STOCK_SCORE_COMPARE_CACHE_SECONDS"
      : view === "technical"
        ? "STOCK_SCORE_TECHNICAL_CACHE_SECONDS"
        : "STOCK_SCORE_DETAIL_CACHE_SECONDS";
  return numericEnv(name, base);
}

export function chartOpenTtlSeconds(market: MarketCode): number {
  const base = stockCachePolicyFreshSeconds("chart");
  return numericEnv(`STOCK_CHART_${market}_CACHE_OPEN_SECONDS`, numericEnv("STOCK_CHART_CACHE_OPEN_SECONDS", base));
}

export async function cacheExpiresAtForMarket(market: MarketCode, kind: "quote" | "score" | "chart", nowMs = Date.now(), view: "detail" | "compare" | "technical" = "detail") {
  const session = await getMarketSession(market, nowMs);
  if (session.state !== "open" && session.cacheUntil) {
    return {
      expiresAt: session.cacheUntil,
      session,
    };
  }

  const ttl = kind === "quote" ? quoteOpenTtlSeconds(market) : kind === "chart" ? chartOpenTtlSeconds(market) : scoreOpenTtlSeconds(view);
  return {
    expiresAt: new Date(nowMs + ttl * 1000).toISOString(),
    session,
  };
}

export async function getMarketSession(market: MarketCode, nowMs = Date.now()): Promise<MarketSession> {
  const today = dateInTimeZone(nowMs, MARKET_TIME_ZONES[market]);
  const rows = await readCalendarRows(market, today);
  const todayRow = rows.find((row) => row.trade_date === today);

  if (todayRow) {
    const session = sessionFromCalendarRow(todayRow, rows, nowMs);
    if (session) return session;
  }

  return fallbackMarketSession(market, nowMs, rows[0]?.open_at || undefined);
}

async function readCalendarRows(market: MarketCode, fromDate: string): Promise<CalendarRow[]> {
  const config = supabaseReadConfig();
  if (!config) return [];

  try {
    const query = new URLSearchParams({
      market: `eq.${market}`,
      trade_date: `gte.${fromDate}`,
      select: "market,trade_date,is_open,open_at,close_at,next_open_at,is_early_close",
      order: "trade_date.asc",
      limit: "10",
    });
    const response = await fetchWithTimeout(`${config.url}/rest/v1/${MARKET_CALENDAR_TABLE}?${query.toString()}`, {
      headers: supabaseHeaders(config.key),
      cache: "no-store",
    }, 2_000);
    if (!response.ok) return [];
    const rows = (await response.json()) as CalendarRow[];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function sessionFromCalendarRow(row: CalendarRow, rows: CalendarRow[], nowMs: number): MarketSession | undefined {
  const market = row.market;
  const nextOpenAt = row.next_open_at || firstFutureOpen(rows, nowMs);
  const base = {
    market,
    source: "supabase" as const,
    tradeDate: row.trade_date,
    openAt: row.open_at || undefined,
    closeAt: row.close_at || undefined,
    nextOpenAt: nextOpenAt || undefined,
    isEarlyClose: !!row.is_early_close,
  };

  if (!row.is_open) {
    return {
      ...base,
      state: "holiday",
      cacheUntil: nextOpenAt || undefined,
      reason: "holiday",
    };
  }

  const openMs = row.open_at ? Date.parse(row.open_at) : NaN;
  const closeMs = row.close_at ? Date.parse(row.close_at) : NaN;
  if (!Number.isFinite(openMs) || !Number.isFinite(closeMs)) return undefined;

  if (nowMs < openMs) {
    return {
      ...base,
      state: "closed",
      cacheUntil: row.open_at || undefined,
      reason: "pre_open",
    };
  }

  if (nowMs <= closeMs) {
    return {
      ...base,
      state: "open",
      reason: "regular_session",
    };
  }

  return {
    ...base,
    state: "closed",
    cacheUntil: nextOpenAt || undefined,
    reason: "after_close",
  };
}

function firstFutureOpen(rows: CalendarRow[], nowMs: number): string | undefined {
  return rows
    .filter((row) => row.is_open && row.open_at && Date.parse(row.open_at) > nowMs)
    .sort((left, right) => Date.parse(left.open_at || "") - Date.parse(right.open_at || ""))[0]?.open_at || undefined;
}

function fallbackMarketSession(market: MarketCode, nowMs: number, knownNextOpenAt?: string): MarketSession {
  const timeZone = MARKET_TIME_ZONES[market];
  const today = dateInTimeZone(nowMs, timeZone);
  const parts = dateParts(today);
  const hours = FALLBACK_HOURS[market];
  const day = weekdayInTimeZone(nowMs, timeZone);

  if (day === 0 || day === 6) {
    const nextOpenAt = knownNextOpenAt || nextWeekdayOpen(market, nowMs);
    return {
      market,
      state: "holiday",
      source: "fallback",
      tradeDate: today,
      nextOpenAt,
      cacheUntil: nextOpenAt,
      reason: "weekend_fallback",
    };
  }

  const openAt = zonedTimeToUtcIso(parts.year, parts.month, parts.day, hours.openHour, hours.openMinute, timeZone);
  const closeAt = zonedTimeToUtcIso(parts.year, parts.month, parts.day, hours.closeHour, hours.closeMinute, timeZone);
  const openMs = Date.parse(openAt);
  const closeMs = Date.parse(closeAt);

  if (nowMs < openMs) {
    return {
      market,
      state: "closed",
      source: "fallback",
      tradeDate: today,
      openAt,
      closeAt,
      nextOpenAt: openAt,
      cacheUntil: openAt,
      reason: "pre_open_fallback",
    };
  }

  if (nowMs <= closeMs) {
    return {
      market,
      state: "open",
      source: "fallback",
      tradeDate: today,
      openAt,
      closeAt,
      nextOpenAt: nextWeekdayOpen(market, closeMs + 1),
      reason: "regular_session_fallback",
    };
  }

  const nextOpenAt = knownNextOpenAt || nextWeekdayOpen(market, nowMs);
  return {
    market,
    state: "closed",
    source: "fallback",
    tradeDate: today,
    openAt,
    closeAt,
    nextOpenAt,
    cacheUntil: nextOpenAt,
    reason: "after_close_fallback",
  };
}

function nextWeekdayOpen(market: MarketCode, nowMs: number): string {
  const timeZone = MARKET_TIME_ZONES[market];
  const hours = FALLBACK_HOURS[market];
  let cursor = nowMs + 24 * 60 * 60 * 1000;

  for (let index = 0; index < 10; index += 1) {
    const day = weekdayInTimeZone(cursor, timeZone);
    const date = dateInTimeZone(cursor, timeZone);
    if (day !== 0 && day !== 6) {
      const parts = dateParts(date);
      return zonedTimeToUtcIso(parts.year, parts.month, parts.day, hours.openHour, hours.openMinute, timeZone);
    }
    cursor += 24 * 60 * 60 * 1000;
  }

  const fallback = new Date(nowMs + 24 * 60 * 60 * 1000);
  return fallback.toISOString();
}

function dateInTimeZone(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));

  const year = parts.find((part) => part.type === "year")?.value || "1970";
  const month = parts.find((part) => part.type === "month")?.value || "01";
  const day = parts.find((part) => part.type === "day")?.value || "01";
  return `${year}-${month}-${day}`;
}

function weekdayInTimeZone(ms: number, timeZone: string): number {
  const value = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(new Date(ms));
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(value);
}

function dateParts(date: string) {
  const [year, month, day] = date.split("-").map((part) => Number(part));
  return { year, month, day };
}

function zonedTimeToUtcIso(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): string {
  let utcMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let index = 0; index < 2; index += 1) {
    utcMs = Date.UTC(year, month - 1, day, hour, minute, 0) - timeZoneOffsetMs(timeZone, utcMs);
  }
  return new Date(utcMs).toISOString();
}

function timeZoneOffsetMs(timeZone: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utcMs));

  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value || "0");
  const zonedAsUtc = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second"));
  return zonedAsUtc - utcMs;
}
