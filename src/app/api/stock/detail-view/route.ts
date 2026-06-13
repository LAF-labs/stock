import { NextRequest, NextResponse } from "next/server";
import { apiLimitPolicy } from "@/lib/apiRateLimit";
import { guardedRateLimit } from "@/lib/apiRequestGuards";
import { publicVercelCdnCacheHeaders } from "@/lib/httpCacheHeaders";
import { stockDisplayPayloadWithQueueSchedule } from "@/lib/stockDisplayCompletionSchedule";
import { stockDetailViewFromDisplayPayload } from "@/lib/stockDetailViewModel";
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
      mode: "failed_irreversible",
      error: strict.error,
      message: "조회할 수 없는 종목 형식입니다.",
    }, {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const rateLimit = await guardedRateLimit(
    request,
    apiLimitPolicy("stock_detail_view", 180, 60),
    "stock_detail_view",
  );
  if (!rateLimit.ok) return rateLimit.response;

  const displayPayload = await stockDisplayPayloadWithQueueSchedule(await buildStockDisplayPayload({
    ticker: strict.ticker,
    view,
  }));

  const detailView = stockDetailViewFromDisplayPayload(displayPayload);

  return NextResponse.json(detailView, {
    status: 200,
    headers: detailViewHeaders(detailView.nextPollMs !== undefined),
  });
}

function cleanDisplayView(value: string | null): StockDisplayView {
  if (value === "technical") return "technical";
  if (value === "compare") return "compare";
  return "detail";
}

function detailViewHeaders(refreshActive: boolean): HeadersInit {
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
