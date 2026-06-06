import { NextRequest, NextResponse } from "next/server";
import { acquireRateLimit, apiLimitPolicy, clientRateLimitKey, rateLimitHeaders } from "@/lib/apiRateLimit";
import { jsonError } from "@/lib/apiGuards";
import { safeErrorMessage } from "@/lib/errorSafety";
import { acquireRefreshCooldown, applyRefreshUserCookie, cooldownPayload, privateNoStoreHeaders } from "@/lib/refreshCooldown";
import { isStockDataUnavailableError } from "@/lib/stockDataRuntime";
import { enrichStockPayloadWithSymbolProfile } from "@/lib/symbolProfiles";
import { getStockQuote, quoteResponseCacheHeaders, quoteStatusFromPayload } from "@/lib/stockQuoteCache";
import { enqueueStockPendingPayload, stockPendingJsonResponse } from "@/lib/stockPendingResponse";
import { normalizeTickerRef } from "@/lib/stockSnapshotCache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const ticker = normalizeTickerRef(request.nextUrl.searchParams.get("ticker"));
  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";
  const rateLimit = await acquireRateLimit(
    clientRateLimitKey(request),
    forceRefresh ? apiLimitPolicy("stock_quote_refresh", 8, 900) : apiLimitPolicy("stock_quote", 240, 60)
  );
  if (!rateLimit.allowed) {
    return jsonError(429, "rate_limited", "요청이 너무 많아요. 잠시 후 다시 시도해주세요.", rateLimitHeaders(rateLimit));
  }

  const cooldown = forceRefresh ? await acquireRefreshCooldown(request) : undefined;

  if (forceRefresh && cooldown?.blocked) {
    const response = NextResponse.json(
      {
        ok: false,
        error: "refresh_cooldown",
        message: "Manual refresh is cooling down.",
        refresh_cooldown: cooldownPayload(cooldown.nextAllowedAt),
      },
      {
        status: 429,
        headers: privateNoStoreHeaders(),
      }
    );
    applyRefreshUserCookie(response, cooldown);
    return response;
  }

  try {
    const result = await getStockQuote(ticker, { forceRefresh });
    const payload = quoteNeedsSymbolProfile(result.payload) ? await enrichStockPayloadWithSymbolProfile(result.payload) : result.payload;

    const response = NextResponse.json(
      {
        ...payload,
        ...(cooldown ? { refresh_cooldown: cooldownPayload(cooldown.nextAllowedAt) } : {}),
      },
      {
        status: quoteStatusFromPayload(payload),
        headers: forceRefresh ? privateNoStoreHeaders() : quoteResponseCacheHeaders({ ...result, payload }),
      }
    );
    if (cooldown) applyRefreshUserCookie(response, cooldown);
    return response;
  } catch (error) {
    if (isStockDataUnavailableError(error)) {
      console.info("quote_snapshot_unavailable", { ticker, reason: error.payload.reason });
      const pendingPayload = await enqueueStockPendingPayload({
        kind: "quote",
        ticker,
        priority: forceRefresh ? 10 : 40,
        reason: error.payload.reason,
      });
      const response = stockPendingJsonResponse(pendingPayload);
      if (cooldown) applyRefreshUserCookie(response, cooldown);
      return response;
    }

    console.warn("quote_collector_unreachable", { ticker, error: safeErrorMessage(error) });
    const response = NextResponse.json(
      {
        ok: false,
        error: "quote_collector_unreachable",
        message: "Quote collector is unavailable.",
      },
      { status: 502, headers: privateNoStoreHeaders() }
    );
    if (cooldown) applyRefreshUserCookie(response, cooldown);
    return response;
  }
}

function quoteNeedsSymbolProfile(payload: Record<string, unknown>): boolean {
  const name = comparableText(payload.name);
  const symbol = comparableText(payload.symbol);
  const requestedTicker = comparableText(payload.requested_ticker);
  if (!name) return true;
  return name === symbol || name === requestedTicker;
}

function comparableText(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase().replace(/[^A-Z0-9가-힣]/g, "") : "";
}
