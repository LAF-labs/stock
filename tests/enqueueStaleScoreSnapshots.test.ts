import test from "node:test";
import assert from "node:assert/strict";

import { enqueueStaleScoreSnapshots, parseOptions } from "../scripts/enqueue_stale_score_snapshots";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("stale score snapshot enqueuer parses bounded refresh options", () => {
  const options = parseOptions(["--stale-hours", "12", "--limit", "25", "--views", "detail,technical", "--priority", "65", "--json"], {});

  assert.equal(options.staleHours, 12);
  assert.equal(options.limit, 25);
  assert.deepEqual(options.views, ["detail", "technical"]);
  assert.equal(options.priority, 65);
  assert.equal(options.json, true);
});

test("stale score snapshot enqueuer queues stale rows by ticker and view", async () => {
  const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    if (url.includes("/rest/v1/stock_score_snapshots?")) {
      return Response.json([
        { ticker: "US:APLT", view_mode: "compare", fetched_at: "2026-06-09T08:00:00+00:00" },
        { ticker: "KR:005930", view_mode: "detail", fetched_at: "2026-06-09T08:05:00+00:00" },
      ]);
    }
    if (url.endsWith("/rest/v1/rpc/enqueue_stock_refresh_job")) {
      return Response.json({ id: "job-1" });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;

  const result = await enqueueStaleScoreSnapshots(
    { url: "https://example.supabase.co", key: "service-role-key" },
    parseOptions(["--stale-hours", "24", "--limit", "2", "--views", "detail,compare", "--priority", "60"], {}),
    new Date("2026-06-11T08:00:00.000Z")
  );

  assert.equal(result.stale_rows, 2);
  assert.equal(result.queued, 2);
  assert.equal(result.skipped, 0);
  assert.match(decodeURIComponent(calls[0].url), /or=\(fetched_at\.lt\.2026-06-10T08:00:00\.000Z,expires_at\.lte\.2026-06-11T08:00:00\.000Z\)/);
  assert.match(decodeURIComponent(calls[0].url), /view_mode=in\.\(detail,compare\)/);
  assert.equal(calls[1].url, "https://example.supabase.co/rest/v1/rpc/enqueue_stock_refresh_job");
  assert.deepEqual(calls[1].body, {
    p_kind: "score",
    p_market: "US",
    p_symbol: "APLT",
    p_view_mode: "compare",
    p_priority: 60,
    p_payload: {
      reason: "stale_score_snapshot",
      reason_bucket: "stale_score_snapshot",
      requested_ticker: "US:APLT",
      stale_fetched_at: "2026-06-09T08:00:00+00:00",
    },
  });
  assert.deepEqual(calls[2].body, {
    p_kind: "score",
    p_market: "KR",
    p_symbol: "005930",
    p_view_mode: "detail",
    p_priority: 60,
    p_payload: {
      reason: "stale_score_snapshot",
      reason_bucket: "stale_score_snapshot",
      requested_ticker: "KR:005930",
      stale_fetched_at: "2026-06-09T08:05:00+00:00",
    },
  });
});
