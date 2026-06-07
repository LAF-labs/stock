"use client";

import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { useEffect, useId, useMemo, useState } from "react";
import TradingPriceChart from "@/components/TradingPriceChart";
import {
  SOURCE_VENDOR_TEXT,
  chartSummary,
  componentWord,
  easySentence,
  factorSummary,
  formatNote,
  formatRecordValue,
  humanizeRecordKey,
  isRecordValue,
  isSourceOnlyLabel,
  termTipFor,
  usableChartPoints,
  visibleRecordEntries,
} from "@/components/stockDashboardHelpers";
import { clampScore, formatDateTimeFromEpoch, formatValue } from "@/lib/format";
import type { ChartPattern, ChartSeriesPoint, JsonValue, LabeledValue, NewsItem, ScoreComponent } from "@/lib/types";

export function ChartStory({
  points,
  patterns,
  technicalAnalysisHref,
}: {
  points: ChartSeriesPoint[] | undefined;
  patterns: ChartPattern[] | undefined;
  technicalAnalysisHref?: string;
}) {
  const usable = useMemo(() => usableChartPoints(points), [points]);
  const [chartMode, setChartMode] = useState<"line" | "candle">("line");
  const summaryId = useId();

  function onChartTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setChartMode((mode) => {
        if (event.key === "Home") return "line";
        if (event.key === "End") return "candle";
        return mode === "line" ? "candle" : "line";
      });
    }
  }

  if (usable.length < 2) {
    return <EmptyCard title="가격 흐름" body="표시할 차트 데이터가 없어요." />;
  }
  const oneYearPoints = usable.slice(-260);

  return (
    <section className="chart-story">
      <div className="chart-title-row">
        <div className="section-title">
          <span>가격 흐름</span>
          <h2>최근 1년은 이렇게 움직였어요</h2>
        </div>
        <div className="chart-mode-tabs" role="tablist" aria-label="차트 표시 방식" onKeyDown={onChartTabKeyDown}>
          <button type="button" role="tab" aria-selected={chartMode === "line"} tabIndex={chartMode === "line" ? 0 : -1} className={chartMode === "line" ? "active" : undefined} onClick={() => setChartMode("line")}>
            쉽게
          </button>
          <button type="button" role="tab" aria-selected={chartMode === "candle"} tabIndex={chartMode === "candle" ? 0 : -1} className={chartMode === "candle" ? "active" : undefined} onClick={() => setChartMode("candle")}>
            캔들
          </button>
        </div>
      </div>
      <p id={summaryId} className="sr-only">
        {chartSummary(oneYearPoints)}
      </p>
      <TradingPriceChart points={oneYearPoints} mode={chartMode} describedBy={summaryId} />
      <div className="pattern-chips">
        {(patterns || []).slice(0, 3).map((pattern) => (
          <article key={pattern.name}>
            <strong>
              {pattern.name}
              <TermHelp label={`${pattern.name || ""} ${pattern.evidence || ""} ${pattern.interpretation || ""}`} />
            </strong>
            <span>{pattern.status}</span>
            <p>{easySentence(pattern.interpretation)}</p>
          </article>
        ))}
      </div>
      {technicalAnalysisHref ? (
        <a className="technical-analysis-link" href={technicalAnalysisHref}>
          기술적 분석 보러가기
        </a>
      ) : null}
    </section>
  );
}

export function FactorStory({
  components,
  eyebrow = "점수 이유",
  title = "좋은 점과 아쉬운 점",
}: {
  components: ScoreComponent[] | undefined;
  eyebrow?: string;
  title?: string;
}) {
  if (!components?.length) return <EmptyCard title={eyebrow} body="표시할 점수 데이터가 없어요." />;
  return (
    <section className="factor-card">
      <div className="section-title">
        <span>{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      <div className="factor-list">
        {components.map((component) => {
          const score = clampScore(component.score);
          return (
            <article key={component.key || component.label}>
              <div className="factor-heading">
                <div className="factor-title">
                  <strong>{component.label || component.key}</strong>
                  <TermHelp label={component.label || component.key || ""} />
                </div>
                <span className="factor-score">
                  {score.toFixed(1)} · {componentWord(score)}
                </span>
              </div>
              <i>
                <b style={{ width: `${score}%` }} />
              </i>
              <p>{factorSummary(component)}</p>
              <ul>
                {(component.metrics || []).map((metric) => (
                  <li key={`${component.key}-${metric.label}`}>
                    <span>
                      <LabelWithTerm label={metric.label || "항목"} />
                    </span>
                    <strong>{formatValue(metric.value)}</strong>
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function SimpleList({
  title,
  description,
  items,
  defaultOpen = false,
  desktopOpen = false,
}: {
  title: string;
  description: string;
  items: LabeledValue[] | undefined;
  defaultOpen?: boolean;
  desktopOpen?: boolean;
}) {
  const visibleItems = (items || []).filter((item) => !isSourceOnlyLabel(item.label));
  if (!visibleItems.length) return <EmptyCard title={title} body="표시할 데이터가 없어요." />;
  return (
    <AccordionCard title={title} description={description} defaultOpen={defaultOpen} desktopOpen={desktopOpen}>
      <dl>
        {visibleItems.map((item, index) => (
          <div key={`${item.label}-${index}`}>
            <dt>
              <LabelWithTerm label={item.label || `항목 ${index + 1}`} />
            </dt>
            <dd>
              <strong>{formatValue(item.value)}</strong>
              {formatNote(item.note) ? <span>{formatNote(item.note)}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
    </AccordionCard>
  );
}

export function RecordCard({
  title,
  description,
  record,
  desktopOpen = false,
}: {
  title: string;
  description: string;
  record: Record<string, JsonValue> | undefined;
  desktopOpen?: boolean;
}) {
  if (!record || !visibleRecordEntries(record).length) return <EmptyCard title={title} body="표시할 데이터가 없어요." />;
  return (
    <AccordionCard title={title} description={description} desktopOpen={desktopOpen}>
      <RecordRows record={record} />
    </AccordionCard>
  );
}

function RecordRows({ record }: { record: Record<string, JsonValue> | undefined }) {
  if (!record) return null;
  return (
    <dl className="record-feed">
      {visibleRecordEntries(record).map(([key, value]) => (
        <div key={key}>
          <dt>
            <LabelWithTerm label={humanizeRecordKey(key)} />
          </dt>
          <dd>
            {isRecordValue(value) ? (
              <dl className="record-feed nested">
                {visibleRecordEntries(value).map(([nestedKey, nestedValue]) => (
                  <div key={nestedKey}>
                    <dt>
                      <LabelWithTerm label={humanizeRecordKey(nestedKey)} />
                    </dt>
                    <dd>{formatRecordValue(nestedKey, nestedValue)}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              formatRecordValue(key, value)
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function NewsFeed({ news }: { news: NewsItem[] | undefined }) {
  return (
    <section className="static-card">
      <header>
        <span>관련 소식을 최신순으로 보여줘요.</span>
        <strong>최근 뉴스</strong>
      </header>
      <div className="accordion-body">
        {news?.length ? (
          <div className="news-list">
            {news.map((item, index) => {
              const publishedAt = formatDateTimeFromEpoch(item.provider_publish_time);
              const publisher = item.publisher && !item.publisher.includes(SOURCE_VENDOR_TEXT) ? item.publisher : "News";
              return (
                <a href={safeExternalUrl(item.link)} target="_blank" rel="noopener noreferrer" key={`${item.title}-${index}`}>
                  <span>{publisher}</span>
                  <strong>{item.title || "-"}</strong>
                  {publishedAt !== "-" ? <small>{publishedAt}</small> : null}
                </a>
              );
            })}
          </div>
        ) : (
          <p className="static-empty">표시할 뉴스가 없어요.</p>
        )}
      </div>
    </section>
  );
}

function safeExternalUrl(value: string | undefined): string {
  if (!value) return "#";
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "#";
  } catch {
    return "#";
  }
}

function AccordionCard({
  title,
  description,
  children,
  defaultOpen = false,
  desktopOpen = false,
}: {
  title: string;
  description: string;
  children: ReactNode;
  defaultOpen?: boolean;
  desktopOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [isDesktop, setIsDesktop] = useState(false);
  const lockedOpen = desktopOpen && isDesktop;

  useEffect(() => {
    if (!desktopOpen) return;

    const query = window.matchMedia("(min-width: 900px)");
    const syncDesktop = () => setIsDesktop(query.matches);

    syncDesktop();
    query.addEventListener("change", syncDesktop);

    return () => query.removeEventListener("change", syncDesktop);
  }, [desktopOpen]);

  useEffect(() => {
    if (desktopOpen && !isDesktop) setIsOpen(false);
  }, [desktopOpen, isDesktop]);

  function handleSummaryClick(event: MouseEvent<HTMLElement>) {
    if (!desktopOpen) return;

    event.preventDefault();
    if (lockedOpen) return;

    setIsOpen((current) => !current);
  }

  return (
    <details
      className={`accordion-card${desktopOpen ? " desktop-open" : ""}`}
      open={lockedOpen || isOpen}
      onToggle={(event) => {
        if (!desktopOpen) setIsOpen(event.currentTarget.open);
      }}
    >
      <summary onClick={handleSummaryClick}>
        <span>{description}</span>
        <strong>{title}</strong>
        <i aria-hidden="true" />
      </summary>
      <div className="accordion-body">{children}</div>
    </details>
  );
}

function LabelWithTerm({ label }: { label: string }) {
  return (
    <span className="label-with-term">
      {label}
      <TermHelp label={label} />
    </span>
  );
}

function TermHelp({ label }: { label: string }) {
  const tip = termTipFor(label);
  if (!tip) return null;
  return <InfoTip label={`${tip.term} 설명`} body={tip.body} />;
}

function InfoTip({ label, body }: { label: string; body: string }) {
  const id = useId();
  return (
    <span className="info-tip-wrap">
      <button type="button" className="info-tip" aria-label={label} aria-describedby={id} onClick={(event) => event.stopPropagation()}>
        ?
      </button>
      <span id={id} className="info-bubble" role="tooltip">
        {body}
      </span>
    </span>
  );
}

function EmptyCard({ title, body }: { title: string; body: string }) {
  return (
    <section className="empty-card">
      <strong>{title}</strong>
      <p>{body}</p>
    </section>
  );
}
