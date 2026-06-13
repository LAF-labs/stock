import type { Metadata } from "next";
import { cache } from "react";
import StockCompare from "@/components/StockCompare";
import { parseTickers } from "@/components/stockCompareHelpers";
import { scheduleStockDisplayPayloadCompletionDetached } from "@/lib/stockCompletionPlanner";
import { buildStockDisplayPayload } from "@/lib/stockDisplayModel";
import { compareShareMetadataFromPayloads, stockShareMetadataToNextMetadata, stockShareOriginFromEnv } from "@/lib/stockShareMetadata";
import type { StockDisplayPayload } from "@/lib/stockDisplayTypes";

type CompareRouteSearchParams = Record<string, string | string[] | undefined>;

type CompareRouteProps = {
  searchParams?: CompareRouteSearchParams | Promise<CompareRouteSearchParams>;
};

export default async function ComparePage({ searchParams }: CompareRouteProps) {
  const params = await searchParams;
  const tickersParam = firstParam(params?.tickers) || firstParam(params?.ticker) || "";
  const initialDisplayPayloads = await buildInitialComparePayloads(tickersParam);

  return <StockCompare initialDisplayPayloads={initialDisplayPayloads} />;
}

export async function generateMetadata({ searchParams }: CompareRouteProps): Promise<Metadata> {
  const params = await searchParams;
  const tickersParam = firstParam(params?.tickers) || firstParam(params?.ticker) || "";
  const tickers = parseTickers(tickersParam);
  const payloads = await buildInitialComparePayloads(tickersParam);
  return stockShareMetadataToNextMetadata(compareShareMetadataFromPayloads(payloads, {
    origin: stockShareOriginFromEnv(),
    tickers,
  }));
}

const buildInitialComparePayloads = cache(async function buildInitialComparePayloads(tickersParam: string): Promise<StockDisplayPayload[]> {
  const tickers = parseTickers(tickersParam);
  const payloads = await Promise.all(tickers.map(async (ticker) => {
    try {
      const payload = await buildStockDisplayPayload({ ticker, view: "compare" });
      scheduleStockDisplayPayloadCompletionDetached(payload);
      return payload;
    } catch {
      return undefined;
    }
  }));
  return payloads.filter((payload): payload is StockDisplayPayload => !!payload);
});

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
