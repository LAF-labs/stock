import { NextRequest, NextResponse } from "next/server";
import { searchSymbols } from "@/lib/symbolSearch";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") || "";
  const rawLimit = Number(request.nextUrl.searchParams.get("limit") || 8);
  const market = request.nextUrl.searchParams.get("market");
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
