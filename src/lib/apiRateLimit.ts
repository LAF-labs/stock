import { createHash, createHmac, randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { envValue, fetchWithTimeout, numericEnv, supabaseAdminConfig, supabaseHeaders } from "@/lib/supabaseRest";

type RateLimitRow = {
  allowed?: boolean;
  remaining?: number;
  reset_at?: string;
};

export type RateLimitPolicy = {
  bucket: string;
  limit: number;
  windowSeconds: number;
};

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: string;
  source: "supabase" | "memory";
};

declare global {
  var __stockApiRateLimits: Map<string, { count: number; resetAt: number }> | undefined;
}

const memoryRateLimits = (globalThis.__stockApiRateLimits ??= new Map<string, { count: number; resetAt: number }>());
const RATE_LIMIT_RPC = "acquire_stock_api_rate_limit";
const FALLBACK_RATE_LIMIT_SECRET = createHash("sha256").update(randomUUID()).digest("hex");

export function rateLimitHeaders(result: RateLimitResult): HeadersInit {
  const retryAfter = Math.max(1, Math.ceil((Date.parse(result.resetAt) - Date.now()) / 1000));
  return {
    "Cache-Control": "private, no-store, max-age=0",
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(Math.max(0, result.remaining)),
    "X-RateLimit-Reset": result.resetAt,
    ...(result.allowed ? {} : { "Retry-After": String(retryAfter) }),
  };
}

export function clientRateLimitKey(request: NextRequest, salt = rateLimitSecret()): string {
  const ip = trustedClientIp(request) || "unknown-ip";
  const cookie = request.cookies.get("stock_refresh_user")?.value?.slice(0, 160) || "no-cookie";
  return hashIdentity(`${ip}:${cookie}`, salt);
}

export function fixedRateLimitKey(value: string, salt = rateLimitSecret()): string {
  return hashIdentity(value, salt);
}

export function clientNetworkRateLimitKey(request: NextRequest, salt = rateLimitSecret()): string {
  return hashIdentity(`ip:${trustedClientIp(request) || "unknown-ip"}`, salt);
}

export async function acquireRateLimit(identityKey: string, policy: RateLimitPolicy): Promise<RateLimitResult> {
  const config = supabaseAdminConfig();
  if (config) {
    try {
      const response = await fetchWithTimeout(`${config.url}/rest/v1/rpc/${RATE_LIMIT_RPC}`, {
        method: "POST",
        headers: supabaseHeaders(config.key),
        body: JSON.stringify({
          p_bucket: policy.bucket,
          p_identity_key: identityKey,
          p_limit: policy.limit,
          p_window_seconds: policy.windowSeconds,
        }),
      }, 2_000);
      if (response.ok) {
        const payload = (await response.json()) as RateLimitRow[] | RateLimitRow;
        const row = Array.isArray(payload) ? payload[0] : payload;
        if (row?.reset_at) {
          return {
            allowed: row.allowed !== false,
            limit: policy.limit,
            remaining: Number.isFinite(row.remaining) ? Number(row.remaining) : 0,
            resetAt: row.reset_at,
            source: "supabase",
          };
        }
      }
    } catch {
      // Fall back to process-local protection if Supabase is unavailable.
    }
  }

  return acquireMemoryRateLimit(identityKey, policy);
}

export function apiLimitPolicy(
  bucket: string,
  fallbackLimit: number,
  fallbackWindowSeconds: number,
  limitEnv = `${bucket.toUpperCase()}_RATE_LIMIT`,
  windowEnv = `${bucket.toUpperCase()}_RATE_LIMIT_WINDOW_SECONDS`
): RateLimitPolicy {
  return {
    bucket,
    limit: numericEnv(limitEnv, fallbackLimit),
    windowSeconds: numericEnv(windowEnv, fallbackWindowSeconds),
  };
}

function acquireMemoryRateLimit(identityKey: string, policy: RateLimitPolicy): RateLimitResult {
  const now = Date.now();
  const mapKey = `${policy.bucket}:${identityKey}`;
  const current = memoryRateLimits.get(mapKey);
  const resetAt = current && current.resetAt > now ? current.resetAt : now + policy.windowSeconds * 1000;
  const count = current && current.resetAt > now ? current.count + 1 : 1;
  memoryRateLimits.set(mapKey, { count, resetAt });
  pruneMemoryRateLimits(now);
  return {
    allowed: count <= policy.limit,
    limit: policy.limit,
    remaining: Math.max(0, policy.limit - count),
    resetAt: new Date(resetAt).toISOString(),
    source: "memory",
  };
}

function pruneMemoryRateLimits(now: number) {
  if (memoryRateLimits.size < 5_000) return;
  for (const [key, item] of memoryRateLimits) {
    if (item.resetAt <= now) memoryRateLimits.delete(key);
  }
}

function hashIdentity(value: string, salt: string): string {
  return createHmac("sha256", salt).update(value).digest("hex");
}

function firstHeaderValue(value: string | null): string | undefined {
  return value?.split(",")[0]?.trim() || undefined;
}

export function trustedClientIp(request: Pick<NextRequest, "headers">): string | undefined {
  return firstHeaderValue(request.headers.get("cf-connecting-ip"))
    || firstHeaderValue(request.headers.get("x-real-ip"))
    || firstHeaderValue(request.headers.get("x-forwarded-for"));
}

function rateLimitSecret(): string {
  const secret = envValue("STOCK_RATE_LIMIT_SECRET");
  if (strictSecretRuntime()) {
    if (!secret || secret.length < 32) {
      throw new Error("STOCK_RATE_LIMIT_SECRET must be at least 32 characters in production.");
    }
    return secret;
  }
  return secret
    || envValue("STOCK_REFRESH_COOKIE_SECRET")
    || envValue("NEXTAUTH_SECRET")
    || FALLBACK_RATE_LIMIT_SECRET;
}

function strictSecretRuntime(): boolean {
  return process.env.NODE_ENV === "production" || Boolean(envValue("VERCEL_ENV"));
}
