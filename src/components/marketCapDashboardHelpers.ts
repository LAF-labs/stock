import { formatCompactUsd, formatKoreanWonLarge, formatPercent } from "@/lib/format";
import type { MarketCapDashboardSnapshot, MarketCapRankingRow, MarketCapScope } from "@/lib/marketCapRankingTypes";

export function marketCapScopeFromParam(value: string | null | undefined): MarketCapScope {
  return value === "domestic" || value === "overseas" ? value : "all";
}

export function marketCapDashboardHref(input: { scope: MarketCapScope; sector?: string | null }): string {
  const params = new URLSearchParams();
  if (input.scope !== "all") params.set("scope", input.scope);
  const sector = input.sector?.trim();
  if (sector) params.set("sector", sector);
  const query = params.toString();
  return query ? `/market-cap?${query}` : "/market-cap";
}

export function detailHrefForMarketCapRow(row: Pick<MarketCapRankingRow, "ticker">): string {
  return `/?ticker=${encodeURIComponent(row.ticker)}`;
}

export function filterMarketCapSnapshotRows(snapshot: MarketCapDashboardSnapshot, sector: string | null | undefined): MarketCapDashboardSnapshot {
  const selected = cleanSector(sector);
  if (!selected) return snapshot;
  const rows = snapshot.rows
    .filter((row) => cleanSector(row.sector).toLowerCase() === selected.toLowerCase())
    .map((row, index) => ({ ...row, rank: index + 1 }));
  return { ...snapshot, rows };
}

export function formatMarketCapAmount(value: number | undefined, currency: string | undefined): string {
  if (currency === "KRW") return formatKoreanWonLarge(value);
  if (currency === "USD") return formatCompactUsd(value);
  return "-";
}

export function formatMarketCapPrice(row: Pick<MarketCapRankingRow, "price" | "marketCapCurrency">): string {
  if (!Number.isFinite(row.price)) return "-";
  if (row.marketCapCurrency === "KRW") return `${new Intl.NumberFormat("ko-KR").format(Math.round(row.price))}원`;
  return `$${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(row.price)}`;
}

export function formatMarketCapChange(row: Pick<MarketCapRankingRow, "priceChangePercent">): string {
  return formatPercent(row.priceChangePercent);
}

export function marketCapChangeTone(row: Pick<MarketCapRankingRow, "priceChangePercent">): "up" | "down" | "flat" {
  if (row.priceChangePercent > 0) return "up";
  if (row.priceChangePercent < 0) return "down";
  return "flat";
}

export function marketCapScopeLabel(scope: MarketCapScope): string {
  if (scope === "domestic") return "국내";
  if (scope === "overseas") return "해외";
  return "전체";
}

function cleanSector(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
