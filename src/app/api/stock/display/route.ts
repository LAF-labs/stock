import { NextRequest, NextResponse } from "next/server";
import { apiLimitPolicy } from "@/lib/apiRateLimit";
import { guardedRateLimit } from "@/lib/apiRequestGuards";
import { publicVercelCdnCacheHeaders } from "@/lib/httpCacheHeaders";
import { stockDisplayPayloadWithQueueSchedule } from "@/lib/stockDisplayCompletionSchedule";
import { buildStockDisplayPayload } from "@/lib/stockDisplayModel";
import type { StockDisplayView } from "@/lib/stockDisplayTypes";
import { parseStrictTickerRef, resolveTickerAlias } from "@/lib/tickerRef";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tickerParam = searchParams.get("ticker");
  const view = cleanDisplayView(searchParams.get("view"));
  const resolved = resolveTickerAlias(tickerParam);
  const strict = resolved.ok ? parseStrictTickerRef(resolved.ticker) : parseStrictTickerRef(tickerParam);

  if (!strict.ok) {
    return NextResponse.json({
      ok: false,
      error: strict.error,
      message: "Invalid ticker.",
    }, {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const rateLimit = await guardedRateLimit(
    request,
    apiLimitPolicy("stock_display", 120, 60),
    "stock_display",
  );
  if (!rateLimit.ok) return rateLimit.response;

  const payload = await stockDisplayPayloadWithQueueSchedule(await buildStockDisplayPayload({
    ticker: strict.ticker,
    view,
  }));

  return NextResponse.json(payload, {
    status: 200,
    headers: displayResponseHeaders(payload.refresh.active),
  });
}

function cleanDisplayView(value: string | null): StockDisplayView {
  if (value === "technical") return "technical";
  if (value === "compare") return "compare";
  return "detail";
}

function displayResponseHeaders(refreshActive: boolean): HeadersInit {
  if (refreshActive) {
    return publicVercelCdnCacheHeaders({
      sMaxAgeSeconds: 3,
      staleWhileRevalidateSeconds: 30,
      staleIfErrorSeconds: 300,
    });
  }
  return publicVercelCdnCacheHeaders({
    sMaxAgeSeconds: 60,
    staleWhileRevalidateSeconds: 300,
    staleIfErrorSeconds: 900,
  });
}
