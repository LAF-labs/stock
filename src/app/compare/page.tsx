import StockCompare from "@/components/StockCompare";
import { parseTickers } from "@/components/stockCompareHelpers";
import { scheduleStockDisplayPayloadCompletion } from "@/lib/stockCompletionPlanner";
import { buildStockDisplayPayload } from "@/lib/stockDisplayModel";
import type { StockDisplayPayload } from "@/lib/stockDisplayTypes";

type CompareRouteSearchParams = Record<string, string | string[] | undefined>;

type CompareRouteProps = {
  searchParams?: CompareRouteSearchParams | Promise<CompareRouteSearchParams>;
};

export default async function ComparePage({ searchParams }: CompareRouteProps) {
  const params = await searchParams;
  const tickers = parseTickers(firstParam(params?.tickers) || firstParam(params?.ticker) || null);
  const initialDisplayPayloads = await buildInitialComparePayloads(tickers);

  return <StockCompare initialDisplayPayloads={initialDisplayPayloads} />;
}

async function buildInitialComparePayloads(tickers: string[]): Promise<StockDisplayPayload[]> {
  const payloads = await Promise.all(tickers.map(async (ticker) => {
    try {
      const payload = await buildStockDisplayPayload({ ticker, view: "compare" });
      scheduleStockDisplayPayloadCompletion(payload);
      return payload;
    } catch {
      return undefined;
    }
  }));
  return payloads.filter((payload): payload is StockDisplayPayload => !!payload);
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
