import { isProviderConfirmedEmptyError } from "@/lib/stockProviderErrors";
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
  readSnapshot: (ticker: string, view: ScoreView) => Promise<StockScoreResult | undefined>;
  detailFastPathEnabled: () => boolean | Promise<boolean>;
  technicalFastPathEnabled: () => boolean | Promise<boolean>;
  buildDetailFastPathPayload: (ticker: string, view: ScoreView) => Promise<StockPayload>;
  buildTechnicalScoreFastPathPayload: (ticker: string) => Promise<StockPayload>;
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
  const snapshot = await deps.readSnapshot(ticker, scoreView).catch(() => undefined);
  let payload = snapshot?.payload;

  if (!payload || payload.ok === false) {
    payload = await requestFastPathDisplayScore(ticker, scoreView, deps);
  }

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
  return view === "technical" ? "technical" : view === "compare" ? "compare" : "detail";
}

async function requestFastPathDisplayScore(
  ticker: string,
  view: ScoreView,
  deps: StockDisplayScoreSourceDeps
): Promise<StockPayload | undefined> {
  try {
    if (view === "technical") {
      if (!(await deps.technicalFastPathEnabled())) return undefined;
      return await deps.buildTechnicalScoreFastPathPayload(ticker);
    }
    if (!(await deps.detailFastPathEnabled())) return undefined;
    return await deps.buildDetailFastPathPayload(ticker, view);
  } catch (error) {
    if (isProviderConfirmedEmptyError(error)) throw error;
    return undefined;
  }
}

function defaultDisplayScoreSourceDeps(): StockDisplayScoreSourceDeps {
  return {
    readSnapshot: async (ticker, view) => {
      const { readStockScoreSnapshotForDisplay } = await import("@/lib/stockScoreSnapshotReader");
      return readStockScoreSnapshotForDisplay(ticker, view);
    },
    detailFastPathEnabled: async () => {
      const { detailRequestFastPathEnabled } = await import("@/lib/detailScoreFastPath");
      return detailRequestFastPathEnabled();
    },
    technicalFastPathEnabled: async () => {
      const { technicalRequestFastPathEnabled } = await import("@/lib/technicalScoreFastPath");
      return technicalRequestFastPathEnabled();
    },
    buildDetailFastPathPayload: async (ticker, view) => {
      const { buildDetailScoreFastPathPayload } = await import("@/lib/detailScoreFastPath");
      return buildDetailScoreFastPathPayload(ticker, view);
    },
    buildTechnicalScoreFastPathPayload: async (ticker) => {
      const { buildTechnicalScoreFastPathPayload } = await import("@/lib/technicalScoreFastPath");
      return buildTechnicalScoreFastPathPayload(ticker);
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
