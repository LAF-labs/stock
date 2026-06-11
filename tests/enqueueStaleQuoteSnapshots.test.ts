import test from "node:test";
import assert from "node:assert/strict";

import { enqueueStaleQuoteSnapshots, parseOptions } from "../scripts/enqueue_stale_quote_snapshots";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("stale quote snapshot enqueuer parses bounded refresh options", () => {
  const options = parseOptions(["--limit", "25", "--priority", "55", "--json"], {});

  assert.equal(options.limit, 25);
  assert.equal(options.priority, 55);
  assert.equal(options.json, true);
});

test("stale quote snapshot enqueuer queues expired stale quote rows", async () => {
  const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    if (url.includes("/rest/v1/stock_quote_snapshots?")) {
      return Response.json([
        { ticker: "US:APP", market: "US", symbol: "APP", stale_expires_at: "2026-06-11T04:42:56+00:00" },
        { ticker: "KR:005930", market: "KR", symbol: "005930", stale_expires_at: "2026-06-11T04:43:00+00:00" },
      ]);
    }
    if (url.endsWith("/rest/v1/rpc/enqueue_stock_refresh_job")) {
      return Response.json({ id: "job-1" });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;

  const result = await enqueueStaleQuoteSnapshots(
    { url: "https://example.supabase.co", key: "service-role-key" },
    parseOptions(["--limit", "2", "--priority", "55"], {}),
    new Date("2026-06-11T08:00:00.000Z")
  );

  assert.equal(result.stale_rows, 2);
  assert.equal(result.queued, 2);
  assert.equal(result.skipped, 0);
  assert.match(decodeURIComponent(calls[0].url), /stale_expires_at=lte\.2026-06-11T08:00:00\.000Z/);
  assert.equal(calls[1].url, "https://example.supabase.co/rest/v1/rpc/enqueue_stock_refresh_job");
  assert.deepEqual(calls[1].body, {
    p_kind: "quote",
    p_market: "US",
    p_symbol: "APP",
    p_view_mode: null,
    p_priority: 55,
    p_payload: {
      reason: "stale_quote_snapshot",
      reason_bucket: "stale_quote_snapshot",
      requested_ticker: "US:APP",
      stale_expires_at: "2026-06-11T04:42:56+00:00",
    },
  });
  assert.deepEqual(calls[2].body, {
    p_kind: "quote",
    p_market: "KR",
    p_symbol: "005930",
    p_view_mode: null,
    p_priority: 55,
    p_payload: {
      reason: "stale_quote_snapshot",
      reason_bucket: "stale_quote_snapshot",
      requested_ticker: "KR:005930",
      stale_expires_at: "2026-06-11T04:43:00+00:00",
    },
  });
});
