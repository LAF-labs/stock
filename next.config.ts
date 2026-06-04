import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
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
