import { normalizeTickerRef } from "@/lib/tickerRef";

export type StockPrewarmReason = "active_page" | "search_candidates" | "recent" | "popular" | "long_tail";

export type StockPrewarmCandidate = {
  ticker: string;
};

export type StockPrewarmPlan = {
  reason: StockPrewarmReason;
  snapshotReads: StockPrewarmCandidate[];
  providerCandidates: StockPrewarmCandidate[];
  droppedTickers: string[];
};

export type StockPrewarmInput = {
  reason: StockPrewarmReason;
  tickers: string[];
  maxProviderCandidates?: number;
};

const DEFAULT_SEARCH_PROVIDER_CANDIDATE_CAP = 5;

export function planSelectivePrewarm(input: StockPrewarmInput): StockPrewarmPlan {
  const tickers = uniqueTickers(input.tickers);
  const providerCap = providerCandidateCap(input);
  const providerTickers = input.reason === "long_tail" ? [] : tickers.slice(0, providerCap);

  return {
    reason: input.reason,
    snapshotReads: tickers.slice(0, snapshotReadCap(input)).map((ticker) => ({ ticker })),
    providerCandidates: providerTickers.map((ticker) => ({ ticker })),
    droppedTickers: tickers.slice(providerTickers.length),
  };
}

function providerCandidateCap(input: StockPrewarmInput): number {
  if (input.reason === "long_tail") return 0;
  if (input.reason === "search_candidates") return Math.max(0, input.maxProviderCandidates ?? DEFAULT_SEARCH_PROVIDER_CANDIDATE_CAP);
  return Math.max(0, input.maxProviderCandidates ?? input.tickers.length);
}

function snapshotReadCap(input: StockPrewarmInput): number {
  if (input.reason === "search_candidates") return Math.max(0, input.maxProviderCandidates ?? DEFAULT_SEARCH_PROVIDER_CANDIDATE_CAP);
  return input.tickers.length;
}

function uniqueTickers(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const ticker = normalizeTickerRef(value);
    if (seen.has(ticker)) continue;
    seen.add(ticker);
    result.push(ticker);
  }
  return result;
}
