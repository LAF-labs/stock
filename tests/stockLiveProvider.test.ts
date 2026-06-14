import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { GET as refreshMarketCap } from "../src/app/api/market-cap/refresh/route";
import { fetchLiveDailyChart } from "../src/lib/stockLiveProvider";

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
