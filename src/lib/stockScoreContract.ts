import { stockScorePayloadIsDurable } from "@/lib/stockQueryCompleteness";
import { SCORE_MODEL_VERSION, isCurrentScoreModelPayload, scoreModelVersionFromPayload } from "@/lib/scoreModel";

export type ScoreView = "detail" | "compare" | "technical";
export type StockPayload = Record<string, unknown>;
export type CacheState = "fresh" | "stale" | "miss";
export type CacheSource = "memory" | "supabase" | "collector" | "market-data";

export type StockScoreResult = {
  payload: StockPayload;
  cache: {
    state: CacheState;
    source: CacheSource;
    ticker: string;
    view: ScoreView;
    fetchedAt?: string;
    expiresAt?: string;
    refreshStarted?: boolean;
    refreshError?: string;
  };
};

export type StoredScoreSnapshot = {
  ticker: string;
  view: ScoreView;
  payload: StockPayload;
  fetchedAt: string;
  expiresAt: string;
};

declare global {
  var __stockScoreMemoryCache: Map<string, StoredScoreSnapshot> | undefined;
}

export function cleanScoreView(value: string | null): ScoreView {
  if (value === "technical") return "technical";
  return value === "compare" ? "compare" : "detail";
}

export function statusFromPayload(payload: StockPayload): number {
  return typeof payload.status === "number" ? payload.status : payload.ok === false ? 400 : 200;
}

export function stockScoreCacheKey(ticker: string, view: ScoreView): string {
  return `${view}:${ticker}`;
}

export function isCurrentScorePayload(payload: StockPayload): boolean {
  return isCurrentScoreModelPayload(payload);
}

export function isCurrentTechnicalScorePayload(payload: StockPayload): boolean {
  if (payload.ok === false) return false;
  if (scoreModelVersionFromPayload(payload) !== SCORE_MODEL_VERSION) return false;
  const technical = payload.technical_analysis;
  return Boolean(technical)
    && typeof technical === "object"
    && !Array.isArray(technical)
    && (technical as Record<string, unknown>).type === "technical_analysis";
}

export function isCurrentScoreSnapshot(snapshot: StoredScoreSnapshot): boolean {
  if (snapshot.view === "technical") return isCurrentTechnicalScorePayload(snapshot.payload);
  return isCurrentScorePayload(snapshot.payload) && stockScorePayloadIsDurable(snapshot.payload);
}
