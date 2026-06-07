import type { TechnicalAnalysisPayload } from "@/lib/technicalAnalysisTypes";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export type LabeledValue = {
  label?: string;
  value?: JsonValue;
  note?: string;
  [key: string]: unknown;
};

export type Grade = {
  class?: string;
  label?: string;
};

export type ScoreComponent = {
  key?: string;
  label?: string;
  short?: string;
  score?: number;
  summary?: string;
  metrics?: LabeledValue[];
};

export type ChartSeriesPoint = {
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

export type ChartPattern = {
  name?: string;
  status?: string;
  evidence?: string;
  interpretation?: string;
};

export type NewsItem = {
  title?: string;
  publisher?: string;
  link?: string;
  provider_publish_time?: number;
};

export type TopScore = {
  symbol?: string;
  name?: string;
  price?: number;
  currency?: string;
  score?: number;
  grade?: Grade;
  components?: Record<string, number>;
  ts?: number;
};

export type StockJudgment = {
  headline: string;
  body: string;
  watch: string;
  tone: "positive" | "neutral" | "cautious";
  model?: string;
  promptVersion?: string;
};

export type SiaSnapshot = {
  symbol?: string;
  price?: number;
  raw_signal?: string;
  risk_level?: string;
  confidence?: number;
  quality_score?: number;
  opportunity_score?: number;
  opportunity_confidence?: number;
  spot_score?: number;
  chart_score?: number;
  trend_score?: number;
  momentum_score?: number;
  inverse_score?: number;
  momentum_label?: string;
  signal_source?: string;
  score_model_version?: string;
  bar_ts?: string;
  indicators?: Record<string, number>;
  reasons?: Record<string, number>;
  [key: string]: unknown;
};

export type StockScoreResponse = {
  app?: string;
  requested_ticker?: string;
  market?: "US" | "KR";
  symbol?: string;
  name?: string;
  display_name?: string;
  korean_name?: string;
  english_name?: string;
  instrument_type?: string;
  exchange?: string;
  currency?: string;
  score_model_version?: string;
  score?: number;
  quality_score?: number;
  quality_grade?: Grade;
  opportunity_score?: number;
  opportunity_grade?: Grade;
  opportunity_confidence?: number;
  grade?: Grade;
  summary?: string;
  period?: string;
  benchmark?: string;
  benchmark_label?: string;
  latest_price?: number;
  latest_price_label?: string;
  latest_bar_date?: string;
  usd_krw_rate?: number;
  usd_krw_label?: string;
  evaluation_label?: string;
  evaluation_ts?: number;
  data_quality?: string;
  components?: ScoreComponent[];
  opportunity_components?: ScoreComponent[];
  key_metrics?: LabeledValue[];
  stock_profile?: LabeledValue[];
  valuation_rows?: LabeledValue[];
  chart_patterns?: ChartPattern[];
  chart_series?: ChartSeriesPoint[];
  technical_analysis?: TechnicalAnalysisPayload;
  history?: TopScore[];
  top_scores?: TopScore[];
  news?: NewsItem[];
  price_metrics?: Record<string, JsonValue>;
  financials?: Record<string, JsonValue>;
  financial_statement?: Record<string, JsonValue>;
  sia_snapshot?: SiaSnapshot;
  fetch?: Record<string, JsonValue>;
  server_cache?: Record<string, JsonValue>;
  [key: string]: unknown;
};

export type StockQuoteResponse = {
  ok?: boolean;
  type?: "quote";
  requested_ticker?: string;
  market?: "US" | "KR";
  symbol?: string;
  name?: string;
  exchange?: string;
  exchange_code?: string;
  currency?: string;
  usd_krw_rate?: number;
  usd_krw_label?: string;
  latest_price?: number;
  latest_price_label?: string;
  latest_bar_date?: string;
  previous_close?: number;
  latest_change?: number;
  latest_change_label?: string;
  volume?: number;
  volume_label?: string;
  price_metrics?: Record<string, JsonValue>;
  server_cache?: Record<string, JsonValue>;
  market_session?: Record<string, JsonValue>;
  refresh_cooldown?: {
    seconds?: number;
    next_allowed_at?: string;
    remaining_seconds?: number;
  };
  [key: string]: unknown;
};
