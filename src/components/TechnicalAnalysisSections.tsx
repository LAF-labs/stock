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
import { formatValue } from "@/lib/format";
import type { TechnicalAnalysisPayload } from "@/lib/technicalAnalysisTypes";
import type { StockHeaderIdentity } from "@/components/stockDashboardHelpers";
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
  return (
    <section className={`technical-hero ${summaryTone}`}>
      <div className="technical-hero-heading">
        <span>기술적 분석</span>
        <h1>{identity?.primary || data.name || data.symbol || displayTicker}</h1>
        <p>{data.exchange || data.market} · {identity?.secondary || data.symbol || displayTicker}</p>
      </div>
      <div className="technical-hero-price">
        <span>현재가</span>
        <strong>{formatValue(data.latest_price)}</strong>
        <small>{data.latest_bar_date || technical.closed_bar_date || "-"}</small>
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
