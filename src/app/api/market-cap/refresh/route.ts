import { NextResponse } from "next/server";
import { envValue } from "@/lib/supabaseRest";
import { refreshMarketCapSnapshots } from "@/lib/marketCapSnapshotStore";
import type { MarketCapScope } from "@/lib/marketCapRankingTypes";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return refresh(request);
}

export async function POST(request: Request) {
  return refresh(request);
}

async function refresh(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const scope = scopeParam(url.searchParams.get("scope"));
  const results = await refreshMarketCapSnapshots({ scopes: scope ? [scope] : undefined });
  return NextResponse.json({ ok: true, results }, { status: 200 });
}

function authorized(request: Request): boolean {
  const secret = envValue("MARKET_CAP_REFRESH_SECRET") || envValue("CRON_SECRET");
  if (!secret) return process.env.NODE_ENV !== "production";
  const url = new URL(request.url);
  const candidate = url.searchParams.get("secret") || request.headers.get("x-refresh-secret") || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return candidate === secret;
}

function scopeParam(value: string | null): MarketCapScope | undefined {
  return value === "all" || value === "domestic" || value === "overseas" ? value : undefined;
}
