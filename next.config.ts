import type { NextConfig } from "next";

type BuildEnv = Record<string, string | undefined>;

export const PYTHON_COLLECTOR_TRACE_INCLUDES = [
  "./scripts/fetch_stock_score.py",
  "./scripts/stock_score/**/*.py",
  "./requirements.txt",
];

export const SYMBOL_SEARCH_TRACE_INCLUDES = ["./src/data/symbols.generated.json"];

export const SERVER_TRACE_EXCLUDES = [
  "./next.config.ts",
  "./services/market-data/target/**",
  "./output/**",
];

export function shouldIncludePythonCollector(env: BuildEnv = process.env): boolean {
  const requested =
    env.INCLUDE_PYTHON_COLLECTOR === "1"
    || env.STOCK_DATA_RUNTIME === "python"
    || env.STOCK_DATA_BACKEND === "python";
  if (!requested) return false;
  if (env.VERCEL === "1" && env.STOCK_ALLOW_VERCEL_PYTHON_RUNTIME !== "1") return false;
  return true;
}

const includePythonCollector = shouldIncludePythonCollector();
const scoreTraceIncludes = includePythonCollector
  ? [...SYMBOL_SEARCH_TRACE_INCLUDES, ...PYTHON_COLLECTOR_TRACE_INCLUDES]
  : SYMBOL_SEARCH_TRACE_INCLUDES;

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    const isProduction = process.env.NODE_ENV === "production";
    const scriptSrc = ["script-src", "'self'", "'unsafe-inline'"];
    const connectSrc = ["connect-src", "'self'"];
    if (!isProduction) {
      scriptSrc.push("'unsafe-eval'");
      connectSrc.push("http://localhost:*", "http://127.0.0.1:*", "ws://localhost:*", "ws://127.0.0.1:*");
    }

    const securityHeaders = [
      {
        key: "Content-Security-Policy",
        value: [
          "default-src 'self'",
          "base-uri 'self'",
          "frame-ancestors 'none'",
          "object-src 'none'",
          "img-src 'self' data:",
          "font-src 'self' data:",
          "style-src 'self' 'unsafe-inline'",
          scriptSrc.join(" "),
          connectSrc.join(" "),
          "form-action 'self'",
        ].join("; "),
      },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
    ];
    if (isProduction) {
      securityHeaders.push({
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains; preload",
      });
    }

    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
  ...(includePythonCollector
    ? {
        outputFileTracingIncludes: {
          "/api/symbols": SYMBOL_SEARCH_TRACE_INCLUDES,
          "/api/score": scoreTraceIncludes,
          "/api/score/batch": PYTHON_COLLECTOR_TRACE_INCLUDES,
          "/technical": SYMBOL_SEARCH_TRACE_INCLUDES,
        },
      }
    : {
        outputFileTracingIncludes: {
          "/api/symbols": SYMBOL_SEARCH_TRACE_INCLUDES,
          "/api/score": scoreTraceIncludes,
          "/technical": SYMBOL_SEARCH_TRACE_INCLUDES,
        },
      }),
  outputFileTracingExcludes: {
    "/api/quote": SERVER_TRACE_EXCLUDES,
    "/api/score": SERVER_TRACE_EXCLUDES,
    "/api/score/batch": SERVER_TRACE_EXCLUDES,
  },
};

export default nextConfig;
