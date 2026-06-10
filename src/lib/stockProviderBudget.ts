import { acquireRateLimit, apiLimitPolicy, fixedRateLimitKey, type RateLimitResult } from "@/lib/apiRateLimit";
import type { MarketCode } from "@/lib/tickerRef";

export type StockProviderName = "kis" | "market-data" | "yfinance";
export type StockProviderEndpointKind = "quote" | "chart" | "score" | "technical" | "profile" | "news";

export type StockProviderBudgetInput = {
  provider: StockProviderName;
  market: MarketCode;
  endpointKind: StockProviderEndpointKind;
  credentialKey?: string;
  limit?: number;
  windowSeconds?: number;
};

let testNamespace = 0;

export async function acquireStockProviderBudget(input: StockProviderBudgetInput): Promise<RateLimitResult> {
  const bucket = stockProviderBudgetBucket(input);
  const identity = fixedRateLimitKey([
    "stock-provider-budget",
    testNamespace,
    input.provider,
    input.market,
    input.endpointKind,
    input.credentialKey || "default",
  ].join(":"));

  return acquireRateLimit(
    identity,
    apiLimitPolicy(
      bucket,
      input.limit ?? defaultProviderLimit(input),
      input.windowSeconds ?? defaultProviderWindowSeconds(input),
      `${bucket.toUpperCase()}_RATE_LIMIT`,
      `${bucket.toUpperCase()}_RATE_LIMIT_WINDOW_SECONDS`,
    ),
  );
}

export function stockProviderBudgetBucket(input: Pick<StockProviderBudgetInput, "provider" | "market" | "endpointKind">): string {
  return `stock_provider_${input.provider}_${input.market}_${input.endpointKind}`.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();
}

function defaultProviderLimit(input: StockProviderBudgetInput): number {
  if (input.provider === "kis") return 120;
  if (input.provider === "market-data") return 300;
  return 60;
}

function defaultProviderWindowSeconds(_input: StockProviderBudgetInput): number {
  return 60;
}

export const stockProviderBudgetTestHooks = {
  resetMemory() {
    testNamespace += 1;
  },
};
