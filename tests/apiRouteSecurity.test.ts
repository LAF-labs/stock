import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import { GET as getQuote } from "../src/app/api/quote/route";
import { GET as getScore } from "../src/app/api/score/route";
import { POST as postJudgment } from "../src/app/api/judgment/route";

const ENV_KEYS = [
  "VERCEL",
  "STOCK_DATA_RUNTIME",
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "STOCK_RATE_LIMIT_SECRET",
  "STOCK_REFRESH_COOKIE_SECRET",
] as const;

const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function restoreEnv() {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
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
