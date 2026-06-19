import { fetchKisDailyChart, fetchKisQuote, kisQuoteConfigured, type KisDailyChartPayload } from "@/lib/kisQuoteClient";
import { fetchTossDailyChart, fetchTossQuote, tossInvestConfigured } from "@/lib/tossInvestClient";
import { fetchYahooDailyChart, fetchYahooQuote, yahooFinanceFallbackEnabled } from "@/lib/yahooFinanceClient";
import { combineProviderErrors } from "@/lib/stockProviderErrors";
import type { StockPayload } from "@/lib/stockScoreContract";

export function liveStockProviderConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return tossInvestConfigured(env) || kisConfigured(env) || yahooFinanceFallbackEnabled(env);
}

export async function fetchLiveQuote(ticker: string): Promise<StockPayload> {
  const attempts: Array<LiveProviderAttempt<StockPayload>> = [];
  if (tossInvestConfigured()) attempts.push({ provider: "toss_invest", run: () => fetchTossQuote(ticker) });
  if (kisQuoteConfigured()) attempts.push({ provider: "kis", run: () => fetchKisQuote(ticker) });
  if (yahooFinanceFallbackEnabled()) attempts.push({ provider: "yahoo_finance", run: () => fetchYahooQuote(ticker) });
  return firstLiveProviderResult(ticker, attempts, "No live quote provider is configured.");
}

function kisConfigured(env: Record<string, string | undefined>): boolean {
  return !!((env.STOCK_API_APP_KEY || env.KIS_APP_KEY) && (env.STOCK_API_APP_SECRET || env.KIS_APP_SECRET));
}

export async function fetchLiveDailyChart(ticker: string): Promise<KisDailyChartPayload> {
  const attempts: Array<LiveProviderAttempt<KisDailyChartPayload>> = [];
  if (tossInvestConfigured()) attempts.push({ provider: "toss_invest", run: () => fetchTossDailyChart(ticker) });
  if (kisQuoteConfigured()) attempts.push({ provider: "kis", run: () => fetchKisDailyChart(ticker) });
  if (yahooFinanceFallbackEnabled()) attempts.push({ provider: "yahoo_finance", run: () => fetchYahooDailyChart(ticker) });
  return firstLiveProviderResult(ticker, attempts, "No live chart provider is configured.");
}

type LiveProviderAttempt<T> = {
  provider: string;
  run: () => Promise<T>;
};

async function firstLiveProviderResult<T extends { fetch?: unknown }>(ticker: string, attempts: Array<LiveProviderAttempt<T>>, unconfiguredMessage: string): Promise<T> {
  if (!attempts.length) throw new Error(unconfiguredMessage);
  const errors: unknown[] = [];
  const attempted: string[] = [];
  const failed: string[] = [];

  for (const attempt of attempts) {
    attempted.push(attempt.provider);
    try {
      const value = await attempt.run();
      return withProviderAttemptMetadata(value, attempted, failed);
    } catch (error) {
      errors.push(error);
      failed.push(attempt.provider);
    }
  }

  throw combineProviderErrors(ticker, errors);
}

function withProviderAttemptMetadata<T extends { fetch?: unknown }>(value: T, providerAttempts: string[], fallbackFrom: string[]): T {
  return {
    ...value,
    fetch: {
      ...(isRecord(value.fetch) ? value.fetch : {}),
      provider_attempts: providerAttempts,
      ...(fallbackFrom.length ? { fallback_from: fallbackFrom } : {}),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
