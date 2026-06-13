import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { stockDataRuntimeMode } from "@/lib/stockDataRuntime";
import { envValue, supabaseAdminConfig, supabaseReadConfig } from "@/lib/supabaseRest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VERCEL_REQUIRED = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "STOCK_REFRESH_COOKIE_SECRET",
  "STOCK_RATE_LIMIT_SECRET",
  "STOCK_API_APP_KEY",
  "STOCK_API_APP_SECRET",
] as const;

export async function GET(request: Request) {
  const present = Object.fromEntries(VERCEL_REQUIRED.map((name) => [name, Boolean(envValue(name))]));
  const missing = VERCEL_REQUIRED.filter((name) => !present[name]);
  const verboseRequested = new URL(request.url).searchParams.get("verbose") === "1";
  const verboseAuthorized = verboseRequested && isVerboseHealthAuthorized(request);
  const runtime = stockDataRuntimeMode();
  const vercelSnapshotRuntime = envValue("VERCEL") !== "1" || runtime === "snapshot";

  if (verboseRequested && !verboseAuthorized) {
    return NextResponse.json(
      {
        ok: false,
        error: "unauthorized",
        message: "Detailed health status requires an internal health token.",
      },
      {
        status: 401,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }

  const payload = {
    ok: missing.length === 0 && vercelSnapshotRuntime,
    runtime,
    checks: {
      vercel_snapshot_runtime: vercelSnapshotRuntime,
    },
    supabase: {
      read: Boolean(supabaseReadConfig()),
      admin: Boolean(supabaseAdminConfig()),
    },
    env: verboseAuthorized
      ? {
          present,
          missing,
        }
      : {
          required_count: VERCEL_REQUIRED.length,
          missing_count: missing.length,
        },
    vercel: {
      env: envValue("VERCEL_ENV"),
      ...(verboseAuthorized
        ? {
            branch: envValue("VERCEL_GIT_COMMIT_REF"),
            sha: envValue("VERCEL_GIT_COMMIT_SHA"),
          }
        : {}),
    },
  };

  return NextResponse.json(payload, {
    status: payload.ok ? 200 : 503,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function isVerboseHealthAuthorized(request: Request): boolean {
  const expected = envValue("STOCK_HEALTH_CHECK_TOKEN") || envValue("MARKET_DATA_INTERNAL_TOKEN");
  if (!expected) return false;
  const header = request.headers.get("authorization") || "";
  const token = header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return false;
  return timingSafeEqual(sha256(token), sha256(expected));
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}
