"use client";

import type { CSSProperties } from "react";
import {
  dailyChangeText,
  dailyToneClass,
  formatPrimaryPrice,
  formatSecondaryPrice,
  opportunityExtremes,
  riskLevelLabel,
  scoreDataWithQuote,
  signalLabel,
  stockHeaderFreshnessTimeChip,
  strongestAndWeakest,
  stringFromUnknown,
  stockHeaderIdentity,
  stockMarketCapDisplay,
} from "@/components/stockDashboardHelpers";
import { clampScore } from "@/lib/format";
import type { StockJudgment, StockQuoteResponse, StockScoreResponse } from "@/lib/types";

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

export type JudgmentState =
  | { status: "idle" | "loading"; judgment?: undefined; error?: undefined }
  | { status: "success"; judgment: StockJudgment; error?: undefined }
  | { status: "error"; judgment?: undefined; error: string };

export default function StockHeader({
  data,
  quote,
  quoteState,
  priceRefreshState,
  onRefreshPrice,
  judgmentState,
  compareHref,
}: {
  data: StockScoreResponse;
  quote: StockQuoteResponse | undefined;
  quoteState: QuoteState;
  priceRefreshState: PriceRefreshState;
  onRefreshPrice: () => void;
  judgmentState: JudgmentState;
  compareHref?: string;
}) {
  const displayData = scoreDataWithQuote(data, quote);
  const qualityScore = clampScore(data.quality_score ?? data.score);
  const opportunityScore = typeof data.opportunity_score === "number" ? clampScore(data.opportunity_score) : undefined;
  const symbol = quote?.symbol || data.symbol || data.requested_ticker || "KO";
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
        ? priceRefreshState.message || "새로고침 대기 중"
        : "최신 현재가로 새로고침";
  const quoteStatusMessage =
    quoteState.status === "loading"
      ? "현재가를 확인하는 중이에요."
      : quoteState.status === "pending"
        ? quoteState.pending.message
        : quoteState.status === "error"
          ? `현재가 업데이트 실패: ${quoteState.error}`
          : undefined;
  const marketCap = stockMarketCapDisplay(data);
  const signal = signalLabel(data.sia_snapshot?.raw_signal);
  const risk = riskLevelLabel(data.sia_snapshot?.risk_level);
  const { strongest, weakest } = strongestAndWeakest(data);
  const opportunity = opportunityExtremes(data.opportunity_components);
  const stockJudgment = judgmentState.status === "success" ? judgmentState.judgment : undefined;
  const headerTime = stockHeaderFreshnessTimeChip(data, quote);
  const qualityScoreStyle = { "--score-angle": `${qualityScore * 3.6}deg` } as CSSProperties;
  const opportunityScoreStyle = { "--score-angle": `${(opportunityScore ?? 0) * 3.6}deg` } as CSSProperties;

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
          <strong>{strongest?.label || "-"}</strong>
        </article>
        <article className="quick-metric-card">
          <span>먼저 볼 것</span>
          <strong>{weakest?.label || "-"}</strong>
        </article>
        <article className="quick-metric-card">
          <span>시가총액</span>
          <strong>{marketCap.primary}</strong>
          {marketCap.secondary ? <small>{marketCap.secondary}</small> : null}
        </article>
        <article className="score-panel quality-score-panel">
          <span>품질 점수</span>
          <div className="quality-score-visual">
            <div className="score-donut" style={qualityScoreStyle} role="img" aria-label={`품질 점수 ${qualityScore.toFixed(1)}점`}>
              <span className="quality-donut-value">
                <strong>{qualityScore.toFixed(1)}</strong>
              </span>
            </div>
            <div className="score-chip-row" aria-label="품질 점수 보조 신호">
              <span>매수신호 {signal}</span>
              <span>변동성 {risk}</span>
            </div>
          </div>
        </article>
        <article className="score-panel opportunity-panel">
          <span>기회 점수</span>
          <div className="quality-score-visual">
            <div className="score-donut opportunity-donut" style={opportunityScoreStyle} role="img" aria-label={`기회 점수 ${opportunityScore === undefined ? "없음" : `${opportunityScore.toFixed(1)}점`}`}>
              <span className="quality-donut-value">
                <strong>{opportunityScore === undefined ? "-" : opportunityScore.toFixed(1)}</strong>
              </span>
            </div>
            <div className="opportunity-movers" aria-label="기회 점수 최고 및 최저 항목">
              {opportunity.best ? (
                <span className="opportunity-chip best">
                  <b aria-hidden="true">↗</b>
                  {opportunity.best.label}
                </span>
              ) : null}
              {opportunity.worst ? (
                <span className="opportunity-chip worst">
                  <b aria-hidden="true">↘</b>
                  {opportunity.worst.label}
                </span>
              ) : null}
            </div>
          </div>
        </article>
      </div>

      <div className={`hero-verdict ${stockJudgment?.tone || "neutral"}`}>
        <span>오늘의 판단</span>
        <strong>
          {stockJudgment?.headline ||
            (judgmentState.status === "loading" ? "숫자를 읽고 있어요" : judgmentState.status === "error" ? "판단을 불러오지 못했어요" : "판단을 준비하고 있어요")}
        </strong>
        <p>
          {stockJudgment?.body ||
            (judgmentState.status === "error"
              ? "잠시 후 다시 검색해보세요."
              : judgmentState.status === "loading"
                ? "가격, 점수, 재무 지표를 묶어서 해석하고 있어요."
                : "가격, 점수, 재무 지표를 묶어서 해석하는 중이에요.")}
        </p>
        {stockJudgment?.watch ? <p className="verdict-watch">{stockJudgment.watch}</p> : null}
        {compareHref ? (
          <a className="stock-mobile-action stock-verdict-action" href={compareHref}>
            다른 종목과 비교하기
          </a>
        ) : null}
      </div>
    </section>
  );
}
