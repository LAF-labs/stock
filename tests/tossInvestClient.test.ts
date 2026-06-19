import test from "node:test";
import assert from "node:assert/strict";

import { buildDetailScoreFastPathPayload } from "../src/lib/detailScoreFastPath";
import { fetchTossDailyChart, fetchTossQuote, tossInvestConfigured } from "../src/lib/tossInvestClient";

const ENV_KEYS = [
  "STOCK_YAHOO_FALLBACK",
  "TOSS_INVEST_API_BASE",
  "TOSS_INVEST_CLIENT_ID",
  "TOSS_INVEST_CLIENT_SECRET",
] as const;

const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;

function setupEnv() {
  process.env.TOSS_INVEST_API_BASE = "https://toss.example.com";
  process.env.TOSS_INVEST_CLIENT_ID = "client-id";
  process.env.TOSS_INVEST_CLIENT_SECRET = "client-secret";
}

function restore() {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  globalThis.fetch = originalFetch;
}

test.afterEach(restore);

test("Toss provider config requires client id and secret", () => {
  assert.equal(tossInvestConfigured({}), false);
  assert.equal(tossInvestConfigured({ TOSS_INVEST_CLIENT_ID: "id", TOSS_INVEST_CLIENT_SECRET: "secret" }), true);
});

test("fetchTossQuote maps Toss stock and price data into the public quote shape", async () => {
  setupEnv();
  const seen: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    seen.push(url);
    if (url.endsWith("/oauth2/token")) {
      assert.equal(init?.method, "POST");
      assert.match(String(init?.body), /client_id=client-id/);
      assert.match(String(init?.body), /client_secret=client-secret/);
      return Response.json({ access_token: "token-1", token_type: "Bearer", expires_in: 3600 });
    }
    if (url.includes("/api/v1/stocks?")) {
      return Response.json({
        result: [{
          symbol: "005930",
          name: "삼성전자",
          englishName: "SamsungElec",
          market: "KOSPI",
          currency: "KRW",
          status: "ACTIVE",
          sharesOutstanding: "5919637922",
        }],
      });
    }
    if (url.includes("/api/v1/prices?")) {
      return Response.json({
        result: [{
          symbol: "005930",
          timestamp: "2026-06-19T09:30:00+09:00",
          lastPrice: "70000",
          currency: "KRW",
        }],
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  const quote = await fetchTossQuote("KR:005930");

  assert.equal(quote.ok, true);
  assert.equal(quote.requested_ticker, "KR:005930");
  assert.equal(quote.market, "KR");
  assert.equal(quote.symbol, "005930");
  assert.equal(quote.name, "삼성전자");
  assert.equal(quote.exchange, "KOSPI");
  assert.equal(quote.currency, "KRW");
  assert.equal(quote.latest_price, 70000);
  assert.equal(quote.latest_price_label, "70,000원");
  assert.equal(quote.latest_bar_date, "2026-06-19");
  assert.equal(quote.market_cap, 414374654540000);
  assert.equal((quote.price_metrics as Record<string, unknown>).market_cap, 414374654540000);
  assert.equal((quote.fetch as Record<string, unknown>).provider, "toss_invest");
  assert.ok(seen.some((url) => url.includes("symbols=005930")));
});

test("fetchTossDailyChart maps Toss candles into ascending daily bars", async () => {
  setupEnv();
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/oauth2/token")) {
      return Response.json({ access_token: "token-2", token_type: "Bearer", expires_in: 3600 });
    }
    if (url.includes("/api/v1/stocks?")) {
      return Response.json({
        result: [{
          symbol: "AAPL",
          name: "애플",
          englishName: "Apple Inc.",
          market: "NASDAQ",
          currency: "USD",
          status: "ACTIVE",
          sharesOutstanding: "15400000000",
        }],
      });
    }
    if (url.includes("/api/v1/candles?")) {
      assert.match(url, /symbol=AAPL/);
      assert.match(url, /interval=1d/);
      assert.match(url, /adjusted=true/);
      return Response.json({
        result: {
          candles: [
            { timestamp: "2026-06-18T00:00:00-04:00", openPrice: "198", highPrice: "203", lowPrice: "197", closePrice: "202", volume: "1100", currency: "USD" },
            { timestamp: "2026-06-17T00:00:00-04:00", openPrice: "190", highPrice: "201", lowPrice: "189", closePrice: "200", volume: "1000", currency: "USD" },
          ],
          nextBefore: null,
        },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  const daily = await fetchTossDailyChart("US:AAPL");

  assert.equal(daily.requestedTicker, "US:AAPL");
  assert.equal(daily.name, "애플");
  assert.equal(daily.exchange, "NASDAQ");
  assert.equal(daily.latestPrice, 202);
  assert.equal(daily.latestDate, "2026-06-18");
  assert.deepEqual(daily.chartSeries.map((bar) => bar.date), ["2026-06-17", "2026-06-18"]);
  assert.equal(daily.chartSeries[1]?.change_pct, 0.01);
  assert.equal(daily.priceMetrics.market_cap, 3_110_800_000_000);
  assert.equal(daily.fetch.provider, "toss_invest");
});

test("Toss chart data still uses existing Yahoo fundamentals enrichment", async () => {
  setupEnv();
  process.env.STOCK_YAHOO_FALLBACK = "0";
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/oauth2/token")) {
      return Response.json({ access_token: "token-3", token_type: "Bearer", expires_in: 3600 });
    }
    if (url.includes("/api/v1/stocks?")) {
      return Response.json({
        result: [{
          symbol: "PZZA",
          name: "Papa Johns",
          englishName: "Papa Johns International",
          market: "NASDAQ",
          currency: "USD",
          status: "ACTIVE",
          sharesOutstanding: "31000000",
        }],
      });
    }
    if (url.includes("/api/v1/candles?")) {
      const candles = Array.from({ length: 80 }, (_, index) => {
        const close = 30 + index * 0.1;
        return {
          timestamp: new Date(Date.UTC(2026, 0, 2 + index)).toISOString(),
          openPrice: String(close - 0.1),
          highPrice: String(close + 0.2),
          lowPrice: String(close - 0.2),
          closePrice: String(close),
          volume: String(50_000 + index),
          currency: "USD",
        };
      });
      return Response.json({ result: { candles, nextBefore: null } });
    }
    if (url.includes("query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/PZZA")) {
      return Response.json({
        timeseries: {
          result: [
            { meta: { symbol: ["PZZA"], type: ["trailingTotalRevenue"] }, trailingTotalRevenue: [reported("2026-03-31", 2_014_108_000, "USD")] },
            { meta: { symbol: ["PZZA"], type: ["trailingNetIncome"] }, trailingNetIncome: [reported("2026-03-31", 28_564_000, "USD")] },
            { meta: { symbol: ["PZZA"], type: ["trailingPeRatio"] }, trailingPeRatio: [reported("2026-06-12", 39.277108)] },
          ],
          error: null,
        },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  const payload = await buildDetailScoreFastPathPayload("US:PZZA", "detail");

  assert.equal((payload.fetch as Record<string, unknown>).pending_enrichment, undefined);
  assert.equal((payload.fetch as Record<string, unknown>).fundamentals_source, "yahoo_fundamentals");
  assert.equal((payload.financials as Record<string, unknown>).totalRevenue, 2_014_108_000);
  assert.equal((payload.financials as Record<string, unknown>).trailingPE, 39.277108);
});

function reported(asOfDate: string, raw: number, currencyCode?: string) {
  return {
    asOfDate,
    periodType: "TTM",
    ...(currencyCode ? { currencyCode } : {}),
    reportedValue: { raw, fmt: String(raw) },
  };
}
