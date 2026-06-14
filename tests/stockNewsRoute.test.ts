import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import { GET } from "../src/app/api/stock/news/route";

const ENV_KEYS = [
  "NAVER_SEARCH_CLIENT_ID",
  "NAVER_SEARCH_CLIENT_SECRET",
  "NAVER_CLIENT_ID",
  "NAVER_CLIENT_SECRET",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const originalFetch = global.fetch;

function restoreEnv() {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  global.fetch = originalFetch;
}

function clearEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
  });
}

test.afterEach(restoreEnv);

test("stock news route reports unconfigured Naver credentials without provider calls", async () => {
  clearEnv();
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    return jsonResponse({ items: [] });
  };

  const response = await GET(new NextRequest("http://localhost/api/stock/news?ticker=KR:005930"));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("Cache-Control") || "", /no-store/);
  assert.equal(fetchCalls, 0);
  assert.equal(payload.ok, false);
  assert.equal(payload.error, "naver_news_not_configured");
  assert.deepEqual(payload.items, []);
});

test("stock news route returns Naver news items without caching them", async () => {
  clearEnv();
  process.env.NAVER_SEARCH_CLIENT_ID = "client-id";
  process.env.NAVER_SEARCH_CLIENT_SECRET = "client-secret";
  const naverLink = "https://news.naver.com/mnews/article/001/0010000000?sid=101";
  global.fetch = async () => jsonResponse({
    items: [{
      title: "삼성전자 뉴스",
      link: naverLink,
      pubDate: "Sun, 14 Jun 2026 12:34:56 +0900",
    }],
  });

  const response = await GET(new NextRequest("http://localhost/api/stock/news?ticker=KR:005930"));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("Cache-Control") || "", /no-store/);
  assert.equal(payload.ok, true);
  assert.equal(payload.ticker, "KR:005930");
  assert.equal(payload.items[0].link, naverLink);
});
