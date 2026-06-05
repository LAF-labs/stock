import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
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
          "script-src 'self' 'unsafe-inline'",
          "connect-src 'self'",
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
  outputFileTracingIncludes: {
    "/api/quote": ["./scripts/fetch_yfinance_score.py", "./requirements.txt"],
    "/api/score": ["./scripts/fetch_yfinance_score.py", "./requirements.txt"],
    "/api/score/batch": ["./scripts/fetch_yfinance_score.py", "./requirements.txt"],
  },
  outputFileTracingExcludes: {
    "/api/quote": ["./next.config.ts"],
    "/api/score": ["./next.config.ts"],
    "/api/score/batch": ["./next.config.ts"],
  },
};

export default nextConfig;
