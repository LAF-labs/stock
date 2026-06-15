import test from "node:test";
import assert from "node:assert/strict";

import { marketCapPendingRetryDelayMs } from "../src/components/useMarketCapDashboardQuery";
import type { MarketCapApiResponse } from "../src/lib/marketCapRankingTypes";

test("market cap pending responses retry with the 202 CDN window", () => {
  const payload = {
    ok: false,
    cache: {
      state: "miss",
      scope: "all",
      refreshStarted: true,
    },
    error: "snapshot_pending",
    message: "시가총액 스냅샷을 준비 중입니다.",
  } satisfies MarketCapApiResponse;

  assert.equal(marketCapPendingRetryDelayMs(payload), 5_000);
});

test("market cap ready responses do not schedule a retry", () => {
  const payload = {
    ok: true,
    cache: {
      state: "fresh",
      scope: "all",
    },
  } satisfies MarketCapApiResponse;

  assert.equal(marketCapPendingRetryDelayMs(payload), undefined);
});
