import test from "node:test";
import assert from "node:assert/strict";

import { chartResponseCacheHeaders } from "../src/lib/stockChartCache";
import { quoteResponseCacheHeaders } from "../src/lib/stockQuoteCache";
import { responseCacheHeaders } from "../src/lib/stockSnapshotCache";

function headersFrom(init: HeadersInit): Headers {
  return new Headers(init);
}

test("stock API success responses cache on Vercel CDN without browser max-age", () => {
  const expiresAt = new Date(Date.now() + 60_000).toISOString();

  const scoreHeaders = headersFrom(
    responseCacheHeaders({
      payload: { ok: true },
      cache: {
        state: "fresh",
        source: "supabase",
        ticker: "KR:004020",
        view: "detail",
        fetchedAt: new Date().toISOString(),
        expiresAt,
      },
    })
  );
  const quoteHeaders = headersFrom(
    quoteResponseCacheHeaders({
      payload: { ok: true },
      cache: {
        state: "fresh",
        source: "supabase",
        ticker: "KR:004020",
        fetchedAt: new Date().toISOString(),
        expiresAt,
      },
    })
  );
  const chartHeaders = headersFrom(
    chartResponseCacheHeaders({
      payload: { ok: true },
      cache: {
        state: "fresh",
        source: "supabase",
        ticker: "KR:004020",
        fetchedAt: new Date().toISOString(),
        expiresAt,
        staleExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    })
  );

  for (const headers of [scoreHeaders, quoteHeaders, chartHeaders]) {
    assert.equal(headers.get("cache-control"), "public, max-age=0, must-revalidate");
    assert.doesNotMatch(headers.get("cache-control") || "", /s-maxage|stale-while-revalidate/);
    assert.match(headers.get("vercel-cdn-cache-control") || "", /public, s-maxage=\d+/);
    assert.match(headers.get("vercel-cdn-cache-control") || "", /stale-while-revalidate=\d+/);
    assert.match(headers.get("vercel-cdn-cache-control") || "", /stale-if-error=\d+/);
  }
});
