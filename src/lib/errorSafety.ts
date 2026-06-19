import { envValue } from "@/lib/supabaseRest";

const SECRET_ENV_NAMES = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_ACCESS_TOKEN",
  "STOCK_API_APP_KEY",
  "STOCK_API_APP_SECRET",
  "KIS_APP_KEY",
  "KIS_APP_SECRET",
  "TOSS_INVEST_CLIENT_ID",
  "TOSS_INVEST_CLIENT_SECRET",
  "TOSS_INVEST_API_KEY",
  "TOSS_INVEST_SECRET_KEY",
  "STOCK_REFRESH_COOKIE_SECRET",
  "STOCK_RATE_LIMIT_SECRET",
  "MARKET_DATA_INTERNAL_TOKEN",
] as const;

export function safeErrorMessage(error: unknown, fallback = "unknown"): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : fallback;
  const redacted = redactSecrets(raw).replace(/\s+/g, " ").trim();
  return redacted.slice(0, 240) || fallback;
}

export function publicRefreshErrorCode(error: unknown): string {
  if (error instanceof Error && error.name) return "refresh_failed";
  return "refresh_failed";
}

function redactSecrets(value: string): string {
  let output = value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "Bearer [redacted]")
    .replace(/(appsecret|app_secret|service_role|apikey|authorization)=?[:\s]+[A-Za-z0-9._~+/=-]{12,}/gi, "$1=[redacted]");

  for (const name of SECRET_ENV_NAMES) {
    const secret = envValue(name);
    if (!secret || secret.length < 8) continue;
    output = output.split(secret).join("[redacted]");
  }
  return output;
}
