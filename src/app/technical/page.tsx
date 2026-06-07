import { Suspense } from "react";
import { redirect } from "next/navigation";
import TechnicalAnalysisPage from "@/components/TechnicalAnalysisPage";
import { detailPathForTicker, technicalEligibilityForTicker } from "@/lib/technicalAnalysisEligibility";

type TechnicalRouteSearchParams = Record<string, string | string[] | undefined>;

type TechnicalRouteProps = {
  searchParams?: TechnicalRouteSearchParams | Promise<TechnicalRouteSearchParams>;
};

export default async function TechnicalPage({ searchParams }: TechnicalRouteProps) {
  const params = await searchParams;
  const ticker = firstParam(params?.ticker) || "US:KO";
  const eligibility = await technicalEligibilityForTicker(ticker);

  if (!eligibility.eligible) {
    redirect(detailPathForTicker(eligibility.ticker));
  }

  return (
    <Suspense fallback={<main className="page-shell">로딩 중...</main>}>
      <TechnicalAnalysisPage ticker={eligibility.ticker} />
    </Suspense>
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
