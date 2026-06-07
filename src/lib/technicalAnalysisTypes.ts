export type TechnicalAnalysisStatus = "ready" | "limited" | "unavailable";
export type TechnicalAnalysisTone = "bullish" | "bearish" | "neutral" | "caution" | "insufficient";
export type TechnicalCoverageTier = "insufficient" | "starter" | "short" | "standard" | "full" | "long_history";
export type TechnicalSummaryTone = "positive" | "neutral" | "cautious" | "limited";
export type TechnicalJsonPrimitive = string | number | boolean | null;
export type TechnicalJsonValue = TechnicalJsonPrimitive | TechnicalJsonObject | TechnicalJsonValue[];
export type TechnicalJsonObject = { [key: string]: TechnicalJsonValue };

export type TechnicalIndicatorKey =
  | "moving_average"
  | "ichimoku"
  | "rsi_divergence"
  | "ict"
  | "fibonacci"
  | "volume_candle"
  | "trend";

export type TechnicalDataWindow = {
  available_days: number;
  required_days: number;
  start_date?: string;
  end_date?: string;
  is_newly_listed?: boolean;
  message?: string;
};

export type TechnicalIndicatorReading = {
  key: TechnicalIndicatorKey;
  title: string;
  tone: TechnicalAnalysisTone;
  summary: string;
  rule: string;
  evidence: string[];
  values?: Record<string, TechnicalJsonValue>;
};

export type TechnicalChartPoint = {
  date?: string;
  close?: number;
  close_label?: string;
  currency?: string;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
  volume_label?: string;
  change_pct?: number;
  change_label?: string;
  range_label?: string;
  ohl_label?: string;
  [key: string]: unknown;
};

export type TechnicalChartOverlay = {
  key: string;
  label: string;
  type: "line" | "band" | "zone" | "marker" | "level";
  tone?: TechnicalAnalysisTone;
  points?: TechnicalChartPoint[];
  values?: Record<string, TechnicalJsonValue>;
};

export type TechnicalAnalysisPayload = {
  type: "technical_analysis";
  version: string;
  timeframe?: "1d";
  ticker?: string;
  market?: "US" | "KR";
  symbol?: string;
  status: TechnicalAnalysisStatus;
  coverage_tier?: TechnicalCoverageTier;
  bars?: number;
  closed_bar_date?: string;
  generated_at?: string;
  data_window: TechnicalDataWindow;
  summary: {
    headline: string;
    tone: TechnicalAnalysisTone | TechnicalSummaryTone;
    bullets: string[];
  };
  confluence?: {
    score: number;
    label: string;
    groups: Array<{ key: string; label: string; score: -1 | 0 | 1; weight: number; reason: string }>;
  };
  signals?: Array<{
    key: string;
    title: string;
    status: string;
    tone?: TechnicalAnalysisTone;
    plain: string;
    evidence: string;
    layer?: string;
    rule: string;
  }>;
  indicators: TechnicalIndicatorReading[];
  chart?: {
    points: TechnicalChartPoint[];
    overlays: TechnicalChartOverlay[];
  };
  overlays?: TechnicalJsonObject;
  warnings?: string[];
  glossary?: Array<{
    term: string;
    meaning: string;
  }>;
  metadata?: TechnicalJsonObject;
};
