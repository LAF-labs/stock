import type { JsonValue } from "./types";

export function formatValue(value: JsonValue | undefined): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value || "-";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "-";
    if (Math.abs(value) >= 1000) {
      return new Intl.NumberFormat("ko-KR", {
        maximumFractionDigits: Math.abs(value) >= 1000000 ? 0 : 2,
      }).format(value);
    }
    return new Intl.NumberFormat("ko-KR", {
      maximumFractionDigits: 4,
    }).format(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  return JSON.stringify(value);
}

export function formatPercent(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "-";
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}

export function formatDateTimeFromEpoch(epoch: number | undefined): string {
  if (!epoch) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(epoch * 1000));
}

export function recordEntries(record: Record<string, JsonValue> | undefined) {
  if (!record) return [];
  return Object.entries(record).filter(([, value]) => value !== undefined);
}

export function clampScore(score: number | undefined): number {
  if (score === undefined || !Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, score));
}
