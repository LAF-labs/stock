import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cache } from "react";
import TechnicalAnalysisPage from "@/components/TechnicalAnalysisPage";
import { scheduleStockDisplayPayloadCompletion } from "@/lib/stockCompletionPlanner";
import { buildStockDisplayPayload } from "@/lib/stockDisplayModel";
import { stockShareMetadataFromPayload, stockShareMetadataToNextMetadata, stockShareOriginFromEnv } from "@/lib/stockShareMetadata";
import { detailPathForTicker, technicalEligibilityForTicker } from "@/lib/technicalAnalysisEligibility";

type TechnicalRouteSearchParams = Record<string, string | string[] | undefined>;

type TechnicalRouteProps = {
  searchParams?: TechnicalRouteSearchParams | Promise<TechnicalRouteSearchParams>;
};

export default async function TechnicalPage({ searchParams }: TechnicalRouteProps) {
  const params = await searchParams;
  const rawTicker = firstParam(params?.ticker)?.trim();
  if (!rawTicker) {
    redirect("/");
  }
  const eligibility = await technicalEligibilityForTicker(rawTicker);

  if (!eligibility.eligible) {
    redirect(detailPathForTicker(eligibility.ticker));
  }

  const initialDisplayPayload = await buildInitialTechnicalPayload(eligibility.ticker);

  return <TechnicalAnalysisPage ticker={eligibility.ticker} initialDisplayPayload={initialDisplayPayload} />;
}

export async function generateMetadata({ searchParams }: TechnicalRouteProps): Promise<Metadata> {
  const params = await searchParams;
  const rawTicker = firstParam(params?.ticker)?.trim();
  if (!rawTicker) {
    return stockShareMetadataToNextMetadata(stockShareMetadataFromPayload(undefined, {
      origin: stockShareOriginFromEnv(),
      pathname: "/technical",
    }));
  }
  const eligibility = await technicalEligibilityForTicker(rawTicker);
  const payload = eligibility.eligible ? await buildInitialTechnicalPayload(eligibility.ticker) : undefined;
  return stockShareMetadataToNextMetadata(stockShareMetadataFromPayload(payload, {
    origin: stockShareOriginFromEnv(),
    pathname: "/technical",
  }));
}

const buildInitialTechnicalPayload = cache(async function buildInitialTechnicalPayload(ticker: string) {
  try {
    const payload = await buildStockDisplayPayload({ ticker, view: "technical" });
    scheduleStockDisplayPayloadCompletion(payload);
    return payload;
  } catch {
    return undefined;
  }
});

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
