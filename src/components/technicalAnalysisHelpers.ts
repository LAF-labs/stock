import type { TechnicalAnalysisPayload } from "@/lib/technicalAnalysisTypes";

export type TechnicalSignalView = {
  key: string;
  title: string;
  status: string;
  tone: "bullish" | "bearish" | "neutral" | "caution" | "insufficient";
  plain: string;
  evidence: string;
  rule: string;
  layer?: string;
};

export function isTechnicalAnalysisPayload(value: unknown): value is TechnicalAnalysisPayload {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && (value as Record<string, unknown>).type === "technical_analysis";
}

export function technicalSignals(payload: TechnicalAnalysisPayload | undefined): TechnicalSignalView[] {
  const rawSignals = Array.isArray(payload?.signals) ? payload.signals : [];
  return rawSignals
    .map((signal) => ({
      key: text(signal.key) || "signal",
      title: text(signal.title) || "기술 신호",
      status: text(signal.status) || "neutral",
      tone: normalizedTone(signal.tone || signal.status),
      plain: text(signal.plain) || "추가 확인이 필요해요.",
      evidence: text(signal.evidence) || "-",
      rule: text(signal.rule) || "가격과 거래량의 위치를 함께 확인해요.",
      layer: text(signal.layer),
    }))
    .slice(0, 12);
}

export function technicalCoverageLabel(payload: TechnicalAnalysisPayload | undefined): string {
  switch (payload?.coverage_tier) {
    case "starter":
      return "상장 초기";
    case "short":
      return "제한 분석";
    case "standard":
      return "표준 분석";
    case "full":
      return "충분한 데이터";
    case "long_history":
      return "장기 데이터";
    case "insufficient":
      return "데이터 부족";
    default:
      return payload?.status === "ready" ? "분석 가능" : "확인 필요";
  }
}

export function technicalStatusCopy(payload: TechnicalAnalysisPayload | undefined): string {
  if (!payload) return "기술적 분석 데이터를 찾지 못했어요.";
  const bars = typeof payload.bars === "number" ? payload.bars : payload.data_window?.available_days;
  if (payload.status === "unavailable") return "가격 데이터가 부족해 아직 계산할 수 없어요.";
  if (payload.data_window?.is_newly_listed) return `${bars || 0}개 일봉만 반영했어요. 빠른 신호 위주로 참고하세요.`;
  return `${bars || 0}개 일봉으로 계산했어요. 마지막 기준일은 ${payload.closed_bar_date || payload.data_window?.end_date || "-"}입니다.`;
}

export function technicalToneLabel(tone: string | undefined): string {
  switch (normalizedTone(tone)) {
    case "bullish":
      return "우호";
    case "bearish":
      return "주의";
    case "caution":
      return "확인";
    case "insufficient":
      return "제한";
    default:
      return "중립";
  }
}

export function technicalSummaryBullets(payload: TechnicalAnalysisPayload | undefined): string[] {
  const bullets = Array.isArray(payload?.summary?.bullets) ? payload.summary.bullets.map(text).filter(Boolean) : [];
  if (bullets.length) return bullets.slice(0, 3);
  return technicalSignals(payload).slice(0, 3).map((signal) => signal.plain);
}

export function technicalWarnings(payload: TechnicalAnalysisPayload | undefined): string[] {
  return (Array.isArray(payload?.warnings) ? payload.warnings : []).map(text).filter(Boolean).slice(0, 3);
}

export function safeInternalRedirectPath(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  if (!trimmed || !trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.includes("\\")) return fallback;
  try {
    const url = new URL(trimmed, "https://stock.local");
    return url.origin === "https://stock.local" ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch {
    return fallback;
  }
}

export function normalizedTone(value: string | undefined): TechnicalSignalView["tone"] {
  if (value === "bullish" || value === "positive") return "bullish";
  if (value === "bearish" || value === "cautious") return "bearish";
  if (value === "caution") return "caution";
  if (value === "insufficient" || value === "limited") return "insufficient";
  return "neutral";
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
