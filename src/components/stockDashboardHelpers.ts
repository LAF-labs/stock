import { clampScore, formatApproxKrwAmount, formatCompactUsd, formatCurrencyAmount, formatKoreanWonLarge, formatPercent, formatValue, recordEntries } from "@/lib/format";
import { stockScoreDataFromDetailView } from "@/components/stockDisplayAdapters";
import { displayTicker, isUsDerivativeSymbol } from "@/lib/symbolDisplay";
export { stockJudgmentRequestPayload } from "@/lib/stockJudgmentPayload";
import type { StockDetailViewResponse } from "@/lib/stockDetailViewTypes";
import type { SymbolSearchItem } from "@/lib/symbolTypes";
import { cleanTickerSymbol, resolveTickerAlias } from "@/lib/tickerRef";
import type { ChartSeriesPoint, JsonValue, LabeledValue, ScoreComponent, StockQuoteResponse, StockScoreResponse } from "@/lib/types";

const RECORD_LABELS: Record<string, string> = {
  yfinance_version: "yfinance 버전",
  fetched_at: "조회 시각",
  cache: "캐시",
  input_mode: "입력 방식",
  market_scope: "지원 범위",
  history_rows: "가격 데이터 수",
  price: "현재가",
  previous_close: "전일 종가",
  latest_change: "전일 대비",
  return_1m: "1개월 수익률",
  return_3m: "3개월 수익률",
  return_6m: "6개월 수익률",
  return_52w: "52주 수익률",
  distance_from_52w_high: "52주 고점 거리",
  high_52w: "52주 고가",
  low_52w: "52주 저가",
  sma50: "50일 평균",
  sma200: "200일 평균",
  rsi14: "RSI14",
  atr14: "ATR14",
  atr14_pct: "ATR14 비중",
  avg_volume_20: "20일 평균 거래량",
  avg_volume_60: "60일 평균 거래량",
  profitMargins: "순이익률",
  operatingMargins: "영업이익률",
  grossMargins: "매출총이익률",
  returnOnEquity: "ROE",
  revenueGrowth: "매출 성장률",
  earningsGrowth: "이익 성장률",
  operatingIncomeGrowth: "영업이익 성장률",
  equityGrowth: "자본 성장률",
  assetGrowth: "자산 성장률",
  totalRevenue: "총매출",
  operatingIncome: "영업이익",
  netIncome: "순이익",
  operatingCashflow: "영업현금흐름",
  freeCashflow: "FCF (잉여현금흐름)",
  totalCash: "현금성 자산",
  totalDebt: "총부채",
  totalAssets: "총자산",
  currentAssets: "유동자산",
  totalLiabilities: "총부채",
  currentLiabilities: "유동부채",
  totalEquity: "자본총계",
  debtToEquity: "부채/자본",
  currentRatio: "유동비율",
  quickRatio: "당좌비율",
  targetMeanPrice: "평균 목표가",
  numberOfAnalystOpinions: "애널리스트 수",
  recommendationMean: "투자의견 점수 (1=매수, 5=매도)",
  beta: "베타",
  income_statement: "손익계산서",
  balance_sheet: "재무상태표",
  cashflow: "현금흐름표",
  period: "보고 기간",
  periodEnded: "보고 기준일",
  reported_date: "보고 기준일",
  salesPerShare: "SPS (주당매출)",
  reserveRatio: "유보율",
  borrowingsDependency: "차입금 의존도",
  payoutRatio: "배당성향",
  eva: "EVA (경제적 부가가치)",
  ebitda: "EBITDA (상각전영업이익)",
  evToEbitda: "EV/EBITDA (기업가치/상각전영업이익)",
  profitability_score: "수익성 기여도",
  growth_score: "성장성 기여도",
  health_score: "재무건전성 기여도",
  momentum_score: "모멘텀 기여도",
  valuation_score: "밸류에이션 기여도",
  quality_score: "품질 점수",
  opportunity_score: "기회 점수",
};

const HIDDEN_RECORD_KEYS = new Set([
  "confidence",
  "opportunity_confidence",
  "신뢰도",
  "source",
  "signal_source",
  "market_scope",
  "cache",
  "input_mode",
  "message",
  "quote_only_fast_path",
  "detail_fast_path",
  "identity_only_fast_path",
  "pending_enrichment",
  "request_fast_path",
  "provider_mode",
  "daily_timeout_ms",
  "timeout_ms",
]);
export const SOURCE_VENDOR_TEXT = ["K", "I", "S"].join("");
const SOURCE_LABEL_TEXT = ["데이터", "출처"].join(" ");

const PERCENT_RECORD_KEYS = new Set([
  "latest_change",
  "return_1m",
  "return_3m",
  "return_6m",
  "return_52w",
  "distance_from_52w_high",
  "atr14_pct",
  "profitMargins",
  "operatingMargins",
  "returnOnEquity",
  "revenueGrowth",
  "earningsGrowth",
  "profitability_score",
  "growth_score",
  "health_score",
  "momentum_score",
  "valuation_score",
  "quality_score",
  "opportunity_score",
]);

const COMPACT_METRIC_LABELS = new Set([
  "1개월 수익률",
  "3개월 수익률",
  "6개월 수익률",
  "52주 수익률",
  "52주 고점 거리",
  "매출 성장률",
  "이익 성장률",
  "순이익률",
  "영업이익률",
  "OCF 마진",
  "FCF 마진",
  "ROE 추정",
  "목표가 여지",
  "애널리스트 수",
  "투자의견 평균",
  "ATR14",
  "베타",
  "EPS",
  "BPS",
]);

const COMPACT_METRIC_BLOCKED_VALUE_RE = /[$₩€¥]|조|억|만|천|주|B|M|T|정상|확인|상한|,/i;
const PRICE_METRIC_LABELS = new Set(["현재가", "평균 목표가", "EPS", "BPS", "52주 고가", "52주 저가", "50일 평균", "200일 평균"]);
const LARGE_MONEY_RECORD_KEYS = new Set(["totalRevenue", "operatingCashflow", "freeCashflow", "totalCash", "totalDebt"]);
const PRICE_RECORD_KEYS = new Set(["price", "previous_close", "high_52w", "low_52w", "sma50", "sma200", "targetMeanPrice"]);
const HIDDEN_LABELED_ITEM_LABELS = new Set(["상품유형코드", "통화", "환율 기준", "매매 가능 여부", "거래가능여부", "거래 가능 여부", "거래상태", "적용 상한", "신뢰도", "근거 충분도"]);
const LABEL_REPLACEMENTS: Record<string, string> = {
  PER: "PER (주가수익비율)",
  "Forward PER": "Forward PER (예상 PER)",
  PBR: "PBR (주가순자산비율)",
  "P/S": "P/S (시가총액/매출)",
  EPS: "EPS (주당순이익)",
  BPS: "BPS (주당순자산)",
  "EV/Revenue": "EV/Revenue (기업가치/매출)",
  "Price/Sales": "Price/Sales (시가총액/매출)",
  "OCF 마진": "OCF 마진 (영업현금흐름률)",
  "OFC 마진": "OCF 마진 (영업현금흐름률)",
  "FCF 마진": "FCF 마진 (잉여현금흐름률)",
  "ROE 추정": "ROE (자기자본이익률) 추정",
};
const SOURCE_NOTE_RE = /^(?:yfinance|yahoo finance(?:\s*기준)?|data source|source)$/i;
const CASHFLOW_MARGIN_LABEL_RE = /^(?:OFC|OCF|FCF)\s*마진(?:\s*\(.+\))?$/i;
const MAX_REASONABLE_MARGIN_PERCENT = 500;
const NEUTRAL_FALLBACK_SCORE = 50;
const ANALYST_COMPONENT_KEYS = new Set(["opportunity_analyst", "analyst"]);
const VALUATION_COMPONENT_KEYS = new Set(["valuation", "opportunity_valuation"]);
const PROFITABILITY_COMPONENT_KEYS = new Set(["profitability"]);
const QUALITY_GROWTH_COMPONENT_KEYS = new Set(["growth"]);
const PRICE_GROWTH_COMPONENT_KEYS = new Set(["opportunity_growth"]);
const STABILITY_COMPONENT_KEYS = new Set(["health", "stability", "trading_stability", "opportunity_risk"]);
const MOMENTUM_COMPONENT_KEYS = new Set(["momentum", "opportunity_momentum"]);
const LIQUIDITY_COMPONENT_KEYS = new Set(["liquidity", "opportunity_liquidity"]);
const NON_EVIDENCE_METRIC_LABEL_RE = /^(?:시가총액|보강 상태)$/;
const VALUATION_EVIDENCE_LABEL_RE = /^(?:Forward PER|PER|PBR|P\/S|PSR|EV\/Revenue|EV\/Sales|Price\/Sales|Price to Sales|Price\/Book|P\/B|EPS|BPS)(?:\s*\(.+\))?$/i;
const ANALYST_COUNT_LABEL_RE = /^(?:애널리스트 수|커버리지 수)$/;
const RECOMMENDATION_MEAN_LABEL_RE = /^투자의견 평균$/;
const TARGET_PRICE_LABEL_RE = /^평균 목표가$/;
const PROFITABILITY_EVIDENCE_LABEL_RE = /(?:순이익률|영업이익률|ROE|현금흐름|OCF|FCF|EBITDA|마진|profit|margin|cash\s*flow)/i;
const FINANCIAL_GROWTH_EVIDENCE_LABEL_RE = /(?:매출|이익|EPS|revenue|earnings|sales).*(?:성장|growth)|(?:성장|growth).*(?:매출|이익|EPS|revenue|earnings|sales)/i;
const PRICE_TREND_EVIDENCE_LABEL_RE = /^(?:1개월|3개월|6개월|52주|20일선|50일선|200일선|20일 평균|50일 평균|200일 평균|RSI14|ATR14|베타|beta)/i;
const STABILITY_EVIDENCE_LABEL_RE = /(?:60일 변동성|변동성|ATR14|베타|beta|고점 대비|52주 고점|부채|유동비율|현금|debt|current ratio|cash)/i;
const LIQUIDITY_EVIDENCE_LABEL_RE = /(?:거래량|평균 거래|20일 평균|60일 평균|volume|유동성)/i;

const KO_KR_CHART_FORMATTER = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 });
const NOTE_COPY: Record<string, string> = {
  "TTM 이익 대비 가격": "지난 12개월 이익과 비교한 가격이에요.",
  "예상 이익 대비 가격": "앞으로 예상되는 이익과 비교한 가격이에요.",
  "자본 대비 시장가치": "회사의 장부상 자본과 시장가치를 비교해요.",
  "기업가치/매출": "기업 전체 가치가 매출에 비해 큰지 봐요.",
  "시가총액/매출": "시가총액이 매출에 비해 큰지 봐요.",
  "Yahoo Finance 기준": "Yahoo Finance에서 가져온 기준값이에요.",
};

const TERM_TIPS = [
  { term: "Forward PER", keys: ["forward per"], body: "앞으로 예상되는 이익으로 계산한 PER예요." },
  { term: "EV/Revenue", keys: ["ev/revenue"], body: "기업 전체 가치가 매출에 비해 얼마나 큰지 보여줘요." },
  { term: "P/S", keys: ["p/s", "psr", "price/sales"], body: "시가총액을 매출과 비교한 숫자예요." },
  { term: "ATR14", keys: ["atr14", "atr"], body: "최근 14일 기준 하루 가격 흔들림을 보여줘요." },
  { term: "RSI14", keys: ["rsi14", "rsi"], body: "최근 상승과 하락의 힘을 비교해 과열 여부를 봐요." },
  { term: "ROE", keys: ["roe"], body: "자본을 얼마나 효율적으로 이익으로 바꾸는지 보여줘요." },
  { term: "OCF", keys: ["ocf", "영업현금흐름"], body: "회계상 이익이 아니라 실제로 들어온 현금 흐름이에요." },
  { term: "PER", keys: ["per"], body: "주가가 이익에 비해 비싼지 보는 숫자예요." },
  { term: "PBR", keys: ["pbr"], body: "회사의 장부가치에 비해 주가가 비싼지 보는 숫자예요." },
  { term: "52주", keys: ["52주"], body: "최근 1년 범위에서 고점이나 저점과 비교해요." },
  { term: "50일 평균", keys: ["50일 평균", "sma50", "ma50"], body: "최근 50거래일 평균 가격이에요." },
  { term: "200일 평균", keys: ["200일 평균", "sma200", "ma200"], body: "최근 200거래일 평균 가격이에요." },
  { term: "시가총액", keys: ["시가총액"], body: "주가에 발행주식 수를 곱한 회사 전체 시장가치예요." },
  { term: "유동비율", keys: ["유동비율"], body: "단기 빚을 갚을 여력이 있는지 보는 비율이에요." },
  { term: "부채/자본", keys: ["부채/자본"], body: "자본 대비 부채가 얼마나 큰지 보여줘요." },
  { term: "수익성", keys: ["수익성", "순이익률", "영업이익률"], body: "매출에서 이익을 얼마나 잘 남기는지 봐요." },
  { term: "성장성", keys: ["성장성", "성장률"], body: "매출이나 이익이 커지는 속도를 봐요." },
  { term: "재무건전성", keys: ["재무건전성"], body: "회사가 버틸 체력이 있는지 보는 항목이에요." },
  { term: "모멘텀", keys: ["모멘텀"], body: "최근 가격 흐름에 힘이 붙었는지 보는 개념이에요." },
  { term: "밸류에이션", keys: ["밸류에이션"], body: "현재 가격이 실적이나 자산에 비해 부담스러운지 봐요." },
  { term: "투자의견 평균", keys: ["투자의견 평균", "recommendationmean"], body: "애널리스트 투자의견을 평균낸 값이에요. 1에 가까울수록 매수 쪽, 5에 가까울수록 매도 쪽이에요." },
  { term: "투자의견 점수", keys: ["투자의견 점수"], body: "애널리스트 투자의견을 점수로 평균낸 값이에요. 1에 가까울수록 매수 쪽, 5에 가까울수록 매도 쪽이에요." },
];

export type SnapshotPendingState = {
  message: string;
  ticker?: string;
  queued: boolean;
  retryAfterSeconds?: number;
};

export type ScoreFreshnessSummary = {
  label: string;
  value: string;
  detail: string;
  tone: "fresh" | "stale" | "pending" | "unknown";
};

export type StockHeaderIdentity = {
  primary: string;
  secondary: string;
  primaryKind: "name" | "ticker";
};

export type OpportunityExtreme = {
  label: string;
  score: number;
};

export type OpportunityExtremes = {
  best?: OpportunityExtreme;
  worst?: OpportunityExtreme;
};

export type MarketCapDisplay = {
  primary: string;
  secondary?: string;
};

export type UsableChartPoint = ChartSeriesPoint & { close: number; date: string };

export type PartialStockSnapshotPayload = StockScoreResponse & {
  type?: "partial_stock_snapshot";
  quote?: StockQuoteResponse;
  chart?: StockScoreResponse;
  pending_snapshot?: unknown;
};

const CHART_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function dashboardTickerFromSearchParam(value: string | null): string | undefined {
  const resolved = resolveTickerAlias(value);
  if (resolved.ok) return resolved.ticker;
  const ticker = value?.trim().toUpperCase();
  return ticker || undefined;
}

export function dashboardInputValue(ticker: string | undefined): string {
  return ticker ? displayTickerInput(ticker) : "";
}

export function dashboardSearchInputValue(
  data: StockScoreResponse | undefined,
  quote: StockQuoteResponse | undefined,
  fallbackTicker: string | undefined
): string {
  if (data) {
    const identity = stockHeaderIdentity(data, quote);
    if (identity.primaryKind === "name") return identity.primary;
  }

  if (quote) {
    const quoteData = partialStockDataFromQuote(quote, fallbackTicker || stringFromUnknown(quote.requested_ticker) || "");
    if (quoteData) {
      const identity = stockHeaderIdentity(quoteData, quote);
      if (identity.primaryKind === "name") return identity.primary;
    }
  }

  return dashboardInputValue(fallbackTicker);
}

export type DashboardSearchSyncDecision =
  | { action: "none"; previousTickerParam: string | undefined }
  | { action: "replace"; value: string; isSearchEditing: false; previousTickerParam: string | undefined };

export function dashboardSearchSyncDecision(input: {
  tickerParam: string | undefined;
  previousTickerParam: string | undefined;
  isSearchEditing: boolean;
  data?: StockScoreResponse;
  quote?: StockQuoteResponse;
}): DashboardSearchSyncDecision {
  const tickerChanged = input.previousTickerParam !== input.tickerParam;

  if (!input.tickerParam) {
    if (!tickerChanged) {
      return { action: "none", previousTickerParam: input.previousTickerParam };
    }
    return { action: "replace", value: "", isSearchEditing: false, previousTickerParam: input.tickerParam };
  }

  if (tickerChanged) {
    return {
      action: "replace",
      value: dashboardInputValue(input.tickerParam),
      isSearchEditing: false,
      previousTickerParam: input.tickerParam,
    };
  }

  if (input.isSearchEditing || (!input.data && !input.quote)) {
    return { action: "none", previousTickerParam: input.previousTickerParam };
  }

  return {
    action: "replace",
    value: dashboardSearchInputValue(input.data, input.quote, input.tickerParam),
    isSearchEditing: false,
    previousTickerParam: input.previousTickerParam,
  };
}

export function shouldShowStockSkeleton(status: string, hasUsefulPartialData = false, hasDetailViewResponse = false): boolean {
  void hasDetailViewResponse;
  if (status === "partial") return !hasUsefulPartialData;
  return status === "loading" || status === "pending";
}

export const PARTIAL_SECTION_SKELETON_DEADLINE_MS = 8_000;

export type PartialSectionDisplayState = "content" | "loading" | "unavailable" | "hidden";

export function partialSectionDisplayState({
  hasContent,
  isRecovering,
  startedAtMs,
  nowMs,
  deadlineMs = PARTIAL_SECTION_SKELETON_DEADLINE_MS,
}: {
  hasContent: boolean;
  isRecovering: boolean;
  startedAtMs: number;
  nowMs: number;
  deadlineMs?: number;
}): PartialSectionDisplayState {
  if (hasContent) return "content";
  if (!isRecovering) return "hidden";
  return Math.max(0, nowMs - startedAtMs) < deadlineMs ? "loading" : "unavailable";
}

export function dashboardStateFromDetailView(result: StockDetailViewResponse | undefined): { status: "partial" | "success" | "error"; data?: StockScoreResponse; error?: string } | undefined {
  if (!result) return undefined;
  if (result.ok === false) return { status: "error", error: result.message };

  const data = stockScoreDataFromDetailView(result);

  return { status: result.mode === "ready" ? "success" : "partial", data };
}

export function hasDisplayableStockPartialData(data: StockScoreResponse | undefined): boolean {
  if (!data) return false;
  const record = data as Record<string, unknown>;
  const priceLabel = stringFromUnknown(record.latest_price_label);
  return (
    numberFromUnknown(record.latest_price) !== undefined ||
    Boolean(priceLabel && priceLabel !== "-") ||
    numberFromUnknown(record.quality_score) !== undefined ||
    numberFromUnknown(record.score) !== undefined
  );
}

export function stockRecoveringParts(data: StockScoreResponse | undefined): string[] {
  const record = data as Record<string, unknown> | undefined;
  const serverCache = recordFromUnknown(record?.server_cache);
  return (arrayFromUnknown(serverCache?.recovering_parts) || []).filter((part): part is string => typeof part === "string" && part.trim().length > 0);
}

export function chooseRicherStockData(
  first: StockScoreResponse | undefined,
  second: StockScoreResponse | undefined,
): StockScoreResponse | undefined {
  if (!first) return second;
  if (!second) return first;
  return stockDataUsefulness(first) >= stockDataUsefulness(second) ? first : second;
}

export function stockDataUsefulness(data: StockScoreResponse | undefined): number {
  if (!data) return 0;
  const record = data as Record<string, unknown>;
  let score = 0;

  if (stringFromUnknown(record.name) || stringFromUnknown(record.display_name) || stringFromUnknown(record.symbol)) score += 1;
  if (numberFromUnknown(record.latest_price) !== undefined || stringFromUnknown(record.latest_price_label)) score += 4;
  if (usableChartPoints(data.chart_series).length >= 1) score += 4;
  if (numberFromUnknown(record.quality_score) !== undefined || numberFromUnknown(record.score) !== undefined) score += 4;
  if (arrayFromUnknown(record.key_metrics)?.length) score += 2;
  if (arrayFromUnknown(record.valuation_rows)?.length) score += 2;
  if (arrayFromUnknown(record.components)?.length || arrayFromUnknown(record.opportunity_components)?.length) score += 2;
  if (arrayFromUnknown(record.stock_profile)?.length) score += 1;
  if (recordFromUnknown(record.financials)) score += 1;
  if (recordFromUnknown(record.technical_analysis)) score += 1;

  return score;
}

export function isPartialStockSnapshotPayload(payload: unknown): payload is PartialStockSnapshotPayload {
  return recordFromUnknown(payload)?.type === "partial_stock_snapshot";
}

export function partialStockDataFromPayload(payload: unknown, fallbackTicker: string): StockScoreResponse | undefined {
  if (!isPartialStockSnapshotPayload(payload)) return undefined;

  const record = recordFromUnknown(payload);
  const quote = recordFromUnknown(record?.quote);
  const chart = recordFromUnknown(record?.chart);
  const requestedTicker = stringFromUnknown(record?.requested_ticker) || stringFromUnknown(record?.ticker) || fallbackTicker;
  const market = marketFromPartial(record, quote, chart, requestedTicker);
  const chartSeries = arrayFromUnknown(record?.chart_series) || arrayFromUnknown(chart?.chart_series);
  const latestPrice = numberFromUnknown(quote?.latest_price) ?? numberFromUnknown(record?.latest_price) ?? numberFromUnknown(chart?.latest_price);
  const data: StockScoreResponse = {
    requested_ticker: requestedTicker,
    market,
    symbol: stringFromUnknown(record?.symbol) || stringFromUnknown(quote?.symbol) || stringFromUnknown(chart?.symbol) || cleanTickerSymbol(requestedTicker),
    name: stringFromUnknown(record?.name) || stringFromUnknown(quote?.name) || stringFromUnknown(chart?.name),
    exchange: stringFromUnknown(record?.exchange) || stringFromUnknown(quote?.exchange) || stringFromUnknown(chart?.exchange),
    currency: stringFromUnknown(record?.currency) || stringFromUnknown(quote?.currency) || stringFromUnknown(chart?.currency),
    latest_price: latestPrice,
    latest_price_label: stringFromUnknown(quote?.latest_price_label) || stringFromUnknown(record?.latest_price_label) || stringFromUnknown(chart?.latest_price_label),
    latest_bar_date: stringFromUnknown(quote?.latest_bar_date) || stringFromUnknown(record?.latest_bar_date) || stringFromUnknown(chart?.latest_bar_date),
    usd_krw_rate: numberFromUnknown(quote?.usd_krw_rate) ?? numberFromUnknown(record?.usd_krw_rate) ?? numberFromUnknown(chart?.usd_krw_rate),
    usd_krw_label: stringFromUnknown(quote?.usd_krw_label) || stringFromUnknown(record?.usd_krw_label) || stringFromUnknown(chart?.usd_krw_label),
    chart_series: chartSeries as ChartSeriesPoint[] | undefined,
    server_cache: {
      state: "pending",
      source: "partial",
      refresh_started: true,
    },
  };

  const hasIdentity = Boolean(data.name || data.symbol || data.exchange);
  return data.latest_price !== undefined || usableChartPoints(data.chart_series).length >= 1 || hasIdentity ? data : undefined;
}

export function partialStockDataFromQuote(quote: StockQuoteResponse, fallbackTicker: string): StockScoreResponse | undefined {
  const requestedTicker = stringFromUnknown(quote.requested_ticker) || fallbackTicker;
  const data: StockScoreResponse = {
    requested_ticker: requestedTicker,
    market: quote.market || (requestedTicker.startsWith("KR:") ? "KR" : requestedTicker.startsWith("US:") ? "US" : undefined),
    symbol: stringFromUnknown(quote.symbol) || cleanTickerSymbol(requestedTicker),
    name: stringFromUnknown(quote.name),
    exchange: stringFromUnknown(quote.exchange),
    currency: stringFromUnknown(quote.currency),
    latest_price: numberFromUnknown(quote.latest_price),
    latest_price_label: stringFromUnknown(quote.latest_price_label),
    latest_bar_date: stringFromUnknown(quote.latest_bar_date),
    usd_krw_rate: numberFromUnknown(quote.usd_krw_rate),
    usd_krw_label: stringFromUnknown(quote.usd_krw_label),
    market_cap: numberFromUnknown(quote.market_cap),
    market_cap_label: stringFromUnknown(quote.market_cap_label),
    price_metrics: quote.price_metrics,
    server_cache: {
      state: "pending",
      source: "quote_partial",
      refresh_started: true,
    },
  };

  const hasIdentity = Boolean(data.name || data.symbol || data.exchange);
  return data.latest_price !== undefined || hasIdentity ? data : undefined;
}

export function partialStockDataFromTicker(ticker: string): StockScoreResponse {
  const requestedTicker = dashboardTickerFromSearchParam(ticker) || ticker.trim().toUpperCase();
  const market = requestedTicker.startsWith("KR:") ? "KR" : "US";
  const rawSymbol = requestedTicker.replace(/^(US|KR):/i, "");
  const symbol = cleanTickerSymbol(rawSymbol) || rawSymbol;

  return {
    requested_ticker: requestedTicker,
    market,
    symbol,
    currency: market === "KR" ? "KRW" : "USD",
    server_cache: {
      state: "pending",
      source: "client_deadline",
      refresh_started: true,
    },
  };
}

export function usableChartPoints(points: ChartSeriesPoint[] | undefined): UsableChartPoint[] {
  const byDate = new Map<string, UsableChartPoint>();
  for (const point of points || []) {
    if (typeof point.close !== "number" || !Number.isFinite(point.close)) continue;
    const date = normalizedChartDate(point.date);
    if (!date) continue;
    byDate.set(date, { ...point, close: point.close, date });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function normalizedChartDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const date = value.slice(0, 10);
  if (!CHART_DATE_RE.test(date)) return undefined;
  const parsed = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(parsed) ? date : undefined;
}

export function metricValue(items: LabeledValue[] | undefined, label: string): string {
  return formatValue(items?.find((item) => item.label === label)?.value);
}

export function stockMarketCapDisplay(data: StockScoreResponse): MarketCapDisplay {
  const rawValue =
    data.key_metrics?.find((item) => item.label === "시가총액")?.value
    ?? data.market_cap
    ?? numberFromJsonRecord(data.price_metrics, "market_cap")
    ?? data.market_cap_label;
  const parsed = marketCapNumber(rawValue);
  const fallbackValue = jsonDisplayValue(rawValue);

  if (data.market === "KR" || data.currency === "KRW") {
    return { primary: parsed === undefined ? formatValue(fallbackValue) : formatKoreanWonLarge(parsed) };
  }

  const usdValue = parsed;
  const krwValue = typeof usdValue === "number" && typeof data.usd_krw_rate === "number" ? usdValue * data.usd_krw_rate : undefined;
  return {
    primary: krwValue === undefined ? formatValue(fallbackValue) : formatKoreanWonLarge(krwValue),
    secondary: usdValue === undefined ? undefined : `(${formatCompactUsd(usdValue)})`,
  };
}

function jsonDisplayValue(value: unknown): JsonValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.filter((item): item is JsonValue => item === null || ["string", "number", "boolean"].includes(typeof item));
  return undefined;
}

export function formatMetricDisplayValue(item: LabeledValue, data?: StockScoreResponse): string {
  const label = item.label?.trim() || "";
  if (CASHFLOW_MARGIN_LABEL_RE.test(label)) return formatCashflowMarginDisplayValue(item.value);
  if (RECOMMENDATION_MEAN_LABEL_RE.test(label)) {
    const targetPrice = averageTargetPriceValue(data);
    if (targetPrice !== undefined) {
      return typeof targetPrice === "number" ? formatCurrencyAmount(targetPrice, data ? priceCurrency(data) : undefined) : formatValue(targetPrice);
    }
    const recommendationMean = moneyNumber(item.value);
    return recommendationMean === undefined ? formatValue(item.value) : `${formatValue(recommendationMean)} / 5`;
  }
  if (!data) return formatValue(item.value);
  if (label === "현재가") return formatPriceWithContext(data);
  if (label === "시가총액") return marketCapInlineDisplay(data);
  if (PRICE_METRIC_LABELS.has(label)) {
    const parsed = moneyNumber(item.value);
    if (parsed !== undefined) return formatCurrencyAmount(parsed, priceCurrency(data));
  }
  return formatValue(item.value);
}

export function metricDisplayLabel(item: LabeledValue, data?: StockScoreResponse): string | undefined {
  const label = displayLabeledItemLabel(item.label);
  if (!label) return label;
  if (RECOMMENDATION_MEAN_LABEL_RE.test(label)) {
    return averageTargetPriceValue(data) !== undefined ? "평균 목표가" : "투자의견 점수";
  }
  return label;
}

function averageTargetPriceValue(data: StockScoreResponse | undefined): JsonValue | undefined {
  if (!data) return undefined;
  const financialTarget = numberFromJsonRecord(data.financials, "targetMeanPrice");
  if (financialTarget !== undefined && financialTarget > 0) return financialTarget;
  const row = data.valuation_rows?.find((item) => TARGET_PRICE_LABEL_RE.test(item.label?.trim() || ""));
  if (row && !isMissingDisplayValue(row.value)) return row.value;
  return undefined;
}

function formatCashflowMarginDisplayValue(value: JsonValue | undefined): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Math.abs(value * 100) > MAX_REASONABLE_MARGIN_PERCENT) return "-";
    return formatPercent(value);
  }
  if (typeof value !== "string") return formatValue(value);
  const trimmed = value.trim();
  if (!trimmed || trimmed === "-") return formatValue(value);
  const match = trimmed.replaceAll(",", "").match(/[-+]?\d+(?:\.\d+)?/);
  if (!match) return formatValue(value);
  const parsed = Number(match[0]);
  if (!Number.isFinite(parsed)) return "-";
  const asPercent = trimmed.includes("%") ? parsed : parsed * 100;
  return Math.abs(asPercent) > MAX_REASONABLE_MARGIN_PERCENT ? "-" : formatValue(value);
}

function marketCapInlineDisplay(data: StockScoreResponse): string {
  const display = stockMarketCapDisplay(data);
  return [display.primary, display.secondary].filter(Boolean).join(" ");
}

function marketCapNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;

  const compact = value.trim().replaceAll(",", "");
  const match = compact.match(/([-+]?\d+(?:\.\d+)?)\s*([TtBbMm])?/);
  if (!match) return undefined;

  const base = Number(match[1]);
  if (!Number.isFinite(base)) return undefined;
  const unit = match[2]?.toUpperCase();
  const multiplier = unit === "T" ? 1_000_000_000_000 : unit === "B" ? 1_000_000_000 : unit === "M" ? 1_000_000 : 1;
  return base * multiplier;
}

function moneyNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const compact = value.trim().replaceAll(",", "");
  const match = compact.match(/[-+]?\d+(?:\.\d+)?/);
  if (!match) return undefined;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function financialMoneyDisplay(value: number, data: StockScoreResponse | undefined): string {
  if (!data || data.market === "KR" || data.currency === "KRW") return formatKoreanWonLarge(value);
  const converted = typeof data.usd_krw_rate === "number" && Number.isFinite(data.usd_krw_rate) ? formatKoreanWonLarge(value * data.usd_krw_rate) : undefined;
  const source = formatCompactUsd(value);
  return converted && converted !== "-" ? `${converted} (${source})` : source;
}

export function formatPrimaryPrice(data: StockScoreResponse, fallback = "-"): string {
  const currency = priceCurrency(data);
  const providerLabel = providerPrimaryPriceLabel(stringFromUnknown(data.latest_price_label), currency);
  if (providerLabel) return providerLabel;
  const price = formatCurrencyAmount(numberFromUnknown(data.latest_price), currency);
  if (price !== "-") return price;
  return providerPrimaryPriceLabel(fallback, currency) || fallback.replace(/\s*\(.+\)$/, "").trim() || "-";
}

export function formatSecondaryPrice(data: StockScoreResponse): string {
  if (priceCurrency(data) === "KRW") return "국내 원화 기준";
  return formatApproxKrwAmount(numberFromUnknown(data.latest_price), numberFromUnknown(data.usd_krw_rate)) || "원화 환산 정보가 없어요";
}

export function formatPriceWithContext(data: StockScoreResponse): string {
  const primary = formatPrimaryPrice(data);
  const secondary = formatSecondaryPrice(data);
  if (!secondary || secondary === "국내 원화 기준" || secondary === "원화 환산 정보가 없어요") return primary;
  return `${primary} (${secondary})`;
}

export const formatUsdPrice = formatPrimaryPrice;
export const formatKrwPrice = formatSecondaryPrice;

function priceCurrency(data: StockScoreResponse): string {
  return stringFromUnknown(data.currency) || (data.market === "KR" ? "KRW" : "USD");
}

function providerPrimaryPriceLabel(value: string | undefined, currency: string): string | undefined {
  const label = value?.trim();
  if (!label || label === "-") return undefined;
  const primary = label.split("/")[0]?.replace(/\s*\(.+\)$/, "").trim();
  if (!primary || primary === "-") return undefined;
  if (currency === "USD" && primary.startsWith("$")) return primary;
  if (currency === "KRW" && primary.includes("원")) return primary;
  if (currency !== "USD" && currency !== "KRW" && primary.toUpperCase().startsWith(`${currency} `)) return primary;
  return undefined;
}

function numberFromUnknown(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function stringFromUnknown(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function recordFromUnknown(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

export function snapshotPendingFromPayload(payload: unknown, fallbackTicker: string): SnapshotPendingState | undefined {
  const record = recordFromUnknown(payload);
  if (record?.type === "partial_stock_snapshot" && record.pending_snapshot) {
    return snapshotPendingFromPayload(record.pending_snapshot, fallbackTicker);
  }
  const error = stringFromUnknown(record?.error);
  if (error !== "snapshot_pending" && error !== "snapshot_unavailable") return undefined;

  const refreshRequest = recordFromUnknown(record?.refresh_request);
  const queued = refreshRequest?.queued === true;
  const retryAfterSeconds = numberFromUnknown(record?.retry_after_seconds);
  const ticker = stringFromUnknown(record?.ticker) || fallbackTicker;
  const reason = stringFromUnknown(record?.reason);
  let message = "종목 정보를 화면에 반영합니다.";
  if (queued && reason === "stale_refresh") {
    message = "표시 중인 데이터에 최신 가격과 점수를 조용히 반영합니다.";
  } else if (queued) {
    message = "가격과 점수가 확보되는 즉시 화면에 반영합니다.";
  } else {
    message = "확보된 항목부터 화면에 바로 반영합니다.";
  }

  return {
    message,
    ticker,
    queued,
    retryAfterSeconds,
  };
}

export function partialStockStatusSummary(defaultSummary: string, pending: SnapshotPendingState | undefined): string {
  if (!pending) return defaultSummary;
  if (pending.message) return pending.message;
  if (pending.queued) return "자료가 준비되는 대로 화면에 반영합니다.";
  return defaultSummary;
}

function arrayFromUnknown(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function marketFromPartial(
  record: Record<string, unknown> | undefined,
  quote: Record<string, unknown> | undefined,
  chart: Record<string, unknown> | undefined,
  ticker: string
): "US" | "KR" | undefined {
  const value = stringFromUnknown(record?.market) || stringFromUnknown(quote?.market) || stringFromUnknown(chart?.market);
  if (value === "US" || value === "KR") return value;
  if (ticker.startsWith("KR:")) return "KR";
  if (ticker.startsWith("US:")) return "US";
  return undefined;
}

function numberFromJsonRecord(record: Record<string, JsonValue> | undefined, key: string): number | undefined {
  return numberFromUnknown(record?.[key]);
}

export function scoreDataWithQuote(data: StockScoreResponse, quote: StockQuoteResponse | undefined): StockScoreResponse {
  const latestPrice = numberFromUnknown(quote?.latest_price);
  if (latestPrice === undefined) return data;
  const nextData: StockScoreResponse = {
    ...data,
    currency: stringFromUnknown(quote?.currency) || data.currency,
    latest_price: latestPrice,
    latest_bar_date: stringFromUnknown(quote?.latest_bar_date) || data.latest_bar_date,
    usd_krw_rate: numberFromUnknown(quote?.usd_krw_rate) ?? data.usd_krw_rate,
  };
  const marketCap = numberFromUnknown(quote?.market_cap) ?? numberFromUnknown(data.market_cap);
  const marketCapLabel = stringFromUnknown(quote?.market_cap_label) || stringFromUnknown(data.market_cap_label);
  if (marketCap !== undefined) nextData.market_cap = marketCap;
  if (marketCapLabel) nextData.market_cap_label = marketCapLabel;
  const latestPriceLabel = stringFromUnknown(quote?.latest_price_label) || data.latest_price_label;
  const usdKrwLabel = stringFromUnknown(quote?.usd_krw_label) || data.usd_krw_label;
  if (latestPriceLabel) nextData.latest_price_label = latestPriceLabel;
  if (usdKrwLabel) nextData.usd_krw_label = usdKrwLabel;
  return nextData;
}

export function priceVolatilitySummaryItems(data: StockScoreResponse): LabeledValue[] {
  const metrics = data.price_metrics;
  if (!metrics) return [];
  const currency = priceCurrency(data);
  const items: LabeledValue[] = [];
  addSummaryItem(items, "RSI14", formatValue(numberFromJsonRecord(metrics, "rsi14")));
  addSummaryItem(items, "ATR14 비중", formatUnsignedPercent(numberFromJsonRecord(metrics, "atr14_pct")));
  addSummaryItem(items, "50일 평균", formatCurrencyAmount(numberFromJsonRecord(metrics, "sma50"), currency));
  addSummaryItem(items, "200일 평균", formatCurrencyAmount(numberFromJsonRecord(metrics, "sma200"), currency));
  addSummaryItem(items, "60일 평균 거래량", formatValue(numberFromJsonRecord(metrics, "avg_volume_60")));
  addSummaryItem(items, "52주 고점 거리", formatPercent(numberFromJsonRecord(metrics, "distance_from_52w_high")));
  return items;
}

function addSummaryItem(items: LabeledValue[], label: string, value: string) {
  if (!value || value === "-") return;
  items.push({ label, value });
}

function formatUnsignedPercent(value: number | undefined): string {
  if (value === undefined) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

const SIGNAL_LABELS: Record<string, string> = {
  price_momentum_positive: "흐름 우호",
  price_risk_watch: "리스크 확인",
  price_neutral: "중립",
  buy: "매수 우세",
  sell: "매도 주의",
  hold: "관망",
  bullish: "흐름 우호",
  bearish: "리스크 확인",
  neutral: "중립",
};

const RISK_LEVEL_LABELS: Record<string, string> = {
  low: "낮음",
  medium: "보통",
  moderate: "보통",
  high: "높음",
  elevated: "높음",
};

export function signalLabel(value: unknown): string {
  const raw = stringFromUnknown(value);
  if (!raw || raw === "-") return "-";
  const key = raw.trim().toLowerCase();
  if (SIGNAL_LABELS[key]) return SIGNAL_LABELS[key];
  if (key.includes("momentum") || key.includes("positive") || key.includes("bull")) return "흐름 우호";
  if (key.includes("risk") || key.includes("bear") || key.includes("negative")) return "리스크 확인";
  if (key.includes("hold")) return "관망";
  if (key.includes("neutral")) return "중립";
  return "분류 전";
}

export function riskLevelLabel(value: unknown): string {
  const raw = stringFromUnknown(value);
  if (!raw || raw === "-") return "-";
  const key = raw.trim().toLowerCase();
  if (RISK_LEVEL_LABELS[key]) return RISK_LEVEL_LABELS[key];
  if (key.includes("high")) return "높음";
  if (key.includes("low")) return "낮음";
  if (key.includes("medium") || key.includes("moderate")) return "보통";
  return "분류 전";
}

export function scoreFreshnessSummary(data: StockScoreResponse): ScoreFreshnessSummary {
  const cache = recordFromUnknown(data.server_cache);
  const state = stringFromUnknown(cache?.state);
  const refreshStarted = cache?.refresh_started === true;
  const detail = scoreFreshnessDetail(state, refreshStarted);

  if (state === "fresh") {
    return {
      label: "점수 기준",
      value: "최신 데이터",
      detail,
      tone: "fresh",
    };
  }

  if (state === "stale") {
    return {
      label: "점수 기준",
      value: "업데이트 반영",
      detail,
      tone: "stale",
    };
  }

  if (state === "miss") {
    return {
      label: "점수 기준",
      value: "점수 반영 전",
      detail,
      tone: "pending",
    };
  }

  return {
    label: "점수 기준",
    value: "상태 반영 전",
    detail,
    tone: "unknown",
  };
}

export function scoreFreshnessTimeChip(data: StockScoreResponse): string | undefined {
  const cache = recordFromUnknown(data.server_cache);
  return freshnessChipLabel(cache);
}

export function stockHeaderFreshnessTimeChip(data: StockScoreResponse, quote: StockQuoteResponse | undefined): string | undefined {
  const scoreCache = recordFromUnknown(data.server_cache);
  const quoteCache = recordFromUnknown(quote?.server_cache);
  const scoreFetchedAt = cacheTimestamp(scoreCache, "fetched_at");
  const quoteFetchedAt = cacheTimestamp(quoteCache, "fetched_at");
  let fetchedAt = scoreFetchedAt;
  if (quoteFetchedAt && (!scoreFetchedAt || Date.parse(quoteFetchedAt) > Date.parse(scoreFetchedAt))) {
    fetchedAt = quoteFetchedAt;
  }
  const newestCache = fetchedAt && quoteFetchedAt === fetchedAt ? quoteCache : scoreCache;
  return freshnessChipLabel(newestCache) || (fetchedAt ? "데이터 확인 완료" : undefined);
}

function scoreFreshnessDetail(state: string | undefined, refreshStarted: boolean): string {
  if (refreshStarted) return "업데이트 확인";
  if (state === "fresh") return "점수 반영 완료";
  if (state === "stale") return "최신 점수 반영";
  if (state === "miss") return "점수 미반영";
  return "데이터 상태 반영 전";
}

function freshnessChipLabel(cache: Record<string, unknown> | undefined): string | undefined {
  const state = stringFromUnknown(cache?.state);
  if (cache?.refresh_started === true) return undefined;
  if (state === "fresh") return "최신 데이터";
  if (state === "stale") return "업데이트 반영";
  if (state === "miss") return undefined;
  return cacheTimestamp(cache, "fetched_at") ? "데이터 확인 완료" : undefined;
}

function cacheTimestamp(cache: Record<string, unknown> | undefined, key: string): string | undefined {
  const direct = stringFromUnknown(cache?.[key]);
  if (direct && Number.isFinite(Date.parse(direct))) return direct;
  const millis = numberFromUnknown(cache?.[`${key}_ms`]);
  if (millis === undefined) return undefined;
  return new Date(millis).toISOString();
}

export function dailyChangeText(data: StockScoreResponse, quote: StockQuoteResponse | undefined): string {
  const cachedChange = numberFromJsonRecord(data.price_metrics, "latest_change");
  const quoteChange = numberFromUnknown(quote?.latest_change);
  if (quoteChange !== undefined && shouldTrustQuoteChange(quoteChange, cachedChange)) {
    return stringFromUnknown(quote?.latest_change_label) || formatPercent(quoteChange);
  }
  const quoteLabel = stringFromUnknown(quote?.latest_change_label);
  if (quoteLabel && quoteChange === undefined) return quoteLabel;
  if (cachedChange !== undefined) return formatPercent(cachedChange);
  if (quoteChange !== undefined) return formatPercent(quoteChange);
  if (quoteLabel) return quoteLabel;
  return "-";
}

function shouldTrustQuoteChange(quoteChange: number, cachedChange: number | undefined): boolean {
  if (!Number.isFinite(quoteChange)) return false;
  if (cachedChange === undefined || !Number.isFinite(cachedChange)) return true;
  if (Math.abs(quoteChange) <= 2) return true;
  return Math.abs(cachedChange) > 0.5;
}

export function dailyToneClass(text: string): "price-up" | "price-down" | "price-neutral" {
  const value = text.trim();
  if (!value || value === "-" || value.startsWith("0")) return "price-neutral";
  if (value.startsWith("-") || value.startsWith("−")) return "price-down";
  if (value.startsWith("+")) return "price-up";
  return "price-neutral";
}

export function chartSummary(points: UsableChartPoint[]): string {
  if (points.length < 1) return "가격 차트 데이터가 충분하지 않아요.";
  if (points.length === 1) {
    const point = points[0];
    return `${point.date} 첫 가격 기록입니다. 확인된 가격은 ${chartPointPriceLabel(point)}입니다.`;
  }
  const first = points[0];
  const last = points[points.length - 1];
  let high = first;
  let low = first;
  for (const point of points) {
    if (point.close > high.close) high = point;
    if (point.close < low.close) low = point;
  }
  const change = first.close !== 0 ? (last.close / first.close) - 1 : undefined;
  return `${first.date}부터 ${last.date}까지 ${points.length}개 가격 지점입니다. 시작 ${chartPointPriceLabel(first)}, 마지막 ${chartPointPriceLabel(last)}, 기간 변화 ${formatPercent(change)}, 최고 ${chartPointPriceLabel(high)}, 최저 ${chartPointPriceLabel(low)}.`;
}

export function chartPointPriceLabel(point: Pick<UsableChartPoint, "close" | "close_label" | "currency">): string {
  const currency = typeof point.currency === "string" ? point.currency : undefined;
  const providerLabel = providerPrimaryPriceLabel(point.close_label, currency || "");
  if (providerLabel) return providerLabel;
  if (currency) return formatCurrencyAmount(point.close, currency);
  const label = point.close_label?.trim();
  const primaryLabel = label?.split("/")[0]?.replace(/\s*\(.+\)$/, "").trim();
  if (primaryLabel) return primaryLabel;
  return formatCurrencyAmount(point.close, undefined);
}

export function compactChartNumber(value: number): string {
  return KO_KR_CHART_FORMATTER.format(value);
}

export function refreshCooldownMessage(nextAllowedAt: string | undefined): string | undefined {
  if (!nextAllowedAt || Date.parse(nextAllowedAt) <= Date.now()) return undefined;
  return "잠시 후 새로고침 가능";
}

function removeSourceText(text: string): string {
  const vendor = SOURCE_VENDOR_TEXT;
  return text
    .replaceAll(`${vendor} Open API 기준 `, "")
    .replaceAll(`${vendor}가 제공하는 `, "")
    .replaceAll(`${vendor} 기간별 시세로 `, "")
    .replaceAll(`${vendor} 일별 시세로 `, "")
    .replaceAll(`${vendor} 현재가상세의 `, "")
    .replaceAll(`${vendor} 국내 현재가의 `, "")
    .replaceAll(`${vendor}의 `, "")
    .replaceAll(`${vendor}에서 조회했어요.`, "함께 봤어요.")
    .replaceAll(`${vendor} 현재가상세 기준`, "")
    .replaceAll(`${vendor} 국내 현재가 기준`, "")
    .replaceAll(vendor, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function isSourceOnlyLabel(label: string | undefined): boolean {
  return !!label && (label.includes(SOURCE_VENDOR_TEXT) || label.includes(SOURCE_LABEL_TEXT));
}

export function displayTickerInput(value: string): string {
  return value.replace(/^(US|KR):/i, "");
}

export function symbolRef(item: SymbolSearchItem): string {
  return `${item.market}:${item.ticker}`;
}

export function directInputSymbolItem(value: string): SymbolSearchItem | undefined {
  const resolved = resolveTickerAlias(value);
  if (resolved.ok && resolved.source !== "symbol_master") {
    const label = value.trim();
    return {
      key: resolved.ticker,
      market: resolved.market,
      ticker: resolved.symbol,
      displayName: label || resolved.symbol,
      subtitle: resolved.ticker,
      exchange: "",
      exchangeName: "직접 입력",
      koreanName: /[가-힣]/.test(label) ? label : "",
      englishName: resolved.symbol,
      instrumentType: "STOCK",
    };
  }

  const ticker = cleanTickerSymbol(value);
  if (!ticker) return undefined;
  return {
    key: ticker,
    market: /^(?:[0-9][A-Z0-9]{5}|Q\d{6})$/.test(ticker) ? "KR" : "US",
    ticker,
    displayName: ticker,
    subtitle: ticker,
    exchange: "",
    exchangeName: "직접 입력",
    koreanName: "",
    englishName: ticker,
    instrumentType: "STOCK",
  };
}

export function humanizeRecordKey(key: string): string {
  return RECORD_LABELS[key] || key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ");
}

export function formatRecordValue(key: string, value: JsonValue | undefined, data?: StockScoreResponse): string {
  if (typeof value === "number") {
    if (PERCENT_RECORD_KEYS.has(key)) return formatPercent(value);
    if (key === "debtToEquity") return `${value.toFixed(1)}%`;
    if (key === "recommendationMean") return `${formatValue(value)} / 5`;
    if (LARGE_MONEY_RECORD_KEYS.has(key)) return financialMoneyDisplay(value, data);
    if (data && PRICE_RECORD_KEYS.has(key)) return formatCurrencyAmount(value, priceCurrency(data));
  }
  return formatValue(value);
}

export function isRecordValue(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function visibleRecordEntries(record: Record<string, JsonValue>) {
  return recordEntries(record).filter(([key]) => !HIDDEN_RECORD_KEYS.has(key));
}

export function componentWord(score: number): string {
  if (score >= 80) return "좋음";
  if (score >= 60) return "무난";
  if (score >= 45) return "보통";
  return "주의";
}

export function componentHasDisplayableScore(component: ScoreComponent): boolean {
  const score = numberFromUnknown(component.score);
  if (score === undefined) return false;

  const key = component.key?.trim() || "";
  const evidenceRule = componentEvidenceRule(key);
  if (evidenceRule) return component.metrics?.some(evidenceRule) || false;
  if (component.metrics?.length && !component.metrics.some(hasUsableMetricValue)) return false;
  if (Math.abs(score - NEUTRAL_FALLBACK_SCORE) > 0.05) return true;
  return component.metrics?.some(hasUsableMetricValue) || false;
}

export function componentScoreText(component: ScoreComponent): string {
  if (!componentHasDisplayableScore(component)) return "점수 없음";
  const score = clampScore(component.score);
  return `${score.toFixed(1)} · ${componentWord(score)}`;
}

export function hasDisplayableScoreComponents(components: ScoreComponent[] | undefined): boolean {
  return (components || []).some(componentHasDisplayableScore);
}

function componentEvidenceRule(key: string): ((metric: LabeledValue) => boolean) | undefined {
  if (ANALYST_COMPONENT_KEYS.has(key)) return isAnalystEvidenceMetric;
  if (VALUATION_COMPONENT_KEYS.has(key)) return isValuationEvidenceMetric;
  if (PROFITABILITY_COMPONENT_KEYS.has(key)) return isProfitabilityEvidenceMetric;
  if (QUALITY_GROWTH_COMPONENT_KEYS.has(key)) return isFinancialGrowthEvidenceMetric;
  if (PRICE_GROWTH_COMPONENT_KEYS.has(key)) return isPriceTrendEvidenceMetric;
  if (STABILITY_COMPONENT_KEYS.has(key)) return isStabilityEvidenceMetric;
  if (MOMENTUM_COMPONENT_KEYS.has(key)) return isPriceTrendEvidenceMetric;
  if (LIQUIDITY_COMPONENT_KEYS.has(key)) return isLiquidityEvidenceMetric;
  return undefined;
}

function isAnalystEvidenceMetric(metric: LabeledValue): boolean {
  const label = metric.label?.trim() || "";
  if (TARGET_PRICE_LABEL_RE.test(label)) return hasUsableMetricValue(metric);
  if (label === "목표가 여지") return hasUsableMetricValue(metric);
  if (ANALYST_COUNT_LABEL_RE.test(label)) {
    const count = moneyNumber(metric.value);
    return count !== undefined && count > 0;
  }
  if (RECOMMENDATION_MEAN_LABEL_RE.test(label)) return hasUsableMetricValue(metric);
  return false;
}

function isValuationEvidenceMetric(metric: LabeledValue): boolean {
  const label = metric.label?.trim() || "";
  if (!VALUATION_EVIDENCE_LABEL_RE.test(label)) return false;
  const parsed = moneyNumber(metric.value);
  return parsed !== undefined && parsed > 0;
}

function isProfitabilityEvidenceMetric(metric: LabeledValue): boolean {
  const label = metric.label?.trim() || "";
  return PROFITABILITY_EVIDENCE_LABEL_RE.test(label) && hasUsableMetricValue(metric);
}

function isFinancialGrowthEvidenceMetric(metric: LabeledValue): boolean {
  const label = metric.label?.trim() || "";
  return FINANCIAL_GROWTH_EVIDENCE_LABEL_RE.test(label) && hasUsableMetricValue(metric);
}

function isPriceTrendEvidenceMetric(metric: LabeledValue): boolean {
  const label = metric.label?.trim() || "";
  return PRICE_TREND_EVIDENCE_LABEL_RE.test(label) && hasUsableMetricValue(metric);
}

function isStabilityEvidenceMetric(metric: LabeledValue): boolean {
  const label = metric.label?.trim() || "";
  return STABILITY_EVIDENCE_LABEL_RE.test(label) && hasUsableMetricValue(metric);
}

function isLiquidityEvidenceMetric(metric: LabeledValue): boolean {
  const label = metric.label?.trim() || "";
  return LIQUIDITY_EVIDENCE_LABEL_RE.test(label) && hasUsableMetricValue(metric);
}

function hasUsableMetricValue(metric: LabeledValue): boolean {
  const label = metric.label?.trim() || "";
  if (NON_EVIDENCE_METRIC_LABEL_RE.test(label)) return false;
  return !isMissingDisplayValue(metric.value);
}

function isMissingDisplayValue(value: unknown): boolean {
  const text = formatValue(value as JsonValue | undefined).trim();
  return !text || text === "-" || /^n\/a$/i.test(text) || text === "없음" || text === "대기";
}

export function strongestAndWeakest(data: StockScoreResponse) {
  let strongest: ScoreComponent | undefined;
  let weakest: ScoreComponent | undefined;
  let strongestScore = -1;
  let weakestScore = 101;
  let count = 0;
  for (const component of data.components || []) {
    if (!componentHasDisplayableScore(component)) continue;
    count += 1;
    const strongScore = component.score ?? -1;
    const weakScore = component.score ?? 101;
    if (!strongest || strongScore > strongestScore) {
      strongest = component;
      strongestScore = strongScore;
    }
    if (!weakest || weakScore < weakestScore) {
      weakest = component;
      weakestScore = weakScore;
    }
  }
  return { strongest, weakest: count > 1 ? weakest : undefined };
}

export function stockHeaderIdentity(data: StockScoreResponse, quote?: StockQuoteResponse): StockHeaderIdentity {
  const symbol = stringFromUnknown(quote?.symbol) || stringFromUnknown(data.symbol) || stringFromUnknown(data.requested_ticker) || "KO";
  const symbolLabel = displayTicker({ ticker: symbol }) || symbol;
  const market = stringFromUnknown(quote?.market) || stringFromUnknown(data.market);
  const instrumentType = stringFromUnknown(data.instrument_type) || stringFromUnknown(recordFromUnknown(data.industry_profile)?.asset_class);
  const quoteName = stringFromUnknown(quote?.name);
  const dataName = stringFromUnknown(data.name);
  const name =
    meaningfulHeaderName(stringFromUnknown(data.korean_name), symbolLabel, data.requested_ticker)
    || meaningfulHeaderName(stringFromUnknown(data.display_name), symbolLabel, data.requested_ticker)
    || meaningfulHeaderName(stringFromUnknown(data.english_name), symbolLabel, data.requested_ticker)
    || meaningfulHeaderName(quoteName, symbolLabel, data.requested_ticker)
    || meaningfulHeaderName(dataName, symbolLabel, data.requested_ticker)
    || "";

  if (isUsDerivativeSymbol({ ...data, ticker: symbol, market, instrument_type: instrumentType, name })) {
    return { primary: symbolLabel, secondary: name, primaryKind: "ticker" };
  }

  if (name) {
    return { primary: name, secondary: symbolLabel, primaryKind: "name" };
  }

  return { primary: symbolLabel, secondary: name, primaryKind: "ticker" };
}

export function opportunityExtremes(components: ScoreComponent[] | undefined): OpportunityExtremes {
  let best: OpportunityExtreme | undefined;
  let worst: OpportunityExtreme | undefined;
  let count = 0;
  for (const component of components || []) {
    const score = numberFromUnknown(component.score);
    const label = shortOpportunityLabel(component.label || component.key);
    if (score === undefined || !label) continue;
    const current = { label, score };
    count += 1;
    if (!best || score > best.score) best = current;
    if (!worst || score < worst.score) worst = current;
  }

  return { best, worst: count > 1 ? worst : undefined };
}

export function shouldUseCompactMetricGrid(component: ScoreComponent): boolean {
  const metrics = component.metrics || [];
  if (metrics.length < 2 || metrics.length > 3) return false;
  return metrics.every((metric) => isCompactMetric(metric));
}

export function visibleLabeledItems(items: LabeledValue[] | undefined): LabeledValue[] {
  return (items || [])
    .filter((item) => !isHiddenLabeledItem(item))
    .map((item) => ({ ...item, label: displayLabeledItemLabel(item.label) }));
}

function isHiddenLabeledItem(item: LabeledValue): boolean {
  const label = item.label?.trim();
  return !!label && (isSourceOnlyLabel(label) || HIDDEN_LABELED_ITEM_LABELS.has(label) || isInternalPipelineMetric(item));
}

function isInternalPipelineMetric(item: LabeledValue): boolean {
  const label = item.label?.trim() || "";
  const value = formatValue(item.value as JsonValue | undefined).trim();
  if (label === "보강 상태") return true;
  if (label === "근거" && /^(?:가격 데이터 우선|대기|보강|pending)$/i.test(value)) return true;
  return false;
}

function displayLabeledItemLabel(label: string | undefined): string | undefined {
  const trimmed = label?.trim();
  if (!trimmed) return label;
  return LABEL_REPLACEMENTS[trimmed] || trimmed;
}

function isCompactMetric(metric: LabeledValue): boolean {
  const label = metric.label?.trim();
  if (!label || !COMPACT_METRIC_LABELS.has(label)) return false;
  if (label.length > 9) return false;

  const value = formatValue(metric.value).trim();
  if (!value || value.length > 8) return false;
  if (COMPACT_METRIC_BLOCKED_VALUE_RE.test(value)) return false;
  return true;
}

function meaningfulHeaderName(value: string | undefined, symbol: string, requestedTicker: string | undefined): string | undefined {
  const name = value?.trim();
  if (!name) return undefined;
  const comparableName = name.toUpperCase().replace(/[^A-Z0-9가-힣]/g, "");
  const comparableSymbol = symbol.toUpperCase().replace(/[^A-Z0-9가-힣]/g, "");
  const comparableRequested = (requestedTicker || "").toUpperCase().replace(/[^A-Z0-9가-힣]/g, "");
  if (comparableName === comparableSymbol || comparableName === comparableRequested) return undefined;
  return name;
}

function shortOpportunityLabel(value: string | undefined): string | undefined {
  const label = value?.trim();
  if (!label) return undefined;
  return label.replace(/^기회\s*/, "");
}

export function termTipFor(label: string | undefined) {
  if (!label) return undefined;
  const normalized = label.toLowerCase();
  return TERM_TIPS.find((tip) => tip.keys.some((key) => normalized.includes(key)));
}

export function easySentence(text: string | undefined): string {
  if (!text) return "";
  return removeSourceText(text)
    .replaceAll("봐야 합니다.", "봐야 해요.")
    .replaceAll("보수적으로 봐야 합니다.", "보수적으로 봐야 해요.")
    .replaceAll("봅니다.", "봐요.")
    .replaceAll("합칩니다.", "함께 봐요.")
    .replaceAll("점수화합니다.", "점수로 바꿔요.")
    .replaceAll("입니다.", "이에요.")
    .replaceAll("합니다.", "해요.");
}

export function formatNote(note: unknown): string | undefined {
  if (typeof note !== "string" || !note) return undefined;
  const cleaned = removeSourceText(note);
  if (!cleaned) return undefined;
  if (SOURCE_NOTE_RE.test(cleaned.trim())) return undefined;
  return NOTE_COPY[cleaned] || easySentence(cleaned);
}

export function factorSummary(component: ScoreComponent): string {
  const label = component.label || component.key || "";
  if (!componentHasDisplayableScore(component)) return scorelessFactorSummary(label);
  if (label.includes("수익성")) return "순이익률, ROE, 현금흐름처럼 실제로 돈을 잘 버는지 봐요.";
  if (label.includes("성장성")) return "매출과 이익이 커지는 속도, 최근 가격 흐름을 같이 봐요.";
  if (label.includes("재무건전성")) return "부채 부담과 단기 현금 여력을 봐요. 버틸 체력이 중요해요.";
  if (label.includes("거래 안정성")) return "거래량, 시가총액, 부채 부담, 현금흐름처럼 거래 체력을 봐요.";
  if (label.includes("모멘텀")) return "최근 가격이 올라가는 힘이 있는지, 고점에서 얼마나 떨어져 있는지 봐요.";
  if (label.includes("밸류에이션")) return "좋은 회사라도 가격이 너무 비싸면 점수가 낮아질 수 있어요.";
  return easySentence(component.summary) || "관련 숫자를 묶어서 점수로 바꿔요.";
}

function scorelessFactorSummary(label: string): string {
  if (label.includes("수익성")) return "이익률과 현금흐름 자료가 부족해 아직 판단을 보류해요.";
  if (label.includes("성장성") || label.includes("성장 기대")) return "매출과 이익 성장 자료가 부족해 아직 판단을 보류해요.";
  if (label.includes("재무건전성") || label.includes("거래 안정성") || label.includes("안정성")) return "변동성이나 재무 체력 자료가 더 쌓이면 판단할 수 있어요.";
  if (label.includes("모멘텀") || label.includes("최근 흐름")) return "가격 흐름 자료가 더 쌓이면 추세를 판단할 수 있어요.";
  if (label.includes("밸류에이션") || label.includes("가격 부담")) return "PER, PBR 같은 가격 부담 자료가 부족해 아직 판단하기 어려워요.";
  if (label.includes("분석") || label.includes("목표가") || label.includes("애널리스트")) return "목표가와 투자의견 자료가 부족해 아직 판단하기 어려워요.";
  return "아직 판단할 자료가 부족해요.";
}

export function formatMonthLabel(date: string | undefined): string {
  if (!date) return "";
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  return `${parsed.getMonth() + 1}월`;
}
