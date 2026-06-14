"use client";

import type { CSSProperties, ReactNode } from "react";
import {
  dailyChangeText,
  dailyToneClass,
  formatPrimaryPrice,
  formatSecondaryPrice,
  hasDisplayableScoreComponents,
  opportunityExtremes,
  riskLevelLabel,
  scoreConfidenceChips,
  scoreDataWithQuote,
  signalLabel,
  stockHeaderFreshnessTimeChip,
  strongestAndWeakest,
  stringFromUnknown,
  stockHeaderIdentity,
  stockMarketCapDisplay,
} from "@/components/stockDashboardHelpers";
import { clampScore } from "@/lib/format";
import type { StockQuoteResponse, StockScoreResponse } from "@/lib/types";

export type QuoteState =
  | { status: "idle" | "loading"; data?: undefined; error?: undefined }
  | { status: "success"; data: StockQuoteResponse; error?: undefined }
  | { status: "pending"; data?: undefined; error?: undefined; pending: { message: string } }
  | { status: "error"; data?: undefined; error: string };

export type PriceRefreshState = {
  status: "idle" | "refreshing" | "success" | "cooldown" | "pending" | "error";
  message?: string;
  nextAllowedAt?: string;
};

export default function StockHeader({
  data,
  quote,
  quoteState,
  priceRefreshState,
  onRefreshPrice,
}: {
  data: StockScoreResponse;
  quote: StockQuoteResponse | undefined;
  quoteState: QuoteState;
  priceRefreshState: PriceRefreshState;
  onRefreshPrice: () => void;
}) {
  const displayData = scoreDataWithQuote(data, quote);
  const rawQualityScore = displayData.quality_score ?? displayData.score;
  const hasQualityScoreEvidence = hasDisplayableScoreComponents(displayData.components);
  const hasOpportunityScoreEvidence = hasDisplayableScoreComponents(displayData.opportunity_components);
  const qualityScore = hasQualityScoreEvidence && typeof rawQualityScore === "number" && Number.isFinite(rawQualityScore) ? clampScore(rawQualityScore) : undefined;
  const opportunityScore = hasOpportunityScoreEvidence && typeof displayData.opportunity_score === "number" ? clampScore(displayData.opportunity_score) : undefined;
  const identity = stockHeaderIdentity(data, quote);
  const primaryPrice = formatPrimaryPrice(displayData);
  const secondaryPrice = formatSecondaryPrice(displayData);
  const daily = dailyChangeText(data, quote);
  const latestBarDate = stringFromUnknown(quote?.latest_bar_date) || data.latest_bar_date;
  const refreshDisabled = priceRefreshState.status === "refreshing" || priceRefreshState.status === "cooldown" || priceRefreshState.status === "pending";
  const refreshTitle =
    priceRefreshState.status === "refreshing"
      ? "현재가 새로고침 중"
      : priceRefreshState.status === "cooldown"
        ? priceRefreshState.message || "새로고침 제한"
        : "최신 현재가로 새로고침";
  const quoteStatusMessage = quoteState.status === "error" ? `현재가 업데이트 실패: ${quoteState.error}` : undefined;
  const marketCap = stockMarketCapDisplay(displayData);
  const signal = signalLabel(displayData.sia_snapshot?.raw_signal);
  const risk = riskLevelLabel(displayData.sia_snapshot?.risk_level);
  const { strongest, weakest } = strongestAndWeakest(displayData);
  const opportunity = opportunityExtremes(displayData.opportunity_components);
  const headerTime = stockHeaderFreshnessTimeChip(data, quote);
  const confidenceChips = scoreConfidenceChips(displayData);
  const qualityConfidence = confidenceChips.find((chip) => chip.label === "품질 근거");
  const opportunityConfidence = confidenceChips.find((chip) => chip.label === "기회 근거");
  const scoreEvidenceMissing = qualityScore === undefined && opportunityScore === undefined;

  return (
    <section className="stock-title-card">
      <div className="stock-hero-main">
        <div className="stock-name-row">
          <div>
            <span>
              {quote?.exchange || data.exchange || "미국 거래소"} · {latestBarDate || "최근 가격"}
            </span>
            <h2 className={identity.primaryKind === "name" ? "name-primary" : "ticker-primary"}>{identity.primary}</h2>
            {identity.secondary ? <p>{identity.secondary}</p> : null}
          </div>
        </div>
        <div className="stock-header-toolbar">
          {headerTime ? <span className="score-time-chip">{headerTime}</span> : null}
          <button type="button" className="quote-refresh-button" onClick={onRefreshPrice} disabled={refreshDisabled} title={refreshTitle} aria-label={refreshTitle}>
            ↻
          </button>
        </div>
      </div>

      <div className="price-strip">
        <div className="price-block">
          <strong>{primaryPrice}</strong>
          <span>{secondaryPrice}</span>
        </div>
        <em className={`daily-pill ${dailyToneClass(daily)}`}>{daily}</em>
      </div>
      {priceRefreshState.message ? (
        <p className={`quote-refresh-note ${priceRefreshState.status}`} role="status" aria-live="polite">
          {priceRefreshState.message}
        </p>
      ) : quoteStatusMessage ? (
        <p className={`quote-refresh-note ${quoteState.status}`} role={quoteState.status === "error" ? "alert" : "status"} aria-live="polite">
          {quoteStatusMessage}
        </p>
      ) : null}

      <div className="quick-read">
        <article className="quick-metric-card">
          <span>강점</span>
          <strong>{strongest?.label || (scoreEvidenceMissing ? "판단 보류" : "-")}</strong>
        </article>
        <article className="quick-metric-card">
          <span>먼저 볼 것</span>
          <strong>{weakest?.label || (scoreEvidenceMissing ? "자료 부족" : "-")}</strong>
        </article>
        <article className="quick-metric-card">
          <span>시가총액</span>
          <strong>{marketCap.primary}</strong>
          {marketCap.secondary ? <small>{marketCap.secondary}</small> : null}
        </article>
        {qualityScore !== undefined ? (
          <ScoreInsightPanel
            tone="quality"
            label="품질 점수"
            score={qualityScore}
            title={qualityScoreTitle(qualityScore)}
            description="회사의 기본 체력을 실적, 거래 안정성, 가격 부담까지 묶어서 봅니다."
          >
            <div className="score-chip-row" aria-label="품질 점수 보조 신호">
              <span>매수신호 {signal}</span>
              <span>변동성 {risk}</span>
              {qualityConfidence ? <span>{qualityConfidence.label} {String(qualityConfidence.value)}</span> : null}
            </div>
          </ScoreInsightPanel>
        ) : null}
        {opportunityScore !== undefined ? (
          <ScoreInsightPanel
            tone="opportunity"
            label="기회 점수"
            score={opportunityScore}
            title={opportunityScoreTitle(opportunityScore)}
            description="지금 보기 좋은 자리인지 가격 흐름·목표가·리스크를 함께 봅니다."
          >
            <div className="opportunity-movers" aria-label="기회 점수 핵심 근거">
              {opportunity.best ? (
                <span className="opportunity-chip best">
                  <b aria-hidden="true">좋은 근거</b>
                  {opportunity.best.label}
                </span>
              ) : null}
              {opportunity.worst ? (
                <span className="opportunity-chip worst">
                  <b aria-hidden="true">확인할 점</b>
                  {opportunity.worst.label}
                </span>
              ) : null}
            </div>
            {opportunityConfidence ? (
              <div className="score-chip-row" aria-label="기회 점수 근거 충분도">
                <span>{opportunityConfidence.label} {String(opportunityConfidence.value)}</span>
              </div>
            ) : null}
          </ScoreInsightPanel>
        ) : null}
      </div>
    </section>
  );
}

function ScoreInsightPanel({
  tone,
  label,
  score,
  title,
  description,
  children,
}: {
  tone: "quality" | "opportunity";
  label: string;
  score: number;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  const scoreStyle = { "--score-angle": `${score * 3.6}deg` } as CSSProperties;
  const donutClassName = tone === "opportunity" ? "score-donut opportunity-donut" : "score-donut";

  return (
    <article className={`score-panel ${tone === "opportunity" ? "opportunity-panel" : "quality-score-panel"}`}>
      <span className="score-panel-kicker">{label}</span>
      <div className="quality-score-visual">
        <div className={donutClassName} style={scoreStyle} role="img" aria-label={`${label} ${score.toFixed(1)}점`}>
          <span className="quality-donut-value">
            <strong>{score.toFixed(1)}</strong>
            <small>/100</small>
          </span>
        </div>
        <div className="score-panel-explain">
          <strong>{title}</strong>
          <p>{description}</p>
          {children ? <div className="score-panel-signals">{children}</div> : null}
        </div>
      </div>
    </article>
  );
}

function qualityScoreTitle(score: number): string {
  if (score >= 70) return "기본 체력이 탄탄해요";
  if (score >= 50) return "체력은 보통, 확인할 점이 있어요";
  return "기본 체력 확인이 먼저예요";
}

function opportunityScoreTitle(score: number): string {
  if (score >= 70) return "지금 살펴볼 기회가 커요";
  if (score >= 50) return "조건을 더 확인할 자리예요";
  return "아직 서두를 자리는 아니에요";
}
