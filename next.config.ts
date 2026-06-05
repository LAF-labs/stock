import type { NextConfig } from "next";

const includePythonCollector =
  process.env.INCLUDE_PYTHON_COLLECTOR === "1"
  || process.env.STOCK_DATA_RUNTIME === "python"
  || process.env.STOCK_DATA_BACKEND === "python";

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
    ];

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
          "/api/quote": ["./scripts/fetch_yfinance_score.py", "./requirements.txt"],
          "/api/score": ["./scripts/fetch_yfinance_score.py", "./requirements.txt"],
          "/api/score/batch": ["./scripts/fetch_yfinance_score.py", "./requirements.txt"],
        },
      }
    : {}),
  outputFileTracingExcludes: {
    "/api/quote": ["./next.config.ts"],
    "/api/score": ["./next.config.ts"],
    "/api/score/batch": ["./next.config.ts"],
  },
};

export default nextConfig;
