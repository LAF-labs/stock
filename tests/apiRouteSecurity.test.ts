import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import { GET as getQuote } from "../src/app/api/quote/route";
import { GET as getScore } from "../src/app/api/score/route";
import { GET as getBatchScore } from "../src/app/api/score/batch/route";
import { POST as postJudgment } from "../src/app/api/judgment/route";

const ENV_KEYS = [
  "VERCEL",
  "VERCEL_ENV",
  "STOCK_DATA_RUNTIME",
  "STOCK_ALLOW_MEMORY_GUARD_FALLBACK",
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "STOCK_RATE_LIMIT_SECRET",
  "STOCK_REFRESH_COOKIE_SECRET",
  "STOCK_ALLOWED_ORIGINS",
] as const;

const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;

function restoreEnv() {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  globalThis.fetch = originalFetch;
}

type StrictRequestInit = Omit<RequestInit, "headers" | "signal"> & {
  headers?: HeadersInit;
  signal?: AbortSignal;
};

function request(path: string, init: StrictRequestInit = {}): NextRequest {
  const headers = new Headers(init.headers);
  headers.set("x-real-ip", `203.0.113.${Math.floor(Math.random() * 200) + 1}`);
  return new NextRequest(`http://localhost${path}`, {
    ...init,
    headers,
  });
}

test.afterEach(restoreEnv);

test("stock API routes return JSON when production rate-limit secret is missing", async () => {
  restoreEnv();
  process.env.VERCEL = "1";
  process.env.VERCEL_ENV = "production";
  process.env.STOCK_DATA_RUNTIME = "snapshot";
  delete process.env.STOCK_RATE_LIMIT_SECRET;
  delete process.env.STOCK_ALLOW_MEMORY_GUARD_FALLBACK;

  const quote = await getQuote(request("/api/quote?ticker=US:KO"));
  const score = await getScore(request("/api/score?ticker=US:KO"));
  const batch = await getBatchScore(request("/api/score/batch?tickers=US:KO,US:NVDA"));
  const judgment = await postJudgment(
    request("/api/judgment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true }),
    })
  );

  for (const response of [quote, score, batch, judgment]) {
    assert.equal(response.status, 500);
    assert.match(response.headers.get("content-type") || "", /application\/json/);
    const payload = await response.json();
    assert.equal(payload.error, "server_misconfigured");
    assert.equal(payload.ok, false);
  }
});

test("quote route rejects missing and invalid API ticker input", async () => {
  restoreEnv();
  process.env.VERCEL = "1";
  process.env.STOCK_DATA_RUNTIME = "snapshot";
  process.env.STOCK_RATE_LIMIT_SECRET = "r".repeat(32);
  process.env.STOCK_REFRESH_COOKIE_SECRET = "c".repeat(32);

  const missing = await getQuote(request("/api/quote"));
  const invalid = await getQuote(request("/api/quote?ticker=bad%20spaces"));

  assert.equal(missing.status, 400);
  assert.equal((await missing.json()).error, "missing_ticker");
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error, "invalid_ticker");
  assert.match(missing.headers.get("Cache-Control") || "", /no-store/);
});

test("score route rejects missing and market-mismatched API ticker input", async () => {
  restoreEnv();
  process.env.VERCEL = "1";
  process.env.STOCK_DATA_RUNTIME = "snapshot";
  process.env.STOCK_RATE_LIMIT_SECRET = "r".repeat(32);
  process.env.STOCK_REFRESH_COOKIE_SECRET = "c".repeat(32);

  const missing = await getScore(request("/api/score"));
  const invalid = await getScore(request("/api/score?ticker=KR:ABC"));

  assert.equal(missing.status, 400);
  assert.equal((await missing.json()).error, "missing_ticker");
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error, "invalid_ticker");
  assert.match(invalid.headers.get("Cache-Control") || "", /no-store/);
});

test("stock API routes canonicalize deterministic aliases before rejecting strict input", async () => {
  restoreEnv();
  process.env.VERCEL = "1";
  process.env.STOCK_DATA_RUNTIME = "snapshot";
  process.env.STOCK_RATE_LIMIT_SECRET = "r".repeat(32);
  process.env.STOCK_REFRESH_COOKIE_SECRET = "c".repeat(32);
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_PUBLISHABLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  const score = await getScore(request("/api/score?ticker=BRK%2FB"));
  const quote = await getQuote(request("/api/quote?ticker=005930.KS"));
  const scorePayload = await score.json();
  const quotePayload = await quote.json();

  assert.notEqual(scorePayload.error, "invalid_ticker");
  assert.notEqual(quotePayload.error, "invalid_ticker");
  assert.equal(scorePayload.ticker, "US:BRK.B");
  assert.equal(quotePayload.ticker, "KR:005930");
});

test("stock API routes accept domestic alphanumeric master tickers", async () => {
  restoreEnv();
  process.env.VERCEL = "1";
  process.env.STOCK_DATA_RUNTIME = "snapshot";
  process.env.STOCK_RATE_LIMIT_SECRET = "r".repeat(32);
  process.env.STOCK_REFRESH_COOKIE_SECRET = "c".repeat(32);
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_PUBLISHABLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  const score = await getScore(request("/api/score?ticker=KR:0194M0"));
  const quote = await getQuote(request("/api/quote?ticker=KR:0194M0"));
  const scorePayload = await score.json();
  const quotePayload = await quote.json();

  assert.notEqual(scorePayload.error, "invalid_ticker");
  assert.notEqual(quotePayload.error, "invalid_ticker");
  assert.equal(scorePayload.ticker, "KR:0194M0");
  assert.equal(quotePayload.ticker, "KR:0194M0");
});

test("score route blocks technical analysis for derivative-like products before snapshot work", async () => {
  restoreEnv();
  process.env.VERCEL = "1";
  process.env.STOCK_DATA_RUNTIME = "snapshot";
  process.env.STOCK_RATE_LIMIT_SECRET = "r".repeat(32);
  process.env.STOCK_REFRESH_COOKIE_SECRET = "c".repeat(32);

  const response = await getScore(request("/api/score?ticker=US:KORU&view=technical"));
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error, "technical_unsupported_product");
  assert.equal(payload.ticker, "US:KORU");
  assert.equal(payload.redirect_to, "/?ticker=US%3AKORU");
  assert.match(response.headers.get("Cache-Control") || "", /no-store/);
});

test("score route blocks technical analysis for domestic derivative master tickers before snapshot work", async () => {
  restoreEnv();
  process.env.VERCEL = "1";
  process.env.STOCK_DATA_RUNTIME = "snapshot";
  process.env.STOCK_RATE_LIMIT_SECRET = "r".repeat(32);
  process.env.STOCK_REFRESH_COOKIE_SECRET = "c".repeat(32);

  const response = await getScore(request("/api/score?ticker=KR:0194M0&view=technical"));
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error, "technical_unsupported_product");
  assert.equal(payload.ticker, "KR:0194M0");
  assert.equal(payload.redirect_to, "/?ticker=KR%3A0194M0");
  assert.match(response.headers.get("Cache-Control") || "", /no-store/);
});

test("batch score rejects unsupported refresh before production rate limit guard", async () => {
  restoreEnv();
  process.env.VERCEL = "1";
  process.env.VERCEL_ENV = "production";
  process.env.STOCK_DATA_RUNTIME = "snapshot";
  delete process.env.STOCK_RATE_LIMIT_SECRET;
  delete process.env.STOCK_ALLOW_MEMORY_GUARD_FALLBACK;

  const response = await getBatchScore(request("/api/score/batch?tickers=US:KO&refresh=1"));
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error, "batch_refresh_unsupported");
  assert.match(response.headers.get("Cache-Control") || "", /no-store/);
});

test("batch score canonicalizes deterministic aliases and reports only unresolved invalid tickers", async () => {
  restoreEnv();
  process.env.VERCEL = "1";
  process.env.STOCK_DATA_RUNTIME = "snapshot";
  process.env.STOCK_RATE_LIMIT_SECRET = "r".repeat(32);
  process.env.STOCK_REFRESH_COOKIE_SECRET = "c".repeat(32);
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url.includes("/rest/v1/rpc/acquire_stock_api_rate_limit")) {
      return Response.json({ allowed: true, remaining: 44, reset_at: new Date(Date.now() + 60_000).toISOString() });
    }
    if (url.includes("/rest/v1/stock_score_snapshots")) {
      return Response.json([]);
    }
    if (url.includes("/rest/v1/rpc/enqueue_stock_refresh_job")) {
      return Response.json({ id: "job-1", status: "queued" });
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  const response = await getBatchScore(request("/api/score/batch?tickers=US:KO,bad%20spaces,US:BRK%2FB"));
  const payload = await response.json();

  assert.equal(response.status, 202);
  assert.equal(payload.ok, false);
  assert.deepEqual(
    payload.results.map((item: Record<string, unknown>) => ({
      requested_ticker: item.requested_ticker,
      error: item.error,
      ticker: item.ticker,
    })),
    [
      { requested_ticker: undefined, error: "snapshot_pending", ticker: "US:KO" },
      { requested_ticker: "bad spaces", error: "invalid_ticker", ticker: undefined },
      { requested_ticker: undefined, error: "snapshot_pending", ticker: "US:BRK.B" },
    ]
  );
  assert.match(response.headers.get("Cache-Control") || "", /no-store/);
});

test("judgment route requires JSON content type", async () => {
  restoreEnv();
  process.env.STOCK_RATE_LIMIT_SECRET = "r".repeat(32);

  const response = await postJudgment(
    request("/api/judgment", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "{}",
    })
  );

  assert.equal(response.status, 415);
  assert.equal((await response.json()).error, "unsupported_media_type");
});

test("judgment route rejects cross-site browser writes before reading stock payload", async () => {
  restoreEnv();
  process.env.STOCK_RATE_LIMIT_SECRET = "r".repeat(32);

  const response = await postJudgment(
    request("/api/judgment", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://attacker.example",
        "Sec-Fetch-Site": "cross-site",
      },
      body: JSON.stringify({ ok: true }),
    })
  );

  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "cross_site_request");
});

test("judgment route accepts same-origin browser writes with null origin and same-origin referer", async () => {
  restoreEnv();
  process.env.STOCK_RATE_LIMIT_SECRET = "r".repeat(32);

  const response = await postJudgment(
    request("/api/judgment", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "null",
        Referer: "http://localhost/?ticker=US:KO",
      },
      body: JSON.stringify({ ok: true }),
    })
  );

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "invalid_stock_payload");
});

test("judgment route accepts same-origin browser writes when request url and host use loopback aliases", async () => {
  restoreEnv();
  process.env.STOCK_RATE_LIMIT_SECRET = "r".repeat(32);

  const response = await postJudgment(
    request("/api/judgment", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Host: "127.0.0.1:3000",
        Origin: "http://127.0.0.1:3000",
        Referer: "http://127.0.0.1:3000/?ticker=US:KO",
      },
      body: JSON.stringify({ ok: true }),
    })
  );

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "invalid_stock_payload");
});

test("judgment route accepts configured production allowed origins", async () => {
  restoreEnv();
  process.env.STOCK_RATE_LIMIT_SECRET = "r".repeat(32);
  process.env.STOCK_ALLOWED_ORIGINS = "https://stock.example.com";

  const response = await postJudgment(
    request("/api/judgment", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Host: "localhost",
        Origin: "https://stock.example.com",
        Referer: "https://stock.example.com/?ticker=US:KO",
      },
      body: JSON.stringify({ ok: true }),
    })
  );

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "invalid_stock_payload");
});

test("judgment route rejects Host-spoofed origins when allowed origins are configured", async () => {
  restoreEnv();
  process.env.STOCK_RATE_LIMIT_SECRET = "r".repeat(32);
  process.env.STOCK_ALLOWED_ORIGINS = "https://stock.example.com";

  const response = await postJudgment(
    request("/api/judgment", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Host: "attacker.example",
        Origin: "http://attacker.example",
        Referer: "http://attacker.example/?ticker=US:KO",
      },
      body: JSON.stringify({ ok: true }),
    })
  );

  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "cross_site_request");
});

test("judgment route rejects null-origin browser writes without same-origin referer", async () => {
  restoreEnv();
  process.env.STOCK_RATE_LIMIT_SECRET = "r".repeat(32);

  const response = await postJudgment(
    request("/api/judgment", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "null",
      },
      body: JSON.stringify({ ok: true }),
    })
  );

  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "cross_site_request");
});
