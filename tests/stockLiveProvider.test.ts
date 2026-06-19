import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { GET as refreshMarketCap } from "../src/app/api/market-cap/refresh/route";
import { fetchLiveDailyChart, fetchLiveQuote } from "../src/lib/stockLiveProvider";

const ENV_KEYS = [
  "CRON_SECRET",
  "KIS_API_BASE",
  "KIS_APP_KEY",
  "KIS_APP_SECRET",
  "MARKET_CAP_REFRESH_SECRET",
  "STOCK_API_BASE",
  "STOCK_API_APP_KEY",
  "STOCK_API_APP_SECRET",
  "STOCK_KIS_LOCAL_TOKEN_CACHE",
  "STOCK_KIS_TOKEN_CACHE_DIR",
  "STOCK_TECHNICAL_KIS_DAILY_MAX_PAGES",
  "STOCK_YAHOO_FALLBACK",
  "TOSS_INVEST_API_BASE",
  "TOSS_INVEST_ENABLED",
  "TOSS_INVEST_CLIENT_ID",
  "TOSS_INVEST_CLIENT_SECRET",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_URL",
] as const;

const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
const globalWithKisCache = globalThis as typeof globalThis & {
  __kisQuoteTokenCache?: Map<string, unknown>;
  __kisQuoteTokenInflight?: Map<string, unknown>;
  __kisQuoteDiscoveryCache?: Map<string, unknown>;
  __kisDailyChartMemoryCache?: Map<string, unknown>;
  __kisDailyChartInflight?: Map<string, unknown>;
  __tossInvestTokenCache?: Map<string, unknown>;
  __tossInvestTokenInflight?: Map<string, unknown>;
};
let tokenCacheDir: string | undefined;

function restore() {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  globalThis.fetch = originalFetch;
  if (tokenCacheDir) rmSync(tokenCacheDir, { recursive: true, force: true });
  tokenCacheDir = undefined;
  globalWithKisCache.__kisQuoteTokenCache?.clear();
  globalWithKisCache.__kisQuoteTokenInflight?.clear();
  globalWithKisCache.__kisQuoteDiscoveryCache?.clear();
  globalWithKisCache.__kisDailyChartMemoryCache?.clear();
  globalWithKisCache.__kisDailyChartInflight?.clear();
  globalWithKisCache.__tossInvestTokenCache?.clear();
  globalWithKisCache.__tossInvestTokenInflight?.clear();
}

function setupLiveProviderEnv() {
  tokenCacheDir = mkdtempSync(join(tmpdir(), "stock-live-provider-"));
  process.env.STOCK_API_APP_KEY = "app-key";
  process.env.STOCK_API_APP_SECRET = "app-secret";
  process.env.STOCK_API_BASE = "https://kis.example.com";
  process.env.STOCK_KIS_LOCAL_TOKEN_CACHE = "0";
  process.env.STOCK_KIS_TOKEN_CACHE_DIR = tokenCacheDir;
  process.env.STOCK_YAHOO_FALLBACK = "1";
  delete process.env.KIS_API_BASE;
  delete process.env.KIS_APP_KEY;
  delete process.env.KIS_APP_SECRET;
  delete process.env.SUPABASE_PUBLISHABLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_URL;
}

test.afterEach(restore);

test("market cap refresh rejects secrets in query strings", async () => {
  process.env.MARKET_CAP_REFRESH_SECRET = "secret";
  globalThis.fetch = async () => {
    throw new Error("refresh should not run");
  };

  const response = await refreshMarketCap(new Request("http://localhost/api/market-cap/refresh?secret=secret"));

  assert.equal(response.status, 401);
});

test("live provider waits for a slower fallback before declaring provider-empty", async () => {
  setupLiveProviderEnv();

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/oauth2/tokenP")) {
      return Response.json({ access_token: "token-1", expires_in: 3600 });
    }
    if (url.includes("/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice")) {
      return Response.json({ rt_cd: "0", output2: [] });
    }
    if (url.includes("query1.finance.yahoo.com/v8/finance/chart/005930.KS")) {
      await new Promise((resolve) => setTimeout(resolve, 60));
      return Response.json({
        chart: {
          result: [{
            meta: { currency: "KRW", regularMarketPrice: 12500, chartPreviousClose: 12000 },
            timestamp: [1780531200, 1780617600],
            indicators: {
              quote: [{
                open: [12000, 12100],
                high: [12300, 12600],
                low: [11900, 12000],
                close: [12000, 12500],
                volume: [1000, 1100],
              }],
            },
          }],
          error: null,
        },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  const daily = await fetchLiveDailyChart("KR:005930");

  assert.equal(daily.latestPrice, 12500);
  assert.equal(daily.fetch.provider, "yahoo_finance");
});

test("live provider uses Toss without touching KIS or Yahoo when Toss is configured", async () => {
  setupLiveProviderEnv();
  process.env.TOSS_INVEST_API_BASE = "https://toss.example.com";
  process.env.TOSS_INVEST_CLIENT_ID = "client-id";
  process.env.TOSS_INVEST_CLIENT_SECRET = "client-secret";

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("kis.example.com") || url.includes("query1.finance.yahoo.com")) {
      throw new Error(`legacy provider should not run: ${url}`);
    }
    if (url.endsWith("/oauth2/token")) {
      return Response.json({ access_token: "token-1", token_type: "Bearer", expires_in: 3600 });
    }
    if (url.includes("/api/v1/stocks?")) {
      return Response.json({
        result: [{ symbol: "005930", name: "삼성전자", market: "KOSPI", currency: "KRW", sharesOutstanding: "10" }],
      });
    }
    if (url.includes("/api/v1/prices?")) {
      return Response.json({
        result: [{ symbol: "005930", timestamp: "2026-06-19T09:30:00+09:00", lastPrice: "70000", currency: "KRW" }],
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  const quote = await fetchLiveQuote("KR:005930");

  assert.equal(quote.latest_price, 70000);
  assert.equal((quote.fetch as Record<string, unknown>).provider, "toss_invest");
});

test("live provider falls back to Yahoo quote data when Toss returns empty data", async () => {
  setupLiveProviderEnv();
  process.env.TOSS_INVEST_API_BASE = "https://toss.example.com";
  process.env.TOSS_INVEST_CLIENT_ID = "client-id";
  process.env.TOSS_INVEST_CLIENT_SECRET = "client-secret";
  process.env.STOCK_YAHOO_FALLBACK = "1";
  delete process.env.STOCK_API_APP_KEY;
  delete process.env.STOCK_API_APP_SECRET;

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/oauth2/token")) {
      return Response.json({ access_token: "token-empty-toss", token_type: "Bearer", expires_in: 3600 });
    }
    if (url.includes("/api/v1/stocks?") || url.includes("/api/v1/prices?")) {
      return Response.json({ result: [] });
    }
    if (url.includes("query1.finance.yahoo.com/v8/finance/chart/KO")) {
      return Response.json({
        chart: {
          result: [{
            meta: { currency: "USD", regularMarketPrice: 72.5, chartPreviousClose: 71.5, exchangeName: "NYQ" },
            timestamp: [1780531200, 1780617600],
            indicators: { quote: [{ open: [71, 72], high: [72, 73], low: [70, 71], close: [71.5, 72.5], volume: [1000, 1100] }] },
          }],
          error: null,
        },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  const quote = await fetchLiveQuote("US:KO");

  assert.equal(quote.latest_price, 72.5);
  assert.equal((quote.fetch as Record<string, unknown>).provider, "yahoo_finance");
  assert.deepEqual((quote.fetch as Record<string, unknown>).fallback_from, ["toss_invest"]);
});

test("live provider falls back to Yahoo chart data when Toss chart is empty", async () => {
  setupLiveProviderEnv();
  process.env.TOSS_INVEST_API_BASE = "https://toss.example.com";
  process.env.TOSS_INVEST_CLIENT_ID = "client-id";
  process.env.TOSS_INVEST_CLIENT_SECRET = "client-secret";
  process.env.STOCK_YAHOO_FALLBACK = "1";
  delete process.env.STOCK_API_APP_KEY;
  delete process.env.STOCK_API_APP_SECRET;

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/oauth2/token")) {
      return Response.json({ access_token: "token-empty-toss-chart", token_type: "Bearer", expires_in: 3600 });
    }
    if (url.includes("/api/v1/stocks?")) {
      return Response.json({ result: [{ symbol: "KO", name: "Coca-Cola", market: "NYSE", currency: "USD", sharesOutstanding: "100" }] });
    }
    if (url.includes("/api/v1/candles?")) {
      return Response.json({ result: { candles: [], nextBefore: null } });
    }
    if (url.includes("query1.finance.yahoo.com/v8/finance/chart/KO")) {
      return Response.json({
        chart: {
          result: [{
            meta: { currency: "USD", regularMarketPrice: 72.5, chartPreviousClose: 71.5, exchangeName: "NYQ" },
            timestamp: [1780531200, 1780617600],
            indicators: { quote: [{ open: [71, 72], high: [72, 73], low: [70, 71], close: [71.5, 72.5], volume: [1000, 1100] }] },
          }],
          error: null,
        },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  const daily = await fetchLiveDailyChart("US:KO");

  assert.equal(daily.latestPrice, 72.5);
  assert.equal(daily.fetch.provider, "yahoo_finance");
  assert.deepEqual(daily.fetch.fallback_from, ["toss_invest"]);
});
