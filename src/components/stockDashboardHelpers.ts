import { formatPercent, formatValue, recordEntries } from "@/lib/format";
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
  opportunity_confidence: "기회 신뢰도",
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

const CHART_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

function formatKoreanWonLarge(value: number): string {
  if (!Number.isFinite(value)) return "-";
  const totalEok = Math.max(0, Math.round(value / 100_000_000));
  const jo = Math.floor(totalEok / 10_000);
  const eok = totalEok % 10_000;
  if (jo > 0 && eok > 0) return `${jo}조 ${eok}억원`;
  if (jo > 0) return `${jo}조원`;
  return `${totalEok}억원`;
}

function formatCompactUsd(value: number): string {
  if (!Number.isFinite(value)) return "$-";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000_000) return `$${trimCompact(value / 1_000_000_000_000)}T`;
  if (abs >= 1_000_000_000) return `$${trimCompact(value / 1_000_000_000)}B`;
  if (abs >= 1_000_000) return `$${trimCompact(value / 1_000_000)}M`;
  return `$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value)}`;
}

function trimCompact(value: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(value);
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

function formatUsdAmount(price: number | undefined, currency?: string): string | undefined {
  if (typeof price !== "number" || !Number.isFinite(price)) return undefined;
  const prefix = currency === "USD" || !currency ? "$" : `${currency} `;
  return `${prefix}${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(price)}`;
}

function formatKrwAmount(price: number | undefined, rate: number | undefined): string | undefined {
  if (typeof price !== "number" || !Number.isFinite(price) || typeof rate !== "number" || !Number.isFinite(rate)) return undefined;
  return `약 ${new Intl.NumberFormat("ko-KR").format(Math.round(price * rate))}원`;
}

export function formatUsdPrice(data: StockScoreResponse, fallback: string): string {
  if (data.currency === "KRW") {
    if (fallback && fallback !== "-") return fallback;
    if (typeof data.latest_price === "number" && Number.isFinite(data.latest_price)) {
      return `${new Intl.NumberFormat("ko-KR").format(Math.round(data.latest_price))}원`;
    }
  }
  const price = formatUsdAmount(data.latest_price, data.currency);
  if (price) return price;
  return fallback.replace(/\s*\(.+\)$/, "");
}

export function formatKrwPrice(data: StockScoreResponse): string {
  if (data.currency === "KRW") return "국내 원화 기준";
  return formatKrwAmount(data.latest_price, data.usd_krw_rate) || "원화 환산 정보가 없어요";
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
  const error = stringFromUnknown(record?.error);
  if (error !== "snapshot_pending" && error !== "snapshot_unavailable") return undefined;

  const refreshRequest = recordFromUnknown(record?.refresh_request);
  const queued = refreshRequest?.queued === true;
  const retryAfterSeconds = numberFromUnknown(record?.retry_after_seconds);
  const ticker = stringFromUnknown(record?.ticker) || fallbackTicker;
  const message = queued
    ? "처음 조회하는 종목이라 데이터를 준비하고 있어요. 수집이 끝나면 점수와 현재가가 표시됩니다."
    : "이 종목 데이터가 아직 준비되지 않았어요. 잠시 후 다시 조회해주세요.";

  return {
    message: retryAfterSeconds ? `${message} 보통 ${retryAfterSeconds}초 안에 다시 확인할 수 있어요.` : message,
    ticker,
    queued,
    retryAfterSeconds,
  };
}

function numberFromJsonRecord(record: Record<string, JsonValue> | undefined, key: string): number | undefined {
  return numberFromUnknown(record?.[key]);
}

export function scoreDataWithQuote(data: StockScoreResponse, quote: StockQuoteResponse | undefined): StockScoreResponse {
  const latestPrice = numberFromUnknown(quote?.latest_price);
  if (latestPrice === undefined) return data;
  return {
    ...data,
    currency: stringFromUnknown(quote?.currency) || data.currency,
    latest_price: latestPrice,
    latest_bar_date: stringFromUnknown(quote?.latest_bar_date) || data.latest_bar_date,
    usd_krw_rate: numberFromUnknown(quote?.usd_krw_rate) ?? data.usd_krw_rate,
  };
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

function formatKstMinute(value: string): string | undefined {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return undefined;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
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
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
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
  const closes = points.map((point) => point.close);
  const high = Math.max(...closes);
  const low = Math.min(...closes);
  const change = first.close !== 0 ? (last.close / first.close) - 1 : undefined;
  return `${first.date}부터 ${last.date}까지 ${points.length}개 가격 지점입니다. 시작 ${compactChartNumber(first.close)}, 마지막 ${compactChartNumber(last.close)}, 기간 변화 ${formatPercent(change)}, 최고 ${compactChartNumber(high)}, 최저 ${compactChartNumber(low)}.`;
}

function compactChartNumber(value: number): string {
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(value);
}

export function refreshCooldownMessage(nextAllowedAt: string | undefined): string | undefined {
  if (!nextAllowedAt || Date.parse(nextAllowedAt) <= Date.now()) return undefined;
  return `${new Date(nextAllowedAt).toLocaleTimeString("ko-KR")} 이후 새로고침 가능`;
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
    market: /^\d{6}$/.test(ticker) ? "KR" : "US",
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

export function formatRecordValue(key: string, value: JsonValue | undefined): string {
  if (typeof value === "number") {
    if (PERCENT_RECORD_KEYS.has(key)) return formatPercent(value);
    if (key === "debtToEquity") return `${value.toFixed(1)}%`;
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
  const components = [...(data.components || [])];
  const strongest = components.sort((a, b) => (b.score ?? -1) - (a.score ?? -1))[0];
  const weakest = [...components].sort((a, b) => (a.score ?? 101) - (b.score ?? 101))[0];
  return { strongest, weakest };
}

export function stockHeaderIdentity(data: StockScoreResponse, quote?: StockQuoteResponse): StockHeaderIdentity {
  const symbol = stringFromUnknown(quote?.symbol) || stringFromUnknown(data.symbol) || stringFromUnknown(data.requested_ticker) || "KO";
  const quoteName = stringFromUnknown(quote?.name);
  const dataName = stringFromUnknown(data.name);
  const name = meaningfulHeaderName(quoteName, symbol, data.requested_ticker) || meaningfulHeaderName(dataName, symbol, data.requested_ticker) || "";

  if (/[가-힣]/.test(name) && !isDerivativeLikeDisplayName(name)) {
    return { primary: name, secondary: symbol, primaryKind: "name" };
  }

  return { primary: symbol, secondary: name, primaryKind: "ticker" };
}

export function opportunityExtremes(components: ScoreComponent[] | undefined): OpportunityExtremes {
  const scored = (components || [])
    .map((component) => {
      const score = numberFromUnknown(component.score);
      const label = shortOpportunityLabel(component.label || component.key);
      return score === undefined || !label ? undefined : { label, score };
    })
    .filter((component): component is OpportunityExtreme => !!component);

  if (!scored.length) return {};

  const sorted = [...scored].sort((a, b) => b.score - a.score);
  return {
    best: sorted[0],
    worst: sorted.length > 1 ? sorted[sorted.length - 1] : undefined,
  };
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

function isDerivativeLikeDisplayName(name: string): boolean {
  const length = Array.from(name).length;
  if (length < 12) return false;
  return /(ETF|ETN|KODEX|TIGER|ACE|RISE|PLUS|SOL|HANARO|KOSEF|KBSTAR|WON|1Q|레버리지|인버스|선물|채권혼합|단일종목)/i.test(name);
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
  return NOTE_COPY[cleaned] || easySentence(cleaned);
}

export function factorSummary(component: ScoreComponent): string {
  const label = component.label || component.key || "";
  if (label.includes("수익성")) return "순이익률, ROE, 현금흐름처럼 실제로 돈을 잘 버는지 봐요.";
  if (label.includes("성장성")) return "매출과 이익이 커지는 속도, 최근 가격 흐름을 같이 봐요.";
  if (label.includes("재무건전성")) return "부채 부담과 단기 현금 여력을 봐요. 버틸 체력이 중요해요.";
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
