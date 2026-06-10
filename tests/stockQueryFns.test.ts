import test from "node:test";
import assert from "node:assert/strict";

import { readClientApiPayload } from "../src/lib/clientApi";
import {
  StockQueryError,
  classifyComparePayload,
  classifyScorePayload,
  fetchCompareScores,
  fetchStockQuote,
  fetchStockScore,
  fetchSymbols,
  refreshQuote,
} from "../src/lib/stockQueryFns";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockJsonFetch(payload: Record<string, unknown>, status = 200) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return Response.json(payload, { status });
  }) as typeof fetch;
  return calls;
}

test("client API parser is available from the lib data layer", async () => {
  await assert.rejects(() => readClientApiPayload(new Response("", { status: 200 })), /서버 응답이 비어 있어요/);
  assert.deepEqual(await readClientApiPayload(Response.json({ ok: true })), { ok: true });
});

test("score classifier keeps partial snapshots as successful query data", () => {
  const result = classifyScorePayload(
    {
      ok: true,
      type: "partial_stock_snapshot",
      requested_ticker: "US:ZVRA",
      symbol: "ZVRA",
      pending_snapshot: {
        error: "snapshot_pending",
        ticker: "US:ZVRA",
        retry_after_seconds: 5,
        refresh_request: { queued: true },
      },
    },
    200,
  );

  assert.equal(result.state, "partial");
  assert.equal(result.data.symbol, "ZVRA");
  assert.equal(result.pending?.state, "pending");
  assert.equal(result.pending?.queued, true);
});

test("score classifier models queued pending without throwing", () => {
  const result = classifyScorePayload(
    {
      ok: false,
      error: "snapshot_pending",
      ticker: "KR:004020",
      retry_after_seconds: 30,
      refresh_request: { queued: true },
    },
    202,
  );

  assert.equal(result.state, "pending");
  assert.equal(result.error, "snapshot_pending");
  assert.equal(result.ticker, "KR:004020");
  assert.equal(result.retryAfterSeconds, 30);
});

test("score classifier separates technical unsupported products from transient errors", () => {
  const result = classifyScorePayload(
    {
      ok: false,
      error: "technical_unsupported_product",
      ticker: "KR:0194M0",
      redirect_to: "/?ticker=KR%3A0194M0",
    },
    400,
  );

  assert.equal(result.state, "unsupported");
  assert.equal(result.redirectTo, "/?ticker=KR%3A0194M0");
});

test("score classifier throws typed terminal errors", () => {
  assert.throws(
    () => classifyScorePayload({ ok: false, error: "collector_unreachable", message: "down" }, 502),
    (error) => error instanceof StockQueryError && error.status === 502 && error.code === "collector_unreachable" && error.message === "down",
  );
});

test("compare classifier keeps result order aligned to input tickers", () => {
  const result = classifyComparePayload(
    {
      ok: true,
      results: [
        { ok: true, requested_ticker: "KR:004020", symbol: "004020" },
        {
          ok: true,
          type: "partial_stock_snapshot",
          requested_ticker: "US:KO",
          symbol: "KO",
          pending_snapshot: { error: "snapshot_pending", refresh_request: { queued: true } },
        },
      ],
    },
    200,
    ["KR:004020", "US:KO"],
  );

  assert.equal(result.state, "partial");
  assert.equal(result.results[0].ticker, "KR:004020");
  assert.equal(result.results[0].result.state, "ready");
  assert.equal(result.results[1].ticker, "US:KO");
  assert.equal(result.results[1].result.state, "partial");
});

test("stock query functions build the expected API requests", async () => {
  const calls = mockJsonFetch({ ok: true, requested_ticker: "KR:004020", symbol: "004020" });
  assert.equal((await fetchStockScore({ ticker: "KR:004020" })).state, "ready");
  assert.equal(calls[0], "/api/score?ticker=KR%3A004020&partial=1");

  calls.length = 0;
  assert.equal((await fetchStockScore({ ticker: "KR:004020", view: "technical" })).state, "ready");
  assert.equal(calls[0], "/api/score?ticker=KR%3A004020&partial=1&view=technical");
});

test("quote fetch and refresh model ready pending and cooldown states", async () => {
  const quoteCalls = mockJsonFetch({ ok: true, type: "quote", requested_ticker: "US:KO", latest_price: 60 });
  assert.equal((await fetchStockQuote("US:KO")).state, "ready");
  assert.equal(quoteCalls[0], "/api/quote?ticker=US%3AKO");

  mockJsonFetch({ ok: false, error: "snapshot_pending", refresh_request: { queued: true } }, 202);
  assert.equal((await fetchStockQuote("US:KO")).state, "pending");

  mockJsonFetch({ ok: false, error: "refresh_cooldown", message: "Manual refresh is cooling down.", refresh_cooldown: { next_allowed_at: "2026-06-10T00:00:00.000Z" } }, 429);
  const cooldown = await refreshQuote("US:KO");
  assert.equal(cooldown.state, "cooldown");
  assert.equal(cooldown.nextAllowedAt, "2026-06-10T00:00:00.000Z");
});

test("compare and symbol fetchers return typed ready payloads", async () => {
  const compareCalls = mockJsonFetch({ ok: true, results: [{ ok: true, requested_ticker: "US:KO", symbol: "KO" }] });
  assert.equal((await fetchCompareScores(["US:KO"])).state, "ready");
  assert.equal(compareCalls[0], "/api/score/batch?tickers=US%3AKO&partial=1");

  mockJsonFetch({ ok: true, query: "ko", total: 1, items: [{ key: "US:KO", market: "US", ticker: "KO" }] });
  const symbols = await fetchSymbols({ query: "ko", market: "US" });
  assert.equal(symbols.state, "ready");
  assert.equal(symbols.data.query, "ko");
  assert.equal(symbols.data.items[0].ticker, "KO");
});
