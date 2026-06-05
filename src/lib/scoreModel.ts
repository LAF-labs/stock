export const SCORE_MODEL_VERSION = "score-v4-valuation-guardrails-2026-06-05";

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
  return scoreModelVersionFromPayload(payload) === SCORE_MODEL_VERSION;
}
