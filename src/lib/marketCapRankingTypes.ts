import type { MarketSession } from "@/lib/marketCalendar";

export type MarketCapScope = "all" | "domestic" | "overseas";

export type MarketCapRankingSource = "kis-domestic" | "kis-overseas" | "nasdaq-fallback";

export type MarketCapRankingRow = {
  rank: number;
  ticker: string;
  market: "KR" | "US";
  symbol: string;
  name: string;
  exchange?: string;
  exchangeCode?: string;
  price: number;
  priceChange: number;
  priceChangePercent: number;
  marketCap: number;
  marketCapCurrency: "KRW" | "USD";
  marketCapUsd: number;
  sector?: string;
  industry?: string;
  fetchedAt: string;
  source: MarketCapRankingSource;
};

export type MarketCapDashboardSnapshot = {
  scope: MarketCapScope;
  rows: MarketCapRankingRow[];
  sectors: string[];
  fetchedAt: string;
  updatedAt: string;
  expiresAt: string;
  source: "kis" | "mixed" | "cache";
  usdKrwRate?: number;
  sessions?: MarketSession[];
};

export type MarketCapApiResponse = {
  ok: boolean;
  snapshot?: MarketCapDashboardSnapshot;
  cache: {
    state: "fresh" | "stale" | "miss";
    scope: MarketCapScope;
    fetchedAt?: string;
    expiresAt?: string;
    refreshStarted?: boolean;
    refreshError?: string;
  };
  error?: string;
  message?: string;
};
