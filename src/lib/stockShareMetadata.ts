import type { Metadata } from "next";
import { formatCompactUsd, formatCurrencyAmount, formatKoreanWonLarge, formatPercent } from "@/lib/format";
import type { StockDisplayPayload } from "@/lib/stockDisplayTypes";
import type { ChartSeriesPoint } from "@/lib/types";

export const STOCKSTALKER_SERVICE_NAME = "스톡스토커";
export const STOCKSTALKER_DEFAULT_DESCRIPTION = "국내·미국 주식의 가격, 시가총액, 점수 흐름을 빠르게 확인하세요.";

export type StockShareMetadata = {
  title: string;
  description: string;
  siteName: string;
  url: string;
  imageUrl: string;
};

export type StockShareCandle = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  tone: "up" | "down" | "flat";
};

export type StockShareImageModel = {
  serviceName: string;
  title: string;
  ticker: string;
  price: string;
  change: string;
  description: string;
  candles: StockShareCandle[];
};

export function stockShareMetadataToNextMetadata(share: StockShareMetadata): Metadata {
  const image = {
    url: share.imageUrl,
    width: 1200,
    height: 630,
    alt: share.title,
  };
  return {
    title: share.title,
    description: share.description,
    openGraph: {
      title: share.title,
      description: share.description,
      siteName: share.siteName,
      url: share.url,
      type: "website",
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title: share.title,
      description: share.description,
      images: [share.imageUrl],
    },
  };
}

type StockShareMetadataOptions = {
  origin?: string;
  pathname?: "/" | "/technical";
};

export function stockShareMetadataFromPayload(payload: StockDisplayPayload | undefined, options: StockShareMetadataOptions = {}): StockShareMetadata {
  const origin = stockShareOrigin(options.origin);
  const pathname = options.pathname || "/";
  if (!payload) {
    return {
      title: STOCKSTALKER_SERVICE_NAME,
      description: STOCKSTALKER_DEFAULT_DESCRIPTION,
      siteName: STOCKSTALKER_SERVICE_NAME,
      url: `${origin}${pathname === "/" ? "/" : pathname}`,
      imageUrl: `${origin}/api/og/stock`,
    };
  }

  const stockName = stockNameFromPayload(payload);
  const latestChange = latestChangeText(payload);
  const title = latestChange && latestChange !== "-"
    ? `${stockName} ${latestChange} | ${STOCKSTALKER_SERVICE_NAME}`
    : `${stockName} | ${STOCKSTALKER_SERVICE_NAME}`;
  const price = latestPriceText(payload);
  const marketCap = marketCapText(payload);
  const description = shareDescription(price, marketCap);
  const tickerParam = encodeURIComponent(payload.ticker);

  return {
    title,
    description,
    siteName: STOCKSTALKER_SERVICE_NAME,
    url: `${origin}${pathname === "/" ? "/" : pathname}?ticker=${tickerParam}`,
    imageUrl: `${origin}/api/og/stock?ticker=${tickerParam}`,
  };
}

export function compareShareMetadataFromPayloads(
  payloads: StockDisplayPayload[],
  options: StockShareMetadataOptions & { tickers?: string[] } = {},
): StockShareMetadata {
  const origin = stockShareOrigin(options.origin);
  const tickers = uniqueTickers(options.tickers?.length ? options.tickers : payloads.map((payload) => payload.ticker));
  const payloadByTicker = new Map(payloads.map((payload) => [payload.ticker, payload]));
  const names = tickers.map((ticker) => compareNameForTicker(payloadByTicker.get(ticker), ticker));
  const count = Math.max(tickers.length, names.length);
  const titleBody = names.length ? names.join(" vs ") : "종목 비교";
  const encodedTickers = tickers.map((ticker) => encodeURIComponent(ticker)).join("%2C");
  const query = encodedTickers ? `?tickers=${encodedTickers}` : "";

  return {
    title: `${titleBody} | ${STOCKSTALKER_SERVICE_NAME}`,
    description: `${count}개의 종목을 성장성, 재무, 밸류에이션 등으로 비교해요.`,
    siteName: STOCKSTALKER_SERVICE_NAME,
    url: `${origin}/compare${query}`,
    imageUrl: `${origin}/api/og/compare${query}`,
  };
}

export function compareShareImageModelFromPayloads(payloads: StockDisplayPayload[], tickers: string[] = []): StockShareImageModel {
  const unique = uniqueTickers(tickers.length ? tickers : payloads.map((payload) => payload.ticker));
  const payloadByTicker = new Map(payloads.map((payload) => [payload.ticker, payload]));
  const names = unique.map((ticker) => compareNameForTicker(payloadByTicker.get(ticker), ticker));
  const count = Math.max(unique.length, names.length);
  return {
    serviceName: STOCKSTALKER_SERVICE_NAME,
    title: names.length ? names.join(" vs ") : "종목 비교",
    ticker: `${count}개 종목`,
    price: "성장성 · 재무 · 밸류에이션",
    change: "비교",
    description: `${count}개의 종목을 성장성, 재무, 밸류에이션 등으로 비교해요.`,
    candles: [],
  };
}

export function stockShareImageModelFromPayload(payload: StockDisplayPayload | undefined): StockShareImageModel {
  return {
    serviceName: STOCKSTALKER_SERVICE_NAME,
    title: payload ? stockNameFromPayload(payload) : STOCKSTALKER_SERVICE_NAME,
    ticker: payload?.ticker || "stockstalker",
    price: payload ? latestPriceText(payload) : "국내·미국 주식 점수",
    change: payload ? latestChangeText(payload) || "-" : "공유 카드",
    description: payload ? shareDescription(latestPriceText(payload), marketCapText(payload)) : STOCKSTALKER_DEFAULT_DESCRIPTION,
    candles: chartCandlesForShareImage(chartSeriesFromPayload(payload), 44),
  };
}

export function chartCandlesForShareImage(points: unknown, limit = 44): StockShareCandle[] {
  if (!Array.isArray(points)) return [];
  return points
    .map((point, index) => shareCandleFromPoint(point, index, points))
    .filter((point): point is StockShareCandle => !!point)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-Math.max(1, limit));
}

export function stockShareOriginFromEnv(env: Partial<NodeJS.ProcessEnv> = process.env): string {
  return stockShareOrigin(
    env.NEXT_PUBLIC_SITE_URL
      || env.SITE_URL
      || env.VERCEL_PROJECT_PRODUCTION_URL
      || env.VERCEL_URL
      || "http://localhost:3000"
  );
}

function stockShareOrigin(value: string | undefined): string {
  const raw = (value || "http://localhost:3000").trim().replace(/\/+$/, "");
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withProtocol);
    return url.origin;
  } catch {
    return "http://localhost:3000";
  }
}

function uniqueTickers(tickers: string[] | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const ticker of tickers || []) {
    const value = ticker.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function compareNameForTicker(payload: StockDisplayPayload | undefined, ticker: string): string {
  if (!payload) return fallbackCompareName(ticker);
  const identity = payload.identity.value;
  if (identity.market === "US") return identity.symbol || fallbackCompareName(ticker);
  return identity.name || identity.symbol || fallbackCompareName(ticker);
}

function fallbackCompareName(ticker: string): string {
  const [market, symbol] = ticker.split(":");
  if (market?.toUpperCase() === "US" && symbol) return symbol;
  return symbol || ticker;
}

function stockNameFromPayload(payload: StockDisplayPayload): string {
  const identity = payload.identity.value;
  const price = recordFromUnknown(payload.price?.value);
  const score = recordFromUnknown(payload.score?.value);
  return stringFromUnknown(identity.name)
    || stringFromUnknown(price?.name)
    || stringFromUnknown(score?.display_name)
    || stringFromUnknown(score?.name)
    || identity.symbol
    || payload.ticker;
}

function latestChangeText(payload: StockDisplayPayload): string | undefined {
  const price = recordFromUnknown(payload.price?.value);
  const score = recordFromUnknown(payload.score?.value);
  const priceMetrics = recordFromUnknown(price?.price_metrics) || recordFromUnknown(score?.price_metrics);
  return stringFromUnknown(price?.latest_change_label)
    || stringFromUnknown(score?.latest_change_label)
    || percentFromUnknown(price?.latest_change)
    || percentFromUnknown(score?.latest_change)
    || percentFromUnknown(priceMetrics?.latest_change);
}

function latestPriceText(payload: StockDisplayPayload): string {
  const price = recordFromUnknown(payload.price?.value);
  const score = recordFromUnknown(payload.score?.value);
  const currency = currencyFromPayload(payload);
  const label = providerPrimaryPriceLabel(
    stringFromUnknown(price?.latest_price_label) || stringFromUnknown(score?.latest_price_label),
    currency,
  );
  if (label) return label;
  const latestPrice = numberFromUnknown(price?.latest_price) ?? numberFromUnknown(score?.latest_price);
  return formatCurrencyAmount(latestPrice, currency);
}

function marketCapText(payload: StockDisplayPayload): string {
  const price = recordFromUnknown(payload.price?.value);
  const score = recordFromUnknown(payload.score?.value);
  const priceMetrics = recordFromUnknown(price?.price_metrics) || recordFromUnknown(score?.price_metrics);
  const rawMetric = metricValue(score?.key_metrics, "시가총액");
  const marketCap = numberFromUnknown(price?.market_cap)
    ?? numberFromUnknown(score?.market_cap)
    ?? numberFromUnknown(priceMetrics?.market_cap)
    ?? numberFromUnknown(rawMetric);
  const label = stringFromUnknown(price?.market_cap_label)
    || stringFromUnknown(score?.market_cap_label)
    || stringFromUnknown(rawMetric);
  const currency = currencyFromPayload(payload);

  if (marketCap !== undefined) {
    if (payload.identity.value.market === "KR" || currency === "KRW") return formatKoreanWonLarge(marketCap);
    const usdKrwRate = numberFromUnknown(price?.usd_krw_rate) ?? numberFromUnknown(score?.usd_krw_rate);
    if (usdKrwRate !== undefined) return `${formatKoreanWonLarge(marketCap * usdKrwRate)} (${formatCompactUsd(marketCap)})`;
    return formatCompactUsd(marketCap);
  }

  return label || "-";
}

function shareDescription(price: string, marketCap: string): string {
  const parts = [];
  if (price && price !== "-") parts.push(`현재가 ${price}`);
  if (marketCap && marketCap !== "-") parts.push(`시가총액 ${marketCap}`);
  return parts.length ? parts.join(" · ") : STOCKSTALKER_DEFAULT_DESCRIPTION;
}

function chartSeriesFromPayload(payload: StockDisplayPayload | undefined): unknown {
  const chart = recordFromUnknown(payload?.chart?.value);
  const score = recordFromUnknown(payload?.score?.value);
  return chart?.chart_series || score?.chart_series;
}

function shareCandleFromPoint(point: unknown, index: number, points: unknown[]): StockShareCandle | undefined {
  const record = recordFromUnknown(point);
  const close = numberFromUnknown(record?.close);
  if (close === undefined) return undefined;
  const previous = recordFromUnknown(points[index - 1]);
  const previousClose = numberFromUnknown(previous?.close);
  const open = numberFromUnknown(record?.open) ?? previousClose ?? close;
  const high = Math.max(numberFromUnknown(record?.high) ?? close, open, close);
  const low = Math.min(numberFromUnknown(record?.low) ?? close, open, close);
  const date = stringFromUnknown(record?.date) || String(index).padStart(4, "0");
  return {
    date,
    open,
    high,
    low,
    close,
    tone: close > open ? "up" : close < open ? "down" : "flat",
  };
}

function currencyFromPayload(payload: StockDisplayPayload): string {
  const price = recordFromUnknown(payload.price?.value);
  const score = recordFromUnknown(payload.score?.value);
  return (stringFromUnknown(price?.currency) || stringFromUnknown(score?.currency) || (payload.identity.value.market === "KR" ? "KRW" : "USD")).toUpperCase();
}

function providerPrimaryPriceLabel(value: string | undefined, currency: string): string | undefined {
  const label = value?.trim();
  if (!label || label === "-") return undefined;
  const primary = label.split("/")[0]?.replace(/\s*\(.+\)$/, "").trim();
  if (!primary || primary === "-") return undefined;
  if (currency === "USD" && primary.startsWith("$")) return primary;
  if (currency === "KRW" && primary.includes("원")) return primary;
  if (currency !== "USD" && currency !== "KRW" && primary.toUpperCase().startsWith(`${currency} `)) return primary;
  return primary;
}

function metricValue(value: unknown, label: string): unknown {
  if (!Array.isArray(value)) return undefined;
  const found = value.find((item) => recordFromUnknown(item)?.label === label);
  return recordFromUnknown(found)?.value;
}

function percentFromUnknown(value: unknown): string | undefined {
  const number = numberFromUnknown(value);
  return number === undefined ? undefined : formatPercent(number);
}

function recordFromUnknown(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stringFromUnknown(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberFromUnknown(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
