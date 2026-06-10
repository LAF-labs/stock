import { NextRequest, NextResponse } from "next/server";
import { acquireRateLimit, apiLimitPolicy, clientRateLimitKey, rateLimitHeaders } from "@/lib/apiRateLimit";
import { jsonError } from "@/lib/apiGuards";
import { publicVercelCdnCacheHeaders } from "@/lib/httpCacheHeaders";
import { searchSymbols } from "@/lib/symbolSearch";
import type { SymbolSearchItem } from "@/lib/symbolTypes";

export const dynamic = "force-dynamic";

type SymbolRoutePayload = {
  ok: true;
  query: string;
  total: number;
  items: SymbolSearchItem[];
};

const SYMBOL_ROUTE_CACHE_TTL_MS = 86_400_000;
const SYMBOL_ROUTE_CACHE_MAX = 500;
const symbolRouteCache = new Map<string, { expiresAt: number; payload: SymbolRoutePayload }>();

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") || "";
  const rawLimit = routeLimit(request.nextUrl.searchParams.get("limit"));
  const market = request.nextUrl.searchParams.get("market");
  const cacheKey = symbolRouteCacheKey(query, rawLimit, market);
  const cached = symbolRouteCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.payload, {
      headers: {
        ...symbolRouteCacheHeaders(),
        "x-stock-symbol-route-cache": "hit",
      },
    });
  }
  if (cached) symbolRouteCache.delete(cacheKey);

  const rateLimit = await acquireRateLimit(clientRateLimitKey(request), apiLimitPolicy("stock_symbol_search", 120, 60));
  if (!rateLimit.allowed) {
    return jsonError(429, "rate_limited", "검색 요청이 너무 많아요. 잠시 후 다시 시도해주세요.", rateLimitHeaders(rateLimit));
  }

  const items = await searchSymbols({ query, limit: rawLimit, market });
  const payload: SymbolRoutePayload = {
    ok: true,
    query,
    total: items.length,
    items,
  };
  rememberSymbolRouteCache(cacheKey, payload);

  return NextResponse.json(payload, {
    headers: symbolRouteCacheHeaders(),
  });
}

export function clearSymbolRouteCacheForTests() {
  symbolRouteCache.clear();
}

function symbolRouteCacheHeaders() {
  return publicVercelCdnCacheHeaders({
    sMaxAgeSeconds: 86_400,
    staleWhileRevalidateSeconds: 604_800,
    staleIfErrorSeconds: 604_800,
  });
}

function rememberSymbolRouteCache(key: string, payload: SymbolRoutePayload) {
  if (symbolRouteCache.size >= SYMBOL_ROUTE_CACHE_MAX) {
    const first = symbolRouteCache.keys().next().value;
    if (typeof first === "string") symbolRouteCache.delete(first);
  }
  symbolRouteCache.set(key, {
    expiresAt: Date.now() + SYMBOL_ROUTE_CACHE_TTL_MS,
    payload,
  });
}

function symbolRouteCacheKey(query: string, limit: number, market: string | null): string {
  return [query.trim().toLowerCase(), limit, market?.trim().toUpperCase() || ""].join("\u0000");
}

function routeLimit(value: string | null): number {
  const parsed = Number(value || 8);
  return Math.min(Math.max(Number.isFinite(parsed) ? parsed : 8, 1), 20);
}
