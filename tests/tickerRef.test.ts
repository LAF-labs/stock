import test from "node:test";
import assert from "node:assert/strict";

import {
  cleanTickerSymbol,
  normalizeTickerRef,
  parseStrictTickerRef,
  parseTickerRef,
  resolveTickerAlias,
  validTickerSymbolForMarket,
} from "../src/lib/tickerRef";

test("normalizeTickerRef canonicalizes market-prefixed, domestic, and fallback inputs", () => {
  assert.equal(normalizeTickerRef(" nvda "), "US:NVDA");
  assert.equal(normalizeTickerRef("us:brk.b"), "US:BRK.B");
  assert.equal(normalizeTickerRef("005930"), "KR:005930");
  assert.equal(normalizeTickerRef("Q123456"), "KR:Q123456");
  assert.equal(normalizeTickerRef("0194m0"), "KR:0194M0");
  assert.equal(normalizeTickerRef("", "US:KO"), "US:KO");
});

test("parseTickerRef returns canonical ticker, market, and sanitized symbol", () => {
  assert.deepEqual(parseTickerRef("kr:005930"), { ticker: "KR:005930", market: "KR", symbol: "005930" });
  assert.deepEqual(parseTickerRef("!tsla"), { ticker: "US:TSLA", market: "US", symbol: "TSLA" });
  assert.deepEqual(parseTickerRef("bad spaces"), { ticker: "US:BADSPACES", market: "US", symbol: "BADSPACES" });
});

test("cleanTickerSymbol strips unsafe characters without changing case semantics", () => {
  assert.equal(cleanTickerSymbol(" brk/b "), "BRKB");
  assert.equal(cleanTickerSymbol("005930.ks"), "005930.KS");
});

test("parseStrictTickerRef accepts only explicit safe API ticker inputs", () => {
  assert.deepEqual(parseStrictTickerRef(" nvda "), { ok: true, ticker: "US:NVDA", market: "US", symbol: "NVDA" });
  assert.deepEqual(parseStrictTickerRef("us:brk.b"), { ok: true, ticker: "US:BRK.B", market: "US", symbol: "BRK.B" });
  assert.deepEqual(parseStrictTickerRef("005930"), { ok: true, ticker: "KR:005930", market: "KR", symbol: "005930" });
  assert.deepEqual(parseStrictTickerRef("kr:005930"), { ok: true, ticker: "KR:005930", market: "KR", symbol: "005930" });
  assert.deepEqual(parseStrictTickerRef("kr:0194m0"), { ok: true, ticker: "KR:0194M0", market: "KR", symbol: "0194M0" });
});

test("resolveTickerAlias canonicalizes deterministic public aliases before strict parsing", () => {
  assert.deepEqual(resolveTickerAlias("BRK/B"), {
    ok: true,
    input: "BRK/B",
    ticker: "US:BRK.B",
    market: "US",
    symbol: "BRK.B",
    confidence: "deterministic",
    source: "format_alias",
  });
  assert.equal(aliasTicker("US:BRK/B"), "US:BRK.B");
  assert.equal(aliasTicker("005930.KS"), "KR:005930");
  assert.equal(aliasTicker("KR:005930.KQ"), "KR:005930");
  assert.equal(aliasTicker("삼전"), "KR:005930");
  assert.equal(aliasTicker("엔비디아"), "US:NVDA");
  assert.equal(aliasTicker("구글"), "US:GOOGL");
  assert.equal(aliasTicker("온큐"), "US:IONQ");
  assert.equal(aliasTicker("스트레티지"), "US:MSTR");
  assert.equal(aliasTicker("스트래티지"), "US:MSTR");
  assert.deepEqual(resolveTickerAlias("삼성"), { ok: false, input: "삼성", error: "ambiguous_ticker" });
  assert.deepEqual(resolveTickerAlias("SK"), { ok: false, input: "SK", error: "ambiguous_ticker" });
});

test("parseStrictTickerRef rejects missing, unsafe, and market-mismatched API tickers", () => {
  assert.deepEqual(parseStrictTickerRef(""), { ok: false, error: "missing_ticker" });
  assert.deepEqual(parseStrictTickerRef(null), { ok: false, error: "missing_ticker" });
  assert.deepEqual(parseStrictTickerRef("bad spaces"), { ok: false, error: "invalid_ticker" });
  assert.deepEqual(parseStrictTickerRef("US:BRK/B"), { ok: false, error: "invalid_ticker" });
  assert.deepEqual(parseStrictTickerRef("US:XFLH/UN"), { ok: false, error: "invalid_ticker" });
  assert.deepEqual(parseStrictTickerRef("KR:ABC123"), { ok: false, error: "invalid_ticker" });
  assert.deepEqual(parseStrictTickerRef("US:"), { ok: false, error: "invalid_ticker" });
  assert.deepEqual(parseStrictTickerRef("###"), { ok: false, error: "invalid_ticker" });
});

test("validTickerSymbolForMarket validates raw symbols instead of cleaned aliases", () => {
  assert.equal(validTickerSymbolForMarket("US", "BRK.B"), true);
  assert.equal(validTickerSymbolForMarket("US", "BRK/B"), false);
  assert.equal(validTickerSymbolForMarket("US", "XFLH/UN"), false);
  assert.equal(validTickerSymbolForMarket("KR", "0194M0"), true);
  assert.equal(validTickerSymbolForMarket("KR", "005930.KS"), false);
});

function aliasTicker(value: string): string | undefined {
  const result = resolveTickerAlias(value);
  return result.ok ? result.ticker : undefined;
}
