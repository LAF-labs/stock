import { NextRequest, NextResponse } from "next/server";
import { apiLimitPolicy } from "@/lib/apiRateLimit";
import { guardedRateLimit } from "@/lib/apiRequestGuards";
import { publicVercelCdnCacheHeaders } from "@/lib/httpCacheHeaders";
import { readSecFilings } from "@/lib/secFilings";
import { parseStrictTickerRef, resolveTickerAlias } from "@/lib/tickerRef";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const tickerParam = request.nextUrl.searchParams.get("ticker");
  const limit = Number(request.nextUrl.searchParams.get("limit") || "3");
  const offset = Number(request.nextUrl.searchParams.get("offset") || "0");
  const resolved = resolveTickerAlias(tickerParam);
  const strict = resolved.ok ? parseStrictTickerRef(resolved.ticker) : parseStrictTickerRef(tickerParam);

  if (!strict.ok) {
    return NextResponse.json({ ok: false, error: strict.error, message: "조회할 수 없는 종목 형식입니다.", items: [], total: 0 }, {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const rateLimit = await guardedRateLimit(request, apiLimitPolicy("stock_filings", 240, 60), "stock_filings");
  if (!rateLimit.ok) return rateLimit.response;

  if (!strict.ticker.startsWith("US:")) {
    return NextResponse.json({ ok: true, items: [], total: 0 }, {
      status: 200,
      headers: publicVercelCdnCacheHeaders({ sMaxAgeSeconds: 300, staleWhileRevalidateSeconds: 900, staleIfErrorSeconds: 3600 }),
    });
  }

  const result = await readSecFilings({ ticker: strict.ticker, limit, offset });
  return NextResponse.json({ ok: true, ...result }, {
    status: 200,
    headers: publicVercelCdnCacheHeaders({ sMaxAgeSeconds: 60, staleWhileRevalidateSeconds: 300, staleIfErrorSeconds: 900 }),
  });
}
