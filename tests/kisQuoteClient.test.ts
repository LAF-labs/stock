import test from "node:test";
import assert from "node:assert/strict";

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
  assert.equal(payload.previous_close, 69);
  assert.equal(payload.latest_change, 0.0217);
  assert.equal(payload.usd_krw_rate, 1370);
  assert.equal(payload.latest_bar_date, "2026-06-05");
});
