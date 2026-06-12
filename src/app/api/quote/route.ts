import { NextRequest, NextResponse } from "next/server";
import { apiLimitPolicy } from "@/lib/apiRateLimit";
import { jsonError } from "@/lib/apiGuards";
import { guardedRateLimit } from "@/lib/apiRequestGuards";
import { safeErrorMessage } from "@/lib/errorSafety";
import { acquireRefreshCooldown, applyRefreshUserCookie, cooldownPayload, privateNoStoreHeaders } from "@/lib/refreshCooldown";
import { enrichQuotePayloadForDisplay } from "@/lib/quoteDisplayEnrichment";
import { STOCK_REFRESH_PRIORITIES } from "@/lib/stockRefreshPriorities";
import { isStockDataUnavailableError } from "@/lib/stockDataRuntime";
import { attachQuoteParts } from "@/lib/stockPartsResponse";
import { getStockQuote, quoteResponseCacheHeaders, quoteStatusFromPayload } from "@/lib/stockQuoteCache";
import { enqueueStockPendingPayload, stockPendingJsonResponse } from "@/lib/stockPendingResponse";
import { readTerminalStockDisplayFailures } from "@/lib/stockRefreshFailures";
import { parseTickerRef, resolveTickerAlias } from "@/lib/tickerRef";

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
    const payload = await enrichQuotePayloadForDisplay(resultPayload);
    const resultStatus = quoteStatusFromPayload(payload);
    if (resultStatus === 202) {
      const terminalResponse = await terminalUnavailableQuoteResponse(ticker, cooldown);
      if (terminalResponse) return terminalResponse;
    }

    const response = NextResponse.json(
      {
        ...payload,
        ...(cooldown ? { refresh_cooldown: cooldownPayload(cooldown.nextAllowedAt) } : {}),
      },
      {
        status: resultStatus,
        headers: forceRefresh ? privateNoStoreHeaders() : quoteResponseCacheHeaders({ ...result, payload }),
      }
    );
    if (cooldown) applyRefreshUserCookie(response, cooldown);
    return response;
  } catch (error) {
    if (isStockDataUnavailableError(error)) {
      console.info("quote_snapshot_unavailable", { ticker, reason: error.payload.reason });
      const terminalResponse = await terminalUnavailableQuoteResponse(ticker, cooldown);
      if (terminalResponse) return terminalResponse;
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
    const terminalResponse = await terminalUnavailableQuoteResponse(ticker, cooldown);
    if (terminalResponse) return terminalResponse;
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

type RefreshCooldownState = Awaited<ReturnType<typeof acquireRefreshCooldown>>;

async function terminalUnavailableQuoteResponse(ticker: string, cooldown?: RefreshCooldownState): Promise<NextResponse | undefined> {
  const terminalFailures = await readTerminalStockDisplayFailures(ticker, "detail");
  if (!terminalFailures.some((item) => item.part === "price" && item.reason === "provider_confirmed_empty")) return undefined;
  const target = parseTickerRef(ticker);
  const payload = await enrichQuotePayloadForDisplay({
    ok: true,
    type: "quote",
    requested_ticker: ticker,
    market: target.market,
    symbol: target.symbol,
    name: target.symbol,
    currency: target.market === "KR" ? "KRW" : "USD",
    server_cache: {
      state: "unavailable",
      source: "terminal_failure",
      refresh_started: false,
      unavailable_parts: ["price"],
    },
    parts: {
      quote: {
        state: "unavailable",
        source: "provider",
        reason: "provider_confirmed_empty",
        refresh_started: false,
      },
    },
  });
  const response = NextResponse.json(payload, { status: 200, headers: privateNoStoreHeaders() });
  if (cooldown) applyRefreshUserCookie(response, cooldown);
  return response;
}
