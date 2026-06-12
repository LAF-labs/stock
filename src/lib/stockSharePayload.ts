import { buildStockDisplayPayload } from "@/lib/stockDisplayModel";
import type { DisplayPartSource, DisplayPartFreshness, StockDisplayPayload, StockDisplayView } from "@/lib/stockDisplayTypes";
import { readStockScoreSnapshotForDisplay } from "@/lib/stockScoreSnapshotReader";

export async function buildStockShareDisplayPayload(ticker: string, view: StockDisplayView = "detail"): Promise<StockDisplayPayload> {
  const payload = await buildStockDisplayPayload({ ticker, view });
  if (payload.score) return payload;

  const scoreView = view === "compare" ? "compare" : "detail";
  const scoreResult = await readStockScoreSnapshotForDisplay(payload.ticker, scoreView).catch(() => undefined);
  if (!scoreResult || scoreResult.payload.ok === false) return payload;

  return {
    ...payload,
    score: {
      value: scoreResult.payload,
      freshness: displayFreshnessFromScoreState(scoreResult.cache.state),
      source: displaySourceFromScoreSource(scoreResult.cache.source),
      fetchedAt: scoreResult.cache.fetchedAt,
      expiresAt: scoreResult.cache.expiresAt,
    },
  };
}

function displayFreshnessFromScoreState(state: string): DisplayPartFreshness {
  return state === "stale" ? "stale" : "fresh";
}

function displaySourceFromScoreSource(source: string): DisplayPartSource {
  if (source === "memory" || source === "supabase" || source === "market-data") return source;
  return "derived";
}
