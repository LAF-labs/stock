import test from "node:test";
import assert from "node:assert/strict";

import {
  mergeMarketCapRows,
  normalizeDomesticMarketCapRow,
  normalizeNasdaqMarketCapRow,
  normalizeOverseasMarketCapRow,
  overseasMarketCapRequestParams,
} from "../src/lib/marketCapRankingProvider";
import type { MarketCapRankingRow } from "../src/lib/marketCapRankingTypes";
import type { SymbolMasterItem } from "../src/lib/symbolTypes";

const fetchedAt = "2026-06-12T01:00:00.000Z";

test("normalizes domestic KIS market-cap rows into KRW dashboard rows", () => {
  const row = normalizeDomesticMarketCapRow({
    data_rank: "1",
    mksc_shrn_iscd: "005930",
    hts_kor_isnm: "삼성전자",
    stck_prpr: "70000",
    prdy_vrss: "1000",
    prdy_ctrt: "1.45",
    stck_avls: "4500000",
  }, fetchedAt);

  assert.equal(row?.rank, 1);
  assert.equal(row?.ticker, "KR:005930");
  assert.equal(row?.market, "KR");
  assert.equal(row?.symbol, "005930");
  assert.equal(row?.name, "삼성전자");
  assert.equal(row?.price, 70000);
  assert.equal(row?.priceChange, 1000);
  assert.equal(row?.priceChangePercent, 0.0145);
  assert.equal(row?.marketCap, 450_000_000_000_000);
  assert.equal(row?.marketCapCurrency, "KRW");
  assert.equal(row?.fetchedAt, fetchedAt);
});

test("normalizes overseas KIS market-cap rows into USD dashboard rows", () => {
  const row = normalizeOverseasMarketCapRow({
    rank: "1",
    excd: "NAS",
    symb: "NVDA",
    name: "NVIDIA Corporation",
    last: "195.50",
    diff: "2.50",
    rate: "1.30",
    mcap: "4750000000000",
  }, fetchedAt);

  assert.equal(row?.rank, 1);
  assert.equal(row?.ticker, "US:NVDA");
  assert.equal(row?.market, "US");
  assert.equal(row?.exchangeCode, "NAS");
  assert.equal(row?.price, 195.5);
  assert.equal(row?.priceChange, 2.5);
  assert.equal(row?.priceChangePercent, 0.013);
  assert.equal(row?.marketCap, 4_750_000_000_000);
  assert.equal(row?.marketCapCurrency, "USD");
});

test("normalizes Nasdaq screener market-cap rows into USD dashboard rows", () => {
  const row = normalizeNasdaqMarketCapRow({
    symbol: "BRK/B",
    name: "Berkshire Hathaway Inc. Class B Common Stock",
    lastsale: "$512.30",
    netchange: "-1.20",
    pctchange: "-0.234%",
    marketCap: "1100000000000.00",
    sector: "Finance",
    industry: "Property-Casualty Insurers",
  }, fetchedAt);

  assert.equal(row?.rank, 0);
  assert.equal(row?.ticker, "US:BRK.B");
  assert.equal(row?.market, "US");
  assert.equal(row?.symbol, "BRK.B");
  assert.equal(row?.price, 512.3);
  assert.equal(row?.priceChange, -1.2);
  assert.equal(row?.priceChangePercent, -0.00234);
  assert.equal(row?.marketCap, 1_100_000_000_000);
  assert.equal(row?.marketCapCurrency, "USD");
  assert.equal(row?.source, "nasdaq-fallback");
});

test("overseas KIS market-cap requests include required currency parameter", () => {
  assert.deepEqual(overseasMarketCapRequestParams("NAS"), {
    EXCD: "NAS",
    VOL_RANG: "0",
    KEYB: "",
    AUTH: "",
    CURR_GB: "",
  });
});

test("mergeMarketCapRows filters non-single-stock symbols and ranks by comparable USD market cap", () => {
  const rows: MarketCapRankingRow[] = [
    {
      rank: 1,
      ticker: "KR:005930",
      market: "KR",
      symbol: "005930",
      name: "삼성전자",
      price: 70000,
      priceChange: 1000,
      priceChangePercent: 0.0145,
      marketCap: 450_000_000_000_000,
      marketCapCurrency: "KRW",
      marketCapUsd: 300_000_000_000,
      fetchedAt,
      source: "kis-domestic",
    },
    {
      rank: 1,
      ticker: "US:NVDA",
      market: "US",
      symbol: "NVDA",
      name: "NVIDIA",
      price: 195,
      priceChange: 2,
      priceChangePercent: 0.01,
      marketCap: 4_750_000_000_000,
      marketCapCurrency: "USD",
      marketCapUsd: 4_750_000_000_000,
      fetchedAt,
      source: "kis-overseas",
    },
    {
      rank: 2,
      ticker: "US:SPY",
      market: "US",
      symbol: "SPY",
      name: "SPDR S&P 500 ETF",
      price: 600,
      priceChange: 1,
      priceChangePercent: 0.002,
      marketCap: 500_000_000_000,
      marketCapCurrency: "USD",
      marketCapUsd: 500_000_000_000,
      fetchedAt,
      source: "kis-overseas",
    },
  ];
  const symbols: SymbolMasterItem[] = [
    {
      market: "KR",
      ticker: "005930",
      exchange: "KOSPI",
      exchangeName: "코스피",
      koreanName: "삼성전자",
      englishName: "Samsung Electronics",
      instrumentType: "STOCK",
    },
    {
      market: "US",
      ticker: "NVDA",
      exchange: "NASDAQ",
      exchangeName: "Nasdaq",
      koreanName: "엔비디아",
      englishName: "NVIDIA Corporation",
      instrumentType: "STOCK",
    },
    {
      market: "US",
      ticker: "SPY",
      exchange: "NYSE",
      exchangeName: "NYSE",
      koreanName: "",
      englishName: "SPDR S&P 500 ETF",
      instrumentType: "ETF",
    },
  ];

  const merged = mergeMarketCapRows(rows, { scope: "all", symbols, limit: 100 });

  assert.deepEqual(merged.map((row) => row.ticker), ["US:NVDA", "KR:005930"]);
  assert.deepEqual(merged.map((row) => row.rank), [1, 2]);
});
