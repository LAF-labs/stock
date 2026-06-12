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
  publishQueueJobWithCollector,
  retryAfterSeconds,
  resolveWarmTickers,
  rowHasBlockingErrors,
  selectWarmTickerBatch,
  mergeWarmTickerPool,
  maybeUpsertChartSnapshotFromTechnicalPayload,
  drainRefreshJobs,
  upsertChartSnapshot,
  run,
  upsertQuoteSnapshot,
} from "../scripts/publish_stock_snapshots";
import { RUNTIME_RPC_CHECKS, RUNTIME_TABLE_CHECKS } from "../scripts/supabase_runtime_readiness";

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
  assert.equal(options.queueConcurrency, 1);
});

test("TypeScript snapshot worker parses queue concurrency from env and CLI", () => {
  assert.equal(parseOptions(["--drain-queue", "--kind", "quote"], { STOCK_SNAPSHOT_QUEUE_CONCURRENCY: "4" }).queueConcurrency, 4);
  assert.equal(parseOptions(["--drain-queue", "--kind", "quote", "--queue-concurrency", "2"], { STOCK_SNAPSHOT_QUEUE_CONCURRENCY: "4" }).queueConcurrency, 2);
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

test("TypeScript snapshot worker drains independent queue jobs with bounded concurrency", async () => {
  let active = 0;
  let maxActive = 0;
  const options = parseOptions(["--drain-queue", "--kind", "quote", "--queue-concurrency", "2", "--sleep-seconds", "0"], {});

  const rows = await drainRefreshJobs(
    [
      { id: "job-1", kind: "quote", market: "US", symbol: "A" },
      { id: "job-2", kind: "quote", market: "US", symbol: "B" },
      { id: "job-3", kind: "quote", market: "US", symbol: "C" },
      { id: "job-4", kind: "quote", market: "US", symbol: "D" },
    ],
    { url: "https://example.supabase.co", key: "service-role-key" },
    options,
    async (job) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return { job_id: job.id, status: "succeeded" };
    }
  );

  assert.equal(maxActive, 2);
  assert.deepEqual(rows.map((row) => row.job_id), ["job-1", "job-2", "job-3", "job-4"]);
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
	  const row = await publishQueueJobWithCollector(
	    { id: "job-1", kind: "score", market: "US", symbol: "NVDA", view_mode: "bogus", attempts: 1 },
	    { url: "https://example.supabase.co", key: "service-role-key" },
	    options,
	    async () => {
	      throw new Error("collector_should_not_be_called");
	    }
	  );

  assert.equal(row.status, "failed");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://example.supabase.co/rest/v1/rpc/fail_stock_refresh_job");
  assert.equal(calls[0].body.p_job_id, "job-1");
  assert.equal(calls[0].body.p_permanent, true);
  assert.match(String(calls[0].body.p_error), /unsupported score view/);
});

test("TypeScript snapshot worker retries provider misses instead of creating dead jobs", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input, init) => {
    calls.push({
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : {},
    });
    return new Response(null, { status: 204 });
  }) as typeof fetch;

  const options = parseOptions(["--drain-queue", "--kind", "score", "--allow-score-python-fallback", "--worker-id", "worker-1"], {});
  const row = await publishQueueJobWithCollector(
    { id: "job-aplt", kind: "score", market: "US", symbol: "APLT", view_mode: "compare", attempts: 1 },
    { url: "https://example.supabase.co", key: "service-role-key" },
    options,
    async () => {
      throw new Error("kis_not_found");
    }
  );

  const failCall = calls.find((call) => call.url.endsWith("/rest/v1/rpc/fail_stock_refresh_job"));
  assert.equal(row.status, "failed");
  assert.ok(failCall);
  assert.equal(failCall.body.p_job_id, "job-aplt");
  assert.equal(failCall.body.p_permanent, false);
  assert.equal(failCall.body.p_retry_after_seconds, 120);
});

test("TypeScript snapshot worker fails ok false score payloads instead of completing empty snapshots", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input, init) => {
    calls.push({
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : {},
    });
    return new Response(null, { status: 204 });
  }) as typeof fetch;

  const options = parseOptions(["--drain-queue", "--kind", "score", "--allow-score-python-fallback", "--worker-id", "worker-1"], {});
  const row = await publishQueueJobWithCollector(
    { id: "job-vld", kind: "score", market: "US", symbol: "VLD", view_mode: "detail", attempts: 1 },
    { url: "https://example.supabase.co", key: "service-role-key" },
    options,
    async () => ({
      payload: {
        ok: false,
        status: 404,
        error: "kis_not_found",
        message: "not found",
      },
    })
  );

  const failCall = calls.find((call) => call.url.endsWith("/rest/v1/rpc/fail_stock_refresh_job"));
  const completeCall = calls.find((call) => call.url.endsWith("/rest/v1/rpc/complete_stock_refresh_job"));
  assert.equal(row.status, "failed");
  assert.ok(failCall);
  assert.equal(completeCall, undefined);
  assert.equal(failCall.body.p_job_id, "job-vld");
  assert.equal(failCall.body.p_error, "kis_not_found");
  assert.equal(failCall.body.p_permanent, false);
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
  assert.equal(
    rowHasBlockingErrors({
      ticker: "US:NVDA",
      quote: "error",
      errors: [{ kind: "quote", error: "NAS: fetch failed; NYS: fetch failed; AMS: fetch failed" }],
    }),
    false
  );
});

test("TypeScript snapshot worker treats persisted queue job failures as handled retries", async () => {
  const envKeys = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "STOCK_API_APP_KEY", "STOCK_API_APP_SECRET", "STOCK_API_BASE"] as const;
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ url, body });
    if (url.endsWith("/rest/v1/rpc/stock_runtime_readiness")) {
      return Response.json({
        ok: true,
        required_tables: [...RUNTIME_TABLE_CHECKS],
        required_rpcs: [...RUNTIME_RPC_CHECKS],
        missing_rpc_grants: [],
      });
    }
    if (url.endsWith("/rest/v1/rpc/claim_stock_refresh_jobs_by_kind")) {
      return Response.json([{ id: "job-1", kind: "quote", market: "US", symbol: "FAILQ", attempts: 1 }]);
    }
    if (url.includes("/rest/v1/stock_quote_snapshots")) {
      return Response.json([]);
    }
    if (url.endsWith("/rest/v1/rpc/acquire_stock_refresh_lease")) {
      return Response.json({ acquired: true });
    }
    if (url.endsWith("/rest/v1/rpc/fail_stock_refresh_job")) {
      return new Response(null, { status: 204 });
    }
    if (url.endsWith("/rest/v1/rpc/acquire_stock_api_rate_limit")) {
      return Response.json({ allowed: true, remaining: 119, reset_at: new Date(Date.now() + 60_000).toISOString() });
    }
    if (url.includes("/rest/v1/kis_access_tokens")) {
      return Response.json([]);
    }
    if (url.endsWith("/rest/v1/rpc/acquire_kis_token_issue_lock")) {
      return Response.json({ acquired: true });
    }
    if (url.startsWith("https://kis.example/")) {
      throw new Error("provider network failed");
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;

  try {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    process.env.STOCK_API_APP_KEY = "app-key";
    process.env.STOCK_API_APP_SECRET = "app-secret";
    process.env.STOCK_API_BASE = "https://kis.example";

    const payload = await run(
      parseOptions(["--drain-queue", "--kind", "quote", "--worker-id", "worker-1", "--queue-limit", "1", "--no-warm-from-demand"])
    );

    assert.equal(payload.ok, true);
    assert.equal(payload.queue_rows.length, 1);
    assert.equal(payload.queue_rows[0].status, "failed");
    assert.equal(calls.some((call) => call.url.endsWith("/rest/v1/rpc/fail_stock_refresh_job")), true);
  } finally {
    for (const key of envKeys) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
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

test("TypeScript snapshot worker can reuse technical score payload for chart snapshots", async () => {
  let capturedUrl = "";
  let capturedBody: Record<string, unknown> | undefined;
  globalThis.fetch = (async (input, init) => {
    capturedUrl = String(input);
    capturedBody = JSON.parse(String(init?.body));
    return new Response(null, { status: 201 });
  }) as typeof fetch;

  await maybeUpsertChartSnapshotFromTechnicalPayload(
    { url: "https://example.supabase.co", key: "service-role-key" },
    "US:KO",
    "technical",
    {
      ok: true,
      requested_ticker: "US:KO",
      market: "US",
      symbol: "KO",
      name: "Coca-Cola",
      chart_series: [{ date: "2026-06-08", close: 72.25 }],
      debug_secret: "do-not-store",
    },
    1780939500000
  );

  assert.equal(capturedUrl, "https://example.supabase.co/rest/v1/stock_chart_snapshots?on_conflict=ticker,source");
  assert.equal(capturedBody?.ticker, "US:KO");
  assert.equal(capturedBody?.last_bar_date, "2026-06-08");
  assert.equal((capturedBody?.payload as Record<string, unknown>).source_payload, "technical_fast_path");
  assert.equal("debug_secret" in ((capturedBody?.payload as Record<string, unknown>) || {}), false);
});

test("TypeScript snapshot worker does not chart-upsert non-technical score payloads", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(null, { status: 201 });
  }) as typeof fetch;

  await maybeUpsertChartSnapshotFromTechnicalPayload(
    { url: "https://example.supabase.co", key: "service-role-key" },
    "US:KO",
    "detail",
    {
      ok: true,
      chart_series: [{ date: "2026-06-08", close: 72.25 }],
    },
    1780939500000
  );

  assert.equal(calls, 0);
});

test("TypeScript snapshot worker does not fail technical score jobs when chart series is absent", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(null, { status: 201 });
  }) as typeof fetch;

  await maybeUpsertChartSnapshotFromTechnicalPayload(
    { url: "https://example.supabase.co", key: "service-role-key" },
    "US:NEW",
    "technical",
    { ok: true, requested_ticker: "US:NEW" },
    1780939500000
  );

  assert.equal(calls, 0);
});

test("TypeScript snapshot worker completes technical score jobs when optional chart upsert fails", async () => {
  const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    if (url.includes("/rest/v1/stock_chart_snapshots")) {
      return new Response("chart write down", { status: 500 });
    }
    return Response.json({});
  }) as typeof fetch;

  const options = parseOptions(["--drain-queue", "--kind", "score", "--allow-score-python-fallback", "--worker-id", "worker-1"], {});
  const row = await publishQueueJobWithCollector(
    { id: "job-technical", kind: "score", market: "US", symbol: "KO", view_mode: "technical", attempts: 1 },
    { url: "https://example.supabase.co", key: "service-role-key" },
    options,
    async () =>
      ({
        payload: {
          ok: true,
          requested_ticker: "US:KO",
          market: "US",
          symbol: "KO",
          score_model_version: "score-v5-dual-quality-opportunity-2026-06-05",
          technical_analysis: { type: "technical_analysis" },
          chart_series: [{ date: "2026-06-08", close: 72.25 }],
        },
      }) as any
  );

  assert.equal(row.status, "succeeded");
  assert.ok(calls.some((call) => call.url.includes("/rest/v1/stock_chart_snapshots")));
  assert.ok(calls.some((call) => call.url.includes("/rest/v1/rpc/complete_stock_refresh_job")));
  assert.equal(calls.some((call) => call.url.includes("/rest/v1/rpc/fail_stock_refresh_job")), false);
});

test("TypeScript snapshot worker completes chart jobs without collector when chart snapshot is already fresh", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousPublishable = process.env.SUPABASE_PUBLISHABLE_KEY;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-key";

  const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    if (url.includes("/rest/v1/stock_chart_snapshots")) {
      return Response.json([
        {
          ticker: "US:KO",
          payload: {
            ok: true,
            type: "chart",
            requested_ticker: "US:KO",
            market: "US",
            symbol: "KO",
            chart_series: [{ date: "2026-06-08", close: 72.25 }],
          },
          fetched_at: new Date(Date.now() - 10_000).toISOString(),
          expires_at: new Date(Date.now() + 300_000).toISOString(),
          stale_expires_at: new Date(Date.now() + 2_592_000_000).toISOString(),
          last_bar_date: "2026-06-08",
        },
      ]);
    }
    return Response.json({});
  }) as typeof fetch;

  try {
    const options = parseOptions(["--drain-queue", "--kind", "chart", "--worker-id", "worker-chart"], {});
    const row = await publishQueueJob(
      { id: "job-chart", kind: "chart", market: "US", symbol: "KO", attempts: 1 },
      { url: "https://example.supabase.co", key: "service-role-key" },
      options
    );

    assert.equal(row.status, "succeeded");
    assert.ok(calls.some((call) => call.url.includes("/rest/v1/rpc/complete_stock_refresh_job")));
    assert.equal(calls.some((call) => call.url.includes("/rest/v1/rpc/fail_stock_refresh_job")), false);
    assert.equal(calls.filter((call) => call.url.includes("/rest/v1/stock_chart_snapshots")).length, 1);
  } finally {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousPublishable === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY;
    else process.env.SUPABASE_PUBLISHABLE_KEY = previousPublishable;
  }
});

test("TypeScript snapshot worker keeps retry and permanent failure contracts", () => {
  assert.equal(retryAfterSeconds({ attempts: 1 }), 120);
  assert.equal(retryAfterSeconds({ attempts: 20 }), 3600);
  assert.equal(permanentRefreshFailure("kis_not_found"), false);
  assert.equal(permanentRefreshFailure("KIS HTTP 404"), false);
  assert.equal(permanentRefreshFailure("temporary rate limited"), false);
  assert.equal(permanentRefreshFailure("invalid_ticker"), true);
  assert.equal(permanentRefreshFailure("unsupported score view: bogus"), true);
});
