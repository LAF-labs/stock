"use client";

import { useRouter, useSearchParams } from "next/navigation";
import AppNavigationMenu from "@/components/AppNavigationMenu";
import {
  detailHrefForMarketCapRow,
  formatMarketCapAmount,
  formatMarketCapChange,
  formatMarketCapPrice,
  marketCapChangeTone,
  marketCapDashboardHref,
  marketCapScopeFromParam,
  marketCapScopeLabel,
} from "@/components/marketCapDashboardHelpers";
import { DataTable, Panel, PriceChange } from "@/components/ui";
import type { PriceChangeTone } from "@/components/ui/PriceChange";
import { useMarketCapDashboardQuery } from "@/components/useMarketCapDashboardQuery";
import type { MarketCapScope } from "@/lib/marketCapRankingTypes";

const SCOPES: MarketCapScope[] = ["all", "domestic", "overseas"];

export default function MarketCapDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const scope = marketCapScopeFromParam(searchParams.get("scope"));
  const sector = searchParams.get("sector")?.trim() || undefined;
  const state = useMarketCapDashboardQuery(scope, sector);
  const snapshot = state.status === "success" || state.status === "pending" ? state.payload.snapshot : undefined;
  const sectors = snapshot?.sectors || [];
  const rows = snapshot?.rows || [];

  function selectSector(value: string) {
    router.push(marketCapDashboardHref({ scope, sector: value || undefined }));
  }

  return (
    <main className="stock-app market-cap-app">
      <AppNavigationMenu context={{ page: "marketCap" }} />
      <header className="market-cap-header">
        <div>
          <span>Market Cap</span>
          <h1>시가총액 대시보드</h1>
        </div>
        <p>{snapshot ? `${marketCapScopeLabel(scope)} 상위 ${rows.length}개 종목` : "상위 종목 스냅샷을 불러오는 중"}</p>
      </header>

      <section className="market-cap-toolbar" aria-label="시가총액 목록 필터">
        <div className="market-cap-tabs" role="tablist" aria-label="시장 범위">
          {SCOPES.map((item) => (
            <a key={item} href={marketCapDashboardHref({ scope: item, sector })} className={scope === item ? "active" : ""} role="tab" aria-selected={scope === item}>
              {marketCapScopeLabel(item)}
            </a>
          ))}
        </div>
        <label className="market-cap-sector-filter">
          <span>섹터</span>
          <select value={sector || ""} onChange={(event) => selectSector(event.target.value)}>
            <option value="">전체</option>
            {sectors.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>
      </section>

      {state.status === "loading" ? <MarketCapStatus title="불러오는 중" body="저장된 스냅샷을 확인하고 있어요." /> : null}
      {state.status === "error" ? <MarketCapStatus title="조회할 수 없어요" body={state.error} tone="error" /> : null}
      {state.status === "pending" ? <MarketCapStatus title="스냅샷 준비 중" body={state.payload.message || "정기 갱신이 끝나면 바로 표시됩니다."} /> : null}

      {snapshot ? (
        <Panel className="market-cap-panel" aria-label="시가총액 순위">
          <div className="market-cap-meta">
            <span>업데이트 {formatDateTime(snapshot.fetchedAt)}</span>
            <span>{state.status === "success" ? state.payload.cache.state : "pending"}</span>
          </div>
          <DataTable className="market-cap-table" role="table" density="compact" aria-label={`${marketCapScopeLabel(scope)} 시가총액 상위 종목`}>
            <div className="market-cap-table-head" role="row">
              <span>순위</span>
              <span>종목명</span>
              <span>티커</span>
              <span>시총</span>
              <span>주가</span>
              <span>등락폭</span>
            </div>
            {rows.map((row) => (
              <a key={row.ticker} className="market-cap-table-row" href={detailHrefForMarketCapRow(row)} role="row">
                <span>{row.rank}</span>
                <span>
                  <strong>{row.name}</strong>
                  <small>{[row.sector, row.industry].filter(Boolean).join(" · ") || row.exchange || row.market}</small>
                </span>
                <span>{row.ticker}</span>
                <span>{formatMarketCapAmount(row.marketCap, row.marketCapCurrency)}</span>
                <span>{formatMarketCapPrice(row)}</span>
                <PriceChange className={`market-cap-change ${marketCapChangeTone(row)}`} value={row.priceChangePercent} tone={priceChangeToneForMarketCapRow(row)}>
                  {formatMarketCapChange(row)}
                </PriceChange>
              </a>
            ))}
          </DataTable>
          {!rows.length ? <MarketCapStatus title="표시할 종목이 없어요" body="다른 탭이나 섹터를 선택해보세요." /> : null}
        </Panel>
      ) : null}
    </main>
  );
}

function MarketCapStatus({ title, body, tone = "default" }: { title: string; body: string; tone?: "default" | "error" }) {
  return (
    <section className={`market-cap-status ${tone}`} role={tone === "error" ? "alert" : "status"}>
      <strong>{title}</strong>
      <p>{body}</p>
    </section>
  );
}

function priceChangeToneForMarketCapRow(row: Parameters<typeof marketCapChangeTone>[0]): PriceChangeTone {
  switch (marketCapChangeTone(row)) {
    case "up":
      return "price-up";
    case "down":
      return "price-down";
    default:
      return "neutral";
  }
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
