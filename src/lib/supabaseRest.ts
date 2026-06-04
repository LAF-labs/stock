export type SupabaseConfig = {
  url: string;
  key: string;
};

export function envValue(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

export function numericEnv(name: string, fallback: number): number {
  const parsed = Number(envValue(name));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function supabaseConfig(): SupabaseConfig | undefined {
  return supabaseReadConfig();
}

export function supabaseReadConfig(): SupabaseConfig | undefined {
  const url = envValue("SUPABASE_URL")?.replace(/\/$/, "");
  const key = envValue("SUPABASE_SERVICE_ROLE_KEY") || envValue("SUPABASE_PUBLISHABLE_KEY");
  if (!url || !key) return undefined;
  return { url, key };
}

export function supabaseAdminConfig(): SupabaseConfig | undefined {
  const url = envValue("SUPABASE_URL")?.replace(/\/$/, "");
  const key = envValue("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return undefined;
  return { url, key };
}

export function supabaseHeaders(key: string) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

export async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 2_500): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: init.signal || controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}
