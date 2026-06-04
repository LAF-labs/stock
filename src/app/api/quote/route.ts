import { NextRequest, NextResponse } from "next/server";
import { acquireRefreshCooldown, applyRefreshUserCookie, cooldownPayload, privateNoStoreHeaders, refreshCooldownStatus } from "@/lib/refreshCooldown";
import { getStockQuote, quoteResponseCacheHeaders, quoteStatusFromPayload } from "@/lib/stockQuoteCache";
import { normalizeTickerRef } from "@/lib/stockSnapshotCache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const ticker = normalizeTickerRef(request.nextUrl.searchParams.get("ticker"));
  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";
  const cooldown = forceRefresh ? await acquireRefreshCooldown(request) : await refreshCooldownStatus(request);

  if (forceRefresh && cooldown.blocked) {
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
        refresh_cooldown: cooldownPayload(cooldown.nextAllowedAt),
      },
      {
        status: quoteStatusFromPayload(result.payload),
        headers: forceRefresh ? privateNoStoreHeaders() : quoteResponseCacheHeaders(result),
      }
    );
    applyRefreshUserCookie(response, cooldown);
    return response;
  } catch (error) {
    console.warn("quote_collector_unreachable", { ticker, error: error instanceof Error ? error.message : "unknown" });
    const response = NextResponse.json(
      {
        ok: false,
        error: "quote_collector_unreachable",
        message: "Quote collector is unavailable.",
      },
      { status: 502, headers: privateNoStoreHeaders() }
    );
    applyRefreshUserCookie(response, cooldown);
    return response;
  }
}
