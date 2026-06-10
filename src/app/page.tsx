import StockDashboard from "@/components/StockDashboard";
import { dashboardTickerFromSearchParam } from "@/components/stockDashboardHelpers";
import { planStockDisplayCompletion, scheduleStockDisplayCompletion } from "@/lib/stockCompletionPlanner";
import { buildStockDisplayPayload } from "@/lib/stockDisplayModel";

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

async function buildInitialDisplayPayload(ticker: string) {
  try {
    const payload = await buildStockDisplayPayload({ ticker, view: "detail" });
    scheduleStockDisplayCompletion(planStockDisplayCompletion({
      ticker: payload.ticker,
      view: "detail",
      presentParts: payload.completion.presentParts,
      unavailableParts: payload.completion.unavailableParts,
    }));
    return payload;
  } catch {
    return undefined;
  }
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
