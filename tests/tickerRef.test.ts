import test from "node:test";
import assert from "node:assert/strict";

import { cleanTickerSymbol, normalizeTickerRef, parseStrictTickerRef, parseTickerRef } from "../src/lib/tickerRef";

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

test("parseStrictTickerRef rejects missing, unsafe, and market-mismatched API tickers", () => {
  assert.deepEqual(parseStrictTickerRef(""), { ok: false, error: "missing_ticker" });
  assert.deepEqual(parseStrictTickerRef(null), { ok: false, error: "missing_ticker" });
  assert.deepEqual(parseStrictTickerRef("bad spaces"), { ok: false, error: "invalid_ticker" });
  assert.deepEqual(parseStrictTickerRef("KR:ABC123"), { ok: false, error: "invalid_ticker" });
  assert.deepEqual(parseStrictTickerRef("US:"), { ok: false, error: "invalid_ticker" });
  assert.deepEqual(parseStrictTickerRef("###"), { ok: false, error: "invalid_ticker" });
});
