import test from "node:test";
import assert from "node:assert/strict";

import { loadStockNews, type StockNewsClientFetch } from "../src/lib/clientStockNews";

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
  });
}

test("client stock news loader fetches the no-store stock news route", async () => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetcher: StockNewsClientFetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return jsonResponse({
      ok: true,
      items: [{ title: "뉴스", link: "https://news.naver.com/article" }],
    });
  };

  const result = await loadStockNews("KR:005930", fetcher);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/stock/news?ticker=KR%3A005930");
  assert.equal(calls[0].init?.cache, "no-store");
  assert.equal(result.ok, true);
  assert.equal(result.items[0].link, "https://news.naver.com/article");
});

test("client stock news loader treats invalid payloads as empty errors", async () => {
  const result = await loadStockNews("US:NVDA", async () => jsonResponse({ ok: true, items: "bad" }));

  assert.equal(result.ok, false);
  assert.equal(result.items.length, 0);
});
