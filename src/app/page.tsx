import type { Metadata } from "next";
import { cache } from "react";
import StockDashboard from "@/components/StockDashboard";
import { dashboardTickerFromSearchParam } from "@/components/stockDashboardHelpers";
import { scheduleStockDisplayPayloadCompletion } from "@/lib/stockCompletionPlanner";
import { buildStockDisplayPayload } from "@/lib/stockDisplayModel";
import { stockShareMetadataFromPayload, stockShareMetadataToNextMetadata, stockShareOriginFromEnv } from "@/lib/stockShareMetadata";

type DashboardRouteSearchParams = Record<string, string | string[] | undefined>;

type DashboardRouteProps = {
  searchParams?: DashboardRouteSearchParams | Promise<DashboardRouteSearchParams>;
};

export default async function Page({ searchParams }: DashboardRouteProps) {
  const params = await searchParams;
  const ticker = dashboardTickerFromSearchParam(firstParam(params?.ticker) || null);
  const initialDisplayPayload = ticker ? await buildInitialDisplayPayload(ticker) : undefined;

  return <StockDashboard initialDisplayPayload={initialDisplayPayload} />;
}

export async function generateMetadata({ searchParams }: DashboardRouteProps): Promise<Metadata> {
  const params = await searchParams;
  const ticker = dashboardTickerFromSearchParam(firstParam(params?.ticker) || null);
  const payload = ticker ? await buildInitialDisplayPayload(ticker) : undefined;
  return stockShareMetadataToNextMetadata(stockShareMetadataFromPayload(payload, { origin: stockShareOriginFromEnv() }));
}

const buildInitialDisplayPayload = cache(async function buildInitialDisplayPayload(ticker: string) {
  try {
    const payload = await buildStockDisplayPayload({ ticker, view: "detail" });
    scheduleStockDisplayPayloadCompletion(payload);
    return payload;
  } catch {
    return undefined;
  }
});

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
