import { NextRequest, NextResponse } from "next/server";
import { acquireRateLimit, apiLimitPolicy, clientRateLimitKey, rateLimitHeaders } from "@/lib/apiRateLimit";
import { jsonError } from "@/lib/apiGuards";
import { acquireRefreshCooldown, applyRefreshUserCookie, cooldownPayload, privateNoStoreHeaders } from "@/lib/refreshCooldown";
import { isStockDataUnavailableError } from "@/lib/stockDataRuntime";
import { getStockQuote, quoteResponseCacheHeaders, quoteStatusFromPayload } from "@/lib/stockQuoteCache";
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

    const response = NextResponse.json(
      {
        ...result.payload,
        ...(cooldown ? { refresh_cooldown: cooldownPayload(cooldown.nextAllowedAt) } : {}),
      },
      {
        status: quoteStatusFromPayload(result.payload),
        headers: forceRefresh ? privateNoStoreHeaders() : quoteResponseCacheHeaders(result),
      }
    );
    if (cooldown) applyRefreshUserCookie(response, cooldown);
    return response;
  } catch (error) {
    if (isStockDataUnavailableError(error)) {
      console.info("quote_snapshot_unavailable", { ticker, reason: error.payload.reason });
      const response = NextResponse.json(error.toPayload(), { status: error.status, headers: privateNoStoreHeaders() });
      if (cooldown) applyRefreshUserCookie(response, cooldown);
      return response;
    }

    console.warn("quote_collector_unreachable", { ticker, error: error instanceof Error ? error.message : "unknown" });
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
