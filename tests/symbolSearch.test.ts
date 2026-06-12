import test from "node:test";
import assert from "node:assert/strict";

import { buildSymbolSearchIndex, searchSymbolIndex } from "../src/lib/symbolLocalSearch";
import { findExactSymbol, searchLocalSymbolsForTests, searchSymbols } from "../src/lib/symbolSearch";

const originalFetch = globalThis.fetch;
const originalEnv = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  STOCK_SYMBOL_SEARCH_TIMEOUT_MS: process.env.STOCK_SYMBOL_SEARCH_TIMEOUT_MS,
};

function restore() {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

test.afterEach(restore);

test("local symbol index returns instant multi-field suggestions without remote search", () => {
  const index = buildSymbolSearchIndex([
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
      market: "KR",
      ticker: "003720",
      exchange: "KOSPI",
      exchangeName: "코스피",
      koreanName: "삼영",
      englishName: "Samyoung",
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
      ticker: "KO",
      exchange: "NYSE",
      exchangeName: "NYSE",
      koreanName: "코카콜라",
      englishName: "Coca-Cola Company",
      instrumentType: "STOCK",
    },
  ]);

  assert.equal(searchSymbolIndex(index, { query: "삼", limit: 5 })[0]?.key, "KR:005930");
  assert.deepEqual(searchSymbolIndex(index, { query: "삼성", limit: 5 }).map((item) => item.key), ["KR:005930"]);
  assert.deepEqual(searchSymbolIndex(index, { query: "samsung", limit: 5 }).map((item) => item.key), ["KR:005930"]);
  assert.deepEqual(searchSymbolIndex(index, { query: "엔비", limit: 5 }).map((item) => item.key), ["US:NVDA"]);
  assert.deepEqual(searchSymbolIndex(index, { query: "coca cola", limit: 5 }).map((item) => item.key), ["US:KO"]);
  assert.deepEqual(searchSymbolIndex(index, { query: "삼전", limit: 5 }).map((item) => item.key), ["KR:005930"]);
});

test("curated newly listed SPCX symbol is searchable by Korean names and nicknames", () => {
  const index = buildSymbolSearchIndex([]);

  for (const query of ["SPCX", "스페이스X", "스페이스엑스", "스엑스", "스엑"]) {
    const [item] = searchSymbolIndex(index, { query, limit: 5 });
    assert.equal(item?.key, "US:SPCX", query);
    assert.equal(item?.displayName, "스페이스X", query);
    assert.equal(item?.listingStatus, "newly_listed", query);
  }
});

test("local symbol search tolerates a single-character typo in names", () => {
  const index = buildSymbolSearchIndex([
    {
      market: "US",
      ticker: "RKLB",
      exchange: "NASDAQ",
      exchangeName: "나스닥",
      koreanName: "로켓 랩",
      englishName: "Rocket Lab Corporation",
      instrumentType: "STOCK",
    },
    {
      market: "US",
      ticker: "RKT",
      exchange: "NYSE",
      exchangeName: "뉴욕",
      koreanName: "로켓 컴퍼니스",
      englishName: "Rocket Companies",
      instrumentType: "STOCK",
    },
  ]);

  assert.deepEqual(searchSymbolIndex(index, { query: "로캣랩", limit: 5 }).map((item) => item.key), ["US:RKLB"]);
  assert.equal(searchSymbolIndex(index, { query: "Roket Lab", limit: 5 })[0]?.key, "US:RKLB");
});

test("curated SPCX search result is served before an empty Supabase response", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "anon-key";

  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return Response.json([]);
  }) as typeof fetch;

  const [item] = await searchSymbols({ query: "스엑", limit: 8 });

  assert.equal(item?.key, "US:SPCX");
  assert.equal(item?.displayName, "스페이스X");
  assert.equal(calls, 0);
});

test("symbol search uses Supabase RPC when available", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "anon-key";
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  const calls: Array<{ url: string; body?: string }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: String(init?.body || "") });
    return Response.json([
      {
        market: "US",
        ticker: "NVDA",
        exchange: "NASDAQ",
        exchange_name: "Nasdaq",
        korean_name: "엔비디아",
        english_name: "NVIDIA Corporation",
        instrument_type: "STOCK",
        currency: "USD",
        standard_code: null,
        provider_sector_code: "technology.semiconductors",
        listing_status: "listed",
        listed_at: "1999-01-22",
        delisted_at: null,
      },
    ]);
  }) as typeof fetch;

  const items = await searchSymbols({ query: "nvda", limit: 8 });

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/search_stock_symbols$/);
  assert.equal(JSON.parse(calls[0].body || "{}").p_query, "nvda");
  assert.equal(items.length, 1);
  assert.equal(items[0].key, "US:NVDA");
  assert.equal(items[0].displayName, "엔비디아");
  assert.equal(items[0].listingStatus, "listed");
  assert.equal(items[0].listedAt, "1999-01-22");
});

test("symbol search drops Supabase RPC rows with unsupported slash tickers", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "anon-key";
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  globalThis.fetch = (async () =>
    Response.json([
      {
        market: "US",
        ticker: "BRK/B",
        exchange: "NYSE",
        exchange_name: "NYSE",
        korean_name: "",
        english_name: "Berkshire Hathaway Class B slash alias",
        instrument_type: "STOCK",
      },
      {
        market: "US",
        ticker: "BRK.B",
        exchange: "NYSE",
        exchange_name: "NYSE",
        korean_name: "",
        english_name: "Berkshire Hathaway Class B",
        instrument_type: "STOCK",
      },
    ])) as typeof fetch;

  const items = await searchSymbols({ query: "brk", limit: 8 });

  assert.deepEqual(items.map((item) => item.key), ["US:BRK.B"]);
});

test("symbol search does not fallback when Supabase returns a real empty result", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "anon-key";

  globalThis.fetch = (async () => Response.json([])) as typeof fetch;

  const items = await searchSymbols({ query: "ko", limit: 8 });

  assert.deepEqual(items, []);
});

test("symbol search falls back to the generated universe when Supabase is unavailable", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "anon-key";

  globalThis.fetch = (async () => new Response("service unavailable", { status: 503 })) as typeof fetch;

  const items = await searchSymbols({ query: "nvda", limit: 8, market: "US" });

  assert.equal(items.some((item) => item.key === "US:NVDA"), true);
});

test("exact symbol lookup uses the generated universe before Supabase RPC", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "anon-key";

  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return Response.json([]);
  }) as typeof fetch;

  const item = await findExactSymbol("KR:005930");

  assert.equal(item?.key, "KR:005930");
  assert.deepEqual(calls, []);
});

test("local symbol search excludes delisted rows and keeps newly listed rows searchable", async () => {
  const items = await searchLocalSymbolsForTests(
    [
      {
        market: "US",
        ticker: "LIVE",
        exchange: "NASDAQ",
        exchangeName: "Nasdaq",
        koreanName: "",
        englishName: "Live Corp",
        instrumentType: "STOCK",
        listingStatus: "listed",
      },
      {
        market: "US",
        ticker: "DEAD",
        exchange: "NASDAQ",
        exchangeName: "Nasdaq",
        koreanName: "",
        englishName: "Dead Corp",
        instrumentType: "STOCK",
        listingStatus: "delisted",
      },
      {
        market: "KR",
        ticker: "123456",
        exchange: "KOSDAQ",
        exchangeName: "KOSDAQ",
        koreanName: "새상장",
        englishName: "New Listing",
        instrumentType: "STOCK",
        listingStatus: "newly_listed",
      },
    ],
    { query: "새", limit: 10 }
  );

  assert.equal(items.some((item) => item.key === "US:DEAD"), false);
  assert.equal(items.some((item) => item.key === "KR:123456"), true);
});

test("local symbol search resolves deterministic popular aliases to canonical symbols", async () => {
  const items = await searchLocalSymbolsForTests(
    [
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
        ticker: "GOOGL",
        exchange: "NASDAQ",
        exchangeName: "나스닥",
        koreanName: "알파벳",
        englishName: "Alphabet Inc.",
        instrumentType: "STOCK",
      },
    ],
    { query: "삼전", limit: 10 }
  );
  const googleItems = await searchLocalSymbolsForTests(
    [
      {
        market: "US",
        ticker: "GOOGL",
        exchange: "NASDAQ",
        exchangeName: "나스닥",
        koreanName: "알파벳",
        englishName: "Alphabet Inc.",
        instrumentType: "STOCK",
      },
    ],
    { query: "구글", limit: 10 }
  );

  assert.deepEqual(items.map((item) => item.key), ["KR:005930"]);
  assert.deepEqual(googleItems.map((item) => item.key), ["US:GOOGL"]);
});

test("symbol search display names prefer Korean labels except US derivative products", async () => {
  const universe = [
    {
      market: "US" as const,
      ticker: "KO",
      exchange: "NYS",
      exchangeName: "뉴욕",
      koreanName: "코카콜라",
      englishName: "COCA-COLA CO",
      instrumentType: "STOCK" as const,
    },
    {
      market: "KR" as const,
      ticker: "0194M0",
      exchange: "KOSPI",
      exchangeName: "코스피",
      koreanName: "ACE 삼성전자단일종목레버리지",
      englishName: "",
      instrumentType: "ETF" as const,
    },
    {
      market: "US" as const,
      ticker: "TSLL",
      exchange: "NASDAQ",
      exchangeName: "나스닥",
      koreanName: "",
      englishName: "테슬라 2배 ETF",
      instrumentType: "ETF" as const,
    },
  ];

  const [coke] = await searchLocalSymbolsForTests(universe, { query: "KO", limit: 10 });
  const [domesticDerivative] = await searchLocalSymbolsForTests(universe, { query: "삼성전자", limit: 10 });
  const [usDerivative] = await searchLocalSymbolsForTests(universe, { query: "TSLL", limit: 10 });

  assert.equal(coke?.displayName, "코카콜라");
  assert.equal(coke?.subtitle, "미국 · 뉴욕");
  assert.equal(domesticDerivative?.displayName, "ACE 삼성전자단일종목레버리지");
  assert.equal(domesticDerivative?.subtitle, "국내 · 코스피");
  assert.equal(usDerivative?.displayName, "TSLL");
  assert.equal(usDerivative?.subtitle, "미국 · 나스닥");
});

test("symbol search filters master rows that the score API cannot accept", async () => {
  const items = await searchLocalSymbolsForTests(
    [
      {
        market: "KR",
        ticker: "F70100026",
        exchange: "KOSPI",
        exchangeName: "코스피",
        koreanName: "한투글로벌넥스트웨이브1(A)",
        englishName: "",
        instrumentType: "STOCK",
      },
      {
        market: "KR",
        ticker: "0194M0",
        exchange: "KOSPI",
        exchangeName: "코스피",
        koreanName: "ACE 삼성전자단일종목레버리지",
        englishName: "",
        instrumentType: "ETF",
      },
    ],
    { query: "한투", limit: 10 }
  );
  const derivative = await searchLocalSymbolsForTests(
    [
      {
        market: "KR",
        ticker: "0194M0",
        exchange: "KOSPI",
        exchangeName: "코스피",
        koreanName: "ACE 삼성전자단일종목레버리지",
        englishName: "",
        instrumentType: "ETF",
      },
    ],
    { query: "삼성전자", limit: 10 }
  );

  assert.deepEqual(items, []);
  assert.equal(derivative[0]?.key, "KR:0194M0");
  assert.equal(derivative[0]?.displayName, "ACE 삼성전자단일종목레버리지");
});

test("symbol search filters slash ticker master rows that would be cleaned into aliases", async () => {
  const items = await searchLocalSymbolsForTests(
    [
      {
        market: "US",
        ticker: "BRK/B",
        exchange: "NYSE",
        exchangeName: "NYSE",
        koreanName: "",
        englishName: "Berkshire Hathaway Class B slash alias",
        instrumentType: "STOCK",
      },
      {
        market: "US",
        ticker: "BRK.B",
        exchange: "NYSE",
        exchangeName: "NYSE",
        koreanName: "",
        englishName: "Berkshire Hathaway Class B",
        instrumentType: "STOCK",
      },
    ],
    { query: "brk", limit: 10 }
  );

  assert.deepEqual(items.map((item) => item.key), ["US:BRK.B"]);
});
