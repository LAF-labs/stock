import { NextResponse } from "next/server";
import { marketCapScopeFromParam } from "@/components/marketCapDashboardHelpers";
import { publicVercelCdnCacheHeaders } from "@/lib/httpCacheHeaders";
import { getMarketCapSnapshotResponse } from "@/lib/marketCapSnapshotStore";
import type { MarketCapScope } from "@/lib/marketCapRankingTypes";

export const dynamic = "force-dynamic";

export function readMarketCapRequestParams(url: URL): { scope: MarketCapScope; sector?: string } {
  const scopeParam = url.searchParams.get("scope");
  const scope = scopeParam === null ? marketCapScopeFromMarketParam(url.searchParams.get("market")) : marketCapScopeFromParam(scopeParam);
  const sector = url.searchParams.get("sector")?.trim() || undefined;
  return { scope, sector };
}

export async function GET(request: Request) {
  const params = readMarketCapRequestParams(new URL(request.url));
  const payload = await getMarketCapSnapshotResponse(params);
  return NextResponse.json(payload, {
    status: payload.ok ? 200 : 202,
    headers: publicVercelCdnCacheHeaders({
      sMaxAgeSeconds: payload.ok ? 60 : 5,
      staleWhileRevalidateSeconds: payload.ok ? 300 : 10,
      staleIfErrorSeconds: 600,
    }),
  });
}

function marketCapScopeFromMarketParam(value: string | null): MarketCapScope {
  const normalized = value?.trim().toUpperCase();
  if (normalized === "KR" || normalized === "DOMESTIC") return "domestic";
  if (normalized === "US" || normalized === "OVERSEAS") return "overseas";
  return "all";
}
