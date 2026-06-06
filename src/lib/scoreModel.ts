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
  const directVersion = typeof payload.score_model_version === "string" && payload.score_model_version.trim()
    ? payload.score_model_version.trim()
    : undefined;
  const snapshot = payload.sia_snapshot;
  if (!isRecord(snapshot)) return false;
  const nestedVersion = typeof snapshot.score_model_version === "string" && snapshot.score_model_version.trim()
    ? snapshot.score_model_version.trim()
    : undefined;

  if ((directVersion || nestedVersion) !== SCORE_MODEL_VERSION) return false;
  if (directVersion && directVersion !== SCORE_MODEL_VERSION) return false;
  if (nestedVersion && nestedVersion !== SCORE_MODEL_VERSION) return false;
  if (!isScore100(payload.score)) return false;
  if (!isScore100(payload.quality_score)) return false;
  if (!isScore100(payload.opportunity_score)) return false;
  if (!isRatio(payload.opportunity_confidence)) return false;
  if (!isRatio(snapshot.confidence)) return false;
  if (!isRatio(snapshot.quality_score)) return false;
  if (!isRatio(snapshot.opportunity_score)) return false;
  if (!hasUsableComponents(payload.components, ["profitability", "growth", "health", "momentum", "valuation"])) return false;
  if (
    !hasUsableComponents(payload.opportunity_components, [
      "opportunity_momentum",
      "opportunity_growth",
      "opportunity_analyst",
      "opportunity_liquidity",
      "opportunity_risk",
    ])
  ) {
    return false;
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isScore100(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 100;
}

function isRatio(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}

function hasUsableComponents(value: unknown, requiredKeys: string[]): boolean {
  if (!Array.isArray(value)) return false;
  const components = new Map<string, Record<string, unknown>>();
  for (const item of value) {
    if (!isRecord(item)) continue;
    const key = typeof item.key === "string" ? item.key.trim() : "";
    const label = typeof item.label === "string" ? item.label.trim() : "";
    if (!key || !label || !isScore100(item.score)) continue;
    components.set(key, item);
  }
  return requiredKeys.every((key) => components.has(key));
}
