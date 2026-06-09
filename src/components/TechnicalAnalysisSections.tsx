"use client";

import type { CSSProperties } from "react";
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
    <div className="technical-feed loading-status-feed" role="status" aria-live="polite">
      <section className="technical-hero neutral technical-pending-hero">
        <div className="technical-hero-heading">
          <span>기술적 분석</span>
          <h1>{title}</h1>
          <p>{body || "차트 데이터를 확인하고 있어요."}</p>
        </div>
        <div className="technical-hero-price">
          <span>상태</span>
          <strong>준비 중</strong>
          <small>가격 데이터가 먼저 확인되면 이 화면에 바로 채워집니다.</small>
        </div>
        <div className="technical-summary">
          <span>진행 상태</span>
          <strong>요청을 확인하고 있어요.</strong>
          <p>{body || "가격과 차트 데이터를 불러오는 중이에요."}</p>
          {actionLabel && onAction ? (
            <button type="button" className="technical-pending-action" onClick={onAction}>
              {actionLabel}
            </button>
          ) : null}
        </div>
      </section>
      <section className="technical-chart-panel technical-rule-pending">
        <div className="section-title">
          <span>가격 캔들</span>
          <h2>데이터 확인 중</h2>
        </div>
        <p>응답 가능한 데이터부터 순서대로 표시합니다.</p>
      </section>
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
      <section className="technical-rule-section technical-rule-pending" role="status" aria-live="polite">
        <div className="section-title">
          <span>룰 기반 해석</span>
          <h2>보조지표 준비 중</h2>
        </div>
        <div className="technical-signal-grid">
          {["추세", "모멘텀", "리스크"].map((label) => (
            <article key={label} className="technical-signal-card neutral technical-pending-card">
              <div>
                <span>{label}</span>
                <strong>준비 중</strong>
              </div>
              <p>가격 기록을 확인한 뒤 신호를 채웁니다.</p>
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
