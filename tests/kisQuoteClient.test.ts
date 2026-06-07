import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { fetchKisQuote } from "../src/lib/kisQuoteClient";

const ENV_KEYS = [
  "STOCK_API_APP_KEY",
  "STOCK_API_APP_SECRET",
  "STOCK_API_BASE",
  "KIS_APP_KEY",
  "KIS_APP_SECRET",
  "KIS_API_BASE",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
const globalWithKisCache = globalThis as typeof globalThis & {
  __kisQuoteTokenCache?: Map<string, { accessToken: string; expiresAtMs: number }>;
  __kisQuoteDiscoveryCache?: Map<string, unknown>;
};

function setupEnv() {
  process.env.STOCK_API_APP_KEY = "app-key";
  process.env.STOCK_API_APP_SECRET = "app-secret";
  process.env.STOCK_API_BASE = "https://kis.example.com";
  delete process.env.KIS_APP_KEY;
  delete process.env.KIS_APP_SECRET;
  delete process.env.KIS_API_BASE;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_PUBLISHABLE_KEY;
  globalWithKisCache.__kisQuoteTokenCache?.clear();
  globalWithKisCache.__kisQuoteDiscoveryCache?.clear();
}

function restore() {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  globalThis.fetch = originalFetch;
  globalWithKisCache.__kisQuoteTokenCache?.clear();
  globalWithKisCache.__kisQuoteDiscoveryCache?.clear();
}

test.afterEach(restore);

test("fetchKisQuote maps domestic KIS quote payload into public quote shape", async () => {
  setupEnv();

  globalThis.fetch = async (url) => {
    const text = String(url);
    if (text.includes("/oauth2/tokenP")) {
      return Response.json({ access_token: "token-1", expires_in: 3600 });
    }
    if (text.includes("/uapi/domestic-stock/v1/quotations/inquire-price")) {
      return Response.json({
        rt_cd: "0",
        output: {
          stck_prpr: "70000",
          stck_sdpr: "69000",
          prdy_ctrt: "1.45",
          acml_vol: "123456",
          hts_kor_isnm: "삼성전자",
          stck_bsop_date: "20260605",
        },
      });
    }
    throw new Error(`unexpected fetch ${text}`);
  };

  const payload = await fetchKisQuote("KR:005930");

  assert.equal(payload.ok, true);
  assert.equal(payload.type, "quote");
  assert.equal(payload.requested_ticker, "KR:005930");
  assert.equal(payload.market, "KR");
  assert.equal(payload.symbol, "005930");
  assert.equal(payload.name, "삼성전자");
  assert.equal(payload.latest_price, 70000);
  assert.equal(payload.latest_price_label, "70,000원");
  assert.equal(payload.previous_close, 69000);
  assert.equal(payload.latest_change, 0.0145);
  assert.equal(payload.latest_bar_date, "2026-06-05");
  assert.equal((payload.fetch as { source?: unknown } | undefined)?.source, "market_data");
});

test("fetchKisQuote maps US KIS quote payload into public quote shape", async () => {
  setupEnv();

  globalThis.fetch = async (url) => {
    const text = String(url);
    if (text.includes("/oauth2/tokenP")) {
      return Response.json({ access_token: "token-2", expires_in: 3600 });
    }
    if (text.includes("/uapi/overseas-price/v1/quotations/price-detail")) {
      return Response.json({
        rt_cd: "0",
        output: {
          last: "70.50",
          base: "69.00",
          rate: "2.17",
          tvol: "1000",
          curr: "USD",
          t_rate: "1370",
          xymd: "20260605",
        },
      });
    }
    if (text.includes("/uapi/overseas-price/v1/quotations/search-info")) {
      return Response.json({
        rt_cd: "0",
        output: {
          prdt_eng_name: "Coca-Cola",
          ovrs_excg_name: "Nasdaq",
        },
      });
    }
    throw new Error(`unexpected fetch ${text}`);
  };

  const payload = await fetchKisQuote("US:KO");

  assert.equal(payload.ok, true);
  assert.equal(payload.type, "quote");
  assert.equal(payload.requested_ticker, "US:KO");
  assert.equal(payload.market, "US");
  assert.equal(payload.symbol, "KO");
  assert.equal(payload.name, "Coca-Cola");
  assert.equal(payload.exchange_code, "NAS");
  assert.equal(payload.latest_price, 70.5);
  assert.equal(payload.latest_price_label, "$70.50");
  assert.equal(payload.previous_close, 69);
  assert.equal(payload.latest_change, 0.0217);
  assert.equal(payload.usd_krw_rate, 1370);
  assert.equal(payload.usd_krw_label, "$1 = 약 1,370원");
  assert.equal(payload.latest_bar_date, "2026-06-05");
});

test("fetchKisQuote reuses successful US discovery inside the server instance", async () => {
  setupEnv();

  let priceDetailCalls = 0;
  let searchInfoCalls = 0;
  globalThis.fetch = async (url) => {
    const text = String(url);
    if (text.includes("/oauth2/tokenP")) {
      return Response.json({ access_token: "token-2", expires_in: 3600 });
    }
    if (text.includes("/uapi/overseas-price/v1/quotations/price-detail")) {
      priceDetailCalls += 1;
      return Response.json({
        rt_cd: "0",
        output: {
          last: "70.50",
          base: "69.00",
          rate: "2.17",
          tvol: "1000",
          curr: "USD",
          t_rate: "1370",
          xymd: "20260605",
        },
      });
    }
    if (text.includes("/uapi/overseas-price/v1/quotations/search-info")) {
      searchInfoCalls += 1;
      return Response.json({
        rt_cd: "0",
        output: {
          prdt_eng_name: "Coca-Cola",
          ovrs_excg_name: "Nasdaq",
        },
      });
    }
    throw new Error(`unexpected fetch ${text}`);
  };

  await fetchKisQuote("US:KO");
  const payload = await fetchKisQuote("US:KO");

  assert.equal(payload.ok, true);
  assert.equal(payload.exchange_code, "NAS");
  assert.equal(priceDetailCalls, 2);
  assert.equal(searchInfoCalls, 1);
});

test("fetchKisQuote reuses a valid Supabase KIS token cache entry", async () => {
  setupEnv();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  const expectedCacheKey = createHash("sha256").update("https://kis.example.com:app-key").digest("hex").slice(0, 16);

  let tokenEndpointCalls = 0;
  let cacheReadUrl = "";
  let quoteAuthorization = "";
  globalThis.fetch = async (url, init) => {
    const text = String(url);
    if (text.includes("/rest/v1/kis_access_tokens")) {
      cacheReadUrl = text;
      return Response.json([
        {
          cache_key: expectedCacheKey,
          access_token: "shared-token",
          expires_at: "2099-01-01T00:00:00.000Z",
        },
      ]);
    }
    if (text.includes("/oauth2/tokenP")) {
      tokenEndpointCalls += 1;
      return Response.json({ access_token: "unexpected-token", expires_in: 3600 });
    }
    if (text.includes("/uapi/domestic-stock/v1/quotations/inquire-price")) {
      quoteAuthorization = String((init?.headers as Record<string, string>)?.authorization || "");
      return Response.json({
        rt_cd: "0",
        output: {
          stck_prpr: "70000",
          stck_sdpr: "69000",
          prdy_ctrt: "1.45",
          acml_vol: "123456",
          hts_kor_isnm: "삼성전자",
          stck_bsop_date: "20260605",
        },
      });
    }
    throw new Error(`unexpected fetch ${text}`);
  };

  const payload = await fetchKisQuote("KR:005930");

  assert.equal(payload.ok, true);
  assert.equal(tokenEndpointCalls, 0);
  assert.match(cacheReadUrl, /\/rest\/v1\/kis_access_tokens/);
  assert.match(cacheReadUrl, new RegExp(`cache_key=eq\\.${expectedCacheKey}`));
  assert.equal(quoteAuthorization, "Bearer shared-token");
});

test("fetchKisQuote stores newly issued KIS tokens in the Supabase shared cache", async () => {
  setupEnv();
  process.env.SUPABASE_URL = "https://example.supabase.co/";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

  let tokenEndpointCalls = 0;
  let lockCalls = 0;
  let writeCalls = 0;
  let writtenBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (url, init) => {
    const text = String(url);
    if (text.includes("/rest/v1/rpc/acquire_kis_token_issue_lock")) {
      lockCalls += 1;
      return Response.json({ acquired: true });
    }
    if (text.includes("/rest/v1/kis_access_tokens") && init?.method === "POST") {
      writeCalls += 1;
      writtenBody = JSON.parse(String(init.body)) as Record<string, unknown>;
      return new Response(null, { status: 204 });
    }
    if (text.includes("/rest/v1/kis_access_tokens")) {
      return Response.json([]);
    }
    if (text.includes("/oauth2/tokenP")) {
      tokenEndpointCalls += 1;
      return Response.json({ access_token: "fresh-token", expires_in: 3600 });
    }
    if (text.includes("/uapi/domestic-stock/v1/quotations/inquire-price")) {
      return Response.json({
        rt_cd: "0",
        output: {
          stck_prpr: "70000",
          stck_sdpr: "69000",
          prdy_ctrt: "1.45",
          acml_vol: "123456",
          hts_kor_isnm: "삼성전자",
          stck_bsop_date: "20260605",
        },
      });
    }
    throw new Error(`unexpected fetch ${text}`);
  };

  const payload = await fetchKisQuote("KR:005930");

  assert.equal(payload.ok, true);
  assert.equal(lockCalls, 1);
  assert.equal(tokenEndpointCalls, 1);
  assert.equal(writeCalls, 1);
  assert.equal(writtenBody?.access_token, "fresh-token");
  assert.equal(typeof writtenBody?.expires_at, "string");
});
