import { NextRequest, NextResponse } from "next/server";
import { apiLimitPolicy } from "@/lib/apiRateLimit";
import { jsonError } from "@/lib/apiGuards";
import { guardedRateLimit } from "@/lib/apiRequestGuards";
import { safeErrorMessage } from "@/lib/errorSafety";
import { acquireRefreshCooldown, applyRefreshUserCookie, cooldownPayload, privateNoStoreHeaders } from "@/lib/refreshCooldown";
import { userScoreRefreshPriority } from "@/lib/stockRefreshPriorities";
import { getStockChart } from "@/lib/stockChartCache";
import { isStockDataUnavailableError } from "@/lib/stockDataRuntime";
import { enqueueStockPendingPayload, optimisticStockPendingPayload, stockPartialResponseCacheHeaders, stockPendingJsonResponse } from "@/lib/stockPendingResponse";
import { attachChartPartToPayload, attachScoreParts, pendingPartialStockPayload, terminalUnavailableStockPayload } from "@/lib/stockPartsResponse";
import { readTerminalStockDisplayFailures } from "@/lib/stockRefreshFailures";
import { enqueueScoreRefreshAfterUnavailable, settleStockScore, waitForPartialStockScore } from "@/lib/stockScorePartialFastPath";
import { cleanView, getStockScore, responseCacheHeaders, statusFromPayload, type StockPayload, type StockScoreResult } from "@/lib/stockSnapshotCache";
import { enrichStockPayloadWithIndustryBenchmarks } from "@/lib/stockIndustryBenchmarkEnrichment";
import { enrichStockPayloadWithSymbolDisplay } from "@/lib/symbolSearch";
import { enrichStockPayloadWithSymbolProfile } from "@/lib/symbolProfiles";
import { technicalEligibilityForTicker, technicalUnsupportedProductPayload } from "@/lib/technicalAnalysisEligibility";
import { resolveTickerAlias } from "@/lib/tickerRef";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const tickerRef = resolveTickerAlias(request.nextUrl.searchParams.get("ticker"));
  if (!tickerRef.ok) {
    return jsonError(
      400,
      tickerRef.error,
      tickerRef.error === "missing_ticker" ? "조회할 티커를 입력해주세요." : "지원하지 않는 티커 형식이에요.",
      privateNoStoreHeaders()
    );
  }
  const ticker = tickerRef.ticker;
  const view = cleanView(request.nextUrl.searchParams.get("view"));
  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";
  const partial = request.nextUrl.searchParams.get("partial") === "1";
  const rateLimit = await guardedRateLimit(
    request,
    forceRefresh ? apiLimitPolicy("stock_score_refresh", 6, 900) : apiLimitPolicy("stock_score", 180, 60),
    "score"
  );
  if (!rateLimit.ok) return rateLimit.response;

  if (view === "technical") {
    const eligibility = await technicalEligibilityForTicker(ticker);
    if (!eligibility.eligible) {
      return NextResponse.json(technicalUnsupportedProductPayload(eligibility.ticker), { status: 400, headers: privateNoStoreHeaders() });
    }
  }

  let cooldown;
  try {
    cooldown = forceRefresh ? await acquireRefreshCooldown(request) : undefined;
  } catch (error) {
    console.error("score_refresh_cooldown_guard_failed", { error: safeErrorMessage(error) });
    return jsonError(
      500,
      "server_misconfigured",
      "서버 보안 설정을 확인해야 해요. 잠시 후 다시 시도해주세요.",
      privateNoStoreHeaders()
    );
  }

  if (cooldown?.blocked) {
    const response = NextResponse.json(
      {
        ok: false,
        error: "refresh_cooldown",
        message: "Manual refresh is cooling down.",
        refresh_cooldown: cooldownPayload(cooldown.nextAllowedAt),
      },
      { status: 429, headers: privateNoStoreHeaders() }
    );
    applyRefreshUserCookie(response, cooldown);
    return response;
  }

  try {
    const settledScorePromise = settleStockScore(getStockScore(ticker, view, { forceRefresh }));
    const earlyScore = partial && !forceRefresh ? await waitForPartialStockScore(settledScorePromise, { view }) : undefined;
    if (earlyScore?.status === "timeout") {
      const pendingInput = {
        kind: "score",
        ticker,
        view,
        priority: userScoreRefreshPriority(view, forceRefresh),
        reason: "snapshot_miss",
      } as const;
      const partialPayload = await pendingPartialStockPayload({ pending: optimisticStockPendingPayload(pendingInput), ticker, view });
      if (partialPayload) {
        enqueueScoreRefreshAfterUnavailable(settledScorePromise, pendingInput, { ticker, view });
        const response = NextResponse.json(partialPayload, { status: 200, headers: stockPartialResponseCacheHeaders() });
        if (cooldown) applyRefreshUserCookie(response, cooldown);
        return response;
      }
    } else if (earlyScore?.status === "rejected") {
      throw earlyScore.error;
    }

    const settledScore = earlyScore?.status === "fulfilled" ? earlyScore : await settledScorePromise;
    if (settledScore.status === "rejected") throw settledScore.error;
    const result = settledScore.value;
    const scorePayload = await attachChartForTechnicalView(attachScoreParts(result), ticker, view);
    const enrichedPayload = await enrichScorePayloadForView(scorePayload, view);
    const payload = forceRefresh
      ? {
          ...enrichedPayload,
          refresh_cooldown: cooldownPayload(cooldown?.nextAllowedAt),
        }
      : enrichedPayload;
    const response = NextResponse.json(
      payload,
      {
        status: statusFromPayload(result.payload),
        headers: forceRefresh ? privateNoStoreHeaders() : responseCacheHeaders(result),
      }
    );
    if (cooldown) applyRefreshUserCookie(response, cooldown);
    return response;
  } catch (error) {
    if (isStockDataUnavailableError(error)) {
      console.info("stock_snapshot_unavailable", { ticker, view, reason: error.payload.reason });
      const terminalFailures = await readTerminalStockDisplayFailures(ticker, view);
      if (terminalFailures.length) {
        const terminalPayload = await terminalUnavailableStockPayload({ ticker, view, unavailableParts: terminalFailures });
        if (terminalPayload) {
          const response = NextResponse.json(terminalPayload, { status: 200, headers: stockPartialResponseCacheHeaders() });
          if (cooldown) applyRefreshUserCookie(response, cooldown);
          return response;
        }
      }
      const pendingInput = {
        kind: "score",
        ticker,
        view,
        priority: userScoreRefreshPriority(view, forceRefresh),
        reason: error.payload.reason,
      } as const;
      const pendingPayloadPromise = enqueueStockPendingPayload(pendingInput);
      if (partial) {
        const partialPayload = await pendingPartialStockPayload({ pending: optimisticStockPendingPayload(pendingInput), ticker, view });
        if (partialPayload) {
          void pendingPayloadPromise.catch(() => undefined);
          const response = NextResponse.json(partialPayload, { status: 200, headers: cooldown ? privateNoStoreHeaders() : stockPartialResponseCacheHeaders() });
          if (cooldown) applyRefreshUserCookie(response, cooldown);
          return response;
        }
      }
      const pendingPayload = await pendingPayloadPromise;
      const response = stockPendingJsonResponse(pendingPayload);
      if (cooldown) applyRefreshUserCookie(response, cooldown);
      return response;
    }

    console.warn("stock_collector_unreachable", { ticker, view, error: safeErrorMessage(error) });
    const response = NextResponse.json(
      {
        ok: false,
        error: "collector_unreachable",
        message: "Stock collector is unavailable.",
      },
      { status: 502, headers: privateNoStoreHeaders() }
    );
    if (cooldown) applyRefreshUserCookie(response, cooldown);
    return response;
  }
}

async function enrichScorePayloadForView(payload: StockPayload, view: ReturnType<typeof cleanView>): Promise<StockPayload> {
  if (view === "technical") return enrichStockPayloadWithSymbolDisplay(payload);
  const withProfile = await enrichStockPayloadWithSymbolProfile(payload);
  return enrichStockPayloadWithSymbolDisplay(await enrichStockPayloadWithIndustryBenchmarks(withProfile));
}

async function attachChartForTechnicalView(payload: StockPayload, ticker: string, view: ReturnType<typeof cleanView>): Promise<StockPayload> {
  if (view !== "technical" || hasUsableChartSeries(payload.chart_series)) return payload;
  try {
    const chartResult = await getStockChart(ticker, { enqueueOnMiss: false });
    return attachChartPartToPayload(payload, chartResult);
  } catch {
    // Keep going: older deployments may have detail score snapshots with chart_series
    // before the dedicated chart snapshot lane is populated.
  }
  try {
    const detailResult = await getStockScore(ticker, "detail");
    return attachChartFromScoreSnapshot(payload, detailResult);
  } catch {
    return payload;
  }
}

function attachChartFromScoreSnapshot(payload: StockPayload, result: StockScoreResult): StockPayload {
  if (!hasUsableChartSeries(result.payload.chart_series)) return payload;
  return {
    ...payload,
    chart_series: result.payload.chart_series,
    parts: {
      ...(payload.parts && typeof payload.parts === "object" && !Array.isArray(payload.parts) ? payload.parts : {}),
      chart: {
        state: result.cache.state,
        source: result.cache.source,
        fetched_at: result.cache.fetchedAt,
        expires_at: result.cache.expiresAt,
        refresh_started: result.cache.refreshStarted,
        refresh_error: result.cache.refreshError,
      },
    },
  };
}

function hasUsableChartSeries(value: unknown): boolean {
  return Array.isArray(value) && value.length > 1;
}
