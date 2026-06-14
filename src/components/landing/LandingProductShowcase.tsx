"use client";

import type { CSSProperties } from "react";

export type LandingShowcaseVariant = "search" | "rank" | "brief" | "chart" | "compare";

type LandingProductShowcaseProps = {
  variant: LandingShowcaseVariant;
};

const showcaseLabels: Record<LandingShowcaseVariant, string> = {
  search: "관심 종목을 점수와 지표로 좁히는 검색 화면 미리보기",
  rank: "시가총액과 섹터 흐름을 훑는 시장 목록 화면 미리보기",
  brief: "종목의 점수, 재무, 뉴스 근거를 함께 보는 상세 화면 미리보기",
  chart: "국내 색상 규칙의 캔들 차트와 진입 신호 화면 미리보기",
  compare: "후보 종목을 같은 지표로 비교하는 화면 미리보기",
};

export function LandingProductShowcase({ variant }: LandingProductShowcaseProps) {
  return (
    <div aria-label={showcaseLabels[variant]} className={`landing-product-showcase landing-product-showcase-${variant}`} role="img">
      {variant === "search" && <SearchWorkbench />}
      {variant === "rank" && <MarketWorkbench />}
      {variant === "brief" && <BriefWorkbench />}
      {variant === "chart" && <ChartWorkbench />}
      {variant === "compare" && <CompareWorkbench />}
    </div>
  );
}

function SearchWorkbench() {
  return (
    <div className="landing-ui-canvas landing-ui-canvas-search">
      <div className="landing-ui-toolbar">
        <span>종목명이나 티커 검색</span>
        <strong>검색</strong>
      </div>
      <div className="landing-ui-focus-card">
        <div>
          <span>NVIDIA</span>
          <strong>$142.80</strong>
        </div>
        <em>품질 86</em>
      </div>
      <div className="landing-ui-score-row">
        <MetricChip label="Forward PER" value="28.4x" />
        <MetricChip label="ROE" value="58%" />
        <MetricChip label="목표가" value="+9%" />
      </div>
      <div className="landing-ui-candidate-list">
        <CandidateRow name="SK하이닉스" score="83" tone="good" />
        <CandidateRow name="Tesla" score="72" tone="watch" />
        <CandidateRow name="삼성전자" score="78" tone="neutral" />
      </div>
    </div>
  );
}

function MarketWorkbench() {
  return (
    <div className="landing-ui-canvas landing-ui-canvas-market">
      <div className="landing-ui-tab-row">
        <span>국내</span>
        <span className="active">미국</span>
        <span>섹터</span>
      </div>
      <div className="landing-ui-market-grid">
        <MarketCapRow rank="1" name="NVIDIA" cap="$3.4T" change="+2.1%" positive />
        <MarketCapRow rank="2" name="Apple" cap="$3.1T" change="-0.4%" />
        <MarketCapRow rank="3" name="Microsoft" cap="$3.0T" change="+0.8%" positive />
        <MarketCapRow rank="4" name="삼성전자" cap="508조" change="+1.8%" positive />
      </div>
      <div className="landing-ui-sector-strip">
        <span style={{ "--bar": "76%" } as CSSProperties}>AI 반도체</span>
        <span style={{ "--bar": "58%" } as CSSProperties}>빅테크</span>
        <span style={{ "--bar": "42%" } as CSSProperties}>국내 대형주</span>
      </div>
    </div>
  );
}

function BriefWorkbench() {
  return (
    <div className="landing-ui-canvas landing-ui-canvas-brief">
      <div className="landing-ui-brief-header">
        <div>
          <span>NVDA 브리프</span>
          <strong>성장은 강한데, 가격 부담도 같이 봐요</strong>
        </div>
        <em>업데이트됨</em>
      </div>
      <div className="landing-ui-dual-score">
        <ScoreDial label="품질" score="86" nextScore="88" tone="good" />
        <ScoreDial label="기회" score="64" nextScore="69" tone="watch" />
      </div>
      <div className="landing-ui-proof-panel">
        <span>실적 모멘텀</span>
        <strong>AI 수요와 마진은 강세, 밸류 부담은 확인 필요</strong>
      </div>
      <div className="landing-ui-news-strip">
        <span>뉴스</span>
        <p>AI 서버 수요 확대 · 목표가 상향 리포트</p>
      </div>
    </div>
  );
}

function ChartWorkbench() {
  const candles = [
    { tone: "fall", height: "45%", top: "36%", delay: "0ms", move: "-4px" },
    { tone: "rise", height: "34%", top: "42%", delay: "180ms", move: "5px" },
    { tone: "fall", height: "52%", top: "28%", delay: "360ms", move: "-6px" },
    { tone: "rise", height: "62%", top: "20%", delay: "540ms", move: "4px" },
    { tone: "rise", height: "72%", top: "12%", delay: "720ms", move: "-5px" },
    { tone: "fall", height: "42%", top: "34%", delay: "900ms", move: "6px" },
  ];

  return (
    <div className="landing-ui-canvas landing-ui-canvas-chart">
      <div className="landing-ui-chart-head">
        <span>NVDA · 20일 캔들</span>
        <strong>진입 전 확인</strong>
      </div>
      <div className="landing-ui-candle-stage">
        <div className="landing-ui-price-line" />
        {candles.map((candle, index) => (
          <span
            className={`landing-ui-candle ${candle.tone}`}
            key={`${candle.tone}-${index}`}
            style={{ "--height": candle.height, "--top": candle.top, "--delay": candle.delay, "--move": candle.move } as CSSProperties}
          />
        ))}
      </div>
      <div className="landing-ui-signal-row">
        <MetricChip label="추세" value="상승" />
        <MetricChip label="변동성" value="보통" />
        <MetricChip label="과열" value="주의" />
      </div>
    </div>
  );
}

function CompareWorkbench() {
  return (
    <div className="landing-ui-canvas landing-ui-canvas-compare">
      <div className="landing-ui-compare-head">
        <span>후보 비교</span>
        <strong>같은 기준으로 보기</strong>
      </div>
      <div className="landing-ui-compare-table">
        <CompareRow name="NVIDIA" quality="86" chance="64" price="+2.1%" />
        <CompareRow name="TSMC" quality="84" chance="70" price="+1.2%" />
        <CompareRow name="삼성전자" quality="78" chance="71" price="+1.8%" />
      </div>
    </div>
  );
}

function MetricChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="landing-ui-chip">
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  );
}

function CandidateRow({ name, score, tone }: { name: string; score: string; tone: "good" | "watch" | "neutral" }) {
  return (
    <span className={`landing-ui-candidate landing-ui-candidate-${tone}`}>
      <strong>{name}</strong>
      <em>{score}</em>
    </span>
  );
}

function MarketCapRow({
  rank,
  name,
  cap,
  change,
  positive = false,
}: {
  rank: string;
  name: string;
  cap: string;
  change: string;
  positive?: boolean;
}) {
  return (
    <span className="landing-ui-market-row">
      <small>{rank}</small>
      <strong>{name}</strong>
      <em>{cap}</em>
      <b className={positive ? "positive" : "negative"}>{change}</b>
    </span>
  );
}

function ScoreDial({ label, score, nextScore, tone }: { label: string; score: string; nextScore?: string; tone: "good" | "watch" }) {
  const numericScore = Number(score);
  const numericNextScore = Number(nextScore ?? score);
  const scoreOffset = Number.isFinite(numericScore) ? 100 - Math.max(0, Math.min(100, numericScore)) : 100;
  const scoreOffsetNext = Number.isFinite(numericNextScore) ? 100 - Math.max(0, Math.min(100, numericNextScore)) : scoreOffset;

  return (
    <span
      className={`landing-ui-score-dial landing-ui-score-dial-${tone}`}
      style={{ "--dial-offset": scoreOffset, "--dial-offset-next": scoreOffsetNext } as CSSProperties}
    >
      <svg aria-hidden="true" className="landing-ui-score-ring" viewBox="0 0 112 112">
        <circle className="landing-ui-score-track" cx="56" cy="56" r="45" pathLength="100" />
        <circle className="landing-ui-score-progress" cx="56" cy="56" r="45" pathLength="100" />
      </svg>
      <span className="landing-ui-score-value">
        <small>{label}</small>
        <strong data-next-score={nextScore ?? score}>{score}</strong>
      </span>
    </span>
  );
}

function CompareRow({ name, quality, chance, price }: { name: string; quality: string; chance: string; price: string }) {
  return (
    <span className="landing-ui-compare-row">
      <strong>{name}</strong>
      <em>{quality}</em>
      <em>{chance}</em>
      <b>{price}</b>
    </span>
  );
}
