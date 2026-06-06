import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { clientNetworkRateLimitKey } from "@/lib/apiRateLimit";
import { envValue, fetchWithTimeout, numericEnv, supabaseAdminConfig, supabaseHeaders } from "@/lib/supabaseRest";

export type RefreshCooldownStatus = {
  blocked: boolean;
  userId: string;
  userKey: string;
  nextAllowedAt?: string;
  remainingSeconds?: number;
  shouldSetCookie: boolean;
  cookieValue: string;
};

type AcquireCooldownRow = {
  acquired?: boolean;
  cooldown_until?: string;
  remaining_seconds?: number;
};

declare global {
  var __stockRefreshCooldowns: Map<string, string> | undefined;
}

const COOKIE_NAME = "stock_refresh_user";
const COOLDOWN_RPC = "acquire_stock_refresh_cooldown";
const FALLBACK_COOKIE_SECRET = randomUUID();
const memoryCooldowns = (globalThis.__stockRefreshCooldowns ??= new Map<string, string>());

export function refreshCooldownSeconds(): number {
  return numericEnv("STOCK_REFRESH_COOLDOWN_SECONDS", 300);
}

export async function acquireRefreshCooldown(request: NextRequest, nowMs = Date.now()): Promise<RefreshCooldownStatus> {
  const identity = refreshUserIdentity(request);
  const acquiredUntil = await acquireCooldown(identity.userKey, nowMs);
  return statusFromUntil(identity, acquiredUntil.nextAllowedAt, nowMs, acquiredUntil.blocked);
}

export function applyRefreshUserCookie(response: NextResponse, status: RefreshCooldownStatus) {
  if (!status.shouldSetCookie) return;
  response.cookies.set(COOKIE_NAME, status.cookieValue, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

export function cooldownPayload(nextAllowedAt?: string, nowMs = Date.now()) {
  const remainingSeconds = secondsRemaining(nextAllowedAt, nowMs);
  return {
    seconds: refreshCooldownSeconds(),
    next_allowed_at: remainingSeconds > 0 ? nextAllowedAt : undefined,
    remaining_seconds: remainingSeconds > 0 ? remainingSeconds : undefined,
  };
}

export function privateNoStoreHeaders(): HeadersInit {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    Vary: "Cookie",
  };
}

async function acquireCooldown(userKey: string, nowMs: number): Promise<{ blocked: boolean; nextAllowedAt: string }> {
  const memoryUntil = memoryCooldowns.get(userKey);
  if (secondsRemaining(memoryUntil, nowMs) > 0 && !supabaseAdminConfig()) {
    return { blocked: true, nextAllowedAt: memoryUntil as string };
  }

  const config = supabaseAdminConfig();
  if (config) {
    try {
      const response = await fetchWithTimeout(`${config.url}/rest/v1/rpc/${COOLDOWN_RPC}`, {
        method: "POST",
        headers: supabaseHeaders(config.key),
        body: JSON.stringify({
          p_user_key: userKey,
          p_cooldown_seconds: refreshCooldownSeconds(),
        }),
      });
      if (response.ok) {
        const rows = (await response.json()) as AcquireCooldownRow[] | AcquireCooldownRow;
        const row = Array.isArray(rows) ? rows[0] : rows;
        const nextAllowedAt = row?.cooldown_until;
        if (nextAllowedAt) {
          memoryCooldowns.set(userKey, nextAllowedAt);
          return { blocked: row.acquired === false, nextAllowedAt };
        }
      } else {
        console.warn("stock_refresh_cooldown_acquire_failed", { status: response.status });
      }
    } catch (error) {
      console.warn("stock_refresh_cooldown_acquire_failed", { error: error instanceof Error ? error.message : "unknown" });
    }
  }

  return acquireMemoryCooldown(userKey, nowMs);
}

function acquireMemoryCooldown(userKey: string, nowMs: number): { blocked: boolean; nextAllowedAt: string } {
  const existingUntil = memoryCooldowns.get(userKey);
  if (secondsRemaining(existingUntil, nowMs) > 0) {
    return { blocked: true, nextAllowedAt: existingUntil as string };
  }

  const nextAllowedAt = new Date(nowMs + refreshCooldownSeconds() * 1000).toISOString();
  memoryCooldowns.set(userKey, nextAllowedAt);
  return { blocked: false, nextAllowedAt };
}

function statusFromUntil(
  identity: { userId: string; userKey: string; shouldSetCookie: boolean; cookieValue: string },
  nextAllowedAt: string | undefined,
  nowMs: number,
  blockedOverride?: boolean
): RefreshCooldownStatus {
  const remainingSeconds = secondsRemaining(nextAllowedAt, nowMs);
  return {
    blocked: blockedOverride ?? remainingSeconds > 0,
    userId: identity.userId,
    userKey: identity.userKey,
    nextAllowedAt: remainingSeconds > 0 ? nextAllowedAt : undefined,
    remainingSeconds: remainingSeconds > 0 ? remainingSeconds : undefined,
    shouldSetCookie: identity.shouldSetCookie,
    cookieValue: identity.cookieValue,
  };
}

function secondsRemaining(nextAllowedAt: string | undefined, nowMs: number): number {
  if (!nextAllowedAt) return 0;
  const parsed = Date.parse(nextAllowedAt);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.ceil((parsed - nowMs) / 1000));
}

function refreshUserIdentity(request: NextRequest) {
  const rawCookie = request.cookies.get(COOKIE_NAME)?.value;
  const parsedUserId = parseRefreshCookie(rawCookie);
  const userId = parsedUserId || networkBoundRefreshUserId(request);
  const cookieValue = signRefreshUserId(userId);
  return {
    userId,
    userKey: hashUserId(userId),
    cookieValue,
    shouldSetCookie: rawCookie !== cookieValue,
  };
}

function hashUserId(userId: string): string {
  return createHash("sha256").update(userId).digest("hex");
}

function parseRefreshCookie(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const [userId, signature] = value.split(".", 2);
  if (!validUserId(userId)) return undefined;
  if (!signature) return process.env.NODE_ENV === "production" ? undefined : userId;
  return verifySignature(userId, signature) ? userId : undefined;
}

function signRefreshUserId(userId: string): string {
  return `${userId}.${signatureFor(userId)}`;
}

function signatureFor(userId: string): string {
  const secret = cookieSecret();
  return createHmac("sha256", secret).update(userId).digest("base64url");
}

function verifySignature(userId: string, signature: string): boolean {
  const expected = signatureFor(userId);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function cookieSecret(): string {
  const secret = envValue("STOCK_REFRESH_COOKIE_SECRET");
  if (strictSecretRuntime()) {
    if (!secret || secret.length < 32) {
      throw new Error("STOCK_REFRESH_COOKIE_SECRET must be at least 32 characters in production.");
    }
    return secret;
  }
  return secret || envValue("NEXTAUTH_SECRET") || FALLBACK_COOKIE_SECRET;
}

function validUserId(value: string | undefined): value is string {
  return !!value && /^[a-zA-Z0-9-]{20,80}$/.test(value);
}

function networkBoundRefreshUserId(request: NextRequest): string {
  return `ip-${clientNetworkRateLimitKey(request).slice(0, 64)}`;
}

function strictSecretRuntime(): boolean {
  return process.env.NODE_ENV === "production" || Boolean(envValue("VERCEL_ENV"));
}
