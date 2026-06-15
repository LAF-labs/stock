import { NextRequest, NextResponse } from "next/server";
import { recordAdminPageView, STOCK_VISITOR_COOKIE } from "@/lib/adminMetrics";
import { parseStrictTickerRef } from "@/lib/tickerRef";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => undefined);
  const record = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const ticker = cleanTicker(record.ticker);
  const path = cleanPath(record.path);
  const result = await recordAdminPageView({
    visitorId: request.cookies.get(STOCK_VISITOR_COOKIE)?.value,
    ticker,
    path,
    userAgent: request.headers.get("user-agent") || undefined,
  });

  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(STOCK_VISITOR_COOKIE, result.visitorId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}

function cleanTicker(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = parseStrictTickerRef(value);
  return parsed.ok ? parsed.ticker : undefined;
}

function cleanPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/")) return "/";
  return value.slice(0, 240);
}
