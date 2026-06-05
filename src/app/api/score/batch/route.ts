import { NextRequest, NextResponse } from "next/server";
import { acquireRateLimit, apiLimitPolicy, clientRateLimitKey, rateLimitHeaders } from "@/lib/apiRateLimit";
import { batchStatusFromResults, jsonError } from "@/lib/apiGuards";
import { privateNoStoreHeaders } from "@/lib/refreshCooldown";
import { getStockScore, parseTickerList, responseCacheHeaders, type StockPayload, type StockScoreResult } from "@/lib/stockSnapshotCache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_TICKERS = 5;

export async function GET(request: NextRequest) {
  const tickers = parseTickerList(request.nextUrl.searchParams.get("tickers"), MAX_TICKERS);
  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";
  const rateLimit = await acquireRateLimit(clientRateLimitKey(request), apiLimitPolicy("stock_score_batch", 45, 60));
  if (!rateLimit.allowed) {
    return jsonError(429, "rate_limited", "요청이 너무 많아요. 잠시 후 다시 시도해주세요.", rateLimitHeaders(rateLimit));
  }

  if (!tickers.length) {
    return NextResponse.json({ ok: false, error: "missing_tickers", message: "비교할 티커를 입력해주세요." }, { status: 400 });
  }

  if (forceRefresh) {
    return NextResponse.json(
      {
        ok: false,
        error: "batch_refresh_unsupported",
        message: "Batch refresh is not supported. Refresh the current price from the stock detail page.",
      },
      { status: 400, headers: privateNoStoreHeaders() }
    );
  }

  try {
    const resultItems = await Promise.all(
      tickers.map(async (ticker): Promise<{ payload: StockPayload; cache?: StockScoreResult["cache"] }> => {
        try {
          const result = await getStockScore(ticker, "compare");
          return { payload: result.payload, cache: result.cache };
        } catch (error) {
          console.warn("batch_stock_collector_unreachable", { ticker, error: error instanceof Error ? error.message : "unknown" });
          return {
            payload: {
              ok: false,
              requested_ticker: ticker,
              error: "collector_unreachable",
              message: "Stock collector is unavailable.",
            },
          };
        }
      })
    );
    const results = resultItems.map((item) => item.payload);

    const payload = {
      ok: results.some((result) => result.ok === true),
      results,
    };

    const successfulItems = resultItems.filter((item) => item.payload.ok === true && item.cache);
    const headers = successfulItems.length === resultItems.length ? batchResponseCacheHeaders(successfulItems as Array<{ payload: StockPayload; cache: StockScoreResult["cache"] }>) : privateNoStoreHeaders();

    return NextResponse.json(payload, { status: batchStatusFromResults(results), headers });
  } catch (error) {
    console.warn("batch_stock_collector_unreachable", { tickers, error: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json(
      {
        ok: false,
        error: "collector_unreachable",
        message: "Stock collector is unavailable.",
      },
      { status: 502, headers: privateNoStoreHeaders() }
    );
  }
}

function batchResponseCacheHeaders(items: Array<{ payload: StockPayload; cache: StockScoreResult["cache"] }>): HeadersInit {
  const first = items[0];
  const minExpiresAtMs = Math.min(...items.map((item) => Date.parse(item.cache.expiresAt || "")).filter(Number.isFinite));
  const hasStale = items.some((item) => item.cache.state === "stale");
  return responseCacheHeaders({
    payload: first.payload,
    cache: {
      ...first.cache,
      state: hasStale ? "stale" : first.cache.state,
      expiresAt: Number.isFinite(minExpiresAtMs) ? new Date(minExpiresAtMs).toISOString() : first.cache.expiresAt,
    },
  });
}
