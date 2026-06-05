import { NextResponse } from "next/server";
import { stockDataRuntimeMode } from "@/lib/stockDataRuntime";
import { envValue, supabaseAdminConfig, supabaseReadConfig } from "@/lib/supabaseRest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VERCEL_REQUIRED = [
  "STOCK_DATA_RUNTIME",
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "STOCK_REFRESH_COOKIE_SECRET",
  "STOCK_RATE_LIMIT_SECRET",
  "STOCK_API_APP_KEY",
  "STOCK_API_APP_SECRET",
  "STOCK_API_BASE",
] as const;

export async function GET() {
  const present = Object.fromEntries(VERCEL_REQUIRED.map((name) => [name, Boolean(envValue(name))]));
  const missing = VERCEL_REQUIRED.filter((name) => !present[name]);
  const payload = {
    ok: missing.length === 0,
    runtime: stockDataRuntimeMode(),
    supabase: {
      read: Boolean(supabaseReadConfig()),
      admin: Boolean(supabaseAdminConfig()),
    },
    env: {
      present,
      missing,
    },
    vercel: {
      env: envValue("VERCEL_ENV"),
      branch: envValue("VERCEL_GIT_COMMIT_REF"),
      sha: envValue("VERCEL_GIT_COMMIT_SHA"),
    },
  };

  return NextResponse.json(payload, {
    status: payload.ok ? 200 : 503,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
