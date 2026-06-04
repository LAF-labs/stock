import { Suspense } from "react";
import StockCompare from "@/components/StockCompare";

export default function ComparePage() {
  return (
    <Suspense fallback={<main className="page-shell">로딩 중...</main>}>
      <StockCompare />
    </Suspense>
  );
}
