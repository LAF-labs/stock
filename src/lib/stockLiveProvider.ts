import { fetchKisDailyChart, fetchKisQuote, kisQuoteConfigured, type KisDailyChartPayload } from "@/lib/kisQuoteClient";
import { fetchTossDailyChart, fetchTossQuote, tossInvestConfigured } from "@/lib/tossInvestClient";
import { fetchYahooDailyChart, fetchYahooQuote, yahooFinanceFallbackEnabled } from "@/lib/yahooFinanceClient";
import { combineProviderErrors } from "@/lib/stockProviderErrors";
import type { StockPayload } from "@/lib/stockScoreContract";

export function liveStockProviderConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return tossInvestConfigured(env) || kisConfigured(env) || yahooFinanceFallbackEnabled(env);
}

export async function fetchLiveQuote(ticker: string): Promise<StockPayload> {
  if (tossInvestConfigured()) return fetchTossQuote(ticker);
  const attempts: Array<() => Promise<StockPayload>> = [];
  if (kisQuoteConfigured()) attempts.push(() => fetchKisQuote(ticker));
  if (yahooFinanceFallbackEnabled()) attempts.push(() => fetchYahooQuote(ticker));
  return firstLiveProviderResult(ticker, attempts, "No live quote provider is configured.");
}

function kisConfigured(env: Record<string, string | undefined>): boolean {
  return !!((env.STOCK_API_APP_KEY || env.KIS_APP_KEY) && (env.STOCK_API_APP_SECRET || env.KIS_APP_SECRET));
}

export async function fetchLiveDailyChart(ticker: string): Promise<KisDailyChartPayload> {
  if (tossInvestConfigured()) return fetchTossDailyChart(ticker);
  const attempts: Array<() => Promise<KisDailyChartPayload>> = [];
  if (kisQuoteConfigured()) attempts.push(() => fetchKisDailyChart(ticker));
  if (yahooFinanceFallbackEnabled()) attempts.push(() => fetchYahooDailyChart(ticker));
  return firstLiveProviderResult(ticker, attempts, "No live chart provider is configured.");
}

async function firstLiveProviderResult<T>(ticker: string, attempts: Array<() => Promise<T>>, unconfiguredMessage: string): Promise<T> {
  if (!attempts.length) throw new Error(unconfiguredMessage);
  const pending = attempts.map((attempt) => settleProvider(attempt()));
  const errors: unknown[] = [];

  while (pending.length) {
    const { index, result } = await Promise.race(pending.map((promise, index) => promise.then((result) => ({ index, result }))));
    pending.splice(index, 1);
    if (result.ok) {
      drainPending(pending);
      return result.value;
    }

    errors.push(result.error);
  }

  throw combineProviderErrors(ticker, errors);
}

async function settleProvider<T>(promise: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, error };
  }
}

function drainPending<T>(pending: Array<Promise<T>>) {
  for (const promise of pending) void promise.catch(() => undefined);
}
