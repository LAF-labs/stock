import test from "node:test";
import assert from "node:assert/strict";

import {
  claimRefreshJobs,
  assertRefreshWorkerReadiness,
  parseOptions,
  parseTickerArgs,
  parseViews,
  permanentRefreshFailure,
  publishQueueJob,
  retryAfterSeconds,
  resolveWarmTickers,
  rowHasBlockingErrors,
  selectWarmTickerBatch,
  mergeWarmTickerPool,
  upsertChartSnapshot,
  run,
  upsertQuoteSnapshot,
} from "../scripts/publish_stock_snapshots";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("TypeScript snapshot worker defaults to quote-only queue drain", () => {
  const options = parseOptions(["--drain-queue", "--json"], {});

  assert.equal(options.mode, "quote");
  assert.equal(options.skipQuote, false);
  assert.equal(options.skipScore, true);
  assert.equal(options.queueLimit, 50);
});

test("TypeScript snapshot worker parses canonical tickers and views", () => {
  assert.deepEqual(parseTickerArgs(["nvda, KR:005930", "US:NVDA"]), ["US:NVDA", "KR:005930"]);
  assert.deepEqual(parseViews("detail,technical,compare,technical"), ["detail", "technical", "compare"]);
});

test("TypeScript snapshot worker selects one rotating warm batch from a capped pool", () => {
  const tickers = Array.from({ length: 500 }, (_, index) => `US:T${String(index + 1).padStart(3, "0")}`);

  assert.deepEqual(selectWarmTickerBatch(tickers, { warmPoolLimit: 500, warmBatchSize: 50, warmShardKey: "0" }), tickers.slice(0, 50));
  assert.deepEqual(selectWarmTickerBatch(tickers, { warmPoolLimit: 500, warmBatchSize: 50, warmShardKey: "1" }), tickers.slice(50, 100));
  assert.deepEqual(selectWarmTickerBatch(tickers, { warmPoolLimit: 500, warmBatchSize: 50, warmShardKey: "10" }), tickers.slice(0, 50));
});

test("TypeScript snapshot worker prioritizes demand tickers before static warm tickers", () => {
  const demand = ["US:NVDA", "KR:005930", "US:KO"];
  const configured = ["US:KO", "US:TSLA", "US:NVDA", "US:MSFT"];

  assert.deepEqual(mergeWarmTickerPool(demand, configured, 5), ["US:NVDA", "KR:005930", "US:KO", "US:TSLA", "US:MSFT"]);
});

test("TypeScript snapshot worker resolves demand warm tickers from recent succeeded jobs", async () => {
  let requestedUrl = "";
  globalThis.fetch = (async (input) => {
    requestedUrl = String(input);
    return Response.json([
      { market: "US", symbol: "NVDA" },
      { market: "KR", symbol: "005930" },
      { market: "US", symbol: "KO" },
    ]);
  }) as typeof fetch;

  const options = parseOptions(["--dry-run", "--tickers", "TSLA,KO", "--warm-batch-size", "3", "--warm-shard-key", "0"], {});
  const tickers = await resolveWarmTickers(options, { url: "https://example.supabase.co", key: "service-role-key" });

  assert.match(requestedUrl, /stock_refresh_jobs/);
  assert.match(requestedUrl, /status=eq\.succeeded/);
  assert.deepEqual(tickers, ["US:NVDA", "KR:005930", "US:KO"]);
});

test("TypeScript snapshot worker claims quote jobs with kind-specific RPC", async () => {
  const calls: Array<{ url: string; body: unknown; authorization: string | null }> = [];
  globalThis.fetch = (async (input, init) => {
    calls.push({
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      authorization: new Headers(init?.headers).get("authorization"),
    });
    return Response.json([{ id: "job-1", kind: "quote", market: "US", symbol: "KO" }]);
  }) as typeof fetch;

  const options = parseOptions(["--drain-queue", "--kind", "quote", "--worker-id", "worker-1", "--queue-limit", "7"], {});
  const jobs = await claimRefreshJobs({ url: "https://example.supabase.co", key: "service-role-key" }, options);

  assert.equal(jobs.length, 1);
  assert.equal(calls[0].url, "https://example.supabase.co/rest/v1/rpc/claim_stock_refresh_jobs_by_kind");
  assert.deepEqual(calls[0].body, {
    p_worker_id: "worker-1",
    p_kind: "quote",
    p_limit: 7,
    p_lock_seconds: 900,
  });
  assert.equal(calls[0].authorization, "Bearer service-role-key");
});

test("TypeScript snapshot worker accepts chart queue mode", async () => {
  const options = parseOptions(["--drain-queue", "--kind", "chart", "--worker-id", "worker-chart"], {});

  assert.equal(options.mode, "chart");
  assert.equal(options.skipQuote, true);
  assert.equal(options.skipScore, true);
});

test("TypeScript snapshot worker preflights Supabase runtime before queue drain", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  globalThis.fetch = (async (input, init) => {
    calls.push({
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return Response.json({
      ok: true,
      required_tables: ["public.stock_quote_snapshots"],
      required_rpcs: ["claim_stock_refresh_jobs_by_kind"],
    });
  }) as typeof fetch;

  await assert.rejects(
    assertRefreshWorkerReadiness(
      { url: "https://example.supabase.co", key: "service-role-key" },
      parseOptions(["--drain-queue", "--kind", "quote"], {})
    ),
    /Supabase runtime readiness failed/
  );
  assert.equal(calls[0].url, "https://example.supabase.co/rest/v1/rpc/stock_runtime_readiness");
  assert.deepEqual(calls[0].body, {});
});

test("TypeScript snapshot worker rejects score queue modes without explicit legacy fallback", () => {
  assert.throws(
    () => parseOptions(["--drain-queue", "--kind", "all"], {}),
    /Score publishing requires --allow-score-python-fallback/
  );
  assert.throws(
    () => parseOptions(["--drain-queue", "--kind", "score"], {}),
    /Score publishing requires --allow-score-python-fallback/
  );
  assert.throws(
    () => parseOptions(["--ticker", "KO", "--include-score"], {}),
    /Score publishing requires --allow-score-python-fallback/
  );
});

test("TypeScript snapshot worker preserves all-kind claim when legacy fallback is explicit", async () => {
  let requestedUrl = "";
  globalThis.fetch = (async (input) => {
    requestedUrl = String(input);
    return Response.json([]);
  }) as typeof fetch;

  const options = parseOptions(["--drain-queue", "--kind", "all", "--allow-score-python-fallback"], {});
  await claimRefreshJobs({ url: "https://example.supabase.co", key: "service-role-key" }, options);

  assert.equal(requestedUrl, "https://example.supabase.co/rest/v1/rpc/claim_stock_refresh_jobs");
});

test("TypeScript snapshot worker rejects invalid score views before provider fetch", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input, init) => {
    calls.push({
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : {},
    });
    return new Response(null, { status: 204 });
  }) as typeof fetch;

  const options = parseOptions(["--drain-queue", "--kind", "score", "--allow-score-python-fallback"], {});
  const row = await publishQueueJob(
    { id: "job-1", kind: "score", market: "US", symbol: "NVDA", view_mode: "bogus", attempts: 1 },
    { url: "https://example.supabase.co", key: "service-role-key" },
    options
  );

  assert.equal(row.status, "failed");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://example.supabase.co/rest/v1/rpc/fail_stock_refresh_job");
  assert.equal(calls[0].body.p_job_id, "job-1");
  assert.equal(calls[0].body.p_permanent, true);
  assert.match(String(calls[0].body.p_error), /unsupported score view/);
});

test("TypeScript snapshot worker dry-runs quote tickers without provider calls", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return Response.json({});
  }) as typeof fetch;

  const payload = await run(parseOptions(["--dry-run", "--ticker", "KO"], {}));

  assert.equal(payload.ok, true);
  assert.equal(payload.tickers, 1);
  assert.equal(payload.rows[0].quote, "dry_run");
  assert.equal(calls, 0);
});

test("TypeScript snapshot worker does not fail optional warm tickers already being refreshed", () => {
  assert.equal(
    rowHasBlockingErrors({
      ticker: "US:NVDA",
      quote: "error",
      errors: [{ kind: "quote", error: "quote_refresh_not_performed:US:NVDA" }],
    }),
    false
  );
  assert.equal(
    rowHasBlockingErrors({
      ticker: "US:NVDA",
      quote: "error",
      errors: [{ kind: "quote", error: "KIS HTTP 500" }],
    }),
    true
  );
});

test("TypeScript snapshot worker upserts quote snapshots with serving columns", async () => {
  let capturedUrl = "";
  let capturedBody: Record<string, unknown> | undefined;
  globalThis.fetch = (async (input, init) => {
    capturedUrl = String(input);
    capturedBody = JSON.parse(String(init?.body));
    return new Response(null, { status: 201 });
  }) as typeof fetch;

  await upsertQuoteSnapshot(
    { url: "https://example.supabase.co", key: "service-role-key" },
    "US:KO",
    { ok: true, latest_price: 72.25 },
    "2026-06-06T00:00:00.000Z",
    "2026-06-06T00:05:00.000Z",
    "2026-06-07T00:00:00.000Z"
  );

  assert.equal(capturedUrl, "https://example.supabase.co/rest/v1/stock_quote_snapshots?on_conflict=ticker");
  assert.equal(capturedBody?.ticker, "US:KO");
  assert.equal(capturedBody?.market, "US");
  assert.equal(capturedBody?.symbol, "KO");
  assert.equal(capturedBody?.source, "kis");
  assert.equal(capturedBody?.stale_expires_at, "2026-06-07T00:00:00.000Z");
});

test("TypeScript snapshot worker upserts chart snapshots with serving columns", async () => {
  let capturedUrl = "";
  let capturedBody: Record<string, unknown> | undefined;
  globalThis.fetch = (async (input, init) => {
    capturedUrl = String(input);
    capturedBody = JSON.parse(String(init?.body));
    return new Response(null, { status: 201 });
  }) as typeof fetch;

  await upsertChartSnapshot(
    { url: "https://example.supabase.co", key: "service-role-key" },
    "US:KO",
    {
      ok: true,
      type: "chart",
      requested_ticker: "US:KO",
      market: "US",
      symbol: "KO",
      chart_series: [{ date: "2026-06-08", close: 72.25 }],
    },
    "2026-06-08T00:00:00.000Z",
    "2026-06-08T00:15:00.000Z",
    "2026-07-08T00:00:00.000Z"
  );

  assert.equal(capturedUrl, "https://example.supabase.co/rest/v1/stock_chart_snapshots?on_conflict=ticker,source");
  assert.equal(capturedBody?.ticker, "US:KO");
  assert.equal(capturedBody?.market, "US");
  assert.equal(capturedBody?.symbol, "KO");
  assert.equal(capturedBody?.source, "kis");
  assert.equal(capturedBody?.last_bar_date, "2026-06-08");
  assert.equal(capturedBody?.stale_expires_at, "2026-07-08T00:00:00.000Z");
});

test("TypeScript snapshot worker keeps retry and permanent failure contracts", () => {
  assert.equal(retryAfterSeconds({ attempts: 1 }), 120);
  assert.equal(retryAfterSeconds({ attempts: 20 }), 3600);
  assert.equal(permanentRefreshFailure("kis_not_found"), true);
  assert.equal(permanentRefreshFailure("temporary rate limited"), false);
});
