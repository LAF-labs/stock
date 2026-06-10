import { numericEnv } from "@/lib/supabaseRest";

type VercelCdnCacheOptions = {
  sMaxAgeSeconds: number;
  staleWhileRevalidateSeconds?: number;
  staleIfErrorSeconds?: number;
  browserMaxAgeSeconds?: number;
};

export function publicVercelCdnCacheHeaders(options: VercelCdnCacheOptions): HeadersInit {
  const browserMaxAgeSeconds = Math.max(0, Math.floor(options.browserMaxAgeSeconds ?? 0));
  const cdnParts = ["public", `s-maxage=${Math.max(1, Math.floor(options.sMaxAgeSeconds))}`];
  const staleWhileRevalidateSeconds = Math.max(0, Math.floor(options.staleWhileRevalidateSeconds ?? 0));
  const staleIfErrorSeconds = Math.max(0, Math.floor(options.staleIfErrorSeconds ?? 0));

  if (staleWhileRevalidateSeconds > 0) cdnParts.push(`stale-while-revalidate=${staleWhileRevalidateSeconds}`);
  if (staleIfErrorSeconds > 0) cdnParts.push(`stale-if-error=${staleIfErrorSeconds}`);

  return {
    "Cache-Control": browserMaxAgeSeconds > 0 ? `public, max-age=${browserMaxAgeSeconds}` : "public, max-age=0, must-revalidate",
    "Vercel-CDN-Cache-Control": cdnParts.join(", "),
  };
}

export function stockPartialResponseCacheHeaders(): HeadersInit {
  return publicVercelCdnCacheHeaders({
    sMaxAgeSeconds: numericEnv("STOCK_PARTIAL_HTTP_CDN_CACHE_SECONDS", 1),
    staleIfErrorSeconds: numericEnv("STOCK_PARTIAL_HTTP_STALE_IF_ERROR_SECONDS", 30),
  });
}
