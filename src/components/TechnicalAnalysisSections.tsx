"use client";

import type { CSSProperties } from "react";
import SkeletonBlock from "@/components/SkeletonBlock";
import {
  normalizedTone,
  technicalCoverageLabel,
  technicalSignals,
  technicalStatusCopy,
  technicalSummaryBullets,
  technicalToneLabel,
  technicalWarnings,
} from "@/components/technicalAnalysisHelpers";
import TechnicalOverlayChart from "@/components/TechnicalOverlayChart";
import type { TechnicalAnalysisPayload } from "@/lib/technicalAnalysisTypes";
import {
  formatPrimaryPrice,
  formatSecondaryPrice,
  usableChartPoints,
  type SnapshotPendingState,
  type StockHeaderIdentity,
} from "@/components/stockDashboardHelpers";
import type { StockScoreResponse } from "@/lib/types";

export function TechnicalAnalysisTopbar({ detailHref, displayTicker }: { detailHref: string; displayTicker: string }) {
  return (
    <header className="technical-topbar">
      <a href={detailHref}>상세로 돌아가기</a>
      <span>{displayTicker}</span>
    </header>
  );
}

export function TechnicalStatus({
  title,
  body,
  tone = "default",
  actionLabel,
  onAction,
}: {
  title: string;
  body: string;
  tone?: "default" | "error";
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <section className={`app-status ${tone}`} role={tone === "error" ? "alert" : "status"}>
      <strong>{title}</strong>
      <p>{body}</p>
      {actionLabel && onAction ? (
        <button type="button" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </section>
  );
}

export function TechnicalAnalysisSkeleton({
  title = "기술적 분석 준비 중",
  body,
  actionLabel,
  onAction,
}: {
  title?: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="technical-feed skeleton-feed" role="status" aria-live="polite" aria-busy="true">
      {body ? <span className="sr-only">{body}</span> : null}
      <section className="technical-hero technical-skeleton-hero">
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
      <section className="technical-chart-panel">
        <div className="section-title">
          <SkeletonBlock className="label" />
          <SkeletonBlock className="section-heading" />
        </div>
        <SkeletonBlock className="chart-area" />
      </section>
      {body ? (
        <div className="skeleton-pending-action">
          <span>{title}</span>
          <p>{body}</p>
          {actionLabel && onAction ? (
            <button type="button" onClick={onAction}>
              {actionLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function TechnicalAnalysisFeed({
  data,
  technical,
  identity,
  displayTicker,
}: {
  data: StockScoreResponse;
  technical: TechnicalAnalysisPayload;
  identity: StockHeaderIdentity | undefined;
  displayTicker: string;
}) {
  const signals = technicalSignals(technical);
  const warnings = technicalWarnings(technical);
  const bullets = technicalSummaryBullets(technical);
  const summaryTone = normalizedTone(String(technical.summary?.tone || ""));
  const confluenceScore = typeof technical.confluence?.score === "number" ? Math.max(0, Math.min(100, technical.confluence.score)) : undefined;

  return (
    <div className="technical-feed">
      <TechnicalHero
        data={data}
        technical={technical}
        identity={identity}
        displayTicker={displayTicker}
        bullets={bullets}
        summaryTone={summaryTone}
        confluenceScore={confluenceScore}
      />
      <TechnicalWarnings warnings={warnings} />
      <TechnicalOverlayChart points={data.chart_series} technical={technical} />
      <TechnicalRuleSection signals={signals} />
      <TechnicalGlossary glossary={technical.glossary} />
    </div>
  );
}

export function TechnicalAnalysisPendingFeed({
  data,
  pending,
  identity,
  displayTicker,
  onRetry,
}: {
  data: StockScoreResponse;
  pending: SnapshotPendingState;
  identity: StockHeaderIdentity | undefined;
  displayTicker: string;
  onRetry: () => void;
}) {
  const chartPointCount = usableChartPoints(data.chart_series).length;
  const limitedWarnings =
    chartPointCount > 1 && chartPointCount < 80
      ? ["상장 후 가격 기록이 아직 짧아요. 이동평균, 피보나치, FVG/OB 같은 신호는 충분한 봉이 쌓이면 더 안정적으로 표시됩니다."]
      : [];

  return (
    <div className="technical-feed">
      <section className="technical-hero neutral technical-pending-hero">
        <div className="technical-hero-heading">
          <span>기술적 분석</span>
          <h1>{identity?.primary || data.name || data.symbol || displayTicker}</h1>
          <p>{data.exchange || data.market || "시장"} · {identity?.secondary || data.symbol || displayTicker}</p>
        </div>
        <div className="technical-hero-price">
          <span>현재가</span>
          <strong>{formatPrimaryPrice(data)}</strong>
          <small>{[formatSecondaryPrice(data), data.latest_bar_date].filter(Boolean).join(" · ")}</small>
        </div>
        <div className="technical-summary">
          <span>분석 준비 중</span>
          <strong>가격 캔들부터 먼저 보여드려요.</strong>
          <p>{pending.message}</p>
          <button type="button" className="technical-pending-action" onClick={onRetry}>
            다시 확인
          </button>
        </div>
      </section>
      {limitedWarnings.length ? <TechnicalWarnings warnings={limitedWarnings} /> : null}
      <TechnicalOverlayChart points={data.chart_series} />
      <section className="technical-rule-section technical-rule-skeleton" role="status" aria-live="polite" aria-busy="true">
        <div className="section-title">
          <span>룰 기반 해석</span>
          <h2>보조지표를 계산하고 있어요</h2>
        </div>
        <div className="technical-signal-grid">
          {[0, 1, 2].map((item) => (
            <article key={item} className="technical-signal-card neutral">
              <div>
                <SkeletonBlock className="label" />
                <SkeletonBlock className="value" />
              </div>
              <SkeletonBlock className="wide" />
              <SkeletonBlock className="medium" />
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function TechnicalHero({
  data,
  technical,
  identity,
  displayTicker,
  bullets,
  summaryTone,
  confluenceScore,
}: {
  data: StockScoreResponse;
  technical: TechnicalAnalysisPayload;
  identity: StockHeaderIdentity | undefined;
  displayTicker: string;
  bullets: string[];
  summaryTone: string;
  confluenceScore: number | undefined;
}) {
  const priceMeta = [formatSecondaryPrice(data), data.latest_bar_date || technical.closed_bar_date || "-"].filter(Boolean).join(" · ");
  return (
    <section className={`technical-hero ${summaryTone}`}>
      <div className="technical-hero-heading">
        <span>기술적 분석</span>
        <h1>{identity?.primary || data.name || data.symbol || displayTicker}</h1>
        <p>{data.exchange || data.market} · {identity?.secondary || data.symbol || displayTicker}</p>
      </div>
      <div className="technical-hero-price">
        <span>현재가</span>
        <strong>{formatPrimaryPrice(data)}</strong>
        <small>{priceMeta}</small>
      </div>
      <div className="technical-summary">
        <span>{technicalCoverageLabel(technical)}</span>
        <strong>{technical.summary.headline}</strong>
        <p>{technicalStatusCopy(technical)}</p>
        {bullets.length ? (
          <ul>
            {bullets.map((item) => <li key={item}>{item}</li>)}
          </ul>
        ) : null}
      </div>
      {confluenceScore !== undefined ? (
        <div className="technical-score-meter" style={{ "--technical-score": `${confluenceScore}%` } as CSSProperties}>
          <span>종합 신호</span>
          <strong>{confluenceScore.toFixed(1)}</strong>
          <p>{technical.confluence?.label || "중립"}</p>
        </div>
      ) : null}
    </section>
  );
}

function TechnicalWarnings({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null;

  return (
    <section className="technical-warning">
      <strong>데이터 해석 범위</strong>
      {warnings.map((warning) => <p key={warning}>{warning}</p>)}
    </section>
  );
}

function TechnicalRuleSection({ signals }: { signals: ReturnType<typeof technicalSignals> }) {
  return (
    <section className="technical-rule-section">
      <div className="section-title">
        <span>룰 기반 해석</span>
        <h2>핵심 신호만 빠르게 보기</h2>
      </div>
      <div className="technical-signal-grid">
        {signals.map((signal) => (
          <article key={`${signal.key}-${signal.title}`} className={`technical-signal-card ${signal.tone}`}>
            <div>
              <span>{technicalToneLabel(signal.tone)}</span>
              <strong>{signal.title}</strong>
            </div>
            <p>{signal.plain}</p>
            <dl>
              <div>
                <dt>근거</dt>
                <dd>{signal.evidence}</dd>
              </div>
              <div>
                <dt>룰</dt>
                <dd>{signal.rule}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}

function TechnicalGlossary({ glossary }: { glossary: TechnicalAnalysisPayload["glossary"] }) {
  if (!glossary?.length) return null;

  return (
    <section className="technical-glossary">
      <div className="section-title">
        <span>용어</span>
        <h2>짧게 이해하기</h2>
      </div>
      <div>
        {glossary.map((item) => (
          <article key={item.term}>
            <strong>{item.term}</strong>
            <p>{item.meaning}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
