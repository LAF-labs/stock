import test from "node:test";
import assert from "node:assert/strict";

import { buildStockDisplayPayload, displayLaneTimeoutMs, readStockDisplayScoreSource } from "../src/lib/stockDisplayModel";
import { partialStockScoreTimeoutMs } from "../src/lib/stockScorePartialFastPath";
import { providerEmptyError } from "../src/lib/stockProviderErrors";

test("display model keeps price and chart lanes fast while score uses the interactive score SLA", () => {
  assert.equal(displayLaneTimeoutMs("price"), 900);
  assert.equal(displayLaneTimeoutMs("chart"), 1_000);
  assert.equal(displayLaneTimeoutMs("score"), partialStockScoreTimeoutMs("detail"));
});

test("display model returns identity-only payload while recovering core parts", async () => {
  const payload = await buildStockDisplayPayload({
    ticker: "KR:005930",
    view: "detail",
    sources: {
      identity: async () => ({ ticker: "KR:005930", market: "KR", symbol: "005930", name: "삼성전자" }),
      price: async () => undefined,
      chart: async () => undefined,
      score: async () => undefined,
    },
  });

  assert.equal(payload.ok, true);
  assert.equal(payload.identity.value.name, "삼성전자");
  assert.deepEqual(payload.completion.presentParts, ["identity"]);
  assert.deepEqual(payload.completion.recoveringParts, ["price", "chart", "score"]);
  assert.equal(payload.refresh.active, true);
});

test("display model keeps provider timeouts recoverable instead of terminal", async () => {
  const payload = await buildStockDisplayPayload({
    ticker: "US:KO",
    view: "technical",
    sources: {
      identity: async () => ({ ticker: "US:KO", market: "US", symbol: "KO", name: "Coca-Cola" }),
      price: async () => ({ latest_price: 60, latest_price_label: "$60.00" }),
      chart: async () => {
        throw new Error("provider timeout");
      },
      score: async () => undefined,
    },
  });

  assert.equal(payload.ok, true);
  assert.equal(payload.price?.value.latest_price, 60);
  assert.deepEqual(payload.completion.unavailableParts, []);
  assert.deepEqual(payload.completion.recoveringParts, ["chart", "technical"]);
});

test("display model marks provider-confirmed empty lanes unavailable instead of recovering forever", async () => {
  const payload = await buildStockDisplayPayload({
    ticker: "US:DELISTED",
    view: "detail",
    sources: {
      identity: async () => ({ ticker: "US:DELISTED", market: "US", symbol: "DELISTED", name: "Delisted Inc" }),
      price: async () => {
        throw providerEmptyError("No data found, symbol may be delisted");
      },
      chart: async () => {
        throw providerEmptyError("empty daily chart");
      },
      score: async () => {
        throw providerEmptyError("kis_not_found");
      },
    },
  });

  assert.deepEqual(payload.completion.presentParts, ["identity"]);
  assert.deepEqual(payload.completion.missingParts, []);
  assert.deepEqual(payload.completion.recoveringParts, []);
  assert.deepEqual(payload.completion.unavailableParts, [
    { part: "price", reason: "provider_confirmed_empty" },
    { part: "chart", reason: "provider_confirmed_empty" },
    { part: "score", reason: "provider_confirmed_empty" },
  ]);
  assert.equal(payload.refresh.active, false);
});

test("display model uses terminal refresh failures even when provider lanes miss their deadline", async () => {
  const payload = await buildStockDisplayPayload({
    ticker: "US:DEAD",
    view: "technical",
    sources: {
      identity: async () => ({ ticker: "US:DEAD", market: "US", symbol: "DEAD", name: "Dead Provider" }),
      price: async () => undefined,
      chart: async () => undefined,
      score: async () => undefined,
      terminalFailures: async () => [
        { part: "price", reason: "provider_confirmed_empty" },
        { part: "chart", reason: "provider_confirmed_empty" },
        { part: "technical", reason: "provider_confirmed_empty" },
      ],
    },
  });

  assert.deepEqual(payload.completion.missingParts, []);
  assert.deepEqual(payload.completion.recoveringParts, []);
  assert.deepEqual(payload.completion.unavailableParts, [
    { part: "price", reason: "provider_confirmed_empty" },
    { part: "chart", reason: "provider_confirmed_empty" },
    { part: "technical", reason: "provider_confirmed_empty" },
  ]);
  assert.equal(payload.refresh.active, false);
});

test("display model normalizes legacy app names in score payloads", async () => {
  const payload = await buildStockDisplayPayload({
    ticker: "KR:005930",
    view: "detail",
    sources: {
      identity: async () => ({ ticker: "KR:005930", market: "KR", symbol: "005930", name: "삼성전자" }),
      price: async () => ({ latest_price: 70000 }),
      chart: async () => ({ chart_series: [{ date: "2026-06-09", close: 69000 }, { date: "2026-06-10", close: 70000 }] }),
      score: async () => ({ app: "Stock Score Reader", score: 70, quality_score: 70 }),
    },
  });

  assert.equal(payload.score?.value.app, "스톡스토커");
});

test("display model marks chart and technical present independently", async () => {
  const payload = await buildStockDisplayPayload({
    ticker: "US:KO",
    view: "technical",
    sources: {
      identity: async () => ({ ticker: "US:KO", market: "US", symbol: "KO", name: "Coca-Cola" }),
      price: async () => ({ latest_price: 60 }),
      chart: async () => ({ chart_series: [{ date: "2026-06-08", close: 59 }, { date: "2026-06-09", close: 60 }] }),
      score: async () => ({ technical_analysis: { type: "technical_analysis", signals: [{ label: "상승 추세" }] } }),
    },
  });

  assert.equal(payload.chart?.value.chart_series instanceof Array, true);
  assert.equal(payload.technical?.value.type, "technical_analysis");
  assert.deepEqual(payload.completion.missingParts, []);
  assert.equal(payload.refresh.active, false);
});

test("display model keeps current-provider fast-path score visible while recovering enrichment parts", async () => {
  for (const view of ["detail", "compare"] as const) {
    const payload = await buildStockDisplayPayload({
      ticker: "US:GMAB",
      view,
      sources: {
        identity: async () => ({ ticker: "US:GMAB", market: "US", symbol: "GMAB", name: "젠맵(ADR)" }),
        price: async () => ({ latest_price: 24.97, market_cap: 16_600_000_000, currency: "USD" }),
        chart: async () => ({ chart_series: [{ date: "2026-06-09", close: 25.1 }, { date: "2026-06-10", close: 24.97 }] }),
        score: async () => ({
          ok: true,
          score_model_version: "score-v5-dual-quality-opportunity-2026-06-05",
          score: 47,
          quality_score: 47,
          chart_series: [{ date: "2026-06-09", close: 25.1 }, { date: "2026-06-10", close: 24.97 }],
          key_metrics: [{ label: "현재가", value: "$24.97" }],
          valuation_rows: [{ label: "현재가", value: "$24.97" }],
          fetch: { pending_enrichment: true, detail_fast_path: true },
          financials: { source: "pending_enrichment", detail_fast_path: true },
        }),
      },
    });

    assert.equal(payload.score?.value.quality_score, 47);
    assert.deepEqual(payload.completion.requiredParts, ["identity", "price", "chart", "score", "fundamentals", "industryBenchmark"]);
    assert.deepEqual(payload.completion.presentParts, ["identity", "price", "chart", "score"]);
    assert.deepEqual(payload.completion.missingParts, ["fundamentals", "industryBenchmark"]);
    assert.deepEqual(payload.completion.recoveringParts, ["fundamentals", "industryBenchmark"]);
    assert.equal(payload.refresh.active, true);
    assert.equal(payload.refresh.nextPollMs, 1500);
  }
});

test("display score source uses request fast path when score snapshot is missing", async () => {
  const payload = await readStockDisplayScoreSource("US:COLD", "detail", {
    readSnapshot: async () => undefined,
    detailFastPathEnabled: () => true,
    technicalFastPathEnabled: () => false,
    buildDetailFastPathPayload: async () => ({
      ok: true,
      score: 54,
      quality_score: 54,
      latest_price: 12.3,
      chart_series: [{ date: "2026-06-09", close: 12 }, { date: "2026-06-10", close: 12.3 }],
      financials: { detail_fast_path: true },
    }),
    buildTechnicalScoreFastPathPayload: async () => {
      throw new Error("unexpected technical fast path");
    },
    enrichStockPayloadWithSymbolProfile: async (score) => ({ ...score, stock_profile: [{ label: "티커", value: "COLD" }] }),
    enrichStockPayloadWithIndustryBenchmarks: async (score) => ({ ...score, industry_benchmarks: [{ metric: "per", value: 20 }] }),
  });

  assert.equal(payload?.quality_score, 54);
  assert.equal(payload?.latest_price, 12.3);
  assert.equal(Array.isArray(payload?.chart_series), true);
  assert.deepEqual(payload?.stock_profile, [{ label: "티커", value: "COLD" }]);
  assert.deepEqual(payload?.industry_benchmarks, [{ metric: "per", value: 20 }]);
});

test("compare display score source reuses detail-grade score data for chart fallback", async () => {
  const views: string[] = [];
  const payload = await readStockDisplayScoreSource("US:COLD", "compare", {
    readSnapshot: async (_ticker, view) => {
      views.push(`snapshot:${view}`);
      return undefined;
    },
    detailFastPathEnabled: () => true,
    technicalFastPathEnabled: () => false,
    buildDetailFastPathPayload: async (_ticker, view) => {
      views.push(`fast:${view}`);
      return {
        ok: true,
        score: 54,
        quality_score: 54,
        latest_price: 12.3,
        chart_series: [{ date: "2026-06-09", close: 12 }, { date: "2026-06-10", close: 12.3 }],
        financials: { detail_fast_path: true },
      };
    },
    buildTechnicalScoreFastPathPayload: async () => {
      throw new Error("unexpected technical fast path");
    },
    enrichStockPayloadWithSymbolProfile: async (score) => score,
    enrichStockPayloadWithIndustryBenchmarks: async (score) => score,
  });

  assert.deepEqual(views, ["snapshot:detail", "fast:detail"]);
  assert.equal(payload?.quality_score, 54);
  assert.equal(Array.isArray(payload?.chart_series), true);
});

test("technical display score source uses technical request fast path when snapshot is missing", async () => {
  const payload = await readStockDisplayScoreSource("US:TECH", "technical", {
    readSnapshot: async () => undefined,
    detailFastPathEnabled: () => false,
    technicalFastPathEnabled: () => true,
    buildDetailFastPathPayload: async () => {
      throw new Error("unexpected detail fast path");
    },
    buildTechnicalScoreFastPathPayload: async () => ({
      ok: true,
      latest_price: 22,
      chart_series: [{ date: "2026-06-09", close: 21 }, { date: "2026-06-10", close: 22 }],
      technical_analysis: { type: "technical_analysis", summary: { headline: "우호" } },
    }),
    enrichStockPayloadWithSymbolProfile: async (score) => score,
    enrichStockPayloadWithIndustryBenchmarks: async (score) => score,
  });

  assert.equal(payload?.latest_price, 22);
  assert.deepEqual(payload?.technical_analysis, { type: "technical_analysis", summary: { headline: "우호" } });
});

test("display model does not materialize empty score chart arrays as chart parts", async () => {
  const payload = await buildStockDisplayPayload({
    ticker: "US:EMPTYCHART",
    view: "compare",
    sources: {
      identity: async () => ({ ticker: "US:EMPTYCHART", market: "US", symbol: "EMPTYCHART", name: "Empty Chart" }),
      price: async () => ({ latest_price: 10 }),
      chart: async () => undefined,
      score: async () => ({ ok: true, score: 50, quality_score: 50, chart_series: [] }),
    },
  });

  assert.equal(payload.chart, undefined);
  assert.deepEqual(payload.completion.presentParts, ["identity", "price", "score"]);
  assert.deepEqual(payload.completion.recoveringParts, ["chart"]);
});

test("display model treats one-bar newly listed charts as visible price history", async () => {
  for (const view of ["detail", "compare"] as const) {
    const payload = await buildStockDisplayPayload({
      ticker: "US:SPCX",
      view,
      sources: {
        identity: async () => ({ ticker: "US:SPCX", market: "US", symbol: "SPCX", name: "SpaceX" }),
        price: async () => ({ latest_price: 135, latest_price_label: "$135.00" }),
        chart: async () => ({
          chart_series: [{ date: "2026-06-11", open: 135, high: 135, low: 135, close: 135, volume: 0 }],
        }),
        score: async () => ({
          ok: true,
          score: 50,
          quality_score: 50,
          latest_price: 135,
          chart_series: [{ date: "2026-06-11", open: 135, high: 135, low: 135, close: 135, volume: 0 }],
        }),
      },
    });

    assert.equal(Array.isArray(payload.chart?.value.chart_series), true);
    assert.equal((payload.chart?.value.chart_series as unknown[] | undefined)?.length, 1);
    assert.deepEqual(payload.completion.presentParts, ["identity", "price", "chart", "score"]);
    assert.deepEqual(payload.completion.missingParts, []);
    assert.deepEqual(payload.completion.recoveringParts, []);
    assert.deepEqual(payload.completion.unavailableParts, []);
    assert.equal(payload.refresh.active, false);
  }
});

test("technical display keeps one-bar price history visible while analysis is limited", async () => {
  const payload = await buildStockDisplayPayload({
    ticker: "US:SPCX",
    view: "technical",
    sources: {
      identity: async () => ({ ticker: "US:SPCX", market: "US", symbol: "SPCX", name: "SpaceX" }),
      price: async () => ({ latest_price: 135, latest_price_label: "$135.00" }),
      chart: async () => ({
        chart_series: [{ date: "2026-06-11", open: 135, high: 135, low: 135, close: 135, volume: 0 }],
      }),
      score: async () => ({
        ok: true,
        latest_price: 135,
        chart_series: [{ date: "2026-06-11", open: 135, high: 135, low: 135, close: 135, volume: 0 }],
        technical_analysis: {
          type: "technical_analysis",
          status: "limited",
          summary: { headline: "데이터가 부족해요" },
        },
      }),
    },
  });

  assert.equal(Array.isArray(payload.chart?.value.chart_series), true);
  assert.equal((payload.chart?.value.chart_series as unknown[] | undefined)?.length, 1);
  assert.equal(payload.technical?.value.type, "technical_analysis");
  assert.deepEqual(payload.completion.presentParts, ["identity", "price", "chart", "technical"]);
  assert.deepEqual(payload.completion.missingParts, []);
  assert.deepEqual(payload.completion.recoveringParts, []);
  assert.deepEqual(payload.completion.unavailableParts, []);
  assert.equal(payload.refresh.active, false);
});

test("display model derives one-point chart from a dated quote when chart provider returns no rows", async () => {
  const payload = await buildStockDisplayPayload({
    ticker: "US:SPCX",
    view: "detail",
    sources: {
      identity: async () => ({ ticker: "US:SPCX", market: "US", symbol: "SPCX", name: "스페이스X" }),
      price: async () => ({
        requested_ticker: "US:SPCX",
        market: "US",
        symbol: "SPCX",
        name: "스페이스X",
        currency: "USD",
        latest_price: 135,
        latest_price_label: "$135.00",
        latest_bar_date: "2026-06-12",
        price_metrics: { price: 135, latest_change: 0 },
      }),
      chart: async () => ({ chart_series: [] }),
      score: async () => ({ ok: true, score: 47.3, quality_score: 47.3, chart_series: [] }),
    },
  });

  assert.deepEqual(payload.completion.presentParts, ["identity", "price", "chart", "score"]);
  assert.deepEqual(payload.completion.recoveringParts, []);
  assert.equal(payload.chart?.source, "market-data");
  assert.deepEqual(payload.chart?.value.chart_series, [{
    date: "2026-06-12",
    open: 135,
    high: 135,
    low: 135,
    close: 135,
    close_label: "$135.00",
    currency: "USD",
  }]);
});

test("display model materializes enriched score fields as first-class display parts", async () => {
  const payload = await buildStockDisplayPayload({
    ticker: "US:KO",
    view: "detail",
    sources: {
      identity: async () => ({ ticker: "US:KO", market: "US", symbol: "KO", name: "Coca-Cola" }),
      price: async () => ({ latest_price: 61.25, market_cap: 263_000_000_000, currency: "USD" }),
      chart: async () => ({ chart_series: [{ date: "2026-06-09", close: 60.5 }, { date: "2026-06-10", close: 61.25 }] }),
      score: async () => ({
        ok: true,
        score: 72,
        quality_score: 72,
        key_metrics: [{ label: "시가총액", value: "$263B" }],
        stock_profile: [{ label: "섹터", value: "Consumer Defensive" }],
        valuation_rows: [
          { label: "Forward PER", value: "21.4" },
          { label: "섹터 평균 PER", value: "24.0", note: "해외 Consumer Defensive 섹터 평균" },
        ],
        financials: { profitMargins: 0.22, revenueGrowth: 0.04 },
        financial_statement: { period: "TTM" },
        industry_benchmarks: [{ metric: "per", value: 24.0 }],
        news: [{ title: "실적 발표", link: "https://example.com/news" }],
      }),
    },
  });

  assert.ok(payload.fundamentals);
  assert.ok(payload.industryBenchmark);
  assert.ok(payload.news);
  assert.deepEqual(payload.completion.presentParts, ["identity", "price", "chart", "score", "fundamentals", "industryBenchmark", "news"]);
  assert.deepEqual(payload.completion.missingParts, []);
  assert.equal((payload.fundamentals.value.key_metrics as unknown[]).length, 1);
  assert.deepEqual((payload.fundamentals.value.valuation_rows as Array<{ label: string }>).map((row) => row.label), ["Forward PER"]);
  assert.equal((payload.industryBenchmark.value.industry_benchmarks as unknown[]).length, 1);
  assert.deepEqual((payload.industryBenchmark.value.valuation_rows as Array<{ label: string }>).map((row) => row.label), ["업종 평균 PER"]);
  assert.equal((payload.industryBenchmark.value.valuation_rows as Array<{ note?: string }>)[0]?.note, "해외 업종 평균");
  assert.equal((payload.news.value.items as unknown[]).length, 1);
});

test("display model starts price chart and score lanes without waiting for slow identity", async () => {
  const started: string[] = [];
  let releaseIdentity: (() => void) | undefined;
  const identityReady = new Promise<void>((resolve) => {
    releaseIdentity = resolve;
  });

  const payloadPromise = buildStockDisplayPayload({
    ticker: "US:LANES",
    view: "detail",
    sources: {
      identity: async () => {
        await identityReady;
        return { ticker: "US:LANES", market: "US", symbol: "LANES", name: "Lane Test" };
      },
      price: async () => {
        started.push("price");
        return { latest_price: 10 };
      },
      chart: async () => {
        started.push("chart");
        return { chart_series: [{ date: "2026-06-09", close: 9 }, { date: "2026-06-10", close: 10 }] };
      },
      score: async () => {
        started.push("score");
        return { score: 51, quality_score: 51 };
      },
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(started.sort(), ["chart", "price", "score"]);

  releaseIdentity?.();
  const payload = await payloadPromise;
  assert.equal(payload.identity.value.name, "Lane Test");
  assert.equal(payload.price?.value.latest_price, 10);
});
