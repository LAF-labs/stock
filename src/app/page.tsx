import type { Metadata } from "next";
import { cache, Suspense } from "react";
import StockDashboard from "@/components/StockDashboard";
import { dashboardTickerFromSearchParam } from "@/components/stockDashboardHelpers";
import { buildStockShareDisplayPayload } from "@/lib/stockSharePayload";
import { stockShareMetadataFromPayload, stockShareMetadataToNextMetadata, stockShareOriginFromEnv } from "@/lib/stockShareMetadata";

type DashboardRouteSearchParams = Record<string, string | string[] | undefined>;

type DashboardRouteProps = {
  searchParams?: DashboardRouteSearchParams | Promise<DashboardRouteSearchParams>;
};

export default function Page() {
  return (
    <Suspense fallback={null}>
      <StockDashboard />
    </Suspense>
  );
}

export async function generateMetadata({ searchParams }: DashboardRouteProps): Promise<Metadata> {
  const params = await searchParams;
  const ticker = dashboardTickerFromSearchParam(firstParam(params?.ticker) || null);
  const payload = ticker ? await buildShareMetadataPayload(ticker) : undefined;
  return stockShareMetadataToNextMetadata(stockShareMetadataFromPayload(payload, { origin: stockShareOriginFromEnv() }));
}

const buildShareMetadataPayload = cache(async function buildShareMetadataPayload(ticker: string) {
  try {
    return await buildStockShareDisplayPayload(ticker, "detail");
  } catch {
    return undefined;
  }
});

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
