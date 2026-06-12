"use client";

import { useEffect, useState } from "react";
import { marketCapDashboardHref } from "@/components/marketCapDashboardHelpers";
import type { MarketCapApiResponse, MarketCapScope } from "@/lib/marketCapRankingTypes";

const MARKET_CAP_PENDING_RETRY_MS = 2_000;

type MarketCapDashboardQueryState =
  | { status: "loading" }
  | { status: "success"; payload: MarketCapApiResponse }
  | { status: "pending"; payload: MarketCapApiResponse }
  | { status: "error"; error: string };

export function marketCapPendingRetryDelayMs(payload: MarketCapApiResponse): number | undefined {
  return payload.ok ? undefined : MARKET_CAP_PENDING_RETRY_MS;
}

export function useMarketCapDashboardQuery(scope: MarketCapScope, sector: string | undefined): MarketCapDashboardQueryState {
  const [state, setState] = useState<MarketCapDashboardQueryState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    let retryTimer: number | undefined;

    function clearRetry() {
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
        retryTimer = undefined;
      }
    }

    function scheduleRetry(payload: MarketCapApiResponse) {
      const delayMs = marketCapPendingRetryDelayMs(payload);
      if (delayMs === undefined || controller.signal.aborted) return;
      retryTimer = window.setTimeout(() => {
        retryTimer = undefined;
        void load(false);
      }, delayMs);
    }

    async function load(showLoading: boolean) {
      clearRetry();
      if (showLoading) setState({ status: "loading" });
      try {
        const response = await fetch(apiHref(scope, sector), {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        const payload = await response.json() as MarketCapApiResponse;
        if (!response.ok && response.status !== 202) {
          setState({ status: "error", error: payload.message || payload.error || "시가총액 데이터를 불러오지 못했어요." });
          return;
        }
        setState({ status: payload.ok ? "success" : "pending", payload });
        scheduleRetry(payload);
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({ status: "error", error: error instanceof Error ? error.message : "시가총액 데이터를 불러오지 못했어요." });
      }
    }

    void load(true);
    return () => {
      controller.abort();
      clearRetry();
    };
  }, [scope, sector]);

  return state;
}

function apiHref(scope: MarketCapScope, sector: string | undefined): string {
  return marketCapDashboardHref({ scope, sector }).replace(/^\/market-cap/, "/api/market-cap");
}
