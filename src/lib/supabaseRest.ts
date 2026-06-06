export type SupabaseConfig = {
  url: string;
  key: string;
  keySource?: "publishable" | "service_role";
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
  const publishableKey = envValue("SUPABASE_PUBLISHABLE_KEY");
  const serviceRoleKey = envValue("SUPABASE_SERVICE_ROLE_KEY");
  const key = publishableKey || serviceRoleKey;
  if (!url || !key) return undefined;
  return { url, key, keySource: publishableKey ? "publishable" : "service_role" };
}

export function supabaseAdminConfig(): SupabaseConfig | undefined {
  const url = envValue("SUPABASE_URL")?.replace(/\/$/, "");
  const key = envValue("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return undefined;
  return { url, key, keySource: "service_role" };
}

export function supabaseHeaders(key: string) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

export async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 2_500): Promise<Response> {
  const timeoutController = new AbortController();
  const { signal, cleanup } = combineAbortSignals(init.signal, timeoutController.signal);
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal,
    });
  } finally {
    clearTimeout(timer);
    cleanup();
  }
}

function combineAbortSignals(callerSignal: AbortSignal | null | undefined, timeoutSignal: AbortSignal) {
  if (!callerSignal) {
    return {
      signal: timeoutSignal,
      cleanup: () => undefined,
    };
  }

  if (callerSignal.aborted) {
    return {
      signal: callerSignal,
      cleanup: () => undefined,
    };
  }

  const controller = new AbortController();
  const abort = () => controller.abort();
  callerSignal.addEventListener("abort", abort, { once: true });
  timeoutSignal.addEventListener("abort", abort, { once: true });

  return {
    signal: controller.signal,
    cleanup: () => {
      callerSignal.removeEventListener("abort", abort);
      timeoutSignal.removeEventListener("abort", abort);
    },
  };
}
