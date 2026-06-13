import type { Metadata } from "next";
import { Suspense } from "react";
import MarketCapDashboard from "@/components/MarketCapDashboard";

export const metadata: Metadata = {
  title: "시가총액 대시보드",
  description: "국내와 해외 상위 시가총액 종목을 한 시간 단위 스냅샷으로 확인합니다.",
};

export default function MarketCapPage() {
  return (
    <Suspense fallback={<main className="stock-app market-cap-app" />}>
      <MarketCapDashboard />
    </Suspense>
  );
}
