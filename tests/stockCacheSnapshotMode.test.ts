import test from "node:test";
import assert from "node:assert/strict";

import { isStockDataUnavailableError } from "../src/lib/stockDataRuntime";
import { fetchKisDomesticFinanceBundle } from "../src/lib/kisQuoteClient";
import { getStockQuote } from "../src/lib/stockQuoteCache";
import { getStockScore } from "../src/lib/stockSnapshotCache";

const ENV_KEYS = [
  "VERCEL",
  "STOCK_DATA_RUNTIME",
  "STOCK_DATA_BACKEND",
  "PYTHON_BIN",
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "MARKET_DATA_SERVICE_URL",
  "MARKET_DATA_INTERNAL_TOKEN",
  "MARKET_DATA_SERVICE_ENABLE_QUOTE",
  "MARKET_DATA_SERVICE_ENABLE_SCORE",
  "STOCK_API_APP_KEY",
  "STOCK_API_APP_SECRET",
  "STOCK_API_BASE",
  "STOCK_TECHNICAL_REQUEST_FAST_PATH",
  "STOCK_DETAIL_REQUEST_FAST_PATH",
  "STOCK_DETAIL_DAILY_FAST_PATH_TIMEOUT_MS",
  "STOCK_QUOTE_CACHE_STALE_SECONDS",
  "STOCK_SCORE_CACHE_STALE_SECONDS",
  "SUPABASE_READ_TIMEOUT_MS",
  "SUPABASE_WRITE_TIMEOUT_MS",
  "STOCK_SCORE_SUPABASE_READ_TIMEOUT_MS",
  "STOCK_SCORE_SUPABASE_WRITE_TIMEOUT_MS",
  "STOCK_QUOTE_SUPABASE_READ_TIMEOUT_MS",
  "STOCK_QUOTE_SUPABASE_WRITE_TIMEOUT_MS",
  "STOCK_YAHOO_FALLBACK",
] as const;

const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
const globalWithScoreCache = globalThis as typeof globalThis & {
  __stockScoreMemoryCache?: Map<string, Record<string, unknown>>;
};

function restoreEnv() {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  globalThis.fetch = originalFetch;
  globalWithScoreCache.__stockScoreMemoryCache?.clear();
}

function reported(asOfDate: string, raw: number, currencyCode?: string) {
  return {
    asOfDate,
    periodType: "TTM",
    ...(currencyCode ? { currencyCode } : {}),
    reportedValue: { raw, fmt: String(raw) },
  };
}

function useSnapshotOnlyRuntime() {
  restoreEnv();
  process.env.VERCEL = "1";
  process.env.PYTHON_BIN = "/bin/false";
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_PUBLISHABLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.MARKET_DATA_SERVICE_URL;
  delete process.env.MARKET_DATA_INTERNAL_TOKEN;
  process.env.STOCK_YAHOO_FALLBACK = "0";
}

test.afterEach(restoreEnv);

test("score cache does not invoke Python collector when Vercel snapshot mode has no snapshot", async () => {
  useSnapshotOnlyRuntime();

  await assert.rejects(
    () => getStockScore("US:ZZZSNAPMISS", "detail"),
    (error) => {
      assert.equal(isStockDataUnavailableError(error), true);
      if (!isStockDataUnavailableError(error)) return false;
      assert.equal(error.status, 503);
      assert.equal(error.payload.error, "snapshot_unavailable");
      assert.equal(error.payload.reason, "snapshot_miss");
      assert.equal(error.payload.kind, "score");
      return true;
    }
  );
});

test("technical score cache serves current technical-only snapshots in snapshot mode", async () => {
  useSnapshotOnlyRuntime();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-key";

  const ticker = "US:TECHONLY";
  const nowMs = Date.now();
  const snapshot = {
    ticker,
    view_mode: "technical",
    payload: {
      ok: true,
      score_model_version: "score-v5-dual-quality-opportunity-2026-06-05",
      requested_ticker: "TECHONLY",
      market: "US",
      symbol: "TECHONLY",
      name: "TECH ONLY INC",
      technical_analysis: {
        type: "technical_analysis",
        version: "technical-v1",
        status: "ready",
        data_window: { available_days: 100, required_days: 60 },
        summary: { headline: "기술 신호 확인", tone: "neutral", bullets: [] },
        indicators: [],
      },
    },
    fetched_at: new Date(nowMs - 30_000).toISOString(),
    expires_at: new Date(nowMs + 270_000).toISOString(),
  };

  globalThis.fetch = async (url) => {
    const text = String(url);
    if (text.includes("/rest/v1/stock_score_snapshots")) {
      return new Response(JSON.stringify([snapshot]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch ${text}`);
  };

  const result = await getStockScore(ticker, "technical");

  assert.equal(result.payload.ok, true);
  assert.equal((result.payload.technical_analysis as Record<string, unknown>).type, "technical_analysis");
  assert.equal(result.cache.state, "fresh");
  assert.equal(result.cache.source, "supabase");
  assert.equal(result.cache.view, "technical");
});

test("technical score cache builds a request fast path from KIS daily rows in Vercel snapshot mode", async () => {
  useSnapshotOnlyRuntime();
  process.env.STOCK_API_APP_KEY = "app-key";
  process.env.STOCK_API_APP_SECRET = "app-secret";
  process.env.STOCK_API_BASE = "https://kis.example";

  const rows = Array.from({ length: 80 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 0, 2 + index)).toISOString().slice(0, 10).replace(/-/g, "");
    const close = 20 + index * 0.1;
    return {
      xymd: date,
      open: String(close - 0.1),
      high: String(close + 0.3),
      low: String(close - 0.4),
      clos: String(close),
      tvol: String(1_000_000 + index),
    };
  });

  globalThis.fetch = async (url) => {
    const text = String(url);
    if (text.includes("/oauth2/tokenP")) {
      return Response.json({ access_token: "token-technical", expires_in: 3600 });
    }
    if (text.includes("/uapi/overseas-price/v1/quotations/dailyprice")) {
      return Response.json({ rt_cd: "0", output2: rows });
    }
    throw new Error(`unexpected fetch ${text}`);
  };

  const result = await getStockScore("US:FASTTECH", "technical");

  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.requested_ticker, "US:FASTTECH");
  assert.equal((result.payload.technical_analysis as Record<string, unknown>).type, "technical_analysis");
  assert.equal((result.payload.chart_series as unknown[]).length, 80);
  assert.equal(result.cache.source, "market-data");
  assert.equal(result.cache.state, "miss");
});

test("detail score cache builds a request fast path from KIS daily rows in Vercel snapshot mode", async () => {
  useSnapshotOnlyRuntime();
  process.env.STOCK_API_APP_KEY = "app-key";
  process.env.STOCK_API_APP_SECRET = "app-secret";
  process.env.STOCK_API_BASE = "https://kis.example";

  const rows = Array.from({ length: 120 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 0, 2 + index)).toISOString().slice(0, 10).replace(/-/g, "");
    const close = 10 + index * 0.04;
    return {
      xymd: date,
      open: String(close - 0.08),
      high: String(close + 0.2),
      low: String(close - 0.2),
      clos: String(close),
      tvol: String(120_000 + index * 50),
    };
  });

  globalThis.fetch = async (url) => {
    const text = String(url);
    if (text.includes("/oauth2/tokenP")) {
      return Response.json({ access_token: "token-detail", expires_in: 3600 });
    }
    if (text.includes("/uapi/overseas-price/v1/quotations/dailyprice")) {
      return Response.json({ rt_cd: "0", output2: rows });
    }
    throw new Error(`unexpected fetch ${text}`);
  };

  const result = await getStockScore("US:BEEM", "detail");

  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.requested_ticker, "US:BEEM");
  assert.equal(result.payload.score_model_version, "score-v5-dual-quality-opportunity-2026-06-05");
  assert.equal(typeof result.payload.score, "number");
  assert.equal(typeof result.payload.quality_score, "number");
  assert.equal(typeof result.payload.opportunity_score, "number");
  assert.equal(result.payload.korean_name, "빔 글로벌");
  assert.equal(result.payload.display_name, "빔 글로벌");
  assert.equal(result.payload.name, "빔 글로벌");
  assert.equal((result.payload.chart_series as unknown[]).length, 120);
  assert.equal((result.payload.technical_analysis as Record<string, unknown>).type, "technical_analysis");
  assert.deepEqual(
    (result.payload.components as Array<Record<string, unknown>>).map((item) => item.key),
    ["profitability", "growth", "health", "momentum", "valuation"]
  );
  assert.deepEqual(
    (result.payload.opportunity_components as Array<Record<string, unknown>>).map((item) => item.key),
    ["opportunity_momentum", "opportunity_growth", "opportunity_analyst", "opportunity_liquidity", "opportunity_risk"]
  );
  assert.equal((result.payload.fetch as Record<string, unknown>).detail_fast_path, true);
  assert.equal(result.cache.source, "market-data");
  assert.equal(result.cache.state, "miss");
});

test("US detail fast path includes Yahoo fundamentals instead of an empty financial section", async () => {
  useSnapshotOnlyRuntime();
  process.env.STOCK_API_APP_KEY = "app-key";
  process.env.STOCK_API_APP_SECRET = "app-secret";
  process.env.STOCK_API_BASE = "https://kis.example";

  const rows = Array.from({ length: 120 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 0, 2 + index)).toISOString().slice(0, 10).replace(/-/g, "");
    const close = 30 + index * 0.03;
    return {
      xymd: date,
      open: String(close - 0.1),
      high: String(close + 0.2),
      low: String(close - 0.2),
      clos: String(close),
      tvol: String(50_000 + index),
    };
  });

  globalThis.fetch = async (url) => {
    const text = String(url);
    if (text.includes("/oauth2/tokenP")) {
      return Response.json({ access_token: "token-us-detail-financials", expires_in: 3600 });
    }
    if (text.includes("/uapi/overseas-price/v1/quotations/dailyprice")) {
      return Response.json({ rt_cd: "0", output2: rows });
    }
    if (text.includes("query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/PZZA")) {
      return Response.json({
        timeseries: {
          result: [
            { meta: { symbol: ["PZZA"], type: ["trailingTotalRevenue"] }, trailingTotalRevenue: [reported("2026-03-31", 2_014_108_000, "USD")] },
            { meta: { symbol: ["PZZA"], type: ["trailingNetIncome"] }, trailingNetIncome: [reported("2026-03-31", 28_564_000, "USD")] },
            { meta: { symbol: ["PZZA"], type: ["trailingOperatingIncome"] }, trailingOperatingIncome: [reported("2026-03-31", 82_728_000, "USD")] },
            { meta: { symbol: ["PZZA"], type: ["trailingPeRatio"] }, trailingPeRatio: [reported("2026-06-12", 39.277108)] },
            { meta: { symbol: ["PZZA"], type: ["trailingDilutedEPS"] }, trailingDilutedEPS: [reported("2026-03-31", 0.87, "USD")] },
            { meta: { symbol: ["PZZA"], type: ["annualTotalRevenue"] }, annualTotalRevenue: [reported("2025-12-31", 2_053_808_000, "USD")] },
          ],
          error: null,
        },
      });
    }
    throw new Error(`unexpected fetch ${text}`);
  };

  const result = await getStockScore("US:PZZA", "detail");

  assert.equal(result.payload.ok, true);
  assert.equal((result.payload.fetch as Record<string, unknown>).pending_enrichment, undefined);
  assert.equal((result.payload.fetch as Record<string, unknown>).fundamentals_source, "yahoo_fundamentals");
  assert.equal((result.payload.financials as Record<string, unknown>).totalRevenue, 2_014_108_000);
  assert.equal((result.payload.financials as Record<string, unknown>).netIncome, 28_564_000);
  assert.equal((result.payload.financials as Record<string, unknown>).trailingPE, 39.277108);
  assert.equal((result.payload.financial_statement as Record<string, unknown>).yahoo_fundamentals !== undefined, true);
});

test("stale score snapshots refresh inline from request fast path in Vercel snapshot mode", async () => {
  useSnapshotOnlyRuntime();
  process.env.STOCK_API_APP_KEY = "app-key";
  process.env.STOCK_API_APP_SECRET = "app-secret";
  process.env.STOCK_API_BASE = "https://kis.example";

  let dailyCalls = 0;
  let fundamentalCalls = 0;
  const rows = Array.from({ length: 120 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 0, 2 + index)).toISOString().slice(0, 10).replace(/-/g, "");
    const close = 30 + index * 0.03;
    return {
      xymd: date,
      open: String(close - 0.1),
      high: String(close + 0.2),
      low: String(close - 0.2),
      clos: String(close),
      tvol: String(50_000 + index),
    };
  });

  globalThis.fetch = async (url) => {
    const text = String(url);
    if (text.includes("/oauth2/tokenP")) {
      return Response.json({ access_token: "token-stale-inline-refresh", expires_in: 3600 });
    }
    if (text.includes("/uapi/overseas-price/v1/quotations/dailyprice")) {
      dailyCalls += 1;
      return Response.json({ rt_cd: "0", output2: rows });
    }
    if (text.includes("query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/STALEREFRESH")) {
      fundamentalCalls += 1;
      return Response.json({
        timeseries: {
          result: [
            { meta: { symbol: ["STALEREFRESH"], type: ["trailingTotalRevenue"] }, trailingTotalRevenue: [reported("2026-03-31", 2_014_108_000, "USD")] },
            { meta: { symbol: ["STALEREFRESH"], type: ["trailingNetIncome"] }, trailingNetIncome: [reported("2026-03-31", 28_564_000, "USD")] },
          ],
          error: null,
        },
      });
    }
    throw new Error(`unexpected fetch ${text}`);
  };

  const first = await getStockScore("US:STALEREFRESH", "detail");
  assert.equal(first.cache.state, "miss");

  const key = "detail:US:STALEREFRESH";
  const snapshot = globalWithScoreCache.__stockScoreMemoryCache?.get(key);
  assert.ok(snapshot);
  globalWithScoreCache.__stockScoreMemoryCache?.set(key, {
    ...snapshot,
    fetchedAt: new Date(Date.now() - 3_600_000).toISOString(),
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
  });
  dailyCalls = 0;
  fundamentalCalls = 0;

  const stale = await getStockScore("US:STALEREFRESH", "detail");
  await sleep(50);

  assert.equal(stale.cache.state, "stale");
  assert.equal(stale.cache.refreshStarted, true);
  assert.ok(dailyCalls + fundamentalCalls > 0);
});

test("domestic detail fast path includes KIS financials instead of a pending enrichment placeholder", async () => {
  useSnapshotOnlyRuntime();
  process.env.STOCK_API_APP_KEY = "app-key";
  process.env.STOCK_API_APP_SECRET = "app-secret";
  process.env.STOCK_API_BASE = "https://kis.example";

  const rows = Array.from({ length: 120 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 0, 2 + index)).toISOString().slice(0, 10).replace(/-/g, "");
    const close = 45_000 + index * 500;
    return {
      stck_bsop_date: date,
      stck_oprc: String(close - 250),
      stck_hgpr: String(close + 500),
      stck_lwpr: String(close - 500),
      stck_clpr: String(close),
      acml_vol: String(500_000 + index * 1_000),
    };
  });

  const financeResponses: Record<string, unknown[]> = {
    "balance-sheet": [{ stac_yymm: "202603", total_aset: "12001.00", total_lblt: "8184.00", total_cptl: "3816.00", cras: "3898.00", flow_lblt: "4420.00" }],
    "income-statement": [{ stac_yymm: "202603", sale_account: "1571.00", bsop_prti: "205.00", thtr_ntin: "172.00" }],
    "financial-ratio": [{ stac_yymm: "202603", eps: "2427.00", bps: "13402.00", grs: "16.37", ntin_inrt: "-16.98" }],
    "profit-ratio": [{ stac_yymm: "202603", sale_ntin_rate: "10.92", self_cptl_ntin_inrt: "18.11" }],
    "other-major-ratios": [{ stac_yymm: "202603", ebitda: "358.00", ev_ebitda: "10.97" }],
    "stability-ratio": [{ stac_yymm: "202603", lblt_rate: "214.45", crnt_rate: "88.19", quck_rate: "0.00" }],
    "growth-ratio": [{ stac_yymm: "202603", grs: "16.37", bsop_prfi_inrt: "-34.58" }],
  };

  globalThis.fetch = async (url) => {
    const text = String(url);
    if (text.includes("/oauth2/tokenP")) {
      return Response.json({ access_token: "token-kr-detail-financials", expires_in: 3600 });
    }
    if (text.includes("/uapi/domestic-stock/v1/quotations/inquire-price")) {
      return Response.json({
        rt_cd: "0",
        output: {
          stck_prpr: "121600",
          eps: "2427.00",
          bps: "13402.00",
          per: "51.46",
          pbr: "9.32",
          lstn_stcn: "10460684",
          hts_avls: "13065",
        },
      });
    }
    if (text.includes("/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice")) {
      return Response.json({ rt_cd: "0", output2: rows });
    }
    for (const [endpoint, output] of Object.entries(financeResponses)) {
      if (text.includes(`/uapi/domestic-stock/v1/finance/${endpoint}`)) {
        return Response.json({ rt_cd: "0", output });
      }
    }
    throw new Error(`unexpected fetch ${text}`);
  };

  const result = await getStockScore("KR:183300", "detail");

  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.requested_ticker, "KR:183300");
  assert.equal((result.payload.fetch as Record<string, unknown>).pending_enrichment, undefined);
  assert.equal((result.payload.financials as Record<string, unknown>).source, undefined);
  assert.equal((result.payload.financials as Record<string, unknown>).totalRevenue, 1571);
  assert.equal((result.payload.financials as Record<string, unknown>).profitMargins, 0.1092);
  assert.equal((result.payload.financial_statement as Record<string, unknown>).kis_domestic_financials !== undefined, true);
  assert.equal((result.payload.valuation_rows as Array<{ label: string; value: string }>).find((row) => row.label === "PER")?.value, "51.46");
  assert.equal(result.cache.source, "market-data");
  assert.equal(result.cache.state, "miss");
});

test("domestic financial bundle fetches finance endpoints concurrently", async () => {
  useSnapshotOnlyRuntime();
  process.env.STOCK_API_APP_KEY = "app-key";
  process.env.STOCK_API_APP_SECRET = "app-secret";
  process.env.STOCK_API_BASE = "https://kis.example";

  const financeResponses: Record<string, unknown[]> = {
    "balance-sheet": [{ stac_yymm: "202603", total_aset: "12001.00", total_lblt: "8184.00", total_cptl: "3816.00" }],
    "income-statement": [{ stac_yymm: "202603", sale_account: "1571.00", bsop_prti: "205.00", thtr_ntin: "172.00" }],
    "financial-ratio": [{ stac_yymm: "202603", eps: "2427.00", bps: "13402.00", grs: "16.37" }],
    "profit-ratio": [{ stac_yymm: "202603", sale_ntin_rate: "10.92" }],
    "other-major-ratios": [{ stac_yymm: "202603", ebitda: "358.00", ev_ebitda: "10.97" }],
    "stability-ratio": [{ stac_yymm: "202603", lblt_rate: "214.45", crnt_rate: "88.19" }],
    "growth-ratio": [{ stac_yymm: "202603", grs: "16.37" }],
  };
  let activeFinanceRequests = 0;
  let maxActiveFinanceRequests = 0;

  globalThis.fetch = async (url) => {
    const text = String(url);
    if (text.includes("/oauth2/tokenP")) {
      return Response.json({ access_token: "token-kr-detail-financials-parallel", expires_in: 3600 });
    }
    if (text.includes("/uapi/domestic-stock/v1/quotations/inquire-price")) {
      return Response.json({
        rt_cd: "0",
        output: { stck_prpr: "121600", eps: "2427.00", bps: "13402.00", per: "51.46", pbr: "9.32" },
      });
    }
    for (const [endpoint, output] of Object.entries(financeResponses)) {
      if (text.includes(`/uapi/domestic-stock/v1/finance/${endpoint}`)) {
        activeFinanceRequests += 1;
        maxActiveFinanceRequests = Math.max(maxActiveFinanceRequests, activeFinanceRequests);
        await new Promise((resolve) => setTimeout(resolve, 25));
        activeFinanceRequests -= 1;
        return Response.json({ rt_cd: "0", output });
      }
    }
    throw new Error(`unexpected fetch ${text}`);
  };

  const result = await fetchKisDomesticFinanceBundle("183300", { timeoutMs: 200 });

  assert.equal(result.normalized.totalRevenue, 1571);
  assert.ok(maxActiveFinanceRequests >= 2);
});

test("detail score cache falls back to a quote-only fast path when daily rows are slow", async () => {
  useSnapshotOnlyRuntime();
  process.env.STOCK_API_APP_KEY = "app-key";
  process.env.STOCK_API_APP_SECRET = "app-secret";
  process.env.STOCK_API_BASE = "https://kis.example";
  process.env.STOCK_DETAIL_DAILY_FAST_PATH_TIMEOUT_MS = "15";

  globalThis.fetch = async (url) => {
    const text = String(url);
    if (text.includes("/oauth2/tokenP")) {
      return Response.json({ access_token: "token-detail-quote", expires_in: 3600 });
    }
    if (text.includes("/uapi/overseas-price/v1/quotations/dailyprice")) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      return Response.json({
        rt_cd: "0",
        output2: [{ xymd: "20260605", open: "10", high: "11", low: "9", clos: "10.5", tvol: "1000" }],
      });
    }
    if (text.includes("/uapi/overseas-price/v1/quotations/price-detail")) {
      return Response.json({
        rt_cd: "0",
        output: {
          last: "24.50",
          base: "24.00",
          rate: "2.08",
          tvol: "12345",
          curr: "USD",
          xymd: "20260605",
        },
      });
    }
    if (text.includes("/uapi/overseas-price/v1/quotations/search-info")) {
      return Response.json({
        rt_cd: "0",
        output: {
          prdt_eng_name: "Quote Fast Inc",
          ovrs_excg_name: "Nasdaq",
        },
      });
    }
    throw new Error(`unexpected fetch ${text}`);
  };

  const result = await getStockScore("US:QUOTEFAST", "detail");

  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.requested_ticker, "US:QUOTEFAST");
  assert.equal(result.payload.latest_price, 24.5);
  assert.equal(result.payload.name, "Quote Fast Inc");
  assert.equal((result.payload.fetch as Record<string, unknown>).quote_only_fast_path, true);
  assert.equal((result.payload.chart_series as unknown[]).length, 0);
  assert.equal(typeof result.payload.score, "number");
  assert.equal(result.cache.source, "market-data");
  assert.equal(result.cache.state, "miss");
});

test("detail quote-only fast path is not stored as a durable score snapshot", async () => {
  useSnapshotOnlyRuntime();
  process.env.STOCK_API_APP_KEY = "app-key";
  process.env.STOCK_API_APP_SECRET = "app-secret";
  process.env.STOCK_API_BASE = "https://kis.example";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  process.env.STOCK_DETAIL_DAILY_FAST_PATH_TIMEOUT_MS = "15";

  const writes: string[] = [];
  globalThis.fetch = async (url, init) => {
    const text = String(url);
    if (text.includes("/rest/v1/stock_score_snapshots") && !init?.method) {
      return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (text.includes("/rest/v1/stock_score_snapshots") && init?.method === "POST") {
      writes.push(text);
      return new Response("", { status: 201 });
    }
    if (text.includes("/rest/v1/rpc/enqueue_stock_refresh_job")) {
      return Response.json({ id: "job-quote-fast-no-store", status: "queued" });
    }
    if (text.includes("/oauth2/tokenP")) {
      return Response.json({ access_token: "token-detail-quote-no-store", expires_in: 3600 });
    }
    if (text.includes("/uapi/overseas-price/v1/quotations/dailyprice")) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      return Response.json({ rt_cd: "0", output2: [] });
    }
    if (text.includes("/uapi/overseas-price/v1/quotations/price-detail")) {
      return Response.json({
        rt_cd: "0",
        output: {
          last: "24.50",
          base: "24.00",
          rate: "2.08",
          tvol: "12345",
          curr: "USD",
          xymd: "20260605",
        },
      });
    }
    if (text.includes("/uapi/overseas-price/v1/quotations/search-info")) {
      return Response.json({
        rt_cd: "0",
        output: {
          prdt_eng_name: "Quote Fast No Store Inc",
          ovrs_excg_name: "Nasdaq",
        },
      });
    }
    throw new Error(`unexpected fetch ${text}`);
  };

  const result = await getStockScore("US:QFASTNOSTORE", "detail");

  assert.equal((result.payload.fetch as Record<string, unknown>).quote_only_fast_path, true);
  assert.deepEqual(writes, []);
});

test("compare score cache uses daily rows for chart-backed fast path data", async () => {
  useSnapshotOnlyRuntime();
  process.env.STOCK_API_APP_KEY = "app-key";
  process.env.STOCK_API_APP_SECRET = "app-secret";
  process.env.STOCK_API_BASE = "https://kis.example";
  process.env.STOCK_DETAIL_DAILY_FAST_PATH_TIMEOUT_MS = "15";

  let dailyCalls = 0;
  globalThis.fetch = async (url) => {
    const text = String(url);
    if (text.includes("/oauth2/tokenP")) {
      return Response.json({ access_token: "token-compare-quote", expires_in: 3600 });
    }
    if (text.includes("/uapi/overseas-price/v1/quotations/dailyprice")) {
      dailyCalls += 1;
      return Response.json({
        rt_cd: "0",
        output2: [
          { xymd: "20260604", open: "10", high: "11", low: "9", clos: "10", tvol: "1000" },
          { xymd: "20260605", open: "10", high: "11", low: "9", clos: "10.5", tvol: "1000" },
        ],
      });
    }
    if (text.includes("/uapi/overseas-price/v1/quotations/price-detail")) {
      return Response.json({
        rt_cd: "0",
        output: {
          last: "18.25",
          base: "18.00",
          rate: "1.39",
          tvol: "22000",
          curr: "USD",
          xymd: "20260605",
        },
      });
    }
    if (text.includes("/uapi/overseas-price/v1/quotations/search-info")) {
      return Response.json({
        rt_cd: "0",
        output: {
          prdt_eng_name: "Anixa Biosciences",
          ovrs_excg_name: "Nasdaq",
        },
      });
    }
    throw new Error(`unexpected fetch ${text}`);
  };

  const result = await getStockScore("US:ANIX", "compare");

  assert.equal(dailyCalls, 1);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.requested_ticker, "US:ANIX");
  assert.equal(result.payload.data_quality, "price_fast_path");
  assert.equal((result.payload.fetch as Record<string, unknown>).provider_mode, "detail_request_fast_path");
  assert.equal((result.payload.chart_series as unknown[]).length, 2);
  assert.equal(typeof result.payload.quality_score, "number");
  assert.equal(result.cache.source, "market-data");
  assert.equal(result.cache.state, "miss");
});

test("compare quote-only score cache skips slow Supabase score writes", async () => {
  useSnapshotOnlyRuntime();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  process.env.STOCK_API_APP_KEY = "app-key";
  process.env.STOCK_API_APP_SECRET = "app-secret";
  process.env.STOCK_API_BASE = "https://kis.example";

  let writeStarted = false;
  let writeFinished = false;
  globalThis.fetch = async (url, init) => {
    const text = String(url);
    if (text.includes("/rest/v1/stock_score_snapshots") && init?.method === "POST") {
      writeStarted = true;
      await sleep(250);
      writeFinished = true;
      return new Response(null, { status: 204 });
    }
    if (text.includes("/rest/v1/stock_score_snapshots")) {
      return Response.json([]);
    }
    if (text.includes("/rest/v1/rpc/acquire_stock_api_rate_limit")) {
      return Response.json({ allowed: true, remaining: 10, reset_at: new Date(Date.now() + 60_000).toISOString() });
    }
    if (text.includes("/rest/v1/rpc/enqueue_stock_refresh_job")) {
      return Response.json({ id: "job-compare-write-behind", status: "queued" });
    }
    if (text.includes("/rest/v1/rpc/acquire_kis_token_issue_lock")) {
      return Response.json({ acquired: true });
    }
    if (text.includes("/rest/v1/kis_access_tokens") && init?.method === "POST") {
      return new Response(null, { status: 204 });
    }
    if (text.includes("/rest/v1/kis_access_tokens")) {
      return Response.json([]);
    }
    if (text.includes("/oauth2/tokenP")) {
      return Response.json({ access_token: "token-compare-write", expires_in: 3600 });
    }
    if (text.includes("/uapi/overseas-price/v1/quotations/price-detail")) {
      return Response.json({
        rt_cd: "0",
        output: {
          last: "21.25",
          base: "21.00",
          rate: "1.19",
          tvol: "32000",
          curr: "USD",
          xymd: "20260605",
        },
      });
    }
    if (text.includes("/uapi/overseas-price/v1/quotations/search-info")) {
      return Response.json({
        rt_cd: "0",
        output: {
          prdt_eng_name: "Apogee Therapeutics",
          ovrs_excg_name: "Nasdaq",
        },
      });
    }
    throw new Error(`unexpected fetch ${text}`);
  };

  const startedAt = Date.now();
  const result = await getStockScore("US:APGE", "compare");
  const elapsedMs = Date.now() - startedAt;

  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.requested_ticker, "US:APGE");
  assert.equal(writeStarted, false);
  assert.equal(writeFinished, false);
  assert.ok(elapsedMs < 200, `compare score waited ${elapsedMs}ms for a skipped score write`);
});

test("compare score cache returns an identity fast path when quote data is unavailable", async () => {
  useSnapshotOnlyRuntime();
  process.env.STOCK_API_APP_KEY = "app-key";
  process.env.STOCK_API_APP_SECRET = "app-secret";
  process.env.STOCK_API_BASE = "https://kis.example";

  globalThis.fetch = async (url) => {
    const text = String(url);
    if (text.includes("/oauth2/tokenP")) {
      return Response.json({ access_token: "token-compare-identity", expires_in: 3600 });
    }
    if (text.includes("/uapi/overseas-price/v1/quotations/price-detail")) {
      return Response.json({ rt_cd: "1", msg1: "quote not found" });
    }
    if (text.includes("/uapi/overseas-price/v1/quotations/dailyprice")) {
      return Response.json({ rt_cd: "0", output2: [] });
    }
    throw new Error(`unexpected fetch ${text}`);
  };

  const result = await getStockScore("US:APPF", "compare");

  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.requested_ticker, "US:APPF");
  assert.equal(result.payload.display_name, "앱폴리오");
  assert.equal(result.payload.data_quality, "identity_fast_path");
  assert.equal((result.payload.fetch as Record<string, unknown>).provider_mode, "compare_identity_fast_path");
  assert.equal((result.payload.chart_series as unknown[]).length, 0);
  assert.equal(result.cache.source, "market-data");
  assert.equal(result.cache.state, "miss");
});

test("quote cache reports background-only refresh in Vercel snapshot mode", async () => {
  useSnapshotOnlyRuntime();

  await assert.rejects(
    () => getStockQuote("US:KO", { forceRefresh: true }),
    (error) => {
      assert.equal(isStockDataUnavailableError(error), true);
      if (!isStockDataUnavailableError(error)) return false;
      assert.equal(error.payload.error, "snapshot_unavailable");
      assert.equal(error.payload.reason, "refresh_background_only");
      assert.equal(error.payload.kind, "quote");
      return true;
    }
  );
});

test("quote cache refreshes cold quotes from Yahoo fallback in Vercel snapshot mode", async () => {
  useSnapshotOnlyRuntime();
  process.env.STOCK_YAHOO_FALLBACK = "1";

  globalThis.fetch = async (url) => {
    const text = String(url);
    if (text.includes("query1.finance.yahoo.com/v8/finance/chart/YHFAST")) {
      return Response.json({
        chart: {
          result: [
            {
              meta: {
                currency: "USD",
                exchangeName: "NMS",
                regularMarketPrice: 42.5,
                chartPreviousClose: 40,
              },
              timestamp: [1780531200, 1780617600],
              indicators: {
                quote: [
                  {
                    open: [39, 41],
                    high: [41, 43],
                    low: [38, 40],
                    close: [40, 42.5],
                    volume: [1000, 1500],
                  },
                ],
              },
            },
          ],
          error: null,
        },
      });
    }
    throw new Error(`unexpected fetch ${text}`);
  };

  const result = await getStockQuote("US:YHFAST", { forceRefresh: true });

  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.latest_price, 42.5);
  assert.equal(result.payload.previous_close, 40);
  assert.equal(result.cache.source, "market-data");
  assert.equal((result.payload.fetch as Record<string, unknown>).provider, "yahoo_finance");
});

test("quote force refresh serves existing snapshot when a provider refresh lease is already active", async () => {
  useSnapshotOnlyRuntime();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

  const ticker = "US:LEASEBUSY";
  const nowMs = Date.now();
  const snapshot = {
    ticker,
    payload: {
      ok: true,
      type: "quote",
      requested_ticker: ticker,
      market: "US",
      symbol: "LEASEBUSY",
      currency: "USD",
      latest_price: 123.45,
      latest_price_label: "$123.45 / 169,127원",
      usd_krw_rate: 1370,
      usd_krw_label: "$1 = 1,370원",
    },
    fetched_at: new Date(nowMs - 30_000).toISOString(),
    expires_at: new Date(nowMs + 270_000).toISOString(),
  };

  globalThis.fetch = async (url, init) => {
    const text = String(url);
    if (text.includes("/rest/v1/stock_quote_snapshots")) {
      return new Response(JSON.stringify([snapshot]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (text.includes("/rest/v1/rpc/acquire_stock_refresh_lease")) {
      return new Response(
        JSON.stringify({
          acquired: false,
          lease_until: new Date(nowMs + 20_000).toISOString(),
          locked_by: "other-worker",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    throw new Error(`unexpected fetch ${text}`);
  };

  const result = await getStockQuote(ticker, { forceRefresh: true });

  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.latest_price, 123.45);
  assert.equal(result.payload.latest_price_label, "$123.45");
  assert.equal(result.payload.usd_krw_label, "$1 = 약 1,370원");
  assert.equal(result.cache.state, "fresh");
  assert.equal(result.cache.source, "supabase");
});

test("quote provider refresh failures do not leak unhandled inflight promise rejections", async () => {
  useSnapshotOnlyRuntime();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  process.env.STOCK_API_APP_KEY = "app-key";
  process.env.STOCK_API_APP_SECRET = "app-secret";
  process.env.STOCK_API_BASE = "https://kis.example";

  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => {
    unhandled.push(reason);
  };
  process.on("unhandledRejection", onUnhandled);

  globalThis.fetch = async (url) => {
    const text = String(url);
    if (text.includes("/rest/v1/stock_quote_snapshots")) {
      return Response.json([]);
    }
    if (text.includes("/rest/v1/rpc/acquire_stock_refresh_lease")) {
      return Response.json({ acquired: true });
    }
    if (text.includes("/rest/v1/rpc/acquire_stock_api_rate_limit")) {
      return Response.json({ allowed: true, remaining: 119, reset_at: new Date(Date.now() + 60_000).toISOString() });
    }
    if (text.includes("/rest/v1/kis_access_tokens")) {
      return Response.json([]);
    }
    if (text.includes("/rest/v1/rpc/acquire_kis_token_issue_lock")) {
      return Response.json({ acquired: true });
    }
    if (text.startsWith("https://kis.example/")) {
      throw new Error("provider network failed");
    }
    throw new Error(`unexpected fetch ${text}`);
  };

  try {
    await assert.rejects(() => getStockQuote("US:UHFAIL", { forceRefresh: true }), /provider network failed/);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("score force refresh serves existing snapshot when refresh is unavailable", async () => {
  useSnapshotOnlyRuntime();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "anon-key";
  process.env.STOCK_SCORE_CACHE_STALE_SECONDS = "86400";

  const ticker = "US:SCOREFALLBACK";
  const nowMs = Date.now();
  const snapshot = {
    ticker,
    view_mode: "detail",
    payload: {
      ok: true,
      type: "score",
      requested_ticker: ticker,
      market: "US",
      symbol: "SCOREFALLBACK",
      score: 72,
      quality_score: 72,
      opportunity_score: 61,
      opportunity_confidence: 0.8,
      components: [
        { key: "profitability", label: "Profitability", score: 76 },
        { key: "growth", label: "Growth", score: 69 },
        { key: "health", label: "Health", score: 74 },
        { key: "momentum", label: "Momentum", score: 71 },
        { key: "valuation", label: "Valuation", score: 68 },
      ],
      opportunity_components: [
        { key: "opportunity_momentum", label: "Momentum setup", score: 63 },
        { key: "opportunity_growth", label: "Growth setup", score: 67 },
        { key: "opportunity_analyst", label: "Analyst upside", score: 56 },
        { key: "opportunity_liquidity", label: "Liquidity", score: 78 },
        { key: "opportunity_risk", label: "Risk control", score: 49 },
      ],
      score_model_version: "score-v5-dual-quality-opportunity-2026-06-05",
      sia_snapshot: {
        confidence: 0.86,
        quality_score: 0.72,
        opportunity_score: 0.61,
        score_model_version: "score-v5-dual-quality-opportunity-2026-06-05",
      },
    },
    fetched_at: new Date(nowMs - 60_000).toISOString(),
    expires_at: new Date(nowMs + 20 * 60_000).toISOString(),
  };

  globalThis.fetch = async (url) => {
    const text = String(url);
    if (text.includes("/rest/v1/stock_score_snapshots")) {
      return new Response(JSON.stringify([snapshot]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch ${text}`);
  };

  const result = await getStockScore(ticker, "detail", { forceRefresh: true });

  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.score, 72);
  assert.equal(result.cache.state, "fresh");
  assert.equal(result.cache.source, "supabase");
  assert.equal(result.cache.refreshError, "refresh_failed");
});

test("score stale snapshot enqueues stale refresh work instead of a snapshot miss", async () => {
  useSnapshotOnlyRuntime();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  process.env.STOCK_SCORE_CACHE_STALE_SECONDS = "86400";

  const ticker = "US:SCORESTALE";
  const nowMs = Date.now();
  const snapshot = {
    ticker,
    view_mode: "detail",
    payload: {
      ok: true,
      type: "score",
      requested_ticker: ticker,
      market: "US",
      symbol: "SCORESTALE",
      score: 69,
      quality_score: 69,
      opportunity_score: 64,
      opportunity_confidence: 0.82,
      components: [
        { key: "profitability", label: "Profitability", score: 72 },
        { key: "growth", label: "Growth", score: 66 },
        { key: "health", label: "Health", score: 70 },
        { key: "momentum", label: "Momentum", score: 68 },
        { key: "valuation", label: "Valuation", score: 67 },
      ],
      opportunity_components: [
        { key: "opportunity_momentum", label: "Momentum setup", score: 63 },
        { key: "opportunity_growth", label: "Growth setup", score: 65 },
        { key: "opportunity_analyst", label: "Analyst upside", score: 61 },
        { key: "opportunity_liquidity", label: "Liquidity", score: 77 },
        { key: "opportunity_risk", label: "Risk control", score: 52 },
      ],
      score_model_version: "score-v5-dual-quality-opportunity-2026-06-05",
      sia_snapshot: {
        confidence: 0.82,
        quality_score: 0.69,
        opportunity_score: 0.64,
        score_model_version: "score-v5-dual-quality-opportunity-2026-06-05",
      },
    },
    fetched_at: new Date(nowMs - 10 * 60_000).toISOString(),
    expires_at: new Date(nowMs - 5 * 60_000).toISOString(),
  };
  let enqueueBody: Record<string, unknown> | undefined;

  globalThis.fetch = async (url, init) => {
    const text = String(url);
    if (text.includes("/rest/v1/stock_score_snapshots")) {
      return new Response(JSON.stringify([snapshot]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (text.includes("/rest/v1/rpc/enqueue_stock_refresh_job")) {
      enqueueBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ id: "job-stale-score", status: "queued" });
    }
    throw new Error(`unexpected fetch ${text}`);
  };

  const result = await getStockScore(ticker, "detail");
  await sleep(20);

  assert.equal(result.cache.state, "stale");
  assert.equal(result.cache.source, "supabase");
  assert.deepEqual(enqueueBody, {
    p_kind: "score",
    p_market: "US",
    p_symbol: "SCORESTALE",
    p_view_mode: "detail",
    p_priority: 70,
    p_payload: {
      reason: "stale_refresh",
      reason_bucket: "stale_refresh",
      requested_ticker: ticker,
      dedupe_key: "score:US:SCORESTALE:detail:stale_refresh",
    },
  });
});

test("score cache uses the score-specific Supabase read timeout", async () => {
  useSnapshotOnlyRuntime();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-key";
  process.env.SUPABASE_READ_TIMEOUT_MS = "250";
  process.env.STOCK_SCORE_SUPABASE_READ_TIMEOUT_MS = "15";

  let abortedAtMs: number | undefined;
  const startMs = Date.now();
  globalThis.fetch = async (_url, init) => {
    await new Promise((resolve) => init?.signal?.addEventListener("abort", resolve, { once: true }));
    abortedAtMs = Date.now() - startMs;
    throw new DOMException("The operation was aborted.", "AbortError");
  };

  await assert.rejects(() => getStockScore("US:SCORETIMEOUT", "detail"), (error) => {
    assert.equal(isStockDataUnavailableError(error), true);
    return true;
  });

  assert.ok(abortedAtMs !== undefined);
  assert.ok(abortedAtMs < 150);
});

test("quote cache uses the quote-specific Supabase read timeout", async () => {
  useSnapshotOnlyRuntime();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-key";
  process.env.SUPABASE_READ_TIMEOUT_MS = "250";
  process.env.STOCK_QUOTE_SUPABASE_READ_TIMEOUT_MS = "15";

  let abortedAtMs: number | undefined;
  const startMs = Date.now();
  globalThis.fetch = async (_url, init) => {
    await new Promise((resolve) => init?.signal?.addEventListener("abort", resolve, { once: true }));
    abortedAtMs = Date.now() - startMs;
    throw new DOMException("The operation was aborted.", "AbortError");
  };

  await assert.rejects(() => getStockQuote("US:QUOTETIMEOUT"), (error) => {
    assert.equal(isStockDataUnavailableError(error), true);
    return true;
  });

  assert.ok(abortedAtMs !== undefined);
  assert.ok(abortedAtMs < 150);
});

test("quote force refresh can use Node KIS quote client in Vercel snapshot mode", async () => {
  useSnapshotOnlyRuntime();
  process.env.STOCK_API_APP_KEY = "app-key";
  process.env.STOCK_API_APP_SECRET = "app-secret";
  process.env.STOCK_API_BASE = "https://kis.example.com";

  globalThis.fetch = async (url, init) => {
    const text = String(url);
    if (text.includes("/oauth2/tokenP")) {
      return Response.json({ access_token: "token-quote-cache", expires_in: 3600 });
    }
    if (text.includes("/uapi/domestic-stock/v1/quotations/inquire-price")) {
      return Response.json({
        rt_cd: "0",
        output: {
          stck_prpr: "70000",
          stck_sdpr: "69000",
          prdy_ctrt: "1.45",
          acml_vol: "1000",
          hts_kor_isnm: "삼성전자",
          stck_bsop_date: "20260605",
        },
      });
    }
    throw new Error(`unexpected fetch ${text}`);
  };

  const result = await getStockQuote("KR:005930", { forceRefresh: true });

  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.requested_ticker, "KR:005930");
  assert.equal(result.payload.latest_price, 70000);
  assert.equal(result.cache.source, "market-data");
});

test("quote force refresh writes serving columns required by Supabase quote snapshots", async () => {
  useSnapshotOnlyRuntime();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  process.env.STOCK_API_APP_KEY = "write-app-key";
  process.env.STOCK_API_APP_SECRET = "write-app-secret";
  process.env.STOCK_API_BASE = "https://kis-write.example.com";

  let writtenBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (url, init) => {
    const text = String(url);
    if (text.includes("/rest/v1/stock_quote_snapshots?") && init?.method !== "POST") {
      return Response.json([]);
    }
    if (text.includes("/rest/v1/rpc/acquire_stock_api_rate_limit")) {
      return Response.json({ allowed: true, remaining: 10, reset_at: new Date(Date.now() + 60_000).toISOString() });
    }
    if (text.includes("/rest/v1/rpc/acquire_stock_refresh_lease")) {
      return Response.json({ acquired: true, lease_until: new Date(Date.now() + 30_000).toISOString() });
    }
    if (text.includes("/rest/v1/kis_access_tokens") && init?.method !== "POST") {
      return Response.json([]);
    }
    if (text.includes("/rest/v1/rpc/acquire_kis_token_issue_lock")) {
      return Response.json({ acquired: true });
    }
    if (text.includes("/oauth2/tokenP")) {
      return Response.json({ access_token: "issued-token", expires_in: 3600 });
    }
    if (text.includes("/rest/v1/kis_access_tokens") && init?.method === "POST") {
      return new Response(null, { status: 201 });
    }
    if (text.includes("/rest/v1/market_calendar?")) {
      return Response.json([]);
    }
    if (text.includes("/uapi/overseas-price/v1/quotations/price-detail")) {
      return Response.json({
        rt_cd: "0",
        output: {
          last: "72.25",
          base: "71.80",
          rate: "0.63",
          tvol: "123456",
          curr: "USD",
          xymd: "20260605",
        },
      });
    }
    if (text.includes("/uapi/overseas-price/v1/quotations/search-info")) {
      return Response.json({
        rt_cd: "0",
        output: {
          prdt_eng_name: "Write Test Inc",
          ovrs_excg_name: "Nasdaq",
        },
      });
    }
    if (text.includes("/rest/v1/stock_quote_snapshots?") && init?.method === "POST") {
      writtenBody = JSON.parse(String(init.body));
      return new Response(null, { status: 201 });
    }
    throw new Error(`unexpected fetch ${text}`);
  };

  const result = await getStockQuote("US:WRITETEST", { forceRefresh: true });

  assert.equal(result.payload.ok, true);
  assert.equal(writtenBody?.ticker, "US:WRITETEST");
  assert.equal(writtenBody?.market, "US");
  assert.equal(writtenBody?.symbol, "WRITETEST");
  assert.equal(writtenBody?.source, "kis");
  assert.equal(typeof writtenBody?.stale_expires_at, "string");
});

test("quote stale snapshot returns immediately while inline provider refresh continues in background", async () => {
  useSnapshotOnlyRuntime();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "anon-key";
  process.env.STOCK_API_APP_KEY = "delayed-app-key";
  process.env.STOCK_API_APP_SECRET = "delayed-app-secret";
  process.env.STOCK_API_BASE = "https://kis-delayed.example.com";
  process.env.STOCK_QUOTE_CACHE_STALE_SECONDS = "86400";

  const ticker = "KR:009999";
  const nowMs = Date.now();
  const snapshot = {
    ticker,
    payload: {
      ok: true,
      type: "quote",
      requested_ticker: ticker,
      market: "KR",
      symbol: "009999",
      latest_price: 1000,
    },
    fetched_at: new Date(nowMs - 10 * 60_000).toISOString(),
    expires_at: new Date(nowMs - 5 * 60_000).toISOString(),
  };
  let providerCalls = 0;

  globalThis.fetch = async (url, init) => {
    const text = String(url);
    if (text.includes("/rest/v1/stock_quote_snapshots")) {
      return new Response(JSON.stringify([snapshot]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (text.includes("/oauth2/tokenP")) {
      providerCalls += 1;
      await sleep(100);
      return Response.json({ access_token: "delayed-token", expires_in: 3600 });
    }
    if (text.includes("/uapi/domestic-stock/v1/quotations/inquire-price")) {
      providerCalls += 1;
      return Response.json({
        rt_cd: "0",
        output: {
          stck_prpr: "1200",
          stck_sdpr: "1000",
          prdy_ctrt: "20.0",
          acml_vol: "100",
          hts_kor_isnm: "느린공급자",
          stck_bsop_date: "20260605",
        },
      });
    }
    throw new Error(`unexpected fetch ${text}`);
  };

  const raced = await Promise.race([getStockQuote(ticker), sleep(40).then(() => "timeout" as const)]);

  assert.notEqual(raced, "timeout");
  if (raced === "timeout") return;
  assert.equal(raced.cache.state, "stale");
  assert.equal(raced.cache.source, "supabase");
  assert.equal(raced.payload.latest_price, 1000);

  await sleep(140);
  assert.equal(providerCalls > 0, true);
});

test("quote stale snapshot avoids queued backstop when inline refresh is available", async () => {
  useSnapshotOnlyRuntime();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  process.env.STOCK_API_APP_KEY = "queued-app-key";
  process.env.STOCK_API_APP_SECRET = "queued-app-secret";
  process.env.STOCK_API_BASE = "https://kis-queued.example.com";
  process.env.STOCK_QUOTE_CACHE_STALE_SECONDS = "86400";

  const ticker = "KR:008888";
  const nowMs = Date.now();
  const snapshot = {
    ticker,
    payload: {
      ok: true,
      type: "quote",
      requested_ticker: ticker,
      market: "KR",
      symbol: "008888",
      latest_price: 900,
    },
    fetched_at: new Date(nowMs - 10 * 60_000).toISOString(),
    expires_at: new Date(nowMs - 5 * 60_000).toISOString(),
  };
  let enqueueBody: Record<string, unknown> | undefined;

  globalThis.fetch = async (url, init) => {
    const text = String(url);
    if (text.includes("/rest/v1/stock_quote_snapshots")) {
      return new Response(JSON.stringify([snapshot]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (text.includes("/rest/v1/rpc/enqueue_stock_refresh_job")) {
      enqueueBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ id: "job-stale-quote", status: "queued" });
    }
    if (text.includes("/rest/v1/rpc/acquire_stock_refresh_lease")) {
      return Response.json({
        acquired: false,
        lease_until: new Date(nowMs + 20_000).toISOString(),
        locked_by: "other-worker",
      });
    }
    if (text.includes("/oauth2/tokenP")) {
      return Response.json({ access_token: "queued-token", expires_in: 3600 });
    }
    throw new Error(`unexpected fetch ${text}`);
  };

  const result = await getStockQuote(ticker);
  await sleep(20);

  assert.equal(result.cache.state, "stale");
  assert.equal(enqueueBody, undefined);
});

test("quote cache honors Supabase stale_expires_at over local stale ttl math", async () => {
  useSnapshotOnlyRuntime();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "anon-key";
  process.env.STOCK_QUOTE_CACHE_STALE_SECONDS = "1";

  const ticker = "US:DBSTALETTL";
  const nowMs = Date.now();
  const snapshot = {
    ticker,
    payload: {
      ok: true,
      type: "quote",
      requested_ticker: ticker,
      market: "US",
      symbol: "DBSTALETTL",
      latest_price: 77,
    },
    fetched_at: new Date(nowMs - 2 * 86_400_000).toISOString(),
    expires_at: new Date(nowMs - 86_400_000).toISOString(),
    stale_expires_at: new Date(nowMs + 86_400_000).toISOString(),
  };

  globalThis.fetch = async (url) => {
    const text = String(url);
    if (text.includes("/rest/v1/stock_quote_snapshots")) {
      return new Response(JSON.stringify([snapshot]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch ${text}`);
  };

  const result = await getStockQuote(ticker);
  const serverCache = result.payload.server_cache as Record<string, unknown>;

  assert.equal(result.cache.state, "stale");
  assert.equal(result.cache.source, "supabase");
  assert.equal(result.cache.staleExpiresAt, snapshot.stale_expires_at);
  assert.equal(serverCache.stale_expires_at, snapshot.stale_expires_at);
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
