import { NextRequest, NextResponse } from "next/server";
import { acquireRateLimit, apiLimitPolicy, clientRateLimitKey, rateLimitHeaders } from "@/lib/apiRateLimit";
import { jsonError } from "@/lib/apiGuards";
import { searchSymbols } from "@/lib/symbolSearch";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") || "";
  const rawLimit = Number(request.nextUrl.searchParams.get("limit") || 8);
  const market = request.nextUrl.searchParams.get("market");
  const rateLimit = await acquireRateLimit(clientRateLimitKey(request), apiLimitPolicy("stock_symbol_search", 120, 60));
  if (!rateLimit.allowed) {
    return jsonError(429, "rate_limited", "검색 요청이 너무 많아요. 잠시 후 다시 시도해주세요.", rateLimitHeaders(rateLimit));
  }

  const items = await searchSymbols({ query, limit: rawLimit, market });

  return NextResponse.json(
    {
      ok: true,
      query,
      total: items.length,
      items,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      },
    }
  );
}
