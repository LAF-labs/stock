import {
  dashboardClientCacheFromJson,
  dashboardClientCacheJson,
  dashboardClientCacheKey,
} from "@/components/stockDashboardHelpers";
import type { StockQuoteResponse, StockScoreResponse } from "@/lib/types";

const DASHBOARD_CLIENT_CACHE_MAX_CHARS = 750_000;

type DashboardClientCacheStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export function readDashboardClientCache(ticker: string) {
  const storage = browserStorage();
  if (!storage) return undefined;
  return readDashboardClientCacheFromStorage(storage, ticker);
}

export function rememberDashboardClientCache(ticker: string, score: StockScoreResponse | undefined, quote: StockQuoteResponse | undefined): boolean {
  const storage = browserStorage();
  if (!storage) return false;
  return rememberDashboardClientCacheInStorage(storage, ticker, score, quote);
}

export function readDashboardClientCacheFromStorage(storage: DashboardClientCacheStorage, ticker: string) {
  try {
    return dashboardClientCacheFromJson(storage.getItem(dashboardClientCacheKey(ticker)), ticker);
  } catch {
    return undefined;
  }
}

export function rememberDashboardClientCacheInStorage(
  storage: DashboardClientCacheStorage,
  ticker: string,
  score: StockScoreResponse | undefined,
  quote: StockQuoteResponse | undefined,
  maxChars = DASHBOARD_CLIENT_CACHE_MAX_CHARS
): boolean {
  try {
    const raw = dashboardClientCacheJson({ ticker, score, quote });
    if (!raw || raw.length > maxChars) return false;
    storage.setItem(dashboardClientCacheKey(ticker), raw);
    return true;
  } catch {
    return false;
  }
}

function browserStorage(): DashboardClientCacheStorage | undefined {
  if (typeof window === "undefined") return undefined;
  return window.localStorage;
}
