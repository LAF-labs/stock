import { createHash, randomUUID } from "node:crypto";
import { fetchWithTimeout, supabaseAdminConfig, supabaseHeaders } from "@/lib/supabaseRest";

export type KisTokenCacheEntry = {
  accessToken: string;
  expiresAtMs: number;
};

type KisTokenCacheRow = {
  access_token?: unknown;
  expires_at?: unknown;
};

type KisTokenLockRow = {
  acquired?: unknown;
};

const KIS_TOKEN_TABLE = "kis_access_tokens";
const KIS_TOKEN_LOCK_RPC = "acquire_kis_token_issue_lock";
const TOKEN_REFRESH_BUFFER_MS = 300_000;

export function kisTokenCacheKey(input: { baseUrl: string; appKey: string }): string {
  return createHash("sha256").update(`${input.baseUrl}:${input.appKey}`).digest("hex").slice(0, 16);
}

export function isFreshKisToken(entry: KisTokenCacheEntry | undefined, nowMs = Date.now()): entry is KisTokenCacheEntry {
  return !!entry?.accessToken && Number.isFinite(entry.expiresAtMs) && entry.expiresAtMs > nowMs + TOKEN_REFRESH_BUFFER_MS;
}

export async function readSharedKisAccessToken(cacheKey: string): Promise<KisTokenCacheEntry | undefined> {
  const config = supabaseAdminConfig();
  if (!config) return undefined;

  const url = new URL(`${config.url}/rest/v1/${KIS_TOKEN_TABLE}`);
  url.searchParams.set("cache_key", `eq.${cacheKey}`);
  url.searchParams.set("select", "access_token,expires_at");
  url.searchParams.set("limit", "1");

  try {
    const response = await fetchWithTimeout(
      url.toString(),
      {
        headers: supabaseHeaders(config.key),
        cache: "no-store",
      },
      2_500
    );
    if (!response.ok) return undefined;
    const rows = (await response.json().catch(() => undefined)) as KisTokenCacheRow[] | undefined;
    const row = Array.isArray(rows) ? rows[0] : undefined;
    const entry = parseSharedTokenRow(row);
    return isFreshKisToken(entry) ? entry : undefined;
  } catch {
    return undefined;
  }
}

export async function acquireSharedKisTokenIssueLock(cacheKey: string, lockSeconds = 30): Promise<boolean | undefined> {
  const config = supabaseAdminConfig();
  if (!config) return undefined;

  try {
    const response = await fetchWithTimeout(
      `${config.url}/rest/v1/rpc/${KIS_TOKEN_LOCK_RPC}`,
      {
        method: "POST",
        headers: supabaseHeaders(config.key),
        body: JSON.stringify({
          p_cache_key: cacheKey,
          p_lock_seconds: lockSeconds,
          p_locked_by: `vercel-${randomUUID()}`,
        }),
        cache: "no-store",
      },
      2_500
    );
    if (!response.ok) return undefined;
    const payload = (await response.json().catch(() => undefined)) as boolean | KisTokenLockRow | KisTokenLockRow[] | undefined;
    if (typeof payload === "boolean") return payload;
    const row = Array.isArray(payload) ? payload[0] : payload;
    return typeof row?.acquired === "boolean" ? row.acquired : undefined;
  } catch {
    return undefined;
  }
}

export async function waitForSharedKisAccessToken(cacheKey: string, attempts = 3, delayMs = 750): Promise<KisTokenCacheEntry | undefined> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await sleep(delayMs);
    const token = await readSharedKisAccessToken(cacheKey);
    if (token) return token;
  }
  return undefined;
}

export async function writeSharedKisAccessToken(cacheKey: string, entry: KisTokenCacheEntry): Promise<boolean> {
  const config = supabaseAdminConfig();
  if (!config || !entry.accessToken || !Number.isFinite(entry.expiresAtMs) || entry.expiresAtMs <= Date.now()) return false;

  try {
    const response = await fetchWithTimeout(
      `${config.url}/rest/v1/${KIS_TOKEN_TABLE}?on_conflict=cache_key`,
      {
        method: "POST",
        headers: {
          ...supabaseHeaders(config.key),
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify({
          cache_key: cacheKey,
          access_token: entry.accessToken,
          expires_at: new Date(entry.expiresAtMs).toISOString(),
          issued_at: new Date().toISOString(),
          locked_until: null,
          locked_by: null,
        }),
        cache: "no-store",
      },
      2_500
    );
    return response.ok;
  } catch {
    return false;
  }
}

function parseSharedTokenRow(row: KisTokenCacheRow | undefined): KisTokenCacheEntry | undefined {
  const accessToken = typeof row?.access_token === "string" ? row.access_token.trim() : "";
  const expiresAtMs = typeof row?.expires_at === "string" ? Date.parse(row.expires_at) : Number.NaN;
  if (!accessToken || !Number.isFinite(expiresAtMs)) return undefined;
  return { accessToken, expiresAtMs };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
