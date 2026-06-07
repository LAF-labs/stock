import type { NextRequest } from "next/server";
import { acquireRateLimit, clientRateLimitKey, rateLimitHeaders, type RateLimitPolicy } from "@/lib/apiRateLimit";
import { jsonError } from "@/lib/apiGuards";
import { safeErrorMessage } from "@/lib/errorSafety";
import { privateNoStoreHeaders } from "@/lib/refreshCooldown";

export async function guardedRateLimit(
  request: NextRequest,
  policy: RateLimitPolicy,
  logLabel: string,
  message = "요청이 너무 많아요. 잠시 후 다시 시도해주세요."
) {
  try {
    const rateLimit = await acquireRateLimit(clientRateLimitKey(request), policy);
    if (!rateLimit.allowed) {
      return {
        ok: false as const,
        response: jsonError(429, "rate_limited", message, rateLimitHeaders(rateLimit)),
      };
    }
    return { ok: true as const, rateLimit };
  } catch (error) {
    console.error(`${logLabel}_rate_limit_guard_failed`, { error: safeErrorMessage(error) });
    return {
      ok: false as const,
      response: jsonError(
        500,
        "server_misconfigured",
        "서버 보안 설정을 확인해야 해요. 잠시 후 다시 시도해주세요.",
        privateNoStoreHeaders()
      ),
    };
  }
}

