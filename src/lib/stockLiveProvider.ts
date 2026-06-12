import { fetchKisDailyChart, fetchKisQuote, kisQuoteConfigured, type KisDailyChartPayload } from "@/lib/kisQuoteClient";
import { fetchYahooDailyChart, fetchYahooQuote, yahooFinanceFallbackEnabled } from "@/lib/yahooFinanceClient";
import { combineProviderErrors, isProviderConfirmedEmptyError } from "@/lib/stockProviderErrors";
import type { StockPayload } from "@/lib/stockScoreContract";
import { numericEnv } from "@/lib/supabaseRest";

export function liveStockProviderConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return kisConfigured(env) || yahooFinanceFallbackEnabled(env);
}

export async function fetchLiveQuote(ticker: string): Promise<StockPayload> {
  const attempts: Array<() => Promise<StockPayload>> = [];
  if (kisQuoteConfigured()) attempts.push(() => fetchKisQuote(ticker));
  if (yahooFinanceFallbackEnabled()) attempts.push(() => fetchYahooQuote(ticker));
  return firstLiveProviderResult(ticker, attempts, "No live quote provider is configured.");
}

function kisConfigured(env: Record<string, string | undefined>): boolean {
  return !!((env.STOCK_API_APP_KEY || env.KIS_APP_KEY) && (env.STOCK_API_APP_SECRET || env.KIS_APP_SECRET));
}

export async function fetchLiveDailyChart(ticker: string): Promise<KisDailyChartPayload> {
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
    if (isProviderConfirmedEmptyError(result.error)) {
      const quick = await firstProviderSuccessWithin(pending, liveEmptyConfirmationMs());
      if (quick.ok) {
        drainPending(pending);
        return quick.value;
      }
      if (quick.error) errors.push(quick.error);
      drainPending(pending);
      throw combineProviderErrors(ticker, errors);
    }
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

async function firstProviderSuccessWithin<T>(
  pending: Array<Promise<{ ok: true; value: T } | { ok: false; error: unknown }>>,
  timeoutMs: number
): Promise<{ ok: true; value: T } | { ok: false; error?: unknown }> {
  if (!pending.length) return { ok: false };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      waitForFirstSuccess(pending),
      new Promise<{ ok: false }>((resolve) => {
        timer = setTimeout(() => resolve({ ok: false }), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function waitForFirstSuccess<T>(
  pending: Array<Promise<{ ok: true; value: T } | { ok: false; error: unknown }>>
): Promise<{ ok: true; value: T } | { ok: false; error?: unknown }> {
  const errors: unknown[] = [];
  const successPromises = pending.map((promise) =>
    promise.then((result) => {
      if (result.ok) return result;
      errors.push(result.error);
      throw result.error;
    })
  );
  try {
    return await Promise.any(successPromises);
  } catch {
    return { ok: false, error: errors[0] };
  }
}

function drainPending<T>(pending: Array<Promise<T>>) {
  for (const promise of pending) void promise.catch(() => undefined);
}

function liveEmptyConfirmationMs(): number {
  return numericEnv("STOCK_LIVE_PROVIDER_EMPTY_CONFIRMATION_MS", 350);
}
