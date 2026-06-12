import { formatCurrencyAmount, formatPercent, formatValue } from "@/lib/format";
import type { KisDailyChartBar } from "@/lib/kisQuoteClient";
import { SCORE_MODEL_VERSION } from "@/lib/scoreModel";
import { STOCKSTALKER_SERVICE_NAME } from "@/lib/stockShareMetadata";
import { fetchLiveDailyChart, fetchLiveQuote, liveStockProviderConfigured } from "@/lib/stockLiveProvider";
import { buildTechnicalAnalysis } from "@/lib/technicalAnalysisEngine";
import { findExactSymbol } from "@/lib/symbolSearch";
import { envValue } from "@/lib/supabaseRest";
import type { ScoreView, StockPayload } from "@/lib/stockScoreContract";
import type { Grade, LabeledValue, ScoreComponent } from "@/lib/types";

type FastPathIdentity = {
  displayName: string;
  koreanName?: string;
  englishName?: string;
  instrumentType?: string;
};

type PriceSignals = {
  latestPrice?: number;
  previousClose?: number;
  latestChange?: number;
  return1m?: number;
  return3m?: number;
  return6m?: number;
  return52w?: number;
  distanceFromYearHigh?: number;
  distanceFromYearLow?: number;
  avgVolume20?: number;
  avgVolume60?: number;
  ma20?: number;
  ma50?: number;
  ma200?: number;
  volatility60?: number;
  momentumScore: number;
  growthProxyScore: number;
  trendScore: number;
  riskScore: number;
  liquidityScore: number;
  valuationProxyScore: number;
};

const NEUTRAL_SCORE = 50;

export function detailRequestFastPathEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const raw = env.STOCK_DETAIL_REQUEST_FAST_PATH?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return liveStockProviderConfigured(env);
}

export async function buildDetailScoreFastPathPayload(ticker: string, view: ScoreView = "detail"): Promise<StockPayload> {
  if (view === "compare") {
    try {
      const quote = await fetchLiveQuote(ticker);
      return buildQuoteOnlyDetailScorePayload(quote, view);
    } catch {
      return buildCompareIdentityScorePayload(ticker, view);
    }
  }

  const dailyPromise = fetchLiveDailyChart(ticker);
  const daily = await withTimeout(dailyPromise, detailDailyFastPathTimeoutMs()).catch(() => undefined);
  if (!daily) {
    const quote = await fetchLiveQuote(ticker);
    return buildQuoteOnlyDetailScorePayload(quote, view);
  }

  const identity = await fastPathIdentity(daily.requestedTicker, daily.name, daily.symbol);
  const displayName = identity.displayName || daily.name || daily.symbol;
  const signals = priceSignalsFromBars(daily.chartSeries);
  const components = scoreComponents(signals, daily.currency);
  const opportunityComponents = opportunityScoreComponents(signals);
  const qualityScore = weightedScore(components, {
    profitability: 0.18,
    growth: 0.2,
    health: 0.18,
    momentum: 0.28,
    valuation: 0.16,
  });
  const opportunityScore = weightedScore(opportunityComponents, {
    opportunity_momentum: 0.35,
    opportunity_growth: 0.18,
    opportunity_analyst: 0.12,
    opportunity_liquidity: 0.17,
    opportunity_risk: 0.18,
  });
  const score = roundScore(qualityScore * 0.56 + opportunityScore * 0.44);
  const confidence = confidenceFromBars(daily.chartSeries.length);
  const technicalAnalysis = buildTechnicalAnalysis(daily.chartSeries);
  technicalAnalysis.ticker = `${daily.market}:${daily.symbol}`;
  technicalAnalysis.market = daily.market;
  technicalAnalysis.symbol = daily.symbol;

  const priceMetrics = {
    ...daily.priceMetrics,
    return_1m: signals.return1m,
    return_3m: signals.return3m,
    return_6m: signals.return6m,
    return_52w: signals.return52w,
    distance_from_year_high: signals.distanceFromYearHigh,
    distance_from_year_low: signals.distanceFromYearLow,
    volatility_60d: signals.volatility60,
  };

  return {
    ok: true,
    app: STOCKSTALKER_SERVICE_NAME,
    requested_ticker: daily.requestedTicker,
    market: daily.market,
    symbol: daily.symbol,
    name: displayName,
    display_name: displayName,
    korean_name: identity.koreanName,
    english_name: identity.englishName,
    instrument_type: identity.instrumentType,
    exchange: daily.exchange,
    ...(daily.exchangeCode ? { exchange_code: daily.exchangeCode } : {}),
    currency: daily.currency,
    score_model_version: SCORE_MODEL_VERSION,
    score,
    quality_score: qualityScore,
    quality_grade: gradeForScore(qualityScore),
    opportunity_score: opportunityScore,
    opportunity_grade: gradeForScore(opportunityScore),
    opportunity_confidence: confidence,
    grade: gradeForScore(score),
    summary: `${displayName}의 가격과 거래량으로 먼저 계산한 빠른 점수입니다. 재무제표와 애널리스트 보강 점수는 백그라운드에서 갱신됩니다.`,
    period: periodLabel(daily.chartSeries),
    benchmark: daily.market === "KR" ? "KRX" : "US",
    benchmark_label: daily.market === "KR" ? "국내 상장 종목" : "미국 상장 종목",
    latest_price: signals.latestPrice ?? daily.latestPrice,
    latest_price_label: formatCurrencyAmount(signals.latestPrice ?? daily.latestPrice, daily.currency),
    latest_bar_date: daily.latestDate,
    evaluation_label: "가격 기반 빠른 점수",
    evaluation_ts: Math.floor(Date.now() / 1000),
    data_quality: "price_fast_path",
    components,
    opportunity_components: opportunityComponents,
    key_metrics: keyMetrics(signals, daily.currency),
    stock_profile: stockProfileRows(daily, identity),
    valuation_rows: valuationRows(signals, daily.currency),
    chart_patterns: [],
    chart_series: daily.chartSeries,
    technical_analysis: technicalAnalysis,
    history: [],
    top_scores: [],
    news: [],
    price_metrics: priceMetrics,
    financials: {
      source: "pending_enrichment",
      detail_fast_path: true,
      message: "정식 재무 데이터는 백그라운드에서 보강됩니다.",
    },
    sia_snapshot: {
      symbol: daily.symbol,
      price: signals.latestPrice ?? daily.latestPrice,
      raw_signal: rawSignalFor(signals.momentumScore, signals.riskScore),
      risk_level: riskLevelFor(signals.riskScore),
      confidence,
      quality_score: ratioFromScore(qualityScore),
      opportunity_score: ratioFromScore(opportunityScore),
      opportunity_confidence: confidence,
      spot_score: ratioFromScore(score),
      chart_score: ratioFromScore(signals.trendScore),
      trend_score: ratioFromScore(signals.trendScore),
      momentum_score: ratioFromScore(signals.momentumScore),
      inverse_score: ratioFromScore(signals.riskScore),
      momentum_label: momentumLabel(signals.momentumScore),
      signal_source: "market_data_fast_path",
      score_model_version: SCORE_MODEL_VERSION,
      bar_ts: daily.latestDate,
      indicators: {
        return_1m: signals.return1m,
        return_3m: signals.return3m,
        return_6m: signals.return6m,
        volatility_60d: signals.volatility60,
      },
      reasons: {
        momentum: ratioFromScore(signals.momentumScore),
        trend: ratioFromScore(signals.trendScore),
        liquidity: ratioFromScore(signals.liquidityScore),
        risk_control: ratioFromScore(signals.riskScore),
      },
    },
    fetch: {
      ...daily.fetch,
      view,
      score_model_version: SCORE_MODEL_VERSION,
      detail_fast_path: true,
      request_fast_path: true,
      pending_enrichment: true,
      source: "market_data",
      provider_mode: "detail_request_fast_path",
      timeout_ms: detailRequestFastPathTimeoutMs(),
    },
  };
}

async function buildQuoteOnlyDetailScorePayload(quote: StockPayload, view: ScoreView): Promise<StockPayload> {
  const ticker = stringValue(quote.requested_ticker) || `${stringValue(quote.market) || "US"}:${stringValue(quote.symbol) || ""}`;
  const symbol = stringValue(quote.symbol) || ticker.replace(/^(US|KR):/i, "");
  const market = stringValue(quote.market) === "KR" ? "KR" : "US";
  const currency = stringValue(quote.currency) || (market === "KR" ? "KRW" : "USD");
  const providerName = stringValue(quote.name) || symbol;
  const identity = await fastPathIdentity(ticker, providerName, symbol);
  const displayName = identity.displayName || providerName || symbol;
  const signals = priceSignalsFromQuote(quote);
  const components = scoreComponents(signals, currency);
  const opportunityComponents = opportunityScoreComponents(signals);
  const qualityScore = weightedScore(components, {
    profitability: 0.18,
    growth: 0.2,
    health: 0.18,
    momentum: 0.28,
    valuation: 0.16,
  });
  const opportunityScore = weightedScore(opportunityComponents, {
    opportunity_momentum: 0.35,
    opportunity_growth: 0.18,
    opportunity_analyst: 0.12,
    opportunity_liquidity: 0.17,
    opportunity_risk: 0.18,
  });
  const score = roundScore(qualityScore * 0.56 + opportunityScore * 0.44);
  const confidence = 0.24;
  const technicalAnalysis = buildTechnicalAnalysis([]);
  technicalAnalysis.ticker = `${market}:${symbol}`;
  technicalAnalysis.market = market;
  technicalAnalysis.symbol = symbol;

  return {
    ok: true,
    app: STOCKSTALKER_SERVICE_NAME,
    requested_ticker: ticker,
    market,
    symbol,
    name: displayName,
    display_name: displayName,
    korean_name: identity.koreanName,
    english_name: identity.englishName,
    instrument_type: identity.instrumentType,
    exchange: stringValue(quote.exchange),
    ...(stringValue(quote.exchange_code) ? { exchange_code: stringValue(quote.exchange_code) } : {}),
    currency,
    usd_krw_rate: numberValue(quote.usd_krw_rate),
    usd_krw_label: stringValue(quote.usd_krw_label),
    score_model_version: SCORE_MODEL_VERSION,
    score,
    quality_score: qualityScore,
    quality_grade: gradeForScore(qualityScore),
    opportunity_score: opportunityScore,
    opportunity_grade: gradeForScore(opportunityScore),
    opportunity_confidence: confidence,
    grade: gradeForScore(score),
    summary: `${displayName}의 현재가로 먼저 계산한 빠른 점수입니다. 차트와 재무제표 보강 점수는 백그라운드에서 갱신됩니다.`,
    benchmark: market === "KR" ? "KRX" : "US",
    benchmark_label: market === "KR" ? "국내 상장 종목" : "미국 상장 종목",
    latest_price: signals.latestPrice,
    latest_price_label: stringValue(quote.latest_price_label) || formatCurrencyAmount(signals.latestPrice, currency),
    latest_bar_date: stringValue(quote.latest_bar_date),
    evaluation_label: "현재가 기반 빠른 점수",
    evaluation_ts: Math.floor(Date.now() / 1000),
    data_quality: "quote_fast_path",
    components,
    opportunity_components: opportunityComponents,
    key_metrics: keyMetrics(signals, currency),
    stock_profile: stockProfileRows({ market, symbol, exchange: stringValue(quote.exchange) || "", currency }, identity),
    valuation_rows: valuationRows(signals, currency),
    chart_patterns: [],
    chart_series: [],
    technical_analysis: technicalAnalysis,
    history: [],
    top_scores: [],
    news: [],
    price_metrics: {
      ...(isRecord(quote.price_metrics) ? quote.price_metrics : {}),
      price: signals.latestPrice,
      previous_close: signals.previousClose,
      latest_change: signals.latestChange,
      volume: numberValue(quote.volume),
    },
    financials: {
      source: "pending_enrichment",
      quote_only_fast_path: true,
      message: "차트와 정식 재무 데이터는 백그라운드에서 보강됩니다.",
    },
    sia_snapshot: {
      symbol,
      price: signals.latestPrice,
      raw_signal: rawSignalFor(signals.momentumScore, signals.riskScore),
      risk_level: riskLevelFor(signals.riskScore),
      confidence,
      quality_score: ratioFromScore(qualityScore),
      opportunity_score: ratioFromScore(opportunityScore),
      opportunity_confidence: confidence,
      spot_score: ratioFromScore(score),
      chart_score: ratioFromScore(NEUTRAL_SCORE),
      trend_score: ratioFromScore(NEUTRAL_SCORE),
      momentum_score: ratioFromScore(signals.momentumScore),
      inverse_score: ratioFromScore(signals.riskScore),
      momentum_label: momentumLabel(signals.momentumScore),
      signal_source: "quote_fast_path",
      score_model_version: SCORE_MODEL_VERSION,
      bar_ts: stringValue(quote.latest_bar_date),
      indicators: {
        latest_change: signals.latestChange,
        volume: numberValue(quote.volume),
      },
      reasons: {
        momentum: ratioFromScore(signals.momentumScore),
        liquidity: ratioFromScore(signals.liquidityScore),
        risk_control: ratioFromScore(signals.riskScore),
      },
    },
    fetch: {
      ...(isRecord(quote.fetch) ? quote.fetch : {}),
      view,
      score_model_version: SCORE_MODEL_VERSION,
      detail_fast_path: true,
      quote_only_fast_path: true,
      request_fast_path: true,
      pending_enrichment: true,
      source: "market_data",
      provider_mode: "detail_quote_fast_path",
      daily_timeout_ms: detailDailyFastPathTimeoutMs(),
    },
  };
}

async function buildCompareIdentityScorePayload(ticker: string, view: ScoreView): Promise<StockPayload> {
  const parts = ticker.split(":");
  const market = parts[0] === "KR" ? "KR" : "US";
  const symbol = (parts[1] || ticker).replace(/^(US|KR):/i, "");
  const identity = await fastPathIdentity(`${market}:${symbol}`, symbol, symbol);
  const displayName = identity.displayName || symbol;
  const payload = await buildQuoteOnlyDetailScorePayload(
    {
      requested_ticker: `${market}:${symbol}`,
      market,
      symbol,
      name: displayName,
      currency: market === "KR" ? "KRW" : "USD",
      exchange: market === "KR" ? "KRX/NXT" : "US",
      fetch: {
        source: "symbol_master",
        provider_mode: "compare_identity_fast_path",
      },
    },
    view
  );

  return {
    ...payload,
    data_quality: "identity_fast_path",
    summary: `${displayName}의 현재가가 아직 들어오지 않아 종목 정보로 먼저 만든 빠른 비교 카드입니다. 현재가와 차트 보강 점수는 백그라운드에서 갱신됩니다.`,
    financials: {
      ...(isRecord(payload.financials) ? payload.financials : {}),
      identity_only_fast_path: true,
      message: "현재가, 차트, 정식 재무 데이터는 백그라운드에서 보강됩니다.",
    },
    fetch: {
      ...(isRecord(payload.fetch) ? payload.fetch : {}),
      provider_mode: "compare_identity_fast_path",
      quote_unavailable: true,
    },
  };
}

async function fastPathIdentity(ticker: string, providerName: string, symbol: string): Promise<FastPathIdentity> {
  const item = await findExactSymbol(ticker).catch(() => undefined);
  const displayName = item?.displayName || item?.koreanName || item?.englishName || providerName || symbol;
  const koreanName = item?.koreanName || (hasHangul(displayName) ? displayName : undefined);
  const englishName = item?.englishName || (!hasHangul(providerName) && providerName !== symbol ? providerName : undefined);
  return {
    displayName,
    koreanName,
    englishName,
    instrumentType: item?.instrumentType,
  };
}

function priceSignalsFromBars(rows: KisDailyChartBar[]): PriceSignals {
  const bars = rows.filter((row) => Number.isFinite(row.close)).sort((left, right) => left.date.localeCompare(right.date));
  const closes = bars.map((row) => row.close);
  const volumes = bars.map((row) => row.volume).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const latest = bars.at(-1);
  const previous = bars.at(-2);
  const year = bars.slice(-252);
  const yearHigh = year.length ? Math.max(...year.map((row) => row.high)) : undefined;
  const yearLow = year.length ? Math.min(...year.map((row) => row.low)) : undefined;
  const ma20 = average(closes.slice(-20));
  const ma50 = average(closes.slice(-50));
  const ma200 = average(closes.slice(-200));
  const return1m = trailingReturn(bars, 21);
  const return3m = trailingReturn(bars, 63);
  const return6m = trailingReturn(bars, 126);
  const return52w = trailingReturn(bars, 252);
  const latestPrice = latest?.close;
  const distanceFromYearHigh = latestPrice && yearHigh ? latestPrice / yearHigh - 1 : undefined;
  const distanceFromYearLow = latestPrice && yearLow ? latestPrice / yearLow - 1 : undefined;
  const avgVolume20 = average(volumes.slice(-20));
  const avgVolume60 = average(volumes.slice(-60));
  const volatility60 = realizedVolatility(closes.slice(-61));
  const returnScore = weightedAverage(
    [
      [scoreFromRange(return1m, -0.18, 0.18), 0.34],
      [scoreFromRange(return3m, -0.28, 0.35), 0.33],
      [scoreFromRange(return6m, -0.38, 0.55), 0.23],
      [scoreFromRange(return52w, -0.55, 0.85), 0.1],
    ],
    NEUTRAL_SCORE
  );
  const trendScore = weightedAverage(
    [
      [priceVsAverageScore(latestPrice, ma20), 0.35],
      [priceVsAverageScore(latestPrice, ma50), 0.35],
      [priceVsAverageScore(latestPrice, ma200), 0.2],
      [scoreFromRange(distanceFromYearHigh, -0.6, -0.03), 0.1],
    ],
    NEUTRAL_SCORE
  );
  const riskScore = weightedAverage(
    [
      [scoreFromRange(volatility60, 0.08, 0.012, true), 0.62],
      [scoreFromRange(distanceFromYearHigh, -0.75, -0.08), 0.38],
    ],
    NEUTRAL_SCORE
  );
  const liquidityScore = liquidityScoreFromVolume(avgVolume20);
  const momentumScore = roundScore(returnScore * 0.52 + trendScore * 0.36 + liquidityScore * 0.12);
  const growthProxyScore = roundScore(NEUTRAL_SCORE * 0.62 + returnScore * 0.38);
  const valuationProxyScore = roundScore(NEUTRAL_SCORE * 0.65 + (scoreFromRange(distanceFromYearHigh, -0.7, -0.08) ?? NEUTRAL_SCORE) * 0.35);

  return {
    latestPrice,
    previousClose: previous?.close,
    latestChange: latest?.change_pct,
    return1m,
    return3m,
    return6m,
    return52w,
    distanceFromYearHigh,
    distanceFromYearLow,
    avgVolume20,
    avgVolume60,
    ma20,
    ma50,
    ma200,
    volatility60,
    momentumScore,
    growthProxyScore,
    trendScore: roundScore(trendScore),
    riskScore: roundScore(riskScore),
    liquidityScore,
    valuationProxyScore,
  };
}

function priceSignalsFromQuote(quote: StockPayload): PriceSignals {
  const latestPrice = numberValue(quote.latest_price);
  const previousClose = numberValue(quote.previous_close);
  const latestChange = numberValue(quote.latest_change) ?? (latestPrice && previousClose ? roundRatio(latestPrice / previousClose - 1) : undefined);
  const volume = numberValue(quote.volume);
  const changeScore = scoreFromRange(latestChange, -0.08, 0.08) ?? NEUTRAL_SCORE;
  const liquidityScore = liquidityScoreFromVolume(volume);
  const riskScore = roundScore(NEUTRAL_SCORE * 0.78 + (latestChange !== undefined && latestChange < -0.06 ? 32 : NEUTRAL_SCORE) * 0.22);
  const momentumScore = roundScore(changeScore * 0.45 + liquidityScore * 0.15 + NEUTRAL_SCORE * 0.4);

  return {
    latestPrice,
    previousClose,
    latestChange,
    avgVolume20: volume,
    avgVolume60: volume,
    momentumScore,
    growthProxyScore: roundScore(NEUTRAL_SCORE * 0.72 + changeScore * 0.28),
    trendScore: NEUTRAL_SCORE,
    riskScore,
    liquidityScore,
    valuationProxyScore: NEUTRAL_SCORE,
  };
}

function scoreComponents(signals: PriceSignals, currency: string): ScoreComponent[] {
  return [
    {
      key: "profitability",
      label: "수익성",
      score: NEUTRAL_SCORE,
      summary: "정식 재무 데이터가 도착하기 전까지 중립으로 둡니다.",
      metrics: [
        { label: "보강 상태", value: "대기" },
        { label: "근거", value: "가격 데이터 우선" },
      ],
    },
    {
      key: "growth",
      label: "성장성",
      score: signals.growthProxyScore,
      summary: "재무 성장률 대신 최근 가격 추세를 낮은 비중으로 반영했습니다.",
      metrics: [
        { label: "3개월", value: percentLabel(signals.return3m) },
        { label: "6개월", value: percentLabel(signals.return6m) },
      ],
    },
    {
      key: "health",
      label: "안정성",
      score: roundScore(NEUTRAL_SCORE * 0.68 + signals.riskScore * 0.32),
      summary: "재무 안정성 보강 전이라 변동성과 고점 대비 위치로 방어력을 추정합니다.",
      metrics: [
        { label: "60일 변동성", value: percentLabel(signals.volatility60) },
        { label: "고점 대비", value: percentLabel(signals.distanceFromYearHigh) },
      ],
    },
    {
      key: "momentum",
      label: "모멘텀",
      score: signals.momentumScore,
      summary: "최근 수익률, 이동평균 위치, 유동성을 즉시 반영했습니다.",
      metrics: [
        { label: "1개월", value: percentLabel(signals.return1m) },
        { label: "현재가", value: formatCurrencyAmount(signals.latestPrice, currency) },
        { label: "20일선", value: formatCurrencyAmount(signals.ma20, currency) },
      ],
    },
    {
      key: "valuation",
      label: "밸류에이션",
      score: signals.valuationProxyScore,
      summary: "PER/PBR 보강 전에는 52주 가격 위치만 보수적으로 반영합니다.",
      metrics: [
        { label: "52주 고점 대비", value: percentLabel(signals.distanceFromYearHigh) },
        { label: "52주 저점 대비", value: percentLabel(signals.distanceFromYearLow) },
      ],
    },
  ];
}

function opportunityScoreComponents(signals: PriceSignals): ScoreComponent[] {
  return [
    {
      key: "opportunity_momentum",
      label: "최근 흐름",
      score: signals.momentumScore,
      summary: "최근 가격 흐름과 이동평균 위치를 함께 봅니다.",
      metrics: [
        { label: "1개월", value: percentLabel(signals.return1m) },
        { label: "3개월", value: percentLabel(signals.return3m) },
      ],
    },
    {
      key: "opportunity_growth",
      label: "성장 기대",
      score: signals.growthProxyScore,
      summary: "정식 성장 지표 보강 전까지 가격 추세를 보수적으로 씁니다.",
      metrics: [{ label: "6개월", value: percentLabel(signals.return6m) }],
    },
    {
      key: "opportunity_analyst",
      label: "분석 보강",
      score: NEUTRAL_SCORE,
      summary: "애널리스트 데이터는 백그라운드에서 보강됩니다.",
      metrics: [{ label: "보강 상태", value: "대기" }],
    },
    {
      key: "opportunity_liquidity",
      label: "유동성",
      score: signals.liquidityScore,
      summary: "최근 평균 거래량으로 체결 가능성을 빠르게 봅니다.",
      metrics: [
        { label: "20일 평균", value: formatValue(signals.avgVolume20) },
        { label: "60일 평균", value: formatValue(signals.avgVolume60) },
      ],
    },
    {
      key: "opportunity_risk",
      label: "리스크",
      score: signals.riskScore,
      summary: "단기 변동성과 고점 대비 낙폭으로 진입 리스크를 봅니다.",
      metrics: [
        { label: "60일 변동성", value: percentLabel(signals.volatility60) },
        { label: "고점 대비", value: percentLabel(signals.distanceFromYearHigh) },
      ],
    },
  ];
}

function keyMetrics(signals: PriceSignals, currency: string): LabeledValue[] {
  return [
    { label: "현재가", value: formatCurrencyAmount(signals.latestPrice, currency) },
    { label: "전일 대비", value: percentLabel(signals.latestChange) },
    { label: "1개월", value: percentLabel(signals.return1m) },
    { label: "3개월", value: percentLabel(signals.return3m) },
    { label: "6개월", value: percentLabel(signals.return6m) },
    { label: "52주 고점 대비", value: percentLabel(signals.distanceFromYearHigh) },
    { label: "20일 평균 거래량", value: formatValue(signals.avgVolume20) },
  ];
}

function stockProfileRows(
  daily: {
    market: "US" | "KR";
    symbol: string;
    exchange: string;
    currency: string;
  },
  identity: FastPathIdentity
): LabeledValue[] {
  return [
    { label: "시장", value: daily.market === "KR" ? "국내" : "미국" },
    { label: "거래소", value: daily.exchange },
    { label: "티커", value: daily.symbol },
    { label: "통화", value: daily.currency },
    { label: "상품 유형", value: identity.instrumentType || "STOCK" },
  ];
}

function valuationRows(signals: PriceSignals, currency: string): LabeledValue[] {
  return [
    { label: "현재가", value: formatCurrencyAmount(signals.latestPrice, currency) },
    { label: "20일선", value: formatCurrencyAmount(signals.ma20, currency) },
    { label: "50일선", value: formatCurrencyAmount(signals.ma50, currency) },
    { label: "200일선", value: formatCurrencyAmount(signals.ma200, currency) },
    { label: "52주 고점 대비", value: percentLabel(signals.distanceFromYearHigh) },
  ];
}

function weightedScore(components: ScoreComponent[], weights: Record<string, number>): number {
  return roundScore(weightedAverage(components.map((component) => [component.score, weights[String(component.key)] || 0]), NEUTRAL_SCORE));
}

function weightedAverage(items: Array<[number | undefined, number]>, fallback: number): number {
  let total = 0;
  let weight = 0;
  for (const [value, itemWeight] of items) {
    if (typeof value !== "number" || !Number.isFinite(value) || itemWeight <= 0) continue;
    total += value * itemWeight;
    weight += itemWeight;
  }
  return weight > 0 ? total / weight : fallback;
}

function trailingReturn(bars: KisDailyChartBar[], periods: number): number | undefined {
  const latest = bars.at(-1);
  if (!latest) return undefined;
  const anchorIndex = Math.max(0, bars.length - 1 - periods);
  const anchor = bars[anchorIndex];
  if (!anchor || anchor === latest || !anchor.close) return undefined;
  return roundRatio(latest.close / anchor.close - 1);
}

function priceVsAverageScore(price: number | undefined, averagePrice: number | undefined): number | undefined {
  if (!price || !averagePrice) return undefined;
  return scoreFromRange(price / averagePrice - 1, -0.12, 0.12);
}

function scoreFromRange(value: number | undefined, low: number, high: number, reverse = false): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const min = Math.min(low, high);
  const max = Math.max(low, high);
  if (max === min) return NEUTRAL_SCORE;
  const ratio = clamp((value - min) / (max - min), 0, 1);
  const score = reverse ? 100 - ratio * 100 : ratio * 100;
  return roundScore(score);
}

function liquidityScoreFromVolume(volume: number | undefined): number {
  if (typeof volume !== "number" || !Number.isFinite(volume) || volume <= 0) return NEUTRAL_SCORE;
  const logVolume = Math.log10(volume);
  return roundScore(clamp((logVolume - 4.2) / (6.4 - 4.2), 0, 1) * 100);
}

function realizedVolatility(values: number[]): number | undefined {
  if (values.length < 12) return undefined;
  const returns: number[] = [];
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (!previous || !current) continue;
    returns.push(current / previous - 1);
  }
  if (returns.length < 10) return undefined;
  const mean = average(returns) ?? 0;
  const variance = average(returns.map((value) => (value - mean) ** 2));
  return variance === undefined ? undefined : roundRatio(Math.sqrt(variance));
}

function average(values: Array<number | undefined>): number | undefined {
  const usable = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!usable.length) return undefined;
  return Math.round((usable.reduce((sum, value) => sum + value, 0) / usable.length) * 1_000_000) / 1_000_000;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("detail_daily_fast_path_timeout")), timeoutMs);
        unrefTimer(timeout);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function unrefTimer(timeout: ReturnType<typeof setTimeout>) {
  if (typeof timeout === "object" && timeout && "unref" in timeout && typeof timeout.unref === "function") {
    timeout.unref();
  }
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const text = String(value).trim();
  return text || undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function periodLabel(rows: KisDailyChartBar[]): string | undefined {
  const first = rows[0]?.date;
  const last = rows.at(-1)?.date;
  return first && last ? `${first} ~ ${last}` : last;
}

function confidenceFromBars(count: number): number {
  return roundRatio(clamp(0.22 + Math.min(count, 180) / 180 * 0.24, 0.22, 0.46));
}

function ratioFromScore(score: number): number {
  return roundRatio(clamp(score, 0, 100) / 100);
}

function gradeForScore(score: number): Grade {
  if (score >= 80) return { class: "excellent", label: "좋음" };
  if (score >= 65) return { class: "good", label: "양호" };
  if (score >= 45) return { class: "neutral", label: "보통" };
  return { class: "caution", label: "주의" };
}

function rawSignalFor(momentumScore: number, riskScore: number): string {
  if (momentumScore >= 65 && riskScore >= 45) return "price_momentum_positive";
  if (momentumScore <= 40 || riskScore <= 35) return "price_risk_watch";
  return "price_neutral";
}

function riskLevelFor(riskScore: number): string {
  if (riskScore >= 70) return "low";
  if (riskScore >= 45) return "medium";
  return "high";
}

function momentumLabel(score: number): string {
  if (score >= 70) return "강함";
  if (score >= 55) return "우호";
  if (score >= 42) return "중립";
  return "약함";
}

function percentLabel(value: number | undefined): string {
  return formatPercent(value);
}

function roundScore(value: number): number {
  return Math.round(clamp(value, 0, 100));
}

function roundRatio(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

function hasHangul(value: string): boolean {
  return /[가-힣]/.test(value);
}

function detailRequestFastPathTimeoutMs(): number {
  const parsed = Number(envValue("STOCK_TECHNICAL_KIS_TIMEOUT_MS"));
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 2_500;
}

function detailDailyFastPathTimeoutMs(): number {
  const parsed = Number(envValue("STOCK_DETAIL_DAILY_FAST_PATH_TIMEOUT_MS"));
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 2_800;
}
