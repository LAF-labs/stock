import { NextRequest, NextResponse } from "next/server";
import { guardedRateLimit } from "@/lib/apiRequestGuards";
import { apiLimitPolicy } from "@/lib/apiRateLimit";
import { fetchNaverStockNews } from "@/lib/naverNewsSearch";
import { findExactLocalSymbol } from "@/lib/symbolSearch";
import { parseStrictTickerRef, resolveTickerAlias } from "@/lib/tickerRef";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const tickerParam = request.nextUrl.searchParams.get("ticker");
  const resolved = resolveTickerAlias(tickerParam);
  const strict = resolved.ok ? parseStrictTickerRef(resolved.ticker) : parseStrictTickerRef(tickerParam);

  if (!strict.ok) {
    return NextResponse.json({
      ok: false,
      error: strict.error,
      message: "Invalid ticker.",
      items: [],
    }, {
      status: 400,
      headers: noStoreHeaders(),
    });
  }

  const rateLimit = await guardedRateLimit(
    request,
    apiLimitPolicy("stock_news", 60, 60),
    "stock_news",
  );
  if (!rateLimit.ok) return rateLimit.response;

  const symbol = await findExactLocalSymbol(strict.ticker).catch(() => undefined);
  const result = await fetchNaverStockNews({
    ticker: strict.ticker,
    queryName: symbol?.displayName || symbol?.koreanName || symbol?.englishName,
  });

  return NextResponse.json({
    ...result,
    ticker: strict.ticker,
    source: "naver_search",
  }, {
    status: 200,
    headers: noStoreHeaders(),
  });
}

function noStoreHeaders(): HeadersInit {
  return {
    "Cache-Control": "private, no-store, max-age=0",
  };
}
