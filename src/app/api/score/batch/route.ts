import { NextRequest, NextResponse } from "next/server";
import { apiLimitPolicy } from "@/lib/apiRateLimit";
import { batchStatusFromResults } from "@/lib/apiGuards";
import { guardedRateLimit } from "@/lib/apiRequestGuards";
import { mapWithConcurrency } from "@/lib/concurrency";
import { safeErrorMessage } from "@/lib/errorSafety";
import { privateNoStoreHeaders } from "@/lib/refreshCooldown";
import { isStockDataUnavailableError } from "@/lib/stockDataRuntime";
import { enqueueStockPendingPayload } from "@/lib/stockPendingResponse";
import { getStockScore, responseCacheHeaders, type StockPayload, type StockScoreResult } from "@/lib/stockSnapshotCache";
import { enrichStockPayloadWithSymbolDisplay } from "@/lib/symbolSearch";
import { enrichStockPayloadWithSymbolProfile } from "@/lib/symbolProfiles";
import { parseStrictTickerRef } from "@/lib/tickerRef";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_TICKERS = 5;
const BATCH_CONCURRENCY = 2;

type ParsedBatchTicker =
  | { ok: true; ticker: string }
  | { ok: false; requestedTicker: string; payload: StockPayload };

export async function GET(request: NextRequest) {
  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";
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

  const parsedTickers = parseBatchTickerItems(request.nextUrl.searchParams.get("tickers"), MAX_TICKERS);
  if (!parsedTickers.length) {
    return NextResponse.json({ ok: false, error: "missing_tickers", message: "비교할 티커를 입력해주세요." }, { status: 400 });
  }

  const validTickers = parsedTickers.filter((item): item is Extract<ParsedBatchTicker, { ok: true }> => item.ok);
  if (!validTickers.length) {
    const results = parsedTickers
      .filter((item): item is Extract<ParsedBatchTicker, { ok: false }> => !item.ok)
      .map((item) => item.payload);
    return NextResponse.json({ ok: false, results }, { status: batchStatusFromResults(results), headers: privateNoStoreHeaders() });
  }

  const rateLimit = await guardedRateLimit(request, apiLimitPolicy("stock_score_batch", 45, 60), "score_batch");
  if (!rateLimit.ok) return rateLimit.response;

  try {
    const validResultItems = await mapWithConcurrency(
      validTickers,
      BATCH_CONCURRENCY,
      async ({ ticker }): Promise<{ payload: StockPayload; cache?: StockScoreResult["cache"] }> => {
        try {
          const result = await getStockScore(ticker, "compare");
          const payload = await enrichStockPayloadWithSymbolDisplay(await enrichStockPayloadWithSymbolProfile(result.payload));
          return { payload, cache: result.cache };
        } catch (error) {
          if (isStockDataUnavailableError(error)) {
            console.info("batch_stock_snapshot_unavailable", { ticker, reason: error.payload.reason });
            return {
              payload: await enqueueStockPendingPayload({
                kind: "score",
                ticker,
                view: "compare",
                priority: 30,
                reason: error.payload.reason,
              }),
            };
          }

          console.warn("batch_stock_collector_unreachable", { ticker, error: safeErrorMessage(error) });
          return {
            payload: {
              ok: false,
              requested_ticker: ticker,
              error: "collector_unreachable",
              message: "Stock collector is unavailable.",
            },
          };
        }
      }
    );
    let validIndex = 0;
    const resultItems = parsedTickers.map((item): { payload: StockPayload; cache?: StockScoreResult["cache"] } => {
      if (!item.ok) return { payload: item.payload };
      const result = validResultItems[validIndex];
      validIndex += 1;
      return result;
    });
    const results = resultItems.map((item) => item.payload);

    const payload = {
      ok: results.some((result) => result.ok === true),
      results,
    };

    const successfulItems = resultItems.filter((item) => item.payload.ok === true && item.cache);
    const headers = successfulItems.length === resultItems.length ? batchResponseCacheHeaders(successfulItems as Array<{ payload: StockPayload; cache: StockScoreResult["cache"] }>) : privateNoStoreHeaders();

    return NextResponse.json(payload, { status: batchStatusFromResults(results), headers });
  } catch (error) {
    console.warn("batch_stock_collector_unreachable", { tickers: validTickers.map((item) => item.ticker), error: safeErrorMessage(error) });
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

function parseBatchTickerItems(value: string | null, maxTickers: number): ParsedBatchTicker[] {
  const unique = new Set<string>();
  const items: ParsedBatchTicker[] = [];

  for (const raw of (value || "").split(",")) {
    const requestedTicker = raw.trim();
    if (!requestedTicker) continue;

    const parsed = parseStrictTickerRef(requestedTicker);
    const key = parsed.ok ? parsed.ticker : `invalid:${requestedTicker.toUpperCase()}`;
    if (unique.has(key)) continue;
    unique.add(key);

    items.push(
      parsed.ok
        ? { ok: true, ticker: parsed.ticker }
        : {
            ok: false,
            requestedTicker,
            payload: {
              ok: false,
              requested_ticker: requestedTicker,
              error: parsed.error,
              message: parsed.error === "missing_ticker" ? "비교할 티커를 입력해주세요." : "지원하지 않는 티커 형식이에요.",
            },
          }
    );

    if (items.length >= maxTickers) break;
  }

  return items;
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
