"use client";

import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppDisclaimerFooter, AppTopbar, useThemePreference } from "@/components/AppChrome";
import SymbolAutocomplete from "@/components/SymbolAutocomplete";
import { clampScore, formatDateTimeFromEpoch, formatPercent, formatValue, recordEntries } from "@/lib/format";
import type { SymbolSearchItem } from "@/lib/symbolTypes";
import type { CandlestickData, HistogramData, LineData, Time } from "lightweight-charts";
import type {
  StockJudgment,
  ChartPattern,
  ChartSeriesPoint,
  JsonValue,
  LabeledValue,
  NewsItem,
  ScoreComponent,
  StockScoreResponse,
  StockQuoteResponse,
} from "@/lib/types";

const EXAMPLES = [
  { key: "US:KO", label: "코카콜라" },
  { key: "US:NVDA", label: "엔비디아" },
  { key: "US:AAPL", label: "애플" },
  { key: "US:MSFT", label: "마이크로소프트" },
  { key: "KR:005930", label: "삼성전자" },
  { key: "KR:000660", label: "SK하이닉스" },
  { key: "KR:035420", label: "NAVER" },
  { key: "KR:005380", label: "현대차" },
];

const RECENT_TICKERS_STORAGE_KEY = "sia-stock-score:recent-tickers";

const DETAIL_SECTIONS = [
  { id: "detail-summary", label: "요약" },
  { id: "detail-chart", label: "가격 흐름" },
  { id: "detail-factors", label: "점수 이유" },
  { id: "detail-key-metrics", label: "핵심 숫자" },
  { id: "detail-news", label: "뉴스" },
  { id: "detail-profile", label: "회사 정보" },
  { id: "detail-valuation", label: "가격 부담" },
  { id: "detail-financials", label: "재무 요약" },
] as const;

type DetailSectionId = (typeof DETAIL_SECTIONS)[number]["id"];

type RecentTicker = {
  key: string;
  label: string;
  subtitle?: string;
};

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
const SOURCE_VENDOR_TEXT = ["K", "I", "S"].join("");
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

type LoadState =
  | { status: "idle" | "loading"; data?: undefined; error?: undefined }
  | { status: "success"; data: StockScoreResponse; error?: undefined }
  | { status: "pending"; data?: undefined; error?: undefined; pending: SnapshotPendingState }
  | { status: "error"; data?: undefined; error: string };

type QuoteState =
  | { status: "idle" | "loading"; data?: undefined; error?: undefined }
  | { status: "success"; data: StockQuoteResponse; error?: undefined }
  | { status: "pending"; data?: undefined; error?: undefined; pending: SnapshotPendingState }
  | { status: "error"; data?: undefined; error: string };

type QuoteRefreshState = {
  status: "idle" | "refreshing" | "success" | "cooldown" | "pending" | "error";
  message?: string;
  nextAllowedAt?: string;
};

type JudgmentState =
  | { status: "idle" | "loading"; judgment?: undefined; error?: undefined }
  | { status: "success"; judgment: StockJudgment; error?: undefined }
  | { status: "error"; judgment?: undefined; error: string };

type SnapshotPendingState = {
  message: string;
  ticker?: string;
  queued: boolean;
  retryAfterSeconds?: number;
};

function metricValue(items: LabeledValue[] | undefined, label: string): string {
  return formatValue(items?.find((item) => item.label === label)?.value);
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

function formatUsdPrice(data: StockScoreResponse, fallback: string): string {
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

function formatKrwPrice(data: StockScoreResponse): string {
  if (data.currency === "KRW") return "국내 원화 기준";
  return formatKrwAmount(data.latest_price, data.usd_krw_rate) || "원화 환산 정보가 없어요";
}

function numberFromUnknown(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringFromUnknown(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function recordFromUnknown(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function snapshotPendingFromPayload(payload: unknown, fallbackTicker: string): SnapshotPendingState | undefined {
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

function scoreDataWithQuote(data: StockScoreResponse, quote: StockQuoteResponse | undefined): StockScoreResponse {
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

function dailyChangeText(data: StockScoreResponse, quote: StockQuoteResponse | undefined): string {
  const quoteLabel = stringFromUnknown(quote?.latest_change_label);
  if (quoteLabel) return quoteLabel;
  const quoteChange = numberFromUnknown(quote?.latest_change);
  if (quoteChange !== undefined) return formatPercent(quoteChange);
  const cachedChange = numberFromJsonRecord(data.price_metrics, "latest_change");
  if (cachedChange !== undefined) return formatPercent(cachedChange);
  return "-";
}

function refreshCooldownMessage(nextAllowedAt: string | undefined): string | undefined {
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

function isSourceOnlyLabel(label: string | undefined): boolean {
  return !!label && (label.includes(SOURCE_VENDOR_TEXT) || label.includes(SOURCE_LABEL_TEXT));
}

function displayTickerInput(value: string): string {
  return value.replace(/^(US|KR):/i, "");
}

function symbolRef(item: SymbolSearchItem): string {
  return `${item.market}:${item.ticker}`;
}

function recentTickerFromItem(item: SymbolSearchItem): RecentTicker {
  const key = symbolRef(item);
  return {
    key,
    label: item.displayName || item.koreanName || item.englishName || item.ticker,
    subtitle: `${item.ticker}${item.exchangeName ? ` · ${item.exchangeName}` : ""}`,
  };
}

function safeRecentTickersFromStorage(): RecentTicker[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_TICKERS_STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({
        key: typeof item?.key === "string" ? item.key : "",
        label: typeof item?.label === "string" ? item.label : "",
        subtitle: typeof item?.subtitle === "string" ? item.subtitle : undefined,
      }))
      .filter((item) => item.key && item.label)
      .slice(0, 8);
  } catch {
    return [];
  }
}

function persistRecentTickers(items: RecentTicker[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RECENT_TICKERS_STORAGE_KEY, JSON.stringify(items.slice(0, 8)));
  } catch {
    // Recent searches are a convenience only.
  }
}

function humanizeRecordKey(key: string): string {
  return RECORD_LABELS[key] || key.replaceAll("_", " ");
}

function formatRecordValue(key: string, value: JsonValue | undefined): string {
  if (typeof value === "number") {
    if (PERCENT_RECORD_KEYS.has(key)) return formatPercent(value);
    if (key === "debtToEquity") return `${value.toFixed(1)}%`;
  }
  return formatValue(value);
}

function isRecordValue(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function visibleRecordEntries(record: Record<string, JsonValue>) {
  return recordEntries(record).filter(([key]) => !HIDDEN_RECORD_KEYS.has(key));
}

function componentWord(score: number): string {
  if (score >= 80) return "좋음";
  if (score >= 60) return "무난";
  if (score >= 45) return "보통";
  return "주의";
}

function strongestAndWeakest(data: StockScoreResponse) {
  const components = [...(data.components || [])];
  const strongest = components.sort((a, b) => (b.score ?? -1) - (a.score ?? -1))[0];
  const weakest = [...components].sort((a, b) => (a.score ?? 101) - (b.score ?? 101))[0];
  return { strongest, weakest };
}

function termTipFor(label: string | undefined) {
  if (!label) return undefined;
  const normalized = label.toLowerCase();
  return TERM_TIPS.find((tip) => tip.keys.some((key) => normalized.includes(key)));
}

function easySentence(text: string | undefined): string {
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

function formatNote(note: unknown): string | undefined {
  if (typeof note !== "string" || !note) return undefined;
  const cleaned = removeSourceText(note);
  if (!cleaned) return undefined;
  return NOTE_COPY[cleaned] || easySentence(cleaned);
}

function factorSummary(component: ScoreComponent): string {
  const label = component.label || component.key || "";
  if (label.includes("수익성")) return "순이익률, ROE, 현금흐름처럼 실제로 돈을 잘 버는지 봐요.";
  if (label.includes("성장성")) return "매출과 이익이 커지는 속도, 최근 가격 흐름을 같이 봐요.";
  if (label.includes("재무건전성")) return "부채 부담과 단기 현금 여력을 봐요. 버틸 체력이 중요해요.";
  if (label.includes("모멘텀")) return "최근 가격이 올라가는 힘이 있는지, 고점에서 얼마나 떨어져 있는지 봐요.";
  if (label.includes("밸류에이션")) return "좋은 회사라도 가격이 너무 비싸면 점수가 낮아질 수 있어요.";
  return easySentence(component.summary) || "관련 숫자를 묶어서 점수로 바꿔요.";
}

function formatMonthLabel(date: string | undefined): string {
  if (!date) return "";
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  return `${parsed.getMonth() + 1}월`;
}

export default function StockDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tickerParamRaw = searchParams.get("ticker");
  const hasTicker = Boolean(tickerParamRaw?.trim());
  const tickerParam = hasTicker ? (tickerParamRaw || "").trim().toUpperCase() : "";

  const [tickerInput, setTickerInput] = useState(displayTickerInput(tickerParam));
  const { theme, setTheme, themeKey } = useThemePreference();
  const [recentTickers, setRecentTickers] = useState<RecentTicker[]>([]);
  const [state, setState] = useState<LoadState>({ status: "idle" });
  const [quoteState, setQuoteState] = useState<QuoteState>({ status: "idle" });
  const [quoteRefreshState, setQuoteRefreshState] = useState<QuoteRefreshState>({ status: "idle" });
  const [judgmentState, setJudgmentState] = useState<JudgmentState>({ status: "idle" });
  const [activeSection, setActiveSection] = useState<DetailSectionId>("detail-summary");
  const currentTickerRef = useRef(tickerParam);
  const quoteRefreshControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setRecentTickers(safeRecentTickersFromStorage());
  }, []);

  function rememberRecentTicker(item: RecentTicker) {
    setRecentTickers((current) => {
      const next = [item, ...current.filter((ticker) => ticker.key !== item.key)].slice(0, 8);
      persistRecentTickers(next);
      return next;
    });
  }

  function removeRecentTicker(key: string) {
    setRecentTickers((current) => {
      const next = current.filter((ticker) => ticker.key !== key);
      persistRecentTickers(next);
      return next;
    });
  }

  useEffect(() => {
    if (!hasTicker) {
      currentTickerRef.current = "";
      quoteRefreshControllerRef.current?.abort();
      setTickerInput("");
      setState({ status: "idle" });
      setQuoteState({ status: "idle" });
      setQuoteRefreshState({ status: "idle" });
      return;
    }

    currentTickerRef.current = tickerParam;
    quoteRefreshControllerRef.current?.abort();
    setTickerInput(displayTickerInput(tickerParam));
    const controller = new AbortController();
    const query = new URLSearchParams({ ticker: tickerParam || "US:KO" });

    setState({ status: "loading" });
    fetch(`/api/score?${query.toString()}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json();
        const pending = snapshotPendingFromPayload(payload, tickerParam);
        if (pending) {
          setState({ status: "pending", pending });
          return undefined;
        }
        if (!response.ok) {
          throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
        }
        return payload as StockScoreResponse;
      })
      .then((data) => {
        if (data) setState({ status: "success", data });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          error: error instanceof Error ? error.message : "데이터를 불러오지 못했어요.",
        });
      });

    return () => controller.abort();
  }, [hasTicker, tickerParam]);

  useEffect(() => {
    if (!hasTicker) {
      setQuoteState({ status: "idle" });
      setQuoteRefreshState({ status: "idle" });
      return;
    }

    const controller = new AbortController();
    const query = new URLSearchParams({ ticker: tickerParam || "US:KO" });

    setQuoteState({ status: "loading" });
    setQuoteRefreshState({ status: "idle" });
    fetch(`/api/quote?${query.toString()}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = await response.json();
        const pending = snapshotPendingFromPayload(payload, tickerParam);
        if (pending) {
          setQuoteState({ status: "pending", pending });
          setQuoteRefreshState({ status: "pending", message: pending.message });
          return undefined;
        }
        if (!response.ok) {
          throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
        }
        return payload as StockQuoteResponse;
      })
      .then((data) => {
        if (!data) return;
        setQuoteState({ status: "success", data });
        const nextAllowedAt = stringFromUnknown(data.refresh_cooldown?.next_allowed_at);
        const message = refreshCooldownMessage(nextAllowedAt);
        if (message) {
          setQuoteRefreshState({ status: "cooldown", nextAllowedAt, message });
        }
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setQuoteState({
          status: "error",
          error: error instanceof Error ? error.message : "quote_fetch_failed",
        });
      });

    return () => controller.abort();
  }, [hasTicker, tickerParam]);

  useEffect(() => {
    const nextAllowedAt = quoteRefreshState.nextAllowedAt;
    if (!nextAllowedAt) return;

    const remainingMs = Date.parse(nextAllowedAt) - Date.now();
    if (remainingMs <= 0) {
      setQuoteRefreshState({ status: "idle" });
      return;
    }

    const timer = window.setTimeout(() => {
      setQuoteRefreshState((current) => (current.nextAllowedAt === nextAllowedAt ? { status: "idle" } : current));
    }, Math.min(remainingMs, 2_147_483_647));

    return () => window.clearTimeout(timer);
  }, [quoteRefreshState.nextAllowedAt]);

  useEffect(() => () => quoteRefreshControllerRef.current?.abort(), []);

  useEffect(() => {
    if (!hasTicker || state.status !== "success") {
      setJudgmentState({ status: "idle" });
      return;
    }

    const controller = new AbortController();
    setJudgmentState({ status: "loading" });

    fetch("/api/judgment", {
      method: "POST",
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(state.data),
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.message || "판단을 불러오지 못했어요.");
        }
        return payload.judgment as StockJudgment;
      })
      .then((judgment) => setJudgmentState({ status: "success", judgment }))
      .catch((error) => {
        if (controller.signal.aborted) return;
        setJudgmentState({
          status: "error",
          error: error instanceof Error ? error.message : "판단을 불러오지 못했어요.",
        });
      });

    return () => controller.abort();
  }, [hasTicker, state]);

  useEffect(() => {
    if (!hasTicker || state.status !== "success") return;
    const symbol = state.data.symbol || displayTickerInput(tickerParam);
    rememberRecentTicker({
      key: tickerParam,
      label: state.data.name || symbol,
      subtitle: `${symbol}${state.data.exchange ? ` · ${state.data.exchange}` : ""}`,
    });
  }, [hasTicker, state, tickerParam]);

  function selectSymbol(item: SymbolSearchItem) {
    const key = symbolRef(item);
    rememberRecentTicker(recentTickerFromItem(item));
    router.push(`/?ticker=${encodeURIComponent(key)}`);
  }

  const data = hasTicker && state.status === "success" ? state.data : undefined;
  const visibleDetailSections = DETAIL_SECTIONS;
  const quoteData = quoteState.status === "success" ? quoteState.data : undefined;
  const compareHref = `/compare?tickers=${encodeURIComponent(tickerParam)}`;
  const showMiniDecisionBar = Boolean(data && activeSection !== "detail-summary");

  useEffect(() => {
    if (!data || !visibleDetailSections.length) return;

    const sectionIds = visibleDetailSections.map((section) => section.id);
    let frame = 0;

    const updateActiveSection = () => {
      if (frame) return;

      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const anchorTop = 190;
        const sectionPositions = sectionIds
          .map((id) => {
            const element = document.getElementById(id);
            return element ? { id, top: element.getBoundingClientRect().top } : undefined;
          })
          .filter((section): section is { id: DetailSectionId; top: number } => !!section);

        if (!sectionPositions.length) return;

        const current = sectionPositions.reduce((candidate, section) => (section.top <= anchorTop ? section : candidate), sectionPositions[0]);
        setActiveSection(current.id);
      });
    };

    updateActiveSection();
    window.addEventListener("scroll", updateActiveSection, { passive: true });
    window.addEventListener("resize", updateActiveSection);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", updateActiveSection);
      window.removeEventListener("resize", updateActiveSection);
    };
  }, [data, visibleDetailSections]);

  function scrollToDetailSection(id: DetailSectionId) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function refreshQuote() {
    if (quoteRefreshState.status === "refreshing" || quoteRefreshState.status === "cooldown" || quoteRefreshState.status === "pending") return;

    const requestedTicker = tickerParam || "US:KO";
    const controller = new AbortController();
    quoteRefreshControllerRef.current?.abort();
    quoteRefreshControllerRef.current = controller;

    const query = new URLSearchParams({ ticker: requestedTicker, refresh: "1" });
    setQuoteRefreshState({ status: "refreshing", message: "최신 현재가 확인 중" });

    fetch(`/api/quote?${query.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (controller.signal.aborted || currentTickerRef.current !== requestedTicker) return undefined;
        const pending = snapshotPendingFromPayload(payload, requestedTicker);
        if (pending) {
          setQuoteState({ status: "pending", pending });
          setQuoteRefreshState({ status: "pending", message: pending.message });
          return undefined;
        }
        if (response.status === 429) {
          const nextAllowedAt = stringFromUnknown(payload?.refresh_cooldown?.next_allowed_at);
          const message = refreshCooldownMessage(nextAllowedAt);
          if (!message) {
            setQuoteRefreshState({ status: "error", message: "잠시 후 다시 시도해주세요." });
            return undefined;
          }
          setQuoteRefreshState({
            status: "cooldown",
            nextAllowedAt,
            message,
          });
          return undefined;
        }
        if (!response.ok) {
          throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
        }
        return payload as StockQuoteResponse;
      })
      .then((data) => {
        if (!data) return;
        if (controller.signal.aborted || currentTickerRef.current !== requestedTicker) return;
        setQuoteState({ status: "success", data });
        const nextAllowedAt = stringFromUnknown(data.refresh_cooldown?.next_allowed_at);
        const message = refreshCooldownMessage(nextAllowedAt);
        setQuoteRefreshState(message ? { status: "cooldown", nextAllowedAt, message } : { status: "success", message: "현재가가 업데이트됐어요." });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setQuoteRefreshState({
          status: "error",
          message: error instanceof Error ? error.message : "quote_refresh_failed",
        });
      });
  }

  return (
    <main className={`stock-app ${hasTicker ? "stock-detail-app" : "stock-landing-app"}`}>
      <section className={`stock-search ${hasTicker ? "" : "landing-search"}`}>
        <AppTopbar active="analysis" theme={theme} onThemeChange={setTheme} />
        <SymbolAutocomplete
          id="ticker"
          value={tickerInput}
          onValueChange={setTickerInput}
          onSelect={selectSymbol}
          placeholder="종목명이나 티커 검색"
          buttonLabel="검색"
          label="국내·미국 주식 검색"
          className="stock-search-form"
        />
        <RecentTickerRail items={recentTickers} onOpen={(key) => router.push(`/?ticker=${encodeURIComponent(key)}`)} onRemove={removeRecentTicker} />
      </section>

      {!hasTicker && <LandingHome onOpenTicker={(key) => router.push(`/?ticker=${encodeURIComponent(key)}`)} />}

      {hasTicker && state.status === "loading" && <StockSkeleton />}
      {hasTicker && state.status === "pending" && <StatusCard title="데이터 준비 중" body={state.pending.message} />}
      {hasTicker && state.status === "error" && <StatusCard title="조회할 수 없어요" body={state.error} tone="error" />}

      {data && (
        <>
          <DetailIndex sections={visibleDetailSections} activeSection={activeSection} onSelect={scrollToDetailSection} compareHref={compareHref} />
          <div className="stock-feed">
            <DetailSection id="detail-summary">
              <StockHeader
                data={data}
                quote={quoteData}
                quoteState={quoteState}
                quoteRefreshState={quoteRefreshState}
                onRefreshQuote={refreshQuote}
                judgmentState={judgmentState}
              />
            </DetailSection>
            <DetailSection id="detail-chart">
              <ChartStory points={data.chart_series} patterns={data.chart_patterns} themeKey={themeKey} />
            </DetailSection>
            <DetailSection id="detail-factors">
              <FactorStory components={data.components} eyebrow="품질 점수 이유" title="기초체력과 가격 부담" />
              {data.opportunity_components?.length ? (
                <FactorStory components={data.opportunity_components} eyebrow="기회 점수 이유" title="지금 볼 만한 근거" />
              ) : null}
            </DetailSection>
            <DetailSection id="detail-key-metrics">
              <SimpleList title="핵심 숫자" description="처음엔 이 숫자만 봐도 충분해요." items={data.key_metrics} defaultOpen />
            </DetailSection>
            <DetailSection id="detail-news">
              <NewsFeed news={data.news} />
            </DetailSection>
            <DetailSection id="detail-profile">
              <SimpleList title="회사 정보" description="어떤 회사인지 빠르게 확인해요." items={data.stock_profile} desktopOpen />
            </DetailSection>
            <DetailSection id="detail-valuation">
              <SimpleList title="가격 부담" description="좋은 회사라도 너무 비싸면 부담이 될 수 있어요." items={data.valuation_rows} desktopOpen />
            </DetailSection>
            <DetailSection id="detail-financials">
              <RecordCard title="재무 요약" description="회사의 체력을 볼 때 참고하는 숫자예요." record={data.financials} desktopOpen />
            </DetailSection>
          </div>
          <DetailMiniDecisionBar data={data} quote={quoteData} visible={showMiniDecisionBar} compareHref={compareHref} />
          <DetailMobileActionBar visible={showMiniDecisionBar} compareHref={compareHref} onBackToTop={scrollToTop} />
        </>
      )}
      <AppDisclaimerFooter />
    </main>
  );
}

function RecentTickerRail({
  items,
  onOpen,
  onRemove,
}: {
  items: RecentTicker[];
  onOpen: (key: string) => void;
  onRemove: (key: string) => void;
}) {
  if (!items.length) return null;

  return (
    <div className="ticker-chips recent-ticker-chips" aria-label="최근 조회 종목">
      {items.map((item) => (
        <span className="recent-chip" key={item.key}>
          <button type="button" onClick={() => onOpen(item.key)}>
            <strong>{item.label}</strong>
            {item.subtitle ? <small>{item.subtitle}</small> : null}
          </button>
          <button type="button" className="recent-remove" onClick={() => onRemove(item.key)} aria-label={`${item.label} 최근 조회에서 제거`}>
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

function LandingHome({ onOpenTicker }: { onOpenTicker: (key: string) => void }) {
  return (
    <section className="landing-home">
      <div className="landing-copy">
        <span className="landing-eyebrow">SIA Stock Score</span>
        <h1>주식 점수 리더</h1>
      </div>
      <div className="landing-example-rail" aria-label="바로 보기 예시">
        {EXAMPLES.slice(0, 6).map((example) => (
          <button key={example.key} type="button" onClick={() => onOpenTicker(example.key)}>
            <strong>{example.label}</strong>
            <span>{displayTickerInput(example.key)}</span>
          </button>
        ))}
      </div>
      <div className="landing-preview-grid">
        <article>
          <span>예시 품질</span>
          <strong>80+</strong>
          <p>수익성·성장·재무</p>
        </article>
        <article>
          <span>예시 기회</span>
          <strong>70+</strong>
          <p>밸류·모멘텀·업종</p>
        </article>
        <article>
          <span>현재가</span>
          <strong>5분</strong>
          <p>수동 갱신 쿨다운</p>
        </article>
      </div>
    </section>
  );
}

function DetailIndex({
  sections,
  activeSection,
  onSelect,
  compareHref,
}: {
  sections: ReadonlyArray<{ id: DetailSectionId; label: string }>;
  activeSection: DetailSectionId;
  onSelect: (id: DetailSectionId) => void;
  compareHref: string;
}) {
  return (
    <nav className="stock-detail-index" aria-label="상세 화면 목차">
      <span>목차</span>
      <div>
        {sections.map((section) => (
          <button
            key={section.id}
            type="button"
            className={activeSection === section.id ? "active" : undefined}
            aria-current={activeSection === section.id ? "true" : undefined}
            onClick={() => onSelect(section.id)}
          >
            {section.label}
          </button>
        ))}
      </div>
      <a className="detail-index-compare" href={compareHref}>
        비교하기
      </a>
    </nav>
  );
}

function DetailSection({ id, children }: { id: DetailSectionId; children: ReactNode }) {
  return (
    <div id={id} className="stock-feed-section" data-stock-section>
      {children}
    </div>
  );
}

function StatusCard({ title, body, tone = "default" }: { title: string; body: string; tone?: "default" | "error" }) {
  return (
    <section className={`app-status ${tone}`} role={tone === "error" ? "alert" : "status"}>
      <strong>{title}</strong>
      <p>{body}</p>
    </section>
  );
}

function DetailMiniDecisionBar({
  data,
  quote,
  visible,
  compareHref,
}: {
  data: StockScoreResponse;
  quote: StockQuoteResponse | undefined;
  visible: boolean;
  compareHref: string;
}) {
  const displayData = scoreDataWithQuote(data, quote);
  const symbol = quote?.symbol || data.symbol || data.requested_ticker || "KO";
  const current = stringFromUnknown(quote?.latest_price_label) || formatValue(data.latest_price);
  const price = stringFromUnknown(quote?.latest_price_label) || formatUsdPrice(displayData, current);
  const daily = dailyChangeText(data, quote);
  const qualityScore = clampScore(data.quality_score ?? data.score);
  const opportunityScore = typeof data.opportunity_score === "number" ? clampScore(data.opportunity_score) : undefined;

  return (
    <aside className={`detail-mini-decision-bar ${visible ? "visible" : ""}`} aria-hidden={!visible}>
      <div className="detail-mini-main">
        <span>{symbol}</span>
        <strong>{price}</strong>
        <small className={daily.startsWith("-") ? "price-down" : "price-up"}>{daily}</small>
      </div>
      <dl className="detail-mini-score-pair">
        <div>
          <dt>품질</dt>
          <dd>{qualityScore.toFixed(1)}</dd>
        </div>
        <div>
          <dt>기회</dt>
          <dd>{opportunityScore === undefined ? "-" : opportunityScore.toFixed(1)}</dd>
        </div>
      </dl>
      <a className="detail-mini-compare" href={compareHref} tabIndex={visible ? 0 : -1}>
        비교
      </a>
    </aside>
  );
}

function DetailMobileActionBar({
  visible,
  compareHref,
  onBackToTop,
}: {
  visible: boolean;
  compareHref: string;
  onBackToTop: () => void;
}) {
  return (
    <div className={`detail-mobile-action-bar ${visible ? "visible" : ""}`} aria-hidden={!visible}>
      <a href={compareHref} tabIndex={visible ? 0 : -1}>
        비교 추가
      </a>
      <button type="button" onClick={onBackToTop} tabIndex={visible ? 0 : -1}>
        맨 위로
      </button>
    </div>
  );
}

function StockHeader({
  data,
  quote,
  quoteState,
  quoteRefreshState,
  onRefreshQuote,
  judgmentState,
}: {
  data: StockScoreResponse;
  quote: StockQuoteResponse | undefined;
  quoteState: QuoteState;
  quoteRefreshState: QuoteRefreshState;
  onRefreshQuote: () => void;
  judgmentState: JudgmentState;
}) {
  const displayData = scoreDataWithQuote(data, quote);
  const qualityScore = clampScore(data.quality_score ?? data.score);
  const opportunityScore = typeof data.opportunity_score === "number" ? clampScore(data.opportunity_score) : undefined;
  const symbol = quote?.symbol || data.symbol || data.requested_ticker || "KO";
  const current = stringFromUnknown(quote?.latest_price_label) || formatValue(data.latest_price);
  const usdPrice = stringFromUnknown(quote?.latest_price_label) || formatUsdPrice(displayData, current);
  const krwPrice = formatKrwPrice(displayData);
  const daily = dailyChangeText(data, quote);
  const latestBarDate = stringFromUnknown(quote?.latest_bar_date) || data.latest_bar_date;
  const refreshDisabled = quoteRefreshState.status === "refreshing" || quoteRefreshState.status === "cooldown" || quoteRefreshState.status === "pending";
  const refreshTitle =
    quoteRefreshState.status === "refreshing"
      ? "현재가 새로고침 중"
      : quoteRefreshState.status === "cooldown"
      ? quoteRefreshState.message || "새로고침 대기 중"
      : "최신 현재가로 새로고침";
  const quoteStatusMessage =
    quoteState.status === "loading"
      ? "현재가를 확인하는 중이에요."
      : quoteState.status === "pending"
        ? quoteState.pending.message
      : quoteState.status === "error"
        ? `현재가 업데이트 실패: ${quoteState.error}`
        : undefined;
  const marketCap = metricValue(data.key_metrics, "시가총액");
  const signal = data.sia_snapshot?.raw_signal || "-";
  const risk = data.sia_snapshot?.risk_level || "-";
  const { strongest, weakest } = strongestAndWeakest(data);
  const stockJudgment = judgmentState.status === "success" ? judgmentState.judgment : undefined;

  return (
    <section className="stock-title-card">
      <div className="stock-hero-main">
        <div className="stock-name-row">
          <div>
            <span>
              {quote?.exchange || data.exchange || "미국 거래소"} · {latestBarDate || "최근 가격"}
            </span>
            <h2>{symbol}</h2>
            <p>{quote?.name || data.name}</p>
          </div>
        </div>
        <em className={`daily-pill ${daily.startsWith("-") ? "price-down" : "price-up"}`}>{daily}</em>
      </div>

      <div className="price-strip">
        <div className="price-block">
          <strong>{usdPrice}</strong>
          <span>{krwPrice}</span>
        </div>
        <button type="button" className="quote-refresh-button" onClick={onRefreshQuote} aria-disabled={refreshDisabled} title={refreshTitle} aria-label={refreshTitle}>
          ↻
        </button>
      </div>
      {quoteRefreshState.message ? (
        <p className={`quote-refresh-note ${quoteRefreshState.status}`} role="status" aria-live="polite">
          {quoteRefreshState.message}
        </p>
      ) : quoteStatusMessage ? (
        <p className={`quote-refresh-note ${quoteState.status}`} role={quoteState.status === "error" ? "alert" : "status"} aria-live="polite">
          {quoteStatusMessage}
        </p>
      ) : null}

      <div className="quick-read">
        <article>
          <span>강점</span>
          <strong>{strongest?.label || "-"}</strong>
        </article>
        <article>
          <span>먼저 볼 것</span>
          <strong>{weakest?.label || "-"}</strong>
        </article>
        <article>
          <span>시가총액</span>
          <strong>{marketCap}</strong>
        </article>
        <HeroScorePanel label="품질 점수" value={qualityScore} caption={`${signal} 신호 · 변동성 ${risk}`} tone="quality" />
        <HeroScorePanel label="기회 점수" value={opportunityScore} caption="성장, 목표가, 모멘텀, 유동성을 따로 봐요" tone="opportunity" />
      </div>

      <div className={`hero-verdict ${stockJudgment?.tone || "neutral"}`}>
        <span>오늘의 판단</span>
        <strong>
          {stockJudgment?.headline ||
            (judgmentState.status === "loading" ? "숫자를 읽고 있어요" : judgmentState.status === "error" ? "판단을 불러오지 못했어요" : "판단을 준비하고 있어요")}
        </strong>
        {judgmentState.status === "loading" ? (
          <div className="verdict-mini-skeleton" aria-hidden="true">
            <SkeletonBlock className="wide" />
            <SkeletonBlock className="medium" />
          </div>
        ) : (
          <p>{stockJudgment?.body || (judgmentState.status === "error" ? "잠시 후 다시 검색해보세요." : "가격, 점수, 재무 지표를 묶어서 해석하는 중이에요.")}</p>
        )}
        {stockJudgment?.watch ? <p className="verdict-watch">{stockJudgment.watch}</p> : null}
      </div>

      <a className="compare-entry" href={`/compare?tickers=${encodeURIComponent(`${data.market === "KR" ? "KR" : "US"}:${symbol}`)}`}>
        <span>나란히 비교하기</span>
        <strong>{symbol} 기준으로 보기</strong>
      </a>
    </section>
  );
}

function HeroScorePanel({
  label,
  value,
  caption,
  tone,
}: {
  label: string;
  value: number | undefined;
  caption: string;
  tone: "quality" | "opportunity";
}) {
  const score = typeof value === "number" && Number.isFinite(value) ? clampScore(value) : undefined;
  return (
    <article className={`score-panel hero-score-panel ${tone}`} style={{ "--score": `${score ?? 0}` } as CSSProperties}>
      <i aria-hidden="true" />
      <div>
        <span>{label}</span>
        <strong>{score === undefined ? "-" : `${score.toFixed(1)}점`}</strong>
        <p>{caption}</p>
        <span className="score-contribution-bar" aria-hidden="true">
          <i />
        </span>
      </div>
    </article>
  );
}

function SkeletonBlock({ className = "" }: { className?: string }) {
  return <span className={`skeleton-block ${className}`} aria-hidden="true" />;
}

function StockSkeleton() {
  return (
    <div className="stock-feed skeleton-feed" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">주식 데이터를 불러오는 중이에요.</span>
      <section className="stock-title-card skeleton-title-card">
        <div className="stock-hero-main">
          <div className="stock-name-row skeleton-name">
            <SkeletonBlock className="meta" />
            <SkeletonBlock className="ticker" />
            <SkeletonBlock className="company" />
          </div>
          <SkeletonBlock className="pill" />
        </div>
        <div className="price-block skeleton-price">
          <SkeletonBlock className="price" />
          <SkeletonBlock className="krw" />
        </div>
        <div className="quick-read">
          <article>
            <SkeletonBlock className="label" />
            <SkeletonBlock className="value" />
          </article>
          <article>
            <SkeletonBlock className="label" />
            <SkeletonBlock className="value" />
          </article>
          <article>
            <SkeletonBlock className="label" />
            <SkeletonBlock className="value wide" />
          </article>
          <article className="score-panel">
            <SkeletonBlock className="label" />
            <SkeletonBlock className="score" />
            <SkeletonBlock className="medium" />
          </article>
        </div>
        <div className="hero-verdict">
          <SkeletonBlock className="label" />
          <SkeletonBlock className="headline" />
          <SkeletonBlock className="wide" />
          <SkeletonBlock className="medium" />
        </div>
      </section>
      <section className="chart-story">
        <div className="section-title">
          <SkeletonBlock className="label" />
          <SkeletonBlock className="section-heading" />
        </div>
        <SkeletonBlock className="chart-area" />
        <div className="pattern-chips">
          {[0, 1, 2].map((item) => (
            <article key={item}>
              <SkeletonBlock className="value" />
              <SkeletonBlock className="wide" />
            </article>
          ))}
        </div>
      </section>
      <section className="factor-card">
        <div className="section-title">
          <SkeletonBlock className="label" />
          <SkeletonBlock className="section-heading" />
        </div>
        <div className="factor-list">
          {[0, 1, 2].map((item) => (
            <article key={item}>
              <div className="factor-heading">
                <SkeletonBlock className="value" />
                <SkeletonBlock className="small" />
              </div>
              <SkeletonBlock className="bar" />
              <SkeletonBlock className="wide" />
            </article>
          ))}
        </div>
      </section>
      <section className="accordion-card skeleton-accordion">
        <SkeletonBlock className="label" />
        <SkeletonBlock className="section-heading" />
      </section>
    </div>
  );
}

function ChartStory({
  points,
  patterns,
  themeKey,
}: {
  points: ChartSeriesPoint[] | undefined;
  patterns: ChartPattern[] | undefined;
  themeKey: string;
}) {
  const usable = useMemo(
    () =>
      (points || []).filter(
        (point): point is ChartSeriesPoint & { close: number; date: string } =>
          typeof point.close === "number" && Number.isFinite(point.close) && typeof point.date === "string"
      ),
    [points]
  );
  const [chartMode, setChartMode] = useState<"line" | "candle">("line");

  if (usable.length < 2) {
    return <EmptyCard title="가격 흐름" body="표시할 차트 데이터가 없어요." />;
  }

  return (
    <section className="chart-story">
      <div className="chart-title-row">
        <div className="section-title">
          <span>가격 흐름</span>
          <h2>최근 1년은 이렇게 움직였어요</h2>
        </div>
        <div className="chart-mode-tabs" role="tablist" aria-label="차트 표시 방식">
          <button type="button" role="tab" aria-selected={chartMode === "line"} className={chartMode === "line" ? "active" : undefined} onClick={() => setChartMode("line")}>
            쉽게
          </button>
          <button type="button" role="tab" aria-selected={chartMode === "candle"} className={chartMode === "candle" ? "active" : undefined} onClick={() => setChartMode("candle")}>
            캔들
          </button>
        </div>
      </div>
      <TradingPriceChart points={usable} mode={chartMode} themeKey={themeKey} />
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
    </section>
  );
}

function chartPriceLabel(point: ChartSeriesPoint & { close: number }) {
  if (point.close_label) return point.close_label;
  const currency = typeof point.currency === "string" ? point.currency : "USD";
  return priceLabel(point.close, currency);
}

function priceLabel(value: number | undefined, currency: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  if (currency === "KRW") return `${new Intl.NumberFormat("ko-KR").format(Math.round(value))}원`;
  if (currency === "USD") {
    return `$${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;
  }
  return `${currency} ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)}`;
}

function TradingPriceChart({
  points,
  mode,
  themeKey,
}: {
  points: Array<ChartSeriesPoint & { close: number; date: string }>;
  mode: "line" | "candle";
  themeKey: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; date: string; price: string } | null>(null);

  const chartData = useMemo(() => {
    const lineData: LineData<Time>[] = [];
    const candleData: CandlestickData<Time>[] = [];
    const volumeData: HistogramData<Time>[] = [];
    const labels = new Map<string, string>();

    points.forEach((point) => {
      const time = point.date as Time;
      const open = typeof point.open === "number" && Number.isFinite(point.open) ? point.open : point.close;
      const high = typeof point.high === "number" && Number.isFinite(point.high) ? point.high : Math.max(open, point.close);
      const low = typeof point.low === "number" && Number.isFinite(point.low) ? point.low : Math.min(open, point.close);
      const volume = typeof point.volume === "number" && Number.isFinite(point.volume) ? point.volume : 0;
      const isUp = point.close >= open;

      lineData.push({ time, value: point.close });
      candleData.push({ time, open, high, low, close: point.close });
      volumeData.push({
        time,
        value: volume,
        color: isUp ? "rgba(240, 68, 82, 0.24)" : "rgba(49, 130, 246, 0.24)",
      });
      labels.set(point.date, chartPriceLabel(point));
    });

    return { lineData, candleData, volumeData, labels };
  }, [points]);

  useEffect(() => {
    if (!containerRef.current) return;

    let disposed = false;
    let resizeObserver: ResizeObserver | undefined;
    let chartApi: { remove: () => void } | undefined;

    async function renderChart() {
      const { createChart, LineSeries, CandlestickSeries, HistogramSeries, ColorType, CrosshairMode } = await import("lightweight-charts");
      const currentContainer = containerRef.current;
      if (disposed || !currentContainer) return;
      const styles = getComputedStyle(document.documentElement);
      const chartBackground = styles.getPropertyValue("--chart-bg").trim() || "#f8fafc";
      const chartText = styles.getPropertyValue("--muted").trim() || "#8b95a1";
      const chartGrid = styles.getPropertyValue("--chart-grid").trim() || "rgba(222, 228, 235, 0.65)";
      const chartAccent = styles.getPropertyValue("--accent").trim() || "#3182f6";
      const chartUp = styles.getPropertyValue("--red").trim() || "#f04452";
      const chartDown = styles.getPropertyValue("--down").trim() || "#3182f6";

      currentContainer.innerHTML = "";
      const chart = createChart(currentContainer, {
        width: Math.max(1, currentContainer.clientWidth),
        height: 360,
        layout: {
          background: { type: ColorType.Solid, color: chartBackground },
          textColor: chartText,
          fontFamily: "inherit",
          fontSize: 12,
        },
        grid: {
          vertLines: { color: chartGrid },
          horzLines: { color: chartGrid },
        },
        rightPriceScale: {
          borderVisible: false,
          scaleMargins: mode === "candle" ? { top: 0.08, bottom: 0.26 } : { top: 0.08, bottom: 0.12 },
        },
        timeScale: {
          borderVisible: false,
          timeVisible: false,
          secondsVisible: false,
          tickMarkFormatter: (time: Time) => (typeof time === "string" ? formatMonthLabel(time) : ""),
        },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: { color: chartAccent, width: 1, labelVisible: false },
          horzLine: { color: chartAccent, width: 1, labelVisible: false },
        },
        handleScroll: {
          mouseWheel: false,
          pressedMouseMove: true,
          horzTouchDrag: true,
          vertTouchDrag: false,
        },
        handleScale: {
          axisPressedMouseMove: false,
          mouseWheel: false,
          pinch: true,
        },
      });

      chartApi = chart;
      const priceSeries =
        mode === "candle"
          ? chart.addSeries(CandlestickSeries, {
              upColor: chartUp,
              downColor: chartDown,
              borderUpColor: chartUp,
              borderDownColor: chartDown,
              wickUpColor: chartUp,
              wickDownColor: chartDown,
            })
          : chart.addSeries(LineSeries, {
              color: chartAccent,
              lineWidth: 3,
              crosshairMarkerVisible: true,
              crosshairMarkerRadius: 5,
            });

      if (mode === "candle") {
        priceSeries.setData(chartData.candleData);
        const volumeSeries = chart.addSeries(HistogramSeries, {
          priceFormat: { type: "volume" },
          priceScaleId: "",
          lastValueVisible: false,
          priceLineVisible: false,
        });
        volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
        volumeSeries.setData(chartData.volumeData);
      } else {
        priceSeries.setData(chartData.lineData);
      }

      chart.subscribeCrosshairMove((param) => {
        if (!containerRef.current || !param.point || param.point.x < 0 || param.point.y < 0 || !param.time) {
          setTooltip(null);
          return;
        }

        const time = String(param.time);
        const seriesValue = param.seriesData.get(priceSeries) as { value?: number; close?: number } | undefined;
        const value = typeof seriesValue?.value === "number" ? seriesValue.value : seriesValue?.close;
        if (typeof value !== "number" || !Number.isFinite(value)) {
          setTooltip(null);
          return;
        }

        setTooltip({
          x: param.point.x,
          y: param.point.y,
          date: time,
          price: chartData.labels.get(time) || priceLabel(value, points[0]?.currency as string),
        });
      });

      chart.timeScale().fitContent();

      resizeObserver = new ResizeObserver(() => {
        if (!containerRef.current) return;
        chart.applyOptions({ width: Math.max(1, containerRef.current.clientWidth) });
      });
      resizeObserver.observe(currentContainer);
    }

    renderChart();

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      chartApi?.remove();
      setTooltip(null);
    };
  }, [chartData, mode, points, themeKey]);

  return (
    <div className="chart-plot">
      <div ref={containerRef} className="trading-chart" role="img" aria-label="가격 차트" />
      {tooltip ? (
        <div
          className="chart-floating-tip"
          style={{
            left: `${tooltip.x}px`,
            top: `${tooltip.y}px`,
          }}
        >
          <strong>{tooltip.date}</strong>
          <span>{tooltip.price}</span>
        </div>
      ) : null}
    </div>
  );
}

function FactorStory({
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

function SimpleList({
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

function RecordCard({
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

function NewsFeed({ news }: { news: NewsItem[] | undefined }) {
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
                <a href={item.link || "#"} target="_blank" rel="noreferrer" key={`${item.title}-${index}`}>
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
