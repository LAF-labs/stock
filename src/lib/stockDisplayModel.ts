import { findExactLocalSymbol } from "@/lib/symbolSearch";
import {
  buildStockDataEnvelope,
  fallbackIdentity,
  type StockDataEnvelopeSourceResult,
  type StockDataEnvelopeSources,
} from "@/lib/stockDataEnvelopeService";
import { stockDisplayPayloadFromEnvelope } from "@/lib/stockDataProjectors";
import type { ScoreView, StockPayload, StockScoreResult } from "@/lib/stockScoreContract";
import type {
  StockDisplayPayload,
  StockDisplayView,
  StockScoreView,
} from "@/lib/stockDisplayTypes";

export { displayLaneTimeoutMs } from "@/lib/stockDataEnvelopeService";

export type StockDisplaySourceResult<T extends Record<string, unknown>> = StockDataEnvelopeSourceResult<T>;
export type StockDisplaySources = StockDataEnvelopeSources;

export type StockDisplayScoreSourceDeps = {
  readScore: (ticker: string, view: ScoreView) => Promise<StockScoreResult | undefined>;
  enrichStockPayloadWithSymbolProfile: (payload: StockPayload) => Promise<StockPayload>;
  enrichStockPayloadWithIndustryBenchmarks: (payload: StockPayload) => Promise<StockPayload>;
};

export type BuildStockDisplayPayloadInput = {
  ticker: string;
  view: StockDisplayView;
  sources?: StockDisplaySources;
  now?: Date;
};

export async function readStockDisplayScoreSource(
  ticker: string,
  view: StockDisplayView,
  deps: StockDisplayScoreSourceDeps = defaultDisplayScoreSourceDeps()
): Promise<StockDisplaySourceResult<StockScoreView>> {
  const scoreView = displayScoreView(view);
  const result = await deps.readScore(ticker, scoreView);
  const payload = result?.payload;
  if (!payload || payload.ok === false) return undefined;
  if (scoreView === "technical") return payload;

  const withProfile = await deps.enrichStockPayloadWithSymbolProfile(payload).catch(() => payload);
  return deps.enrichStockPayloadWithIndustryBenchmarks(withProfile).catch(() => withProfile);
}

export async function buildStockDisplayPayload(input: BuildStockDisplayPayloadInput): Promise<StockDisplayPayload> {
  const envelope = await buildStockDataEnvelope({
    ticker: input.ticker,
    view: input.view,
    sources: input.sources ?? defaultDisplaySources(),
    now: input.now,
  });
  return stockDisplayPayloadFromEnvelope(envelope);
}

function defaultDisplaySources(): StockDisplaySources {
  return {
    identity: async (ticker) => {
      const item = await findExactLocalSymbol(ticker);
      if (!item) return fallbackIdentity(ticker);
      return {
        ticker: item.key,
        market: item.market,
        symbol: item.ticker,
        name: item.displayName || item.koreanName || item.englishName || item.ticker,
        koreanName: item.koreanName || undefined,
        englishName: item.englishName || undefined,
        exchange: item.exchange || undefined,
        instrumentType: item.instrumentType || undefined,
      };
    },
    price: async (ticker) => {
      const { getStockQuote } = await import("@/lib/stockQuoteCache");
      const result = await getStockQuote(ticker);
      return result.payload.ok === false ? undefined : result.payload;
    },
    chart: async (ticker) => {
      const { getStockChart } = await import("@/lib/stockChartCache");
      const result = await getStockChart(ticker);
      return result.payload.ok === false ? undefined : result.payload;
    },
    score: async (ticker, view) => {
      return readStockDisplayScoreSource(ticker, view);
    },
    terminalFailures: async (ticker, view) => {
      const { readTerminalStockDisplayFailures } = await import("@/lib/stockRefreshFailures");
      return readTerminalStockDisplayFailures(ticker, view);
    },
  };
}

function displayScoreView(view: StockDisplayView): ScoreView {
  return view === "technical" ? "technical" : "detail";
}

function defaultDisplayScoreSourceDeps(): StockDisplayScoreSourceDeps {
  return {
    readScore: async (ticker, view) => {
      const { getStockScore } = await import("@/lib/stockSnapshotCache");
      return getStockScore(ticker, view);
    },
    enrichStockPayloadWithSymbolProfile: async (payload) => {
      const { enrichStockPayloadWithSymbolProfile } = await import("@/lib/symbolProfiles");
      return enrichStockPayloadWithSymbolProfile(payload);
    },
    enrichStockPayloadWithIndustryBenchmarks: async (payload) => {
      const { enrichStockPayloadWithIndustryBenchmarks } = await import("@/lib/stockIndustryBenchmarkEnrichment");
      return enrichStockPayloadWithIndustryBenchmarks(payload);
    },
  };
}
