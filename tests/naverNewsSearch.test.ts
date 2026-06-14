import test from "node:test";
import assert from "node:assert/strict";

import {
  fetchNaverStockNews,
  naverNewsConfigured,
  type NaverNewsFetch,
} from "../src/lib/naverNewsSearch";

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
  });
}

test("naver news search calls the official endpoint with credentials and no cache", async () => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetcher: NaverNewsFetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return jsonResponse({ items: [] });
  };

  await fetchNaverStockNews({
    ticker: "KR:005930",
    queryName: "삼성전자",
    env: {
      NAVER_SEARCH_CLIENT_ID: "client-id",
      NAVER_SEARCH_CLIENT_SECRET: "client-secret",
    },
    fetcher,
  });

  assert.equal(calls.length, 1);
  const requestUrl = new URL(calls[0].url);
  assert.equal(requestUrl.origin + requestUrl.pathname, "https://openapi.naver.com/v1/search/news.json");
  assert.equal(requestUrl.searchParams.get("query"), "삼성전자 005930 주식");
  assert.equal(requestUrl.searchParams.get("display"), "8");
  assert.equal(requestUrl.searchParams.get("start"), "1");
  assert.equal(requestUrl.searchParams.get("sort"), "date");
  assert.equal(calls[0].init?.cache, "no-store");
  assert.equal((calls[0].init?.headers as Record<string, string>)["X-Naver-Client-Id"], "client-id");
  assert.equal((calls[0].init?.headers as Record<string, string>)["X-Naver-Client-Secret"], "client-secret");
});

test("naver news search preserves the Naver link from the API response", async () => {
  const naverLink = "https://news.naver.com/mnews/article/001/0010000000?sid=101";
  const fetcher: NaverNewsFetch = async () => jsonResponse({
    items: [{
      title: "삼성전자 <b>반도체</b> 뉴스",
      link: naverLink,
      originallink: "https://example.com/original",
      pubDate: "Sun, 14 Jun 2026 12:34:56 +0900",
    }],
  });

  const result = await fetchNaverStockNews({
    ticker: "KR:005930",
    queryName: "삼성전자",
    env: {
      NAVER_SEARCH_CLIENT_ID: "client-id",
      NAVER_SEARCH_CLIENT_SECRET: "client-secret",
    },
    fetcher,
  });

  assert.equal(result.ok, true);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, "삼성전자 <b>반도체</b> 뉴스");
  assert.equal(result.items[0].link, naverLink);
  assert.equal(result.items[0].publisher, "NAVER 뉴스");
  assert.equal(result.items[0].provider_publish_time, 1781408096);
});

test("naver news search does not call the provider when credentials are missing", async () => {
  let calls = 0;
  const result = await fetchNaverStockNews({
    ticker: "US:NVDA",
    queryName: "NVIDIA",
    env: {},
    fetcher: async () => {
      calls += 1;
      return jsonResponse({ items: [] });
    },
  });

  assert.equal(naverNewsConfigured({}), false);
  assert.equal(calls, 0);
  assert.equal(result.ok, false);
  assert.equal(result.error, "naver_news_not_configured");
});
