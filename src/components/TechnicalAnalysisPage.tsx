"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  isTechnicalAnalysisPayload,
  technicalCoverageLabel,
  technicalSignals,
  technicalStatusCopy,
  technicalSummaryBullets,
  technicalToneLabel,
  technicalWarnings,
  normalizedTone,
} from "@/components/technicalAnalysisHelpers";
import TechnicalOverlayChart from "@/components/TechnicalOverlayChart";
import { snapshotPendingFromPayload, stringFromUnknown, type SnapshotPendingState } from "@/components/stockDashboardHelpers";
import { formatValue } from "@/lib/format";
import type { StockScoreResponse } from "@/lib/types";

type LoadState =
  | { status: "loading"; data?: undefined; error?: undefined; pending?: undefined }
  | { status: "success"; data: StockScoreResponse; error?: undefined; pending?: undefined }
  | { status: "pending"; data?: undefined; error?: undefined; pending: SnapshotPendingState }
  | { status: "error"; data?: undefined; error: string; pending?: undefined };

type ApiPayload = Record<string, unknown>;

async function readApiPayload(response: Response): Promise<ApiPayload> {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error(response.ok ? "서버 응답이 비어 있어요." : `서버 응답이 비어 있어요. (HTTP ${response.status})`);
  }

  try {
    const payload = JSON.parse(text) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("non_object_payload");
    return payload as ApiPayload;
  } catch {
    throw new Error(response.ok ? "서버 응답 형식이 올바르지 않아요." : `서버 오류 응답을 읽지 못했어요. (HTTP ${response.status})`);
  }
}

function apiPayloadMessage(payload: ApiPayload, fallback: string): string {
  return stringFromUnknown(payload.message) || stringFromUnknown(payload.error) || fallback;
}

export default function TechnicalAnalysisPage({ ticker }: { ticker: string }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reloadVersion, setReloadVersion] = useState(0);
  const detailHref = `/?ticker=${encodeURIComponent(ticker)}`;

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ ticker, view: "technical" });
    setState({ status: "loading" });

    fetch(`/api/score?${query.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await readApiPayload(response);
        const redirectTo = stringFromUnknown(payload.redirect_to);
        if (!response.ok && payload.error === "technical_unsupported_product" && redirectTo) {
          window.location.assign(redirectTo);
          return undefined;
        }
        const pending = snapshotPendingFromPayload(payload, ticker);
        if (pending) {
          setState({ status: "pending", pending });
          return undefined;
        }
        if (!response.ok) throw new Error(apiPayloadMessage(payload, `HTTP ${response.status}`));
        return payload as StockScoreResponse;
      })
      .then((data) => {
        if (!data) return;
        if (!isTechnicalAnalysisPayload(data.technical_analysis)) {
          throw new Error("기술적 분석 데이터를 찾지 못했어요.");
        }
        setState({ status: "success", data });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", error: error instanceof Error ? error.message : "기술적 분석을 불러오지 못했어요." });
      });

    return () => controller.abort();
  }, [ticker, reloadVersion]);

  const data = state.status === "success" ? state.data : undefined;
  const technical = isTechnicalAnalysisPayload(data?.technical_analysis) ? data.technical_analysis : undefined;
  const signals = useMemo(() => technicalSignals(technical), [technical]);
  const warnings = technicalWarnings(technical);
  const bullets = technicalSummaryBullets(technical);
  const summaryTone = normalizedTone(String(technical?.summary?.tone || ""));
  const confluenceScore = typeof technical?.confluence?.score === "number" ? Math.max(0, Math.min(100, technical.confluence.score)) : undefined;

  return (
    <main className="stock-app stock-detail-app technical-analysis-app">
      <header className="technical-topbar">
        <a href={detailHref}>상세로 돌아가기</a>
        <span>{ticker}</span>
      </header>

      {state.status === "loading" ? <TechnicalStatus title="기술적 분석 준비 중" body="차트 데이터를 확인하고 있어요." /> : null}
      {state.status === "pending" ? (
        <TechnicalStatus title="데이터 준비 중" body={state.pending.message} actionLabel="다시 확인" onAction={() => setReloadVersion((version) => version + 1)} />
      ) : null}
      {state.status === "error" ? (
        <TechnicalStatus title="조회할 수 없어요" body={state.error} tone="error" actionLabel="다시 시도" onAction={() => setReloadVersion((version) => version + 1)} />
      ) : null}

      {data && technical ? (
        <div className="technical-feed">
          <section className={`technical-hero ${summaryTone}`}>
            <div className="technical-hero-heading">
              <span>기술적 분석</span>
              <h1>{data.name || data.symbol || ticker}</h1>
              <p>{data.exchange || data.market} · {data.symbol || ticker}</p>
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

          {warnings.length ? (
            <section className="technical-warning">
              <strong>데이터 해석 범위</strong>
              {warnings.map((warning) => <p key={warning}>{warning}</p>)}
            </section>
          ) : null}

          <TechnicalOverlayChart points={data.chart_series} technical={technical} />

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

          {technical.glossary?.length ? (
            <section className="technical-glossary">
              <div className="section-title">
                <span>용어</span>
                <h2>짧게 이해하기</h2>
              </div>
              <div>
                {technical.glossary.map((item) => (
                  <article key={item.term}>
                    <strong>{item.term}</strong>
                    <p>{item.meaning}</p>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}

function TechnicalStatus({
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
