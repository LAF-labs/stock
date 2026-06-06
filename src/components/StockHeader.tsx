"use client";

import type { CSSProperties } from "react";
import SkeletonBlock from "@/components/SkeletonBlock";
import {
  dailyChangeText,
  dailyToneClass,
  formatKrwPrice,
  formatUsdPrice,
  metricValue,
  opportunityExtremes,
  scoreDataWithQuote,
  scoreFreshnessTimeChip,
  strongestAndWeakest,
  stringFromUnknown,
  stockHeaderIdentity,
} from "@/components/stockDashboardHelpers";
import { clampScore, formatValue } from "@/lib/format";
import type { StockJudgment, StockQuoteResponse, StockScoreResponse } from "@/lib/types";

export type QuoteState =
  | { status: "idle" | "loading"; data?: undefined; error?: undefined }
  | { status: "success"; data: StockQuoteResponse; error?: undefined }
  | { status: "pending"; data?: undefined; error?: undefined; pending: { message: string } }
  | { status: "error"; data?: undefined; error: string };

export type QuoteRefreshState = {
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
  quoteRefreshState,
  onRefreshQuote,
  judgmentState,
}: {
  data: StockScoreResponse;
  quote: StockQuoteResponse | undefined;
  quoteState: QuoteState;
  quoteRefreshState: QuoteRefreshState;
  onRefreshQuote: () => void;
  judgmentState: JudgmentState;
}) {
  const displayData = scoreDataWithQuote(data, quote);
  const qualityScore = clampScore(data.quality_score ?? data.score);
  const opportunityScore = typeof data.opportunity_score === "number" ? clampScore(data.opportunity_score) : undefined;
  const symbol = quote?.symbol || data.symbol || data.requested_ticker || "KO";
  const identity = stockHeaderIdentity(data, quote);
  const current = stringFromUnknown(quote?.latest_price_label) || formatValue(data.latest_price);
  const usdPrice = stringFromUnknown(quote?.latest_price_label) || formatUsdPrice(displayData, current);
  const krwPrice = formatKrwPrice(displayData);
  const daily = dailyChangeText(data, quote);
  const latestBarDate = stringFromUnknown(quote?.latest_bar_date) || data.latest_bar_date;
  const refreshDisabled = quoteRefreshState.status === "refreshing" || quoteRefreshState.status === "cooldown" || quoteRefreshState.status === "pending";
  const refreshTitle =
    quoteRefreshState.status === "refreshing"
      ? "현재가 새로고침 중"
      : quoteRefreshState.status === "cooldown"
        ? quoteRefreshState.message || "새로고침 대기 중"
        : "최신 현재가로 새로고침";
  const quoteStatusMessage =
    quoteState.status === "loading"
      ? "현재가를 확인하는 중이에요."
      : quoteState.status === "pending"
        ? quoteState.pending.message
        : quoteState.status === "error"
          ? `현재가 업데이트 실패: ${quoteState.error}`
          : undefined;
  const marketCap = metricValue(data.key_metrics, "시가총액");
  const signal = data.sia_snapshot?.raw_signal || "-";
  const risk = data.sia_snapshot?.risk_level || "-";
  const { strongest, weakest } = strongestAndWeakest(data);
  const opportunity = opportunityExtremes(data.opportunity_components);
  const stockJudgment = judgmentState.status === "success" ? judgmentState.judgment : undefined;
  const scoreTime = scoreFreshnessTimeChip(data);
  const qualityScoreStyle = { "--quality-score-angle": `${qualityScore * 3.6}deg` } as CSSProperties;

  return (
    <section className="stock-title-card">
      <div className="stock-header-toolbar">
        {scoreTime ? <span className="score-time-chip">{scoreTime}</span> : null}
        <button type="button" className="quote-refresh-button" onClick={onRefreshQuote} disabled={refreshDisabled} title={refreshTitle} aria-label={refreshTitle}>
          ↻
        </button>
      </div>

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
        <em className={`daily-pill ${dailyToneClass(daily)}`}>{daily}</em>
      </div>

      <div className="price-strip">
        <div className="price-block">
          <strong>{usdPrice}</strong>
          <span>{krwPrice}</span>
        </div>
      </div>
      {quoteRefreshState.message ? (
        <p className={`quote-refresh-note ${quoteRefreshState.status}`} role="status" aria-live="polite">
          {quoteRefreshState.message}
        </p>
      ) : quoteStatusMessage ? (
        <p className={`quote-refresh-note ${quoteState.status}`} role={quoteState.status === "error" ? "alert" : "status"} aria-live="polite">
          {quoteStatusMessage}
        </p>
      ) : null}

      <div className="quick-read">
        <article>
          <span>강점</span>
          <strong>{strongest?.label || "-"}</strong>
        </article>
        <article>
          <span>먼저 볼 것</span>
          <strong>{weakest?.label || "-"}</strong>
        </article>
        <article>
          <span>시가총액</span>
          <strong>{marketCap}</strong>
        </article>
        <article className="score-panel quality-score-panel">
          <span>품질 점수</span>
          <div className="quality-score-visual">
            <div className="quality-donut" style={qualityScoreStyle} role="img" aria-label={`품질 점수 ${qualityScore.toFixed(1)}점`}>
              <span className="quality-donut-value">
                <strong>{qualityScore.toFixed(1)}</strong>
                <small>점</small>
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
          <strong>{opportunityScore === undefined ? "-" : `${opportunityScore.toFixed(1)}점`}</strong>
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
        </article>
      </div>

      <div className={`hero-verdict ${stockJudgment?.tone || "neutral"}`}>
        <span>오늘의 판단</span>
        <strong>
          {stockJudgment?.headline ||
            (judgmentState.status === "loading" ? "숫자를 읽고 있어요" : judgmentState.status === "error" ? "판단을 불러오지 못했어요" : "판단을 준비하고 있어요")}
        </strong>
        {judgmentState.status === "loading" ? (
          <div className="verdict-mini-skeleton" aria-hidden="true">
            <SkeletonBlock className="wide" />
            <SkeletonBlock className="medium" />
          </div>
        ) : (
          <p>{stockJudgment?.body || (judgmentState.status === "error" ? "잠시 후 다시 검색해보세요." : "가격, 점수, 재무 지표를 묶어서 해석하는 중이에요.")}</p>
        )}
        {stockJudgment?.watch ? <p className="verdict-watch">{stockJudgment.watch}</p> : null}
      </div>

      <a className="compare-entry" href={`/compare?tickers=${encodeURIComponent(`${data.market === "KR" ? "KR" : "US"}:${symbol}`)}`}>
        <span>나란히 비교하기</span>
        <strong>{symbol} 기준으로 보기</strong>
      </a>
    </section>
  );
}
