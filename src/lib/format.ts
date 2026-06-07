import type { JsonValue } from "./types";

const KO_KR_INTEGER_FORMATTER = new Intl.NumberFormat("ko-KR");
const EN_US_INTEGER_FORMATTER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const EN_US_AMOUNT_FORMATTER = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const EN_US_GENERIC_AMOUNT_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});
const EN_US_COMPACT_DECIMAL_FORMATTER = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

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

export function formatCurrencyAmount(value: number | undefined, currency: string | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  const normalizedCurrency = (currency || "").toUpperCase();
  if (normalizedCurrency === "KRW") return `${KO_KR_INTEGER_FORMATTER.format(Math.round(value))}원`;
  if (normalizedCurrency === "USD") return `$${EN_US_AMOUNT_FORMATTER.format(value)}`;
  if (normalizedCurrency) return `${normalizedCurrency} ${EN_US_GENERIC_AMOUNT_FORMATTER.format(value)}`;
  return EN_US_GENERIC_AMOUNT_FORMATTER.format(value);
}

export function formatApproxKrwAmount(value: number | undefined, usdKrwRate: number | undefined): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || typeof usdKrwRate !== "number" || !Number.isFinite(usdKrwRate)) return undefined;
  return `약 ${KO_KR_INTEGER_FORMATTER.format(Math.round(value * usdKrwRate))}원`;
}

export function formatKoreanWonLarge(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  const totalEok = Math.max(0, Math.round(value / 100_000_000));
  const jo = Math.floor(totalEok / 10_000);
  const eok = totalEok % 10_000;
  if (jo > 0 && eok > 0) return `${jo}조 ${eok}억원`;
  if (jo > 0) return `${jo}조원`;
  return `${totalEok}억원`;
}

export function formatCompactUsd(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "$-";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000_000) return `$${trimCompactAmount(value / 1_000_000_000_000)}T`;
  if (abs >= 1_000_000_000) return `$${trimCompactAmount(value / 1_000_000_000)}B`;
  if (abs >= 1_000_000) return `$${trimCompactAmount(value / 1_000_000)}M`;
  return `$${EN_US_INTEGER_FORMATTER.format(value)}`;
}

function trimCompactAmount(value: number): string {
  return EN_US_COMPACT_DECIMAL_FORMATTER.format(value);
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
