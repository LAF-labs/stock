import { formatApproxKrwAmount, formatCompactUsd, formatCurrencyAmount, formatKoreanWonLarge, formatPercent, formatValue, recordEntries } from "@/lib/format";
import { displayTicker, isUsDerivativeSymbol } from "@/lib/symbolDisplay";
import type { SymbolSearchItem } from "@/lib/symbolTypes";
import { cleanTickerSymbol } from "@/lib/tickerRef";
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
  returnOnEquity: "ROE",
  revenueGrowth: "매출 성장률",
  earningsGrowth: "이익 성장률",
  totalRevenue: "총매출",
  operatingCashflow: "영업현금흐름",
  debtToEquity: "부채/자본",
  currentRatio: "유동비율",
  quickRatio: "당좌비율",
  targetMeanPrice: "평균 목표가",
  numberOfAnalystOpinions: "애널리스트 수",
  recommendationMean: "투자의견 평균",
  beta: "베타",
  income_statement: "손익계산서",
  balance_sheet: "재무상태표",
  cashflow: "현금흐름표",
  reported_date: "보고 기준일",
  profitability_score: "수익성 기여도",
  growth_score: "성장성 기여도",
  health_score: "재무건전성 기여도",
  momentum_score: "모멘텀 기여도",
  valuation_score: "밸류에이션 기여도",
  quality_score: "품질 점수",
  opportunity_score: "기회 점수",
  opportunity_confidence: "기회 근거 충분도",
};

const HIDDEN_RECORD_KEYS = new Set(["source", "signal_source", "market_scope"]);
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
  "opportunity_confidence",
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
  "근거 충분도",
  "ATR14",
  "베타",
  "EPS",
  "BPS",
]);

const COMPACT_METRIC_BLOCKED_VALUE_RE = /[$₩€¥]|조|억|만|천|주|B|M|T|정상|확인|상한|,/i;
const PRICE_METRIC_LABELS = new Set(["현재가", "평균 목표가", "EPS", "BPS", "52주 고가", "52주 저가", "50일 평균", "200일 평균"]);
const LARGE_MONEY_RECORD_KEYS = new Set(["totalRevenue", "operatingCashflow", "freeCashflow", "totalCash", "totalDebt"]);
const PRICE_RECORD_KEYS = new Set(["price", "previous_close", "high_52w", "low_52w", "sma50", "sma200", "targetMeanPrice"]);
const HIDDEN_LABELED_ITEM_LABELS = new Set(["상품유형코드", "통화", "환율 기준", "매매 가능 여부", "거래가능여부", "거래 가능 여부", "거래상태", "적용 상한"]);
const LABEL_REPLACEMENTS: Record<string, string> = {
  신뢰도: "근거 충분도",
};
const SOURCE_NOTE_RE = /^(?:yfinance|yahoo finance(?:\s*기준)?|data source|source)$/i;

const KO_KR_CHART_FORMATTER = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 });
const KST_MINUTE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const KST_TIME_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

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
  { term: "Price/Sales", keys: ["price/sales"], body: "시가총액을 매출과 비교한 숫자예요." },
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
  { term: "근거 충분도", keys: ["근거 충분도"], body: "이 항목 점수에 쓸 데이터가 얼마나 충분했는지 보여줘요." },
  { term: "투자의견 평균", keys: ["투자의견 평균", "recommendationmean"], body: "애널리스트 투자의견을 평균낸 값이에요. 1에 가까울수록 매수 쪽, 5에 가까울수록 매도 쪽이에요." },
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
  const ticker = value?.trim().toUpperCase();
  return ticker || undefined;
}

export function dashboardInputValue(ticker: string | undefined): string {
  return ticker ? displayTickerInput(ticker) : "";
}

export function shouldShowStockSkeleton(status: string, hasUsefulPartialData = false): boolean {
  return status === "loading" || (status === "pending" && !hasUsefulPartialData);
}

export type DashboardPendingRetryTarget = Pick<SnapshotPendingState, "message" | "retryAfterSeconds"> &
  Partial<Pick<SnapshotPendingState, "ticker" | "queued">>;

export function pendingRetryTargetForDashboard(
  ticker: string | undefined,
  scorePending: DashboardPendingRetryTarget | undefined,
  quotePending: DashboardPendingRetryTarget | undefined
): { pending: DashboardPendingRetryTarget; retryKey: string } | undefined {
  if (!ticker) return undefined;
  const pending = scorePending || quotePending;
  return pending ? { pending, retryKey: `stock:${ticker}` } : undefined;
}

export function shouldPreservePendingViewDuringRetry(status: string, isRetryForSameTicker: boolean): boolean {
  return isRetryForSameTicker && (status === "pending" || status === "partial");
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

  return data.latest_price !== undefined || usableChartPoints(data.chart_series).length > 1 ? data : undefined;
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

export function stockJudgmentRequestPayload(data: StockScoreResponse): Record<string, unknown> {
  return compactRecord({
    requested_ticker: data.requested_ticker,
    market: data.market,
    symbol: data.symbol,
    name: data.name,
    latest_bar_date: data.latest_bar_date,
    score: data.score,
    quality_score: data.quality_score,
    opportunity_score: data.opportunity_score,
    sector: typeof data.sector === "string" ? data.sector : undefined,
    industry: typeof data.industry === "string" ? data.industry : undefined,
    sia_snapshot: data.sia_snapshot
      ? compactRecord({
          raw_signal: data.sia_snapshot.raw_signal,
          risk_level: data.sia_snapshot.risk_level,
        })
      : undefined,
    key_metrics: compactMetrics(data.key_metrics, 12),
    valuation_rows: compactMetrics(data.valuation_rows, 8),
    stock_profile: compactMetrics(data.stock_profile, 16),
    components: compactComponents(data.components),
  });
}

export function stockMarketCapDisplay(data: StockScoreResponse): MarketCapDisplay {
  const rawValue = data.key_metrics?.find((item) => item.label === "시가총액")?.value;
  const parsed = marketCapNumber(rawValue);

  if (data.market === "KR" || data.currency === "KRW") {
    return { primary: parsed === undefined ? formatValue(rawValue) : formatKoreanWonLarge(parsed) };
  }

  const usdValue = parsed;
  const krwValue = typeof usdValue === "number" && typeof data.usd_krw_rate === "number" ? usdValue * data.usd_krw_rate : undefined;
  return {
    primary: krwValue === undefined ? formatValue(rawValue) : formatKoreanWonLarge(krwValue),
    secondary: usdValue === undefined ? undefined : `(${formatCompactUsd(usdValue)})`,
  };
}

export function formatMetricDisplayValue(item: LabeledValue, data?: StockScoreResponse): string {
  if (!data) return formatValue(item.value);
  const label = item.label?.trim() || "";
  if (label === "현재가") return formatPriceWithContext(data);
  if (label === "시가총액") return marketCapInlineDisplay(data);
  if (PRICE_METRIC_LABELS.has(label)) {
    const parsed = moneyNumber(item.value);
    if (parsed !== undefined) return formatCurrencyAmount(parsed, priceCurrency(data));
  }
  return formatValue(item.value);
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

function compactComponents(components: ScoreComponent[] | undefined): Array<Record<string, unknown>> | undefined {
  if (!components?.length) return undefined;
  return components.slice(0, 5).map((component) =>
    compactRecord({
      key: component.key,
      label: component.label,
      score: component.score,
      metrics: compactMetrics(component.metrics, 2),
    })
  );
}

function compactMetrics(items: LabeledValue[] | undefined, count: number): Array<Record<string, unknown>> | undefined {
  if (!items?.length) return undefined;
  return items.slice(0, count).map((item) =>
    compactRecord({
      label: item.label,
      value: item.value,
      note: item.note,
    })
  );
}

function compactRecord<T extends Record<string, unknown>>(record: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
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
  let message = "이 종목 데이터가 아직 준비되지 않았어요. 잠시 후 다시 조회해주세요.";
  if (queued && reason === "stale_refresh") {
    message = "기존 데이터를 보여주는 동안 최신 데이터를 다시 준비하고 있어요. 화면은 자동으로 다시 확인하고, 준비가 끝나면 최신 점수와 현재가를 바로 표시합니다.";
  } else if (queued) {
    message = "처음 조회하는 종목이라 데이터를 준비하고 있어요. 화면은 자동으로 다시 확인하고, 준비가 끝나면 점수와 현재가를 바로 표시합니다.";
  } else {
    message = "이 종목 데이터가 아직 준비되지 않았어요. 화면은 자동으로 다시 확인하고, 준비가 끝나면 바로 표시합니다.";
  }

  return {
    message,
    ticker,
    queued,
    retryAfterSeconds,
  };
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
  const latestPriceLabel = stringFromUnknown(quote?.latest_price_label) || data.latest_price_label;
  const usdKrwLabel = stringFromUnknown(quote?.usd_krw_label) || data.usd_krw_label;
  if (latestPriceLabel) nextData.latest_price_label = latestPriceLabel;
  if (usdKrwLabel) nextData.usd_krw_label = usdKrwLabel;
  return nextData;
}

export function scoreFreshnessSummary(data: StockScoreResponse): ScoreFreshnessSummary {
  const cache = recordFromUnknown(data.server_cache);
  const state = stringFromUnknown(cache?.state);
  const source = scoreFreshnessSourceLabel(stringFromUnknown(cache?.source));
  const fetchedAt = cacheTimestamp(cache, "fetched_at");
  const refreshStarted = cache?.refresh_started === true;
  const details = [source, fetchedAt ? `${formatKstMinute(fetchedAt)} 기준` : undefined, refreshStarted ? "새 점수 준비 중" : undefined].filter(
    (item): item is string => !!item
  );

  if (state === "fresh") {
    return {
      label: "점수 기준",
      value: "최신 스냅샷",
      detail: details.join(" · ") || "스냅샷 기준 확인 중",
      tone: "fresh",
    };
  }

  if (state === "stale") {
    return {
      label: "점수 기준",
      value: "오래된 스냅샷",
      detail: details.join(" · ") || "새 점수 준비 중",
      tone: "stale",
    };
  }

  if (state === "miss") {
    return {
      label: "점수 기준",
      value: "생성 대기",
      detail: details.join(" · ") || "스냅샷 생성 대기",
      tone: "pending",
    };
  }

  return {
    label: "점수 기준",
    value: "기준 확인 중",
    detail: details.join(" · ") || "스냅샷 기준 확인 중",
    tone: "unknown",
  };
}

export function scoreFreshnessTimeChip(data: StockScoreResponse): string | undefined {
  const cache = recordFromUnknown(data.server_cache);
  const fetchedAt = cacheTimestamp(cache, "fetched_at");
  const time = fetchedAt ? formatKstTime(fetchedAt) : undefined;
  return time ? `${time} 기준` : undefined;
}

export function stockHeaderFreshnessTimeChip(data: StockScoreResponse, quote: StockQuoteResponse | undefined): string | undefined {
  const scoreFetchedAt = cacheTimestamp(recordFromUnknown(data.server_cache), "fetched_at");
  const quoteFetchedAt = cacheTimestamp(recordFromUnknown(quote?.server_cache), "fetched_at");
  const fetchedAt = newestTimestamp(scoreFetchedAt, quoteFetchedAt);
  const time = fetchedAt ? formatKstTime(fetchedAt) : undefined;
  return time ? `${time} 기준` : undefined;
}

function scoreFreshnessSourceLabel(source: string | undefined): string {
  if (source === "supabase") return "Supabase";
  if (source === "market-data") return "Rust market-data";
  if (source === "cache") return "Rust cache";
  if (source === "queue") return "Refresh queue";
  if (source === "provider") return "Provider";
  return "Score snapshot";
}

function cacheTimestamp(cache: Record<string, unknown> | undefined, key: string): string | undefined {
  const direct = stringFromUnknown(cache?.[key]);
  if (direct && Number.isFinite(Date.parse(direct))) return direct;
  const millis = numberFromUnknown(cache?.[`${key}_ms`]);
  if (millis === undefined) return undefined;
  return new Date(millis).toISOString();
}

function newestTimestamp(...values: Array<string | undefined>): string | undefined {
  let newest: string | undefined;
  let newestMs = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!value) continue;
    const millis = Date.parse(value);
    if (!Number.isFinite(millis) || millis <= newestMs) continue;
    newest = value;
    newestMs = millis;
  }
  return newest;
}

function formatKstMinute(value: string): string | undefined {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return undefined;
  const parts = KST_MINUTE_FORMATTER.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  const hour = part("hour");
  const minute = part("minute");
  if (!year || !month || !day || !hour || !minute) return undefined;
  return `${year}-${month}-${day} ${hour}:${minute} KST`;
}

function formatKstTime(value: string): string | undefined {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return undefined;
  const parts = KST_TIME_FORMATTER.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  const hour = part("hour");
  const minute = part("minute");
  if (!hour || !minute) return undefined;
  return `${hour}:${minute}`;
}

export function dailyChangeText(data: StockScoreResponse, quote: StockQuoteResponse | undefined): string {
  const quoteLabel = stringFromUnknown(quote?.latest_change_label);
  if (quoteLabel) return quoteLabel;
  const quoteChange = numberFromUnknown(quote?.latest_change);
  if (quoteChange !== undefined) return formatPercent(quoteChange);
  const cachedChange = numberFromJsonRecord(data.price_metrics, "latest_change");
  if (cachedChange !== undefined) return formatPercent(cachedChange);
  return "-";
}

export function dailyToneClass(text: string): "price-up" | "price-down" | "price-neutral" {
  const value = text.trim();
  if (!value || value === "-" || value.startsWith("0")) return "price-neutral";
  if (value.startsWith("-") || value.startsWith("−")) return "price-down";
  if (value.startsWith("+")) return "price-up";
  return "price-neutral";
}

export function chartSummary(points: UsableChartPoint[]): string {
  if (points.length < 2) return "가격 차트 데이터가 충분하지 않아요.";
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
  return `${formatKstTime(nextAllowedAt) || new Date(nextAllowedAt).toLocaleTimeString("ko-KR")} 이후 새로고침 가능`;
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
  return RECORD_LABELS[key] || key.replaceAll("_", " ");
}

export function formatRecordValue(key: string, value: JsonValue | undefined, data?: StockScoreResponse): string {
  if (typeof value === "number") {
    if (PERCENT_RECORD_KEYS.has(key)) return formatPercent(value);
    if (key === "debtToEquity") return `${value.toFixed(1)}%`;
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

export function strongestAndWeakest(data: StockScoreResponse) {
  let strongest: ScoreComponent | undefined;
  let weakest: ScoreComponent | undefined;
  let strongestScore = -1;
  let weakestScore = 101;
  for (const component of data.components || []) {
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
  return { strongest, weakest };
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
  return !!label && (isSourceOnlyLabel(label) || HIDDEN_LABELED_ITEM_LABELS.has(label));
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
  if (label.includes("수익성")) return "순이익률, ROE, 현금흐름처럼 실제로 돈을 잘 버는지 봐요.";
  if (label.includes("성장성")) return "매출과 이익이 커지는 속도, 최근 가격 흐름을 같이 봐요.";
  if (label.includes("재무건전성")) return "부채 부담과 단기 현금 여력을 봐요. 버틸 체력이 중요해요.";
  if (label.includes("거래 안정성")) return "거래량, 시가총액, 부채 부담, 현금흐름처럼 거래 체력을 봐요.";
  if (label.includes("모멘텀")) return "최근 가격이 올라가는 힘이 있는지, 고점에서 얼마나 떨어져 있는지 봐요.";
  if (label.includes("밸류에이션")) return "좋은 회사라도 가격이 너무 비싸면 점수가 낮아질 수 있어요.";
  return easySentence(component.summary) || "관련 숫자를 묶어서 점수로 바꿔요.";
}

export function formatMonthLabel(date: string | undefined): string {
  if (!date) return "";
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  return `${parsed.getMonth() + 1}월`;
}
