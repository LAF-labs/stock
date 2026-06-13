import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { envValue, fetchWithTimeout, supabaseAdminConfig, supabaseHeaders } from "@/lib/supabaseRest";

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

type LocalKisTokenPayload = {
  access_token?: unknown;
  expires_at?: unknown;
};

const KIS_TOKEN_TABLE = "kis_access_tokens";
const KIS_TOKEN_LOCK_RPC = "acquire_kis_token_issue_lock";
const TOKEN_REFRESH_BUFFER_MS = 300_000;
const LOCAL_TOKEN_LOCK_TIMEOUT_MS = 12_000;
const LOCAL_TOKEN_LOCK_STALE_MS = 30_000;

export function kisTokenCacheKey(input: { baseUrl: string; appKey: string }): string {
  return createHash("sha256").update(`${input.baseUrl}:${input.appKey}`).digest("hex").slice(0, 16);
}

export function isFreshKisToken(entry: KisTokenCacheEntry | undefined, nowMs = Date.now()): entry is KisTokenCacheEntry {
  return !!entry?.accessToken && Number.isFinite(entry.expiresAtMs) && entry.expiresAtMs > nowMs + TOKEN_REFRESH_BUFFER_MS;
}

export async function readLocalKisAccessToken(cacheKey: string): Promise<KisTokenCacheEntry | undefined> {
  if (!localKisTokenCacheEnabled()) return undefined;
  try {
    const payload = JSON.parse(await readFile(localKisTokenCachePath(cacheKey), "utf8")) as LocalKisTokenPayload;
    const entry = parseLocalTokenPayload(payload);
    return isFreshKisToken(entry) ? entry : undefined;
  } catch {
    return undefined;
  }
}

export async function writeLocalKisAccessToken(cacheKey: string, entry: KisTokenCacheEntry): Promise<boolean> {
  if (!localKisTokenCacheEnabled() || !isFreshKisToken(entry)) return false;
  try {
    const cachePath = localKisTokenCachePath(cacheKey);
    await mkdir(path.dirname(cachePath), { recursive: true });
    const tmpPath = localKisTokenTmpPath(cacheKey);
    await writeFile(
      tmpPath,
      JSON.stringify({ access_token: entry.accessToken, expires_at: entry.expiresAtMs / 1000 }),
      "utf8"
    );
    await rename(tmpPath, cachePath);
    return true;
  } catch {
    return false;
  }
}

export async function deleteLocalKisAccessToken(cacheKey: string): Promise<boolean> {
  if (!localKisTokenCacheEnabled()) return false;
  try {
    await unlink(localKisTokenCachePath(cacheKey));
    return true;
  } catch {
    return false;
  }
}

export async function withLocalKisTokenIssueLock<T>(cacheKey: string, callback: () => Promise<T>): Promise<T> {
  if (!localKisTokenCacheEnabled()) return callback();
  const release = await acquireLocalKisTokenIssueLock(cacheKey);
  try {
    return await callback();
  } finally {
    await release?.();
  }
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

export async function deleteSharedKisAccessToken(cacheKey: string): Promise<boolean> {
  const config = supabaseAdminConfig();
  if (!config) return false;

  const url = new URL(`${config.url}/rest/v1/${KIS_TOKEN_TABLE}`);
  url.searchParams.set("cache_key", `eq.${cacheKey}`);

  try {
    const response = await fetchWithTimeout(
      url.toString(),
      {
        method: "DELETE",
        headers: supabaseHeaders(config.key),
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

function parseLocalTokenPayload(payload: LocalKisTokenPayload | undefined): KisTokenCacheEntry | undefined {
  const accessToken = typeof payload?.access_token === "string" ? payload.access_token.trim() : "";
  const rawExpiresAt = Number(payload?.expires_at);
  const expiresAtMs = rawExpiresAt > 10_000_000_000 ? rawExpiresAt : rawExpiresAt * 1000;
  if (!accessToken || !Number.isFinite(expiresAtMs)) return undefined;
  return { accessToken, expiresAtMs };
}

function localKisTokenCacheEnabled(): boolean {
  const value = (envValue("STOCK_KIS_LOCAL_TOKEN_CACHE") || "").trim().toLowerCase();
  return value !== "0" && value !== "false" && value !== "off";
}

function localKisTokenCacheDir(): string {
  const configured = envValue("STOCK_KIS_TOKEN_CACHE_DIR");
  return configured ? path.resolve(configured) : process.cwd();
}

function localKisTokenCachePath(cacheKey: string): string {
  return path.join(localKisTokenCacheDir(), `.kis_token_cache_${cacheKey}.json`);
}

function localKisTokenTmpPath(cacheKey: string): string {
  return path.join(localKisTokenCacheDir(), `.kis_token_cache_${cacheKey}.tmp`);
}

function localKisTokenLockPath(cacheKey: string): string {
  return path.join(localKisTokenCacheDir(), `.kis_token_cache_${cacheKey}.ts.lock`);
}

async function acquireLocalKisTokenIssueLock(cacheKey: string): Promise<(() => Promise<void>) | undefined> {
  const lockPath = localKisTokenLockPath(cacheKey);
  const startedAt = Date.now();
  await mkdir(path.dirname(lockPath), { recursive: true }).catch(() => undefined);

  while (Date.now() - startedAt <= LOCAL_TOKEN_LOCK_TIMEOUT_MS) {
    try {
      await mkdir(lockPath);
      return async () => {
        await rm(lockPath, { recursive: true, force: true }).catch(() => undefined);
      };
    } catch (error) {
      if (!isFileExistsError(error)) return undefined;
      await removeStaleLocalKisTokenLock(lockPath);
      await sleep(100);
    }
  }

  return undefined;
}

async function removeStaleLocalKisTokenLock(lockPath: string): Promise<void> {
  try {
    const stats = await stat(lockPath);
    if (Date.now() - stats.mtimeMs > LOCAL_TOKEN_LOCK_STALE_MS) {
      await rm(lockPath, { recursive: true, force: true });
    }
  } catch {
    // Another process may have released the lock between mkdir attempts.
  }
}

function isFileExistsError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === "EEXIST";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
