import test from "node:test";
import assert from "node:assert/strict";

import { fetchYahooDailyChart, fetchYahooQuote } from "../src/lib/yahooFinanceClient";

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
