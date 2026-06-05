export const SCORE_MODEL_VERSION = "score-v5-dual-quality-opportunity-2026-06-05";

export function scoreModelVersionFromPayload(payload: Record<string, unknown>): string | undefined {
  const direct = payload.score_model_version;
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  const snapshot = payload.sia_snapshot;
  if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)) {
    const nested = (snapshot as Record<string, unknown>).score_model_version;
    if (typeof nested === "string" && nested.trim()) return nested.trim();
  }

  return undefined;
}

export function isCurrentScoreModelPayload(payload: Record<string, unknown>): boolean {
  if (scoreModelVersionFromPayload(payload) !== SCORE_MODEL_VERSION) return false;
  if (!isFiniteNumber(payload.score)) return false;
  if (!isFiniteNumber(payload.quality_score)) return false;
  if (!isFiniteNumber(payload.opportunity_score)) return false;
  if (!isFiniteNumber(payload.opportunity_confidence)) return false;
  if (!Array.isArray(payload.opportunity_components)) return false;

  const snapshot = payload.sia_snapshot;
  if (!isRecord(snapshot)) return false;
  return isFiniteNumber(snapshot.quality_score) && isFiniteNumber(snapshot.opportunity_score);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
