import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildRefreshTargetRow,
  refreshTargetRowsFromSymbols,
  stockRefreshTargetIntervals,
} from "../scripts/seed_stock_refresh_targets";
import { parseOptions as parsePlannerOptions, planStockRefreshJobs } from "../scripts/plan_stock_refresh_jobs";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("stock refresh target seed gives ordinary stocks complete but bounded SLA lanes", () => {
  const row = buildRefreshTargetRow({
    market: "KR",
    ticker: "005930",
    exchange: "KOSPI",
    instrumentType: "STOCK",
    koreanName: "삼성전자",
  });

  assert.equal(row.market, "KR");
  assert.equal(row.symbol, "005930");
  assert.equal(row.enabled, true);
  assert.equal(row.tier, "cold_stock");
  assert.equal(row.quote_interval_seconds, stockRefreshTargetIntervals.coldStock.quote);
  assert.equal(row.score_detail_interval_seconds, stockRefreshTargetIntervals.coldStock.score);
  assert.equal(row.score_compare_interval_seconds, stockRefreshTargetIntervals.coldStock.score);
  assert.equal(row.score_technical_interval_seconds, stockRefreshTargetIntervals.coldStock.technical);
  assert.equal(row.chart_interval_seconds, stockRefreshTargetIntervals.coldStock.chart);
});

test("stock refresh target seed keeps ETFs in quote-only coverage", () => {
  const row = buildRefreshTargetRow({
    market: "US",
    ticker: "SPY",
    exchange: "AMS",
    instrumentType: "ETF",
    englishName: "SPDR S&P 500 ETF Trust",
  });

  assert.equal(row.enabled, true);
  assert.equal(row.tier, "etf");
  assert.equal(row.quote_interval_seconds, stockRefreshTargetIntervals.etf.quote);
  assert.equal(row.score_detail_interval_seconds, null);
  assert.equal(row.score_compare_interval_seconds, null);
  assert.equal(row.score_technical_interval_seconds, null);
  assert.equal(row.chart_interval_seconds, null);
});

test("stock refresh target seed protects the queue from product-like rows misclassified as stocks", () => {
  const kodex = buildRefreshTargetRow({
    market: "KR",
    ticker: "0041D0",
    exchange: "KOSPI",
    instrumentType: "STOCK",
    koreanName: "KODEX 미국AI소프트웨어TOP10",
  });
  const preferred = buildRefreshTargetRow({
    market: "KR",
    ticker: "006405",
    exchange: "KOSPI",
    instrumentType: "STOCK",
    koreanName: "삼성SDI우",
  });
  const konex = buildRefreshTargetRow({
    market: "KR",
    ticker: "260870",
    exchange: "KONEX",
    instrumentType: "STOCK",
    koreanName: "SK시그넷",
  });

  assert.equal(kodex.instrument_type, "ETF");
  assert.equal(kodex.tier, "etf");
  assert.equal(kodex.quote_interval_seconds, stockRefreshTargetIntervals.etf.quote);
  assert.equal(kodex.score_detail_interval_seconds, null);
  assert.equal(kodex.score_compare_interval_seconds, null);
  assert.equal(kodex.score_technical_interval_seconds, null);
  assert.equal(kodex.chart_interval_seconds, null);

  assert.equal(preferred.instrument_type, "PREFERRED_STOCK");
  assert.equal(preferred.tier, "etf");
  assert.equal(preferred.score_detail_interval_seconds, null);

  assert.equal(konex.instrument_type, "KONEX_STOCK");
  assert.equal(konex.tier, "etf");
  assert.equal(konex.score_detail_interval_seconds, null);
});

test("stock refresh target seed dedupes normalized symbol rows", () => {
  const rows = refreshTargetRowsFromSymbols([
    { market: "us", ticker: "nvda", exchange: "NAS", instrumentType: "STOCK", englishName: "NVIDIA" },
    { market: "US", ticker: "NVDA", exchange: "NAS", instrumentType: "STOCK", englishName: "NVIDIA duplicate" },
    { market: "KR", ticker: " 005930 ", exchange: "KOSPI", instrumentType: "STOCK", koreanName: "삼성전자" },
    { market: "US", ticker: "", exchange: "NAS", instrumentType: "STOCK" },
  ]);

  assert.deepEqual(
    rows.map((row) => `${row.market}:${row.symbol}`),
    ["US:NVDA", "KR:005930"]
  );
});

test("stock refresh planner calls Supabase planning RPC with bounded options", async () => {
  const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    if (url.endsWith("/rest/v1/rpc/plan_stock_refresh_jobs")) {
      return Response.json({ ok: true, candidates: 12, inserted: 10, by_kind: { quote: 10 } });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;

  const result = await planStockRefreshJobs(
    { url: "https://example.supabase.co", key: "service-role-key" },
    parsePlannerOptions(["--kind", "quote", "--limit", "25", "--json"], {})
  );

  assert.equal(result.ok, true);
  assert.equal(result.inserted, 10);
  assert.equal(calls[0].url, "https://example.supabase.co/rest/v1/rpc/plan_stock_refresh_jobs");
  assert.deepEqual(calls[0].body, {
    p_kind: "quote",
    p_limit: 25,
  });
});

test("refresh target cleanup migration turns product-like targets into quote-only rows and drops pending heavy jobs", () => {
  const migration = readFileSync("supabase/migrations/20260612125000_quote_only_product_refresh_targets.sql", "utf8");

  assert.match(migration, /update public\.stock_refresh_targets/i);
  assert.match(migration, /score_detail_interval_seconds = null/i);
  assert.match(migration, /chart_interval_seconds = null/i);
  assert.match(migration, /delete from public\.stock_refresh_jobs/i);
  assert.match(migration, /status in \('queued', 'running'\)/i);
});

test("provider-empty cleanup migration dead-letters terminal no-data refresh jobs", () => {
  const migration = readFileSync("supabase/migrations/20260612142000_mark_provider_empty_refresh_jobs_dead.sql", "utf8");

  assert.match(migration, /set status = 'dead'/i);
  assert.match(migration, /provider_confirmed_empty/i);
  assert.match(migration, /empty price/i);
  assert.match(migration, /kis_not_found/i);
  assert.match(migration, /chart_series_missing/i);
  assert.match(migration, /not \(/i);
  assert.match(migration, /fetch failed/i);
});
