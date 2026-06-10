import { NextRequest, NextResponse } from "next/server";
import { planStockDisplayCompletion, scheduleStockDisplayCompletion } from "@/lib/stockCompletionPlanner";
import { buildStockDisplayPayload } from "@/lib/stockDisplayModel";
import type { StockDisplayView } from "@/lib/stockDisplayTypes";
import { parseStrictTickerRef, resolveTickerAlias } from "@/lib/tickerRef";

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

  const payload = await buildStockDisplayPayload({
    ticker: strict.ticker,
    view,
  });
  scheduleStockDisplayCompletion(planStockDisplayCompletion({
    ticker: payload.ticker,
    view,
    presentParts: payload.completion.presentParts,
    unavailableParts: payload.completion.unavailableParts,
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
    return {
      "Cache-Control": "public, s-maxage=10, stale-while-revalidate=60, stale-if-error=300",
    };
  }
  return {
    "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300, stale-if-error=900",
  };
}
