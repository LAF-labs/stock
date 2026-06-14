import test from "node:test";
import assert from "node:assert/strict";

import { fetchYahooDailyChart, fetchYahooFundamentals, fetchYahooQuote, yahooFinanceFallbackEnabled } from "../src/lib/yahooFinanceClient";

test("Yahoo fallback is production opt-in instead of Vercel default-on", () => {
  assert.equal(yahooFinanceFallbackEnabled({ VERCEL: "1", VERCEL_ENV: "production" }), false);
  assert.equal(yahooFinanceFallbackEnabled({ VERCEL_ENV: "preview" }), false);
  assert.equal(yahooFinanceFallbackEnabled({ STOCK_YAHOO_FALLBACK: "1", VERCEL_ENV: "production" }), true);
});

test("Yahoo daily fallback ignores split-skewed regularMarketPrice and uses chart closes", async () => {
  const originalFetch = global.fetch;
  const originalFallback = process.env.STOCK_YAHOO_FALLBACK;
  process.env.STOCK_YAHOO_FALLBACK = "1";
  global.fetch = async () => Response.json({
    chart: {
      result: [{
        meta: {
          currency: "USD",
          regularMarketPrice: 103.03,
          chartPreviousClose: 9,
          longName: "Aehr Test Systems",
          fullExchangeName: "NasdaqCM",
          exchangeName: "NCM",
        },
        timestamp: [1781136000, 1781222400],
        indicators: {
          quote: [{
            open: [10, 11],
            high: [10.5, 11.8],
            low: [9.8, 10.8],
            close: [10.3, 11.64],
            volume: [1000, 2000],
          }],
        },
      }],
      error: null,
    },
  });

  try {
    const daily = await fetchYahooDailyChart("US:AEHR");
    assert.equal(daily.latestPrice, 11.64);
    assert.equal(daily.priceMetrics.price, 11.64);
    assert.equal(daily.priceMetrics.previous_close, 10.3);

    const quote = await fetchYahooQuote("US:AEHR");
    assert.equal(quote.latest_price, 11.64);
    assert.equal(quote.previous_close, 10.3);
    assert.equal(quote.latest_change, 0.130097);
  } finally {
    global.fetch = originalFetch;
    if (originalFallback === undefined) delete process.env.STOCK_YAHOO_FALLBACK;
    else process.env.STOCK_YAHOO_FALLBACK = originalFallback;
  }
});

test("Yahoo fundamentals maps timeseries rows into common financial fields", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => Response.json({
    timeseries: {
      result: [
        {
          meta: { symbol: ["PZZA"], type: ["trailingTotalRevenue"] },
          trailingTotalRevenue: [reported("2026-03-31", 2_014_108_000, "USD")],
        },
        {
          meta: { symbol: ["PZZA"], type: ["trailingNetIncome"] },
          trailingNetIncome: [reported("2026-03-31", 28_564_000, "USD")],
        },
        {
          meta: { symbol: ["PZZA"], type: ["trailingOperatingIncome"] },
          trailingOperatingIncome: [reported("2026-03-31", 82_728_000, "USD")],
        },
        {
          meta: { symbol: ["PZZA"], type: ["trailingPeRatio"] },
          trailingPeRatio: [reported("2026-06-12", 39.277108)],
        },
        {
          meta: { symbol: ["PZZA"], type: ["trailingDilutedEPS"] },
          trailingDilutedEPS: [reported("2026-03-31", 0.87, "USD")],
        },
        {
          meta: { symbol: ["PZZA"], type: ["quarterlyTotalAssets"] },
          quarterlyTotalAssets: [reported("2026-03-31", 1_012_000_000, "USD")],
        },
        {
          meta: { symbol: ["PZZA"], type: ["quarterlyTotalLiabilitiesNetMinorityInterest"] },
          quarterlyTotalLiabilitiesNetMinorityInterest: [reported("2026-03-31", 750_000_000, "USD")],
        },
        {
          meta: { symbol: ["PZZA"], type: ["quarterlyStockholdersEquity"] },
          quarterlyStockholdersEquity: [reported("2026-03-31", 262_000_000, "USD")],
        },
        {
          meta: { symbol: ["PZZA"], type: ["annualTotalRevenue"] },
          annualTotalRevenue: [
            reported("2024-12-31", 2_059_387_000, "USD"),
            reported("2025-12-31", 2_053_808_000, "USD"),
          ],
        },
      ],
      error: null,
    },
  });

  try {
    const result = await fetchYahooFundamentals("US:PZZA", { latestPrice: 34.17, marketCap: 1_090_000_000 });
    assert.equal(result.normalized.totalRevenue, 2_014_108_000);
    assert.equal(result.normalized.netIncome, 28_564_000);
    assert.equal(result.normalized.operatingIncome, 82_728_000);
    assert.equal(result.normalized.trailingPE, 39.277108);
    assert.equal(result.normalized.eps, 0.87);
    assert.equal(result.normalized.profitMargins, 0.014182);
    assert.equal(result.normalized.revenueGrowth, -0.002709);
    assert.equal(result.normalized.currency, "USD");
  } finally {
    global.fetch = originalFetch;
  }
});

function reported(asOfDate: string, raw: number, currencyCode?: string) {
  return {
    asOfDate,
    periodType: "TTM",
    ...(currencyCode ? { currencyCode } : {}),
    reportedValue: { raw, fmt: String(raw) },
  };
}
