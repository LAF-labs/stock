import test from "node:test";
import assert from "node:assert/strict";

import {
  STOCKSTALKER_SERVICE_NAME,
  chartCandlesForShareImage,
  compareShareMetadataFromPayloads,
  stockShareMetadataFromPayload,
  stockShareOriginFromEnv,
} from "../src/lib/stockShareMetadata";
import { stockShareImageResponse } from "../src/app/api/og/shareImage";
import type { DisplayPart, StockDisplayPayload } from "../src/lib/stockDisplayTypes";

test("stock share metadata names the stock, latest change, current price, and market cap", () => {
  const metadata = stockShareMetadataFromPayload(sharePayload(), { origin: "https://stock.example" });

  assert.equal(STOCKSTALKER_SERVICE_NAME, "스톡스토커");
  assert.equal(metadata.title, "삼성전자 +2.1% | 스톡스토커");
  assert.equal(metadata.description, "현재가 187,400원 · 시가총액 310조원");
  assert.equal(metadata.siteName, "스톡스토커");
  assert.equal(metadata.url, "https://stock.example/?ticker=KR%3A005930");
  assert.equal(metadata.imageUrl, "https://stock.example/api/og/stock?ticker=KR%3A005930");
});

test("stock share metadata normalizes compact Korean market cap labels", () => {
  const payload = sharePayload();
  delete (payload.price?.value as Record<string, unknown>).market_cap;
  payload.score = part({
    key_metrics: [{ label: "시가총액", value: "₩1497.39T" }],
  }, payload.generatedAt);

  const metadata = stockShareMetadataFromPayload(payload, { origin: "https://stock.example" });

  assert.equal(metadata.description, "현재가 187,400원 · 시가총액 1497조 3900억원");
});

test("technical analysis shares the same stock title and description format as detail", () => {
  const detail = stockShareMetadataFromPayload(sharePayload(), { origin: "https://stock.example" });
  const technical = stockShareMetadataFromPayload(sharePayload(), { origin: "https://stock.example", pathname: "/technical" });

  assert.equal(technical.title, detail.title);
  assert.equal(technical.description, detail.description);
  assert.equal(technical.url, "https://stock.example/technical?ticker=KR%3A005930");
  assert.equal(technical.imageUrl, detail.imageUrl);
});

test("compare share metadata lists US tickers and Korean stock names", () => {
  const metadata = compareShareMetadataFromPayloads([
    sharePayload({
      ticker: "US:NVDA",
      market: "US",
      symbol: "NVDA",
      name: "NVIDIA Corp",
    }),
    sharePayload(),
    sharePayload({
      ticker: "KR:000660",
      market: "KR",
      symbol: "000660",
      name: "SK하이닉스",
    }),
  ], { origin: "https://stock.example", tickers: ["US:NVDA", "KR:005930", "KR:000660"] });

  assert.equal(metadata.title, "NVDA vs 삼성전자 vs SK하이닉스 | 스톡스토커");
  assert.equal(metadata.description, "3개의 종목을 성장성, 재무, 밸류에이션 등으로 비교해요.");
  assert.equal(metadata.url, "https://stock.example/compare?tickers=US%3ANVDA%2CKR%3A005930%2CKR%3A000660");
  assert.equal(metadata.imageUrl, "https://stock.example/api/og/compare?tickers=US%3ANVDA%2CKR%3A005930%2CKR%3A000660");
});

test("stock share metadata falls back to the service card when no ticker payload exists", () => {
  const metadata = stockShareMetadataFromPayload(undefined, { origin: "https://stock.example" });

  assert.equal(metadata.title, "스톡스토커");
  assert.equal(metadata.description, "국내·미국 주식의 가격, 시가총액, 점수 흐름을 빠르게 확인하세요.");
  assert.equal(metadata.url, "https://stock.example/");
  assert.equal(metadata.imageUrl, "https://stock.example/api/og/stock");
});

test("stock share origin normalizes Vercel and public site environment values", () => {
  assert.equal(stockShareOriginFromEnv({ NEXT_PUBLIC_SITE_URL: "stock.example/" }), "https://stock.example");
  assert.equal(stockShareOriginFromEnv({ VERCEL_PROJECT_PRODUCTION_URL: "stock-khaki.vercel.app" }), "https://stock-khaki.vercel.app");
  assert.equal(stockShareOriginFromEnv({}), "http://localhost:3000");
});

test("share image candles keep the latest daily OHLC points", () => {
  const candles = chartCandlesForShareImage([
    { date: "2026-06-09", open: 10, high: 12, low: 9, close: 11 },
    { date: "2026-06-11", open: 13, high: 15, low: 12, close: 12.5 },
    { date: "2026-06-10", open: 11, high: 14, low: 10, close: 13 },
  ], 2);

  assert.deepEqual(candles.map((candle) => candle.date), ["2026-06-10", "2026-06-11"]);
  assert.equal(candles[0].tone, "up");
  assert.equal(candles[1].tone, "down");
});

test("stock share image renders candle data as a PNG", async () => {
  const candles = chartCandlesForShareImage([
    { date: "2026-06-09", open: 10, high: 12, low: 9, close: 11 },
    { date: "2026-06-10", open: 11, high: 14, low: 10, close: 13 },
    { date: "2026-06-11", open: 13, high: 15, low: 12, close: 12.5 },
  ]);
  const response = stockShareImageResponse({
    serviceName: STOCKSTALKER_SERVICE_NAME,
    title: "삼성전자",
    ticker: "KR:005930",
    price: "187,400원",
    change: "+2.1%",
    description: "현재가 187,400원 · 시가총액 310조원",
    candles,
  });
  const image = Buffer.from(await response.arrayBuffer());

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.deepEqual([...image.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
});

function sharePayload(overrides: {
  ticker?: string;
  market?: "US" | "KR";
  symbol?: string;
  name?: string;
} = {}): StockDisplayPayload {
  const generatedAt = "2026-06-12T00:00:00.000Z";
  const ticker = overrides.ticker || "KR:005930";
  const market = overrides.market || "KR";
  const symbol = overrides.symbol || "005930";
  const name = overrides.name || "삼성전자";
  return {
    ok: true,
    ticker,
    requestedTicker: ticker,
    view: "detail",
    generatedAt,
    snapshotVersion: "display-v1",
    hotnessTier: "active",
    identity: part({
      ticker,
      market,
      symbol,
      name,
    }, generatedAt),
    price: part({
      market,
      symbol,
      name,
      currency: market === "KR" ? "KRW" : "USD",
      latest_price: 187400,
      latest_price_label: market === "KR" ? "187,400원" : "$187.40",
      latest_change: 0.021,
      latest_change_label: "+2.1%",
      market_cap: 310_000_000_000_000,
    }, generatedAt),
    chart: part({
      chart_series: [
        { date: "2026-06-09", open: 180000, high: 188000, low: 179000, close: 187400 },
        { date: "2026-06-10", open: 187500, high: 190000, low: 184000, close: 186000 },
      ],
    }, generatedAt),
    completion: {
      requiredParts: ["identity", "price", "chart", "score"],
      presentParts: ["identity", "price", "chart"],
      missingParts: ["score"],
      recoveringParts: ["score"],
      unavailableParts: [],
    },
    refresh: {
      active: true,
      pollable: true,
      staleParts: [],
      recoveringParts: ["score"],
    },
    capabilities: {
      canCompare: true,
      canTechnical: true,
    },
  };
}

function part<T>(value: T, fetchedAt: string): DisplayPart<T> {
  return {
    value,
    freshness: "fresh",
    source: "market-data",
    fetchedAt,
  };
}
