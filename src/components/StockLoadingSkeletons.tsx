import SkeletonBlock from "@/components/SkeletonBlock";

export function SkeletonSectionTitle() {
  return (
    <div className="section-title">
      <SkeletonBlock className="label" />
      <SkeletonBlock className="section-heading" />
    </div>
  );
}

export function ComparePendingOverviewSkeleton() {
  return (
    <section className="compare-section compare-brief">
      <span className="sr-only">비교 화면을 구성하고 있습니다.</span>
      <SkeletonSectionTitle />
      <SkeletonBlock className="wide" />
      <SkeletonBlock className="medium" />
    </section>
  );
}

export function TechnicalAnalysisLoadingSkeleton() {
  return (
    <div className="technical-feed loading-status-feed skeleton-feed" role="status" aria-live="polite">
      <span className="sr-only">기술적 분석 화면을 구성하고 있습니다.</span>
      <section className="technical-hero neutral technical-pending-hero">
        <div className="technical-hero-heading">
          <SkeletonBlock className="label" />
          <SkeletonBlock className="ticker" />
          <SkeletonBlock className="company" />
        </div>
        <div className="technical-hero-price">
          <SkeletonBlock className="label" />
          <SkeletonBlock className="price" />
          <SkeletonBlock className="krw" />
        </div>
        <div className="technical-summary">
          <SkeletonBlock className="label" />
          <SkeletonBlock className="headline" />
          <SkeletonBlock className="wide" />
          <SkeletonBlock className="medium" />
        </div>
      </section>
      <section className="technical-chart-panel technical-rule-pending">
        <SkeletonSectionTitle />
        <SkeletonBlock className="chart-area" />
      </section>
    </div>
  );
}

export function StockDetailLoadingSkeleton({ tickerLabel }: { tickerLabel?: string }) {
  return (
    <div className="stock-feed loading-status-feed skeleton-feed" role="status" aria-live="polite">
      <span className="sr-only">상세 화면을 구성하고 있습니다.</span>
      <section className="stock-title-card partial-stock-title-card skeleton-title-card">
        <div className="stock-hero-main">
          <div className="stock-name-row">
            <div>
              <SkeletonBlock className="label" />
              {tickerLabel ? <h2>{tickerLabel}</h2> : <SkeletonBlock className="company" />}
              <SkeletonBlock className="medium" />
            </div>
          </div>
          <SkeletonBlock className="pill" />
        </div>
        <div className="price-strip">
          <div className="price-block">
            <SkeletonBlock className="price" />
            <SkeletonBlock className="medium" />
          </div>
          <SkeletonBlock className="pill" />
        </div>
        <div className="quick-read">
          {["strength", "watch", "market-cap", "score"].map((key) => (
            <article key={key}>
              <SkeletonBlock className="label" />
              <SkeletonBlock className={key === "score" ? "score" : "medium"} />
            </article>
          ))}
        </div>
      </section>
      <section className="chart-story partial-pending-section">
        <SkeletonSectionTitle />
        <SkeletonBlock className="chart-area" />
      </section>
      <section className="factor-card partial-pending-section">
        <SkeletonSectionTitle />
        <SkeletonBlock className="wide" />
        <SkeletonBlock className="medium" />
      </section>
    </div>
  );
}
