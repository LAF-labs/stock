import { NextRequest, NextResponse } from "next/server";
import { apiLimitPolicy } from "@/lib/apiRateLimit";
import { jsonError } from "@/lib/apiGuards";
import { guardedRateLimit } from "@/lib/apiRequestGuards";
import { safeErrorMessage } from "@/lib/errorSafety";
import { acquireRefreshCooldown, applyRefreshUserCookie, cooldownPayload, privateNoStoreHeaders } from "@/lib/refreshCooldown";
import { STOCK_REFRESH_PRIORITIES } from "@/lib/stockRefreshPriorities";
import { isStockDataUnavailableError } from "@/lib/stockDataRuntime";
import { attachQuoteParts } from "@/lib/stockPartsResponse";
import { enrichStockPayloadWithSymbolProfile } from "@/lib/symbolProfiles";
import { getStockQuote, quoteResponseCacheHeaders, quoteStatusFromPayload } from "@/lib/stockQuoteCache";
import { enqueueStockPendingPayload, stockPendingJsonResponse } from "@/lib/stockPendingResponse";
import { resolveTickerAlias } from "@/lib/tickerRef";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const tickerRef = resolveTickerAlias(request.nextUrl.searchParams.get("ticker"));
  if (!tickerRef.ok) {
    return jsonError(
      400,
      tickerRef.error,
      tickerRef.error === "missing_ticker" ? "조회할 티커를 입력해주세요." : "지원하지 않는 티커 형식이에요.",
      privateNoStoreHeaders()
    );
  }
  const ticker = tickerRef.ticker;
  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";
  const rateLimit = await guardedRateLimit(
    request,
    forceRefresh ? apiLimitPolicy("stock_quote_refresh", 8, 900) : apiLimitPolicy("stock_quote", 240, 60),
    "quote",
  );
  if (!rateLimit.ok) return rateLimit.response;

  let cooldown;
  try {
    cooldown = forceRefresh ? await acquireRefreshCooldown(request) : undefined;
  } catch (error) {
    console.error("quote_refresh_cooldown_guard_failed", { error: safeErrorMessage(error) });
    return jsonError(
      500,
      "server_misconfigured",
      "서버 보안 설정을 확인해야 해요. 잠시 후 다시 시도해주세요.",
      privateNoStoreHeaders()
    );
  }

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
    const resultPayload = attachQuoteParts(result);
    const payload = quoteNeedsSymbolProfile(resultPayload) ? await enrichStockPayloadWithSymbolProfile(resultPayload) : resultPayload;

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
        priority: forceRefresh ? STOCK_REFRESH_PRIORITIES.FORCE_REFRESH : STOCK_REFRESH_PRIORITIES.USER_QUOTE_MISS,
        reason: error.payload.reason,
      });
      const response = stockPendingJsonResponse(pendingPayload);
      if (cooldown) applyRefreshUserCookie(response, cooldown);
      return response;
    }

    console.warn("quote_provider_unavailable", { ticker, error: safeErrorMessage(error) });
    const response = NextResponse.json(
      {
        ok: false,
        error: "quote_provider_unavailable",
        message: "Quote data provider is unavailable.",
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
