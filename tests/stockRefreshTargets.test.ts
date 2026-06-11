import test from "node:test";
import assert from "node:assert/strict";

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
