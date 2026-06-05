import test from "node:test";
import assert from "node:assert/strict";
import {
  buildJudgmentJobRequest,
  enqueueJudgmentJob,
  judgmentJobsEnabled,
} from "../src/lib/judgmentJobQueue";
import { judgmentCacheKeyFor } from "../src/lib/aiJudgmentCache";

const originalFetch = globalThis.fetch;
const originalEnv = {
  STOCK_AI_JUDGMENT_ASYNC: process.env.STOCK_AI_JUDGMENT_ASYNC,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
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

test("judgment jobs are opt-in", () => {
  delete process.env.STOCK_AI_JUDGMENT_ASYNC;
  assert.equal(judgmentJobsEnabled(), false);

  process.env.STOCK_AI_JUDGMENT_ASYNC = "1";
  assert.equal(judgmentJobsEnabled(), true);
});

test("judgment job request carries six-hour cache bucket metadata", () => {
  const now = new Date("2026-06-05T05:59:00.000Z");
  const cacheKey = judgmentCacheKeyFor("gpt-5-mini", now, "stock-judge-v3");
  const request = buildJudgmentJobRequest({
    ticker: "KO",
    stock: { market: "US", symbol: "KO", score: 72.4 },
    cacheDate: "2026-06-05",
    cacheKey,
    cacheBucketStart: "2026-06-05T00:00:00.000Z",
    model: "gpt-5-mini",
    promptVersion: "stock-judge-v3",
  });

  assert.equal(request.p_kind, "judgment");
  assert.equal(request.p_market, "US");
  assert.equal(request.p_symbol, "KO");
  assert.equal(request.p_payload.cache_key, cacheKey);
  assert.equal(request.p_payload.cache_bucket_start, "2026-06-05T00:00:00.000Z");
});

test("enqueue judgment job calls Supabase RPC", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";

  let requestedUrl = "";
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requestedUrl = String(input);
    requestBody = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        id: "job-id",
        kind: "judgment",
        market: "US",
        symbol: "KO",
        status: "queued",
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  const job = await enqueueJudgmentJob({
    ticker: "KO",
    stock: { market: "US", symbol: "KO", score: 72.4 },
    cacheDate: "2026-06-05",
    cacheKey: "gpt-5-mini:stock-judge-v3:2026-06-05T00:00:00.000Z",
    cacheBucketStart: "2026-06-05T00:00:00.000Z",
    model: "gpt-5-mini",
    promptVersion: "stock-judge-v3",
  });

  assert.equal(requestedUrl, "https://example.supabase.co/rest/v1/rpc/enqueue_stock_refresh_job");
  assert.equal(requestBody?.p_kind, "judgment");
  assert.equal(job?.id, "job-id");
});
