import { NextRequest, NextResponse } from "next/server";
import { acquireRateLimit, apiLimitPolicy, clientRateLimitKey, rateLimitHeaders } from "@/lib/apiRateLimit";
import { jsonError } from "@/lib/apiGuards";
import { safeErrorMessage } from "@/lib/errorSafety";
import { acquireRefreshCooldown, applyRefreshUserCookie, cooldownPayload, privateNoStoreHeaders } from "@/lib/refreshCooldown";
import { isStockDataUnavailableError } from "@/lib/stockDataRuntime";
import { enqueueStockPendingPayload, stockPendingJsonResponse } from "@/lib/stockPendingResponse";
import { cleanView, getStockScore, normalizeTickerRef, responseCacheHeaders, statusFromPayload } from "@/lib/stockSnapshotCache";
import { enrichStockPayloadWithSymbolProfile } from "@/lib/symbolProfiles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const ticker = normalizeTickerRef(request.nextUrl.searchParams.get("ticker"));
  const view = cleanView(request.nextUrl.searchParams.get("view"));
  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";
  const rateLimit = await acquireRateLimit(
    clientRateLimitKey(request),
    forceRefresh ? apiLimitPolicy("stock_score_refresh", 6, 900) : apiLimitPolicy("stock_score", 180, 60)
  );
  if (!rateLimit.allowed) {
    return jsonError(429, "rate_limited", "요청이 너무 많아요. 잠시 후 다시 시도해주세요.", rateLimitHeaders(rateLimit));
  }

  const cooldown = forceRefresh ? await acquireRefreshCooldown(request) : undefined;

  if (cooldown?.blocked) {
    const response = NextResponse.json(
      {
        ok: false,
        error: "refresh_cooldown",
        message: "Manual refresh is cooling down.",
        refresh_cooldown: cooldownPayload(cooldown.nextAllowedAt),
      },
      { status: 429, headers: privateNoStoreHeaders() }
    );
    applyRefreshUserCookie(response, cooldown);
    return response;
  }

  try {
    const result = await getStockScore(ticker, view, { forceRefresh });
    const enrichedPayload = await enrichStockPayloadWithSymbolProfile(result.payload);
    const payload = forceRefresh
      ? {
          ...enrichedPayload,
          refresh_cooldown: cooldownPayload(cooldown?.nextAllowedAt),
        }
      : enrichedPayload;
    const response = NextResponse.json(
      payload,
      {
        status: statusFromPayload(result.payload),
        headers: forceRefresh ? privateNoStoreHeaders() : responseCacheHeaders(result),
      }
    );
    if (cooldown) applyRefreshUserCookie(response, cooldown);
    return response;
  } catch (error) {
    if (isStockDataUnavailableError(error)) {
      console.info("stock_snapshot_unavailable", { ticker, view, reason: error.payload.reason });
      const pendingPayload = await enqueueStockPendingPayload({
        kind: "score",
        ticker,
        view,
        priority: forceRefresh ? 10 : 20,
        reason: error.payload.reason,
      });
      const response = stockPendingJsonResponse(pendingPayload);
      if (cooldown) applyRefreshUserCookie(response, cooldown);
      return response;
    }

    console.warn("stock_collector_unreachable", { ticker, view, error: safeErrorMessage(error) });
    const response = NextResponse.json(
      {
        ok: false,
        error: "collector_unreachable",
        message: "Stock collector is unavailable.",
      },
      { status: 502, headers: privateNoStoreHeaders() }
    );
    if (cooldown) applyRefreshUserCookie(response, cooldown);
    return response;
  }
}
