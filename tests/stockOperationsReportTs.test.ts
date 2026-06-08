import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SCORE_MODEL_VERSION,
  evaluateOperationsThresholds,
  fetchMarketDataServiceStatus,
  fetchSupabaseReport,
  freshnessRiskSummary,
  marketDataServiceRequired,
  parseOperationsOptions,
  summarizeIndustryBenchmarks,
  summarizeQueueRows,
  summarizeQuoteSnapshots,
  summarizeScoreSnapshots,
  type SupabaseReportConfig,
} from "../scripts/stock_operations_report";

test("TypeScript operations report summarizes queue backlog and stale locks", () => {
  const summary = summarizeQueueRows(
    [
      { kind: "score", status: "queued", jobs: 12, oldest_run_after: "2026-06-05T11:00:00+00:00", stale_running_jobs: 0 },
      { kind: "quote", status: "running", jobs: 3, oldest_run_after: "2026-06-05T11:10:00+00:00", stale_running_jobs: 2 },
      { kind: "score", status: "dead", jobs: 1, oldest_run_after: "2026-06-05T10:30:00+00:00", stale_running_jobs: 0 },
      { kind: "chart", status: "queued", jobs: 2, oldest_run_after: "2026-06-05T11:20:00+00:00", stale_running_jobs: 0 },
    ],
    new Date("2026-06-05T11:30:00+00:00")
  );

  assert.equal(summary.total_jobs, 18);
  assert.equal(summary.queued_jobs, 14);
  assert.equal(summary.running_jobs, 3);
  assert.equal(summary.dead_jobs, 1);
  assert.equal(summary.stale_running_jobs, 2);
  assert.equal(summary.oldest_due_age_minutes, 60.0);
  assert.deepEqual(summary.oldest_due_age_minutes_by_kind, { score: 60.0, quote: 20.0, chart: 10.0 });
  assert.equal(summary.by_status.queued, 14);
  assert.equal(summary.by_kind.score, 13);
});

test("TypeScript operations report catches duplicate scores and low-confidence high scores", () => {
  const rows = [
    scoreRow("US:NVDA", 87.14, 87.14, 72.0, 0.91, "2026-06-05T23:30:00+00:00"),
    scoreRow("US:MSFT", 87.12, 87.12, 61.0, 0.88, "2026-06-05T23:31:00+00:00"),
    scoreRow("KR:005930", 64.0, 64.0, 55.0, 0.72, "2026-06-05T23:35:00+00:00"),
    scoreRow("US:SPARSE", 67.0, 67.0, 58.0, 0.31, "2026-06-05T23:36:00+00:00"),
    scoreRow("US:OLD", 50.0, 50.0, 52.0, 0.6, "2026-06-04T20:00:00+00:00", "old-model"),
  ];

  const summary = summarizeScoreSnapshots(rows, DEFAULT_SCORE_MODEL_VERSION, new Date("2026-06-06T00:00:00+00:00"), 24);

  assert.equal(summary.total_snapshots, 5);
  assert.equal(summary.current_model_snapshots, 4);
  assert.equal(summary.current_model_rate, 0.8);
  assert.equal(summary.stale_snapshots, 1);
  assert.equal(summary.low_confidence_high_score_count, 1);
  assert.equal(summary.duplicate_score_bucket_count, 1);
  assert.equal(summary.max_duplicate_bucket_size, 2);
  assert.equal(summary.top_duplicate_scores[0].score, 87.1);
});

test("TypeScript operations report ignores same-ticker score duplicates across views", () => {
  const rows = [
    scoreRow("US:NVDA", 71.4, 71.4, 62.0, 0.9, "2026-06-05T23:30:00+00:00", DEFAULT_SCORE_MODEL_VERSION, "detail"),
    scoreRow("US:NVDA", 71.4, 71.4, 62.0, 0.9, "2026-06-05T23:31:00+00:00", DEFAULT_SCORE_MODEL_VERSION, "compare"),
    scoreRow("US:NVDA", 71.4, 71.4, 62.0, 0.9, "2026-06-05T23:32:00+00:00", DEFAULT_SCORE_MODEL_VERSION, "technical"),
  ];

  const summary = summarizeScoreSnapshots(rows, DEFAULT_SCORE_MODEL_VERSION, new Date("2026-06-06T00:00:00+00:00"), 24);

  assert.equal(summary.score_snapshot_count, 3);
  assert.equal(summary.duplicate_score_bucket_count, 0);
  assert.equal(summary.duplicate_score_rate, 0);
  assert.equal(summary.max_duplicate_bucket_size, 0);
});

test("TypeScript operations report summarizes technical snapshots separately", () => {
  const rows = [
    scoreRow("US:NVDA", 87.14, 87.14, 72.0, 0.91, "2026-06-05T23:30:00+00:00"),
    technicalRow("US:NVDA", true, "2026-06-05T23:40:00+00:00", "2026-06-06T02:00:00+00:00"),
    technicalRow("US:OLDTECH", false, "2026-06-04T20:00:00+00:00", "2026-06-05T02:00:00+00:00"),
  ];

  const summary = summarizeScoreSnapshots(rows, DEFAULT_SCORE_MODEL_VERSION, new Date("2026-06-06T00:00:00+00:00"), 24);

  assert.equal(summary.total_snapshots, 3);
  assert.equal(summary.by_view.detail, 1);
  assert.equal(summary.by_view.technical, 2);
  assert.equal(summary.technical_snapshots, 2);
  assert.equal(summary.stale_technical_snapshots, 1);
  assert.equal(summary.missing_technical_payload_count, 1);
  assert.equal(summary.missing_technical_payload_rate, 0.5);
  assert.equal(summary.score_snapshot_count, 1);
  assert.equal(summary.duplicate_score_rate, 0);
});

test("TypeScript operations report summarizes quotes and industry benchmarks", () => {
  const now = new Date("2026-06-06T00:00:00+00:00");
  const quotes = summarizeQuoteSnapshots(
    [
      quoteRow("US:NVDA", 120.0, "2026-06-05T23:59:00+00:00", "2026-06-06T00:04:00+00:00"),
      quoteRow("KR:005930", null, "2026-06-05T20:00:00+00:00", "2026-06-05T20:05:00+00:00"),
    ],
    now,
    2
  );
  const benchmarks = summarizeIndustryBenchmarks(
    [
      { metric: "forward_per", source: "finviz_industry", sample_count: 8, as_of_date: "2026-06-05", expires_at: "2026-06-07T00:00:00+00:00" },
      { metric: "per", source: "score_snapshot", sample_count: 3, as_of_date: "2026-06-04", expires_at: "2026-06-05T00:00:00+00:00" },
    ],
    now
  );

  assert.equal(quotes.total_snapshots, 2);
  assert.equal(quotes.stale_snapshots, 1);
  assert.equal(quotes.missing_price_count, 1);
  assert.equal(quotes.by_market.US, 1);
  assert.equal(quotes.by_market.KR, 1);
  assert.equal(benchmarks.expired_rows, 1);
  assert.equal(benchmarks.low_sample_rows, 1);
  assert.equal(benchmarks.oldest_as_of_date, "2026-06-04");
  assert.equal(benchmarks.newest_as_of_date, "2026-06-05");
});

test("TypeScript operations report evaluates thresholds", () => {
  const result = evaluateOperationsThresholds(
    {
      refresh_queue: { total_jobs: 30, queued_jobs: 28, dead_jobs: 1, stale_running_jobs: 0 },
      score_calibration: {
        stale_snapshots: 3,
        current_model_rate: 0.75,
        duplicate_score_rate: 0.42,
        low_confidence_high_score_count: 2,
        missing_technical_payload_count: 1,
      },
      quote_freshness: { stale_rate: 0.1, missing_price_count: 0 },
      industry_benchmarks: { expired_rows: 0, low_sample_rows: 0 },
      market_calendar: { missing_or_thin_markets: ["KR"] },
    },
    {
      max_dead_refresh_jobs: 0,
      max_queued_refresh_jobs: 100,
      min_current_score_model_rate: 0.9,
      max_duplicate_score_rate: 0.5,
      max_missing_technical_payloads: 0,
      max_market_calendar_thin_markets: 0,
    }
  );

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.violations.map((violation) => violation.key),
    ["max_dead_refresh_jobs", "min_current_score_model_rate", "max_missing_technical_payloads", "max_market_calendar_thin_markets"]
  );
});

test("TypeScript operations report separates freshness risks from threshold pass", () => {
  const risks = freshnessRiskSummary({
    refresh_queue: { oldest_due_age_minutes: 75, queued_jobs: 3 },
    score_calibration: { stale_snapshots: 4 },
    quote_freshness: { stale_rate: 1, stale_snapshots: 13, total_snapshots: 13 },
    thresholds: { ok: true, violations: [] },
  });

  assert.equal(risks.ok, false);
  assert.equal(risks.thresholds_ok, true);
  assert.deepEqual(
    risks.warnings.map((warning) => warning.key),
    ["quote_stale_rate", "refresh_queue_due_age"]
  );
});

test("TypeScript operations report checks configured market-data health and metrics", async () => {
  const calls: Array<{ url: string; authorization: string | null }> = [];
  const originalFetch = global.fetch;
  global.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, authorization: new Headers(init?.headers).get("authorization") });
    if (url.endsWith("/healthz")) {
      return jsonResponse({ ok: true, service: "market-data", dependencies: { supabase_configured: true } });
    }
    if (url.endsWith("/readyz")) {
      return jsonResponse({
        ok: true,
        service: "market-data",
        score: { durable_refresh_available: false },
        backends: { cache: { active: "memory" }, queue: { active: "memory" } },
      });
    }
    if (url.endsWith("/metrics")) {
      return new Response("market_data_service_info 1\n", { status: 200, headers: { "Content-Type": "text/plain" } });
    }
    return jsonResponse({ error: "unexpected" }, 404);
  };

  try {
    const status = await fetchMarketDataServiceStatus({
      url: "http://market-data.internal/",
      token: "internal-token",
      timeoutMs: 1000,
    });

    assert.equal(status.configured, true);
    assert.equal(status.ok, true);
    assert.equal(status.failure_count, 0);
    assert.equal(calls[0].url, "http://market-data.internal/healthz");
    assert.equal(calls[1].url, "http://market-data.internal/readyz");
    assert.equal(calls[1].authorization, "Bearer internal-token");
    assert.equal(calls[2].url, "http://market-data.internal/metrics");
    assert.equal(calls[2].authorization, "Bearer internal-token");
    assert.deepEqual(status.readiness, {
      ok: true,
      status: 200,
      score: { durable_refresh_available: false },
      backends: { cache: { active: "memory" }, queue: { active: "memory" } },
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("TypeScript operations report fails required market-data config when URL or token is missing", async () => {
  const status = await fetchMarketDataServiceStatus({
    timeoutMs: 1000,
    required: true,
  });

  assert.equal(status.configured, false);
  assert.equal(status.ok, false);
  assert.equal(status.failure_count, 1);
  assert.deepEqual(status.failures[0].missing, ["MARKET_DATA_SERVICE_URL", "MARKET_DATA_INTERNAL_TOKEN"]);
});

test("TypeScript operations report can threshold market-data service failures", () => {
  const result = evaluateOperationsThresholds(
    {
      market_data_service: { configured: true, ok: false, failure_count: 1 },
    },
    {
      max_market_data_service_failures: 0,
    }
  );

  assert.equal(result.ok, false);
  assert.deepEqual(result.violations.map((violation) => violation.key), ["max_market_data_service_failures"]);
});

test("TypeScript operations report does not require absent market-data config just because a threshold exists", () => {
  const optional = parseOperationsOptions(["--max-market-data-service-failures", "0"], {});
  const partial = parseOperationsOptions(["--max-market-data-service-failures", "0"], {
    MARKET_DATA_SERVICE_URL: "https://market-data.example.internal",
  });
  const explicit = parseOperationsOptions(["--require-market-data-service"], {});

  assert.equal(marketDataServiceRequired(optional), false);
  assert.equal(marketDataServiceRequired(partial), true);
  assert.equal(marketDataServiceRequired(explicit), true);
});

test("TypeScript operations report fetches Supabase report through REST only", async () => {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const originalFetch = global.fetch;
  global.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, method: init?.method || "GET", body: init?.body?.toString() });
    if (url.includes("/rest/v1/rpc/stock_operations_report")) {
      return jsonResponse({ refresh_queue: [{ kind: "score", status: "queued", jobs: 2 }] });
    }
    if (url.includes("/rest/v1/stock_score_snapshots?")) {
      return jsonResponse([
        scoreRow("US:NVDA", 88, 88, 70, 0.9, "2026-06-05T23:00:00+00:00"),
        technicalRow("US:NVDA", true, "2026-06-05T23:05:00+00:00", "2026-06-06T02:00:00+00:00"),
      ]);
    }
    if (url.includes("/rest/v1/stock_quote_snapshots?")) {
      return jsonResponse([quoteRow("US:NVDA", 120.0, "2026-06-05T23:58:00+00:00", "2026-06-06T00:03:00+00:00")]);
    }
    if (url.includes("/rest/v1/stock_industry_benchmarks?")) {
      return jsonResponse([{ metric: "forward_per", source: "finviz_industry", sample_count: 8, as_of_date: "2026-06-05", expires_at: "2026-06-07T00:00:00+00:00" }]);
    }
    if (url.includes("/rest/v1/market_calendar?")) {
      return jsonResponse([{ market: "US", trade_date: "2026-06-08", is_open: true }]);
    }
    return jsonResponse({ error: "unexpected" }, 404);
  };

  try {
    const config: SupabaseReportConfig = { url: "https://example.supabase.co", key: "service-role-key", timeoutMs: 9000 };
    const payload = await fetchSupabaseReport(config, 50, 24);

    assert.equal(payload.refresh_queue.queued_jobs, 2);
    assert.equal(payload.score_calibration.total_snapshots, 2);
    assert.equal(payload.score_calibration.technical_snapshots, 1);
    assert.equal(payload.quote_freshness.total_snapshots, 1);
    assert.equal(payload.industry_benchmarks.total_rows, 1);
    assert.equal(payload.market_calendar.total_rows, 1);
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].url, "https://example.supabase.co/rest/v1/rpc/stock_operations_report");
    assert.equal(calls[0].body, '{"p_score_stale_hours":24}');
    assert.match(calls[1].url, /stock_score_snapshots/);
    assert.match(calls[1].url, /limit=50/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("TypeScript operations option parser keeps threshold contract", () => {
  const options = parseOperationsOptions([
    "--json",
    "--fail-on-threshold",
    "--sample-limit",
    "100",
    "--max-dead-refresh-jobs",
    "0",
    "--min-current-score-model-rate",
    "0.95",
    "--max-missing-technical-payloads",
    "0",
  ]);

  assert.equal(options.json, true);
  assert.equal(options.failOnThreshold, true);
  assert.equal(options.sampleLimit, 100);
  assert.equal(options.thresholds.max_dead_refresh_jobs, 0);
  assert.equal(options.thresholds.min_current_score_model_rate, 0.95);
  assert.equal(options.thresholds.max_missing_technical_payloads, 0);
});

function scoreRow(
  ticker: string,
  score: number,
  quality: number,
  opportunity: number,
  confidence: number,
  fetchedAt: string,
  version = DEFAULT_SCORE_MODEL_VERSION,
  viewMode = "detail"
) {
  return {
    ticker,
    view_mode: viewMode,
    fetched_at: fetchedAt,
    expires_at: "2026-06-06T02:00:00+00:00",
    score_model_version: version,
    payload: {
      score,
      quality_score: quality,
      opportunity_score: opportunity,
      opportunity_confidence: 0.7,
      score_model_version: version,
      sia_snapshot: {
        confidence,
        quality_score: quality,
        opportunity_score: opportunity,
        score_model_version: version,
      },
    },
  };
}

function technicalRow(ticker: string, hasPayload: boolean, fetchedAt: string, expiresAt: string) {
  return {
    ticker,
    view_mode: "technical",
    fetched_at: fetchedAt,
    expires_at: expiresAt,
    score_model_version: DEFAULT_SCORE_MODEL_VERSION,
    payload: {
      ok: true,
      score_model_version: DEFAULT_SCORE_MODEL_VERSION,
      ...(hasPayload ? { technical_analysis: { type: "technical_analysis", status: "ready" } } : {}),
    },
  };
}

function quoteRow(ticker: string, latestPrice: number | null, fetchedAt: string, expiresAt: string) {
  return {
    ticker,
    fetched_at: fetchedAt,
    expires_at: expiresAt,
    payload: {
      market: ticker.startsWith("KR:") ? "KR" : "US",
      latest_price: latestPrice,
      server_cache: { state: "fresh" },
    },
  };
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}
