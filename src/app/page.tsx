import { Suspense } from "react";
import StockDashboard from "@/components/StockDashboard";

export default function Page() {
  return (
    <Suspense fallback={<main className="page-shell">로딩 중...</main>}>
      <StockDashboard />
    </Suspense>
  );
}
