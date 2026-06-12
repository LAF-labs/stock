# Stock Data Envelope Root Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hidden score-payload enrichment state with an explicit stock data envelope so every valid stock can show accurate available data quickly across detail, technical analysis, and compare, while provider-available missing facts are completed by a durable pipeline.

**Architecture:** Add a fact-based `StockDataEnvelope` between existing snapshot caches and display APIs. Existing quote, chart, score, and fundamental snapshots remain the first storage layer; new adapters convert them into explicit part states, projectors keep current API contracts stable, and durable completion jobs refresh missing provider-available facts without depending on request-time Python or GitHub Actions latency.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Node test runner, Supabase REST snapshots and refresh jobs, existing KIS/yfinance/Python collectors as provider/worker inputs, optional `cockatiel` for provider resilience after the envelope contract is stable.

---

## 2026-06-12 Execution Decision

Current implementation proceeds as a full internal refactor **within the providers already in use**:

- No new market-data provider, paid data API, or external workflow vendor is introduced in this pass.
- Existing KIS/yfinance/Python collector inputs, Supabase snapshots, current refresh jobs, and the existing Next.js API surface remain the system boundary.
- The refactor creates explicit `PartState`, `StockDataEnvelope`, adapter, service, and projector layers so process state such as `pending_enrichment` can no longer become a user-visible skeleton requirement.
- The first production target is detail, technical, and compare display readiness. Durable fact-store/table expansion can follow only where existing snapshot tables are insufficient.

Implemented first pass:

- `src/lib/stockPartState.ts` defines `ready`, `stale_ready`, `refreshing`, `unavailable`, and `degraded` part states.
- `src/lib/stockDataEnvelopeAdapters.ts` converts existing quote/chart/score provider cache outputs into part states.
- `src/lib/stockDataEnvelopeService.ts` owns lane deadlines and envelope assembly.
- `src/lib/stockDataProjectors.ts` owns projection from envelope to the existing `StockDisplayPayload`.
- `src/lib/stockDisplayModel.ts` is now a thin wrapper around envelope assembly plus projection.
- Regression tests verify that fast-path score payloads are displayed without turning `fundamentals` or `industryBenchmark` into enrichment-only skeletons.

---

## Scope

This plan covers the root data-pipeline fix for all supported tickers and all three visible surfaces:

- Detail: `/api/stock/detail-view`, `/api/stock/display?view=detail`, legacy `/api/score?partial=1`.
- Technical analysis: `/api/stock/detail-view?view=technical`, `/api/stock/display?view=technical`, `/api/score?view=technical`.
- Compare: `/api/stock/display?view=compare`, `/api/score/batch?partial=1`.

The plan does not hide missing data as the fix. UI skeleton behavior may improve as a result, but the primary fix is to make fact collection state explicit, durable, and testable.

## Full Refactor Reconsideration

After reviewing the code again under the assumption that a large refactor is acceptable, this plan should be treated as the minimum safe migration path, not the best end-state architecture.

The stronger end state is:

```text
provider APIs
  -> Provider Gateway
  -> Durable Hydration Workflow
  -> Canonical Fact Store
  -> Display Snapshot Projector
  -> /api/stock/display and /api/stock/detail-view
  -> React Query/UI
```

The important difference is that `StockDataEnvelope` should not remain just an in-request adapter over legacy score/quote/chart caches. It should become the in-memory shape of a durable fact store and display-snapshot projector.

Recommended revised direction:

1. Create a canonical fact store keyed by ticker, fact kind, source, and freshness window.
   - Facts: `identity`, `price`, `chart`, `fundamentals`, `industryBenchmark`, `technical`, `score`, `news`, `judgment`.
   - Each fact stores value/state/source/provenance/fetchedAt/expiresAt/staleExpiresAt/unavailableReason/errorClass/checksum.
2. Create a durable `stock_display_snapshots` read model.
   - Detail, technical, and compare read from this product-shaped snapshot first.
   - Next.js routes become read-only BFFs plus “request hydration” commands.
3. Move collection and scoring into a durable hydrator.
   - The hydrator fans out exact provider calls, writes facts, then projects display snapshots.
   - It owns retries, throttling, provider budgets, unavailable-state classification, and observability.
4. Keep `StockDataEnvelope` as the projector contract.
   - It remains useful, but as the bridge from durable facts to public API payloads, not as the final architecture by itself.
5. Retire score-as-source-of-truth.
   - Score becomes a pure projection from facts.
   - Technical becomes a pure projection from chart facts.
   - Fundamentals and industry benchmarks stop depending on score payload shape.

Workflow engine decision:

- Best fit for the current Vercel/Supabase app: Inngest or Upstash Workflow for durable serverless hydration, with Supabase as the fact/read-model store.
- Best fit if adding a long-lived worker is acceptable: Graphile Worker or Supabase Queues backed by Postgres, plus explicit projector code.
- Best fit for maximum correctness and replayability: Temporal or Hatchet, at the cost of more platform surface.

This revised architecture supersedes the conservative “no new table first” preference below if the team accepts the larger refactor. The original tasks are still useful as Phase 0-1 scaffolding, but implementation should add the durable fact store and display snapshot read model earlier.

## Source Map

Existing code inspected for this plan:

- `src/lib/stockDisplayModel.ts`
  - Starts identity, price, chart, and score lanes in parallel.
  - Still derives `fundamentals` and `industryBenchmark` only from score payload fields.
  - Adds `fundamentals` and `industryBenchmark` to required parts when `stockScorePayloadNeedsEnrichment(score)` returns true.
- `src/lib/stockQueryCompleteness.ts`
  - Treats `fetch.pending_enrichment`, `financials.pending_enrichment`, `financials.source === "pending_enrichment"`, quote-only, and identity-only fast paths as non-durable score payloads.
- `src/lib/detailScoreFastPath.ts`
  - Produces accurate price/chart-derived fast payloads, but writes process state into `financials.source = "pending_enrichment"` and `fetch.pending_enrichment = true`.
- `src/lib/stockSnapshotCache.ts`
  - Refuses to persist non-durable score payloads.
  - In Vercel snapshot mode, detail/compare misses fall back to request fast path and enqueue a background score job.
- `src/lib/stockDataRuntime.ts`
  - Vercel defaults to `snapshot` runtime, so Python collector is not the interactive request path.
- `src/lib/stockQuoteCache.ts`, `src/lib/stockChartCache.ts`, `src/lib/stockScoreSnapshotReader.ts`
  - Existing per-fact-ish caches already provide memory/Supabase/stale metadata.
- `src/lib/stockCompletionPlanner.ts`
  - Converts missing display parts into queue actions, but still treats fundamentals and industry benchmark as score refresh work.
- `src/lib/stockDetailViewModel.ts`
  - Already maps display parts into user-facing detail part states.
- `src/lib/stockDisplayTypes.ts`
  - Existing `StockDisplayPayload` is part-based enough to preserve API shape during migration.
- `src/app/api/score/route.ts`
  - Legacy endpoint still returns score-shaped payloads and classifies enrichment as partial.
- `src/app/api/stock/display/route.ts`, `src/app/api/stock/detail-view/route.ts`
  - The display/detail endpoints are the safest target for the new envelope projection.
- `src/components/useStockDashboardQueries.ts`, `src/components/useStockCompareQueries.ts`, `src/components/StockDashboard.tsx`, `src/components/StockCompare.tsx`
  - React Query and UI already consume display/detail fallbacks; the server contract is the higher-leverage fix.
- `supabase/migrations/20260605100000_stock_score_snapshots.sql`
  - Score snapshot table stores `ticker`, `view_mode`, `payload`, `fetched_at`, `expires_at`.
- `supabase/migrations/20260605110000_market_calendar_quote_cache.sql`
  - Quote snapshot table stores `ticker`, `payload`, `fetched_at`, `expires_at`.
- `supabase/migrations/20260608150000_stock_chart_snapshots.sql`
  - Chart snapshot table stores `ticker`, `source`, `payload`, `last_bar_date`, freshness timestamps.
- `supabase/migrations/20260605103000_stock_fundamental_snapshots.sql`
  - Fundamental snapshot table already exists and should become a first-class input instead of being hidden inside score payloads.
- `.github/workflows/publish-stock-snapshots.yml`
  - Current legacy score worker runs on a scheduled workflow; it cannot be the user-visible cold-start guarantee.
- `services/market-data/src/service.rs`, `services/market-data/src/http.rs`
  - Score miss currently enqueues an in-memory job and reports durable score refresh unavailable.

## Existing Failure Mode

Cold detail/compare requests can produce useful price/chart/score data, but that fast payload is tagged as `pending_enrichment`. The display model then requires `fundamentals` and `industryBenchmark`, derives both only from the score payload, and marks those parts as recovering. Because non-durable fast payloads are intentionally not written to `stock_score_snapshots`, the page can keep polling until a separate batch worker later produces a full score snapshot.

The underlying issue is not a card skeleton. The issue is that process state is encoded inside user data and the score payload is used as the source of truth for unrelated facts.

## Target Contract

The target internal contract is:

```ts
export type StockFactPartName =
  | "identity"
  | "price"
  | "chart"
  | "fundamentals"
  | "industryBenchmark"
  | "score"
  | "technical"
  | "news"
  | "judgment";

export type PartUnavailableReason =
  | "provider_empty"
  | "unsupported"
  | "not_reported"
  | "configuration";

export type PartRefreshReason =
  | "snapshot_miss"
  | "stale_refresh"
  | "provider_rate_limited"
  | "provider_timeout";

export type PartState<T> =
  | { state: "ready"; value: T; source: string; fetchedAt: string; expiresAt?: string }
  | { state: "stale_ready"; value: T; source: string; fetchedAt: string; expiresAt?: string; refreshActive: true }
  | { state: "refreshing"; reason: PartRefreshReason; jobId?: string; startedAt?: string }
  | { state: "unavailable"; reason: PartUnavailableReason; checkedAt?: string }
  | { state: "degraded"; value: T; source: string; reason: "price_fast_path" | "quote_fast_path" | "identity_fast_path"; fetchedAt: string };

export type StockDataEnvelope = {
  ticker: string;
  requestedTicker: string;
  view: "detail" | "technical" | "compare";
  generatedAt: string;
  parts: {
    identity: PartState<Record<string, unknown>>;
    price?: PartState<Record<string, unknown>>;
    chart?: PartState<Record<string, unknown>>;
    fundamentals?: PartState<Record<string, unknown>>;
    industryBenchmark?: PartState<Record<string, unknown>>;
    score?: PartState<Record<string, unknown>>;
    technical?: PartState<Record<string, unknown>>;
    news?: PartState<Record<string, unknown>>;
    judgment?: PartState<Record<string, unknown>>;
  };
};
```

Rules:

- `pending_enrichment` must not be used as a display-data field.
- Fast-path price/chart-derived score may be shown as `degraded` or low-confidence `ready`, but it must not imply that fundamentals are guaranteed to arrive.
- Provider-confirmed absence becomes `unavailable`, not `refreshing`.
- Temporary slowness becomes `refreshing` only for the specific part that is actually missing.
- Detail, technical, compare, and legacy score responses are projections from the same envelope, not separate fact owners.

## File Structure

- Create `src/lib/stockPartState.ts`
  - Owns `PartState`, helpers such as `readyPart`, `staleReadyPart`, `refreshingPart`, `unavailablePart`, `degradedPart`, `partValue`, and `partIsVisible`.
- Create `src/lib/stockDataEnvelopeTypes.ts`
  - Owns `StockDataEnvelope`, part names, part-source metadata, and view requirements.
- Create `src/lib/stockDataEnvelopeAdapters.ts`
  - Converts existing quote/chart/score/fundamental snapshot results into `PartState`.
- Create `src/lib/stockDataEnvelopeService.ts`
  - Builds one envelope by racing identity, quote, chart, score, technical, fundamentals, and industry benchmark lanes within the interactive budget.
- Create `src/lib/stockDataProjectors.ts`
  - Converts envelope to existing `StockDisplayPayload`, `StockDetailViewModel`, and legacy score-shaped payloads.
- Modify `src/lib/stockDisplayTypes.ts`
  - Expand `StockDisplayUnavailablePart.reason` to preserve `provider_empty`, `not_reported`, `unsupported`, and `configuration` without lying through `provider_confirmed_empty`.
- Modify `src/lib/stockDisplayModel.ts`
  - Shrink it into an adapter over `buildStockDataEnvelope` and `stockDisplayPayloadFromEnvelope`.
- Modify `src/lib/stockCompletionPlanner.ts`
  - Plan completion from envelope part states and enqueue `fundamentals` and `industryBenchmark` as distinct facts when possible.
- Modify `src/app/api/stock/display/route.ts` and `src/app/api/stock/detail-view/route.ts`
  - Continue returning the same public contracts, but schedule completion from the envelope-derived payload.
- Modify `src/app/api/score/route.ts` and `src/app/api/score/batch/route.ts`
  - Keep compatibility, but stop making `pending_enrichment` the polling trigger for display-ready data.
- Modify `scripts/publish_stock_snapshots.py` and/or `scripts/stock_snapshot_worker.ts`
  - Ensure worker-produced fundamental snapshots and score snapshots can both feed the envelope.
- Add Supabase migration only if existing snapshot tables cannot represent part states cleanly.
  - Preferred first pass: no new table; use existing quote/chart/score/fundamental snapshots and queue rows.
  - Later pass: add a compact product read model only after envelope tests pass and payload size is measured.

## Work Order

### Task 1: Freeze Current Regression With Envelope-Focused Tests

**Files:**
- Create: `tests/stockPartState.test.ts`
- Create: `tests/stockDataEnvelopeProjectors.test.ts`
- Modify: `tests/stockDisplayModel.test.ts`
- Modify: `tests/stockDetailViewModel.test.ts`
- Modify: `tests/useStockCompareQueries.test.ts`

- [ ] **Step 1: Add `PartState` helper tests before implementation**

Create `tests/stockPartState.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import {
  partIsVisible,
  partValue,
  readyPart,
  refreshingPart,
  unavailablePart,
} from "../src/lib/stockPartState";

test("ready parts expose values", () => {
  const part = readyPart({ latest_price: 10 }, "supabase", "2026-06-12T00:00:00.000Z");

  assert.equal(part.state, "ready");
  assert.deepEqual(partValue(part), { latest_price: 10 });
  assert.equal(partIsVisible(part), true);
});

test("refreshing and unavailable parts do not expose fake values", () => {
  assert.equal(partValue(refreshingPart("snapshot_miss")), undefined);
  assert.equal(partValue(unavailablePart("not_reported")), undefined);
  assert.equal(partIsVisible(refreshingPart("provider_timeout")), false);
  assert.equal(partIsVisible(unavailablePart("provider_empty")), false);
});
```

Run:

```bash
node --import tsx --test tests/stockPartState.test.ts
```

Expected: fail because `src/lib/stockPartState.ts` does not exist.

- [ ] **Step 2: Add the display regression test that describes the desired cold-start behavior**

Append to `tests/stockDisplayModel.test.ts`:

```ts
test("display model does not keep financial parts recovering just because score is a price fast path", async () => {
  const payload = await buildStockDisplayPayload({
    ticker: "US:COLD",
    view: "detail",
    sources: {
      identity: async () => ({ ticker: "US:COLD", market: "US", symbol: "COLD", name: "Cold Start Inc" }),
      price: async () => ({ latest_price: 12.3 }),
      chart: async () => ({ chart_series: [{ date: "2026-06-11", close: 12 }, { date: "2026-06-12", close: 12.3 }] }),
      score: async () => ({
        ok: true,
        score: 54,
        quality_score: 54,
        data_quality: "price_fast_path",
        fetch: { detail_fast_path: true, pending_enrichment: true },
        financials: { source: "pending_enrichment", detail_fast_path: true },
      }),
    },
  });

  assert.deepEqual(payload.completion.presentParts, ["identity", "price", "chart", "score"]);
  assert.deepEqual(payload.completion.missingParts, []);
  assert.deepEqual(payload.completion.recoveringParts, []);
  assert.equal(payload.refresh.active, false);
});
```

Run:

```bash
node --import tsx --test tests/stockDisplayModel.test.ts
```

Expected: fail under the current model because `stockScorePayloadNeedsEnrichment` turns the fast-path score into mandatory recovering fundamentals even though no first-response fundamentals lane has proven that a user-visible value is actively arriving.

### Task 2: Introduce `PartState` Without Touching Routes

**Files:**
- Create: `src/lib/stockPartState.ts`
- Test: `tests/stockPartState.test.ts`

- [ ] **Step 1: Add the minimal helper implementation**

Create `src/lib/stockPartState.ts`:

```ts
export type PartUnavailableReason = "provider_empty" | "unsupported" | "not_reported" | "configuration";
export type PartRefreshReason = "snapshot_miss" | "stale_refresh" | "provider_rate_limited" | "provider_timeout";
export type DegradedReason = "price_fast_path" | "quote_fast_path" | "identity_fast_path";

export type PartState<T> =
  | { state: "ready"; value: T; source: string; fetchedAt: string; expiresAt?: string }
  | { state: "stale_ready"; value: T; source: string; fetchedAt: string; expiresAt?: string; refreshActive: true }
  | { state: "refreshing"; reason: PartRefreshReason; jobId?: string; startedAt?: string }
  | { state: "unavailable"; reason: PartUnavailableReason; checkedAt?: string }
  | { state: "degraded"; value: T; source: string; reason: DegradedReason; fetchedAt: string };

export function readyPart<T>(value: T, source: string, fetchedAt: string, expiresAt?: string): PartState<T> {
  return expiresAt ? { state: "ready", value, source, fetchedAt, expiresAt } : { state: "ready", value, source, fetchedAt };
}

export function staleReadyPart<T>(value: T, source: string, fetchedAt: string, expiresAt?: string): PartState<T> {
  return expiresAt
    ? { state: "stale_ready", value, source, fetchedAt, expiresAt, refreshActive: true }
    : { state: "stale_ready", value, source, fetchedAt, refreshActive: true };
}

export function refreshingPart(reason: PartRefreshReason, jobId?: string, startedAt?: string): PartState<never> {
  return { state: "refreshing", reason, ...(jobId ? { jobId } : {}), ...(startedAt ? { startedAt } : {}) };
}

export function unavailablePart(reason: PartUnavailableReason, checkedAt?: string): PartState<never> {
  return { state: "unavailable", reason, ...(checkedAt ? { checkedAt } : {}) };
}

export function degradedPart<T>(value: T, source: string, reason: DegradedReason, fetchedAt: string): PartState<T> {
  return { state: "degraded", value, source, reason, fetchedAt };
}

export function partValue<T>(part: PartState<T> | undefined): T | undefined {
  if (!part) return undefined;
  if (part.state === "ready" || part.state === "stale_ready" || part.state === "degraded") return part.value;
  return undefined;
}

export function partIsVisible<T>(part: PartState<T> | undefined): boolean {
  return partValue(part) !== undefined;
}
```

- [ ] **Step 2: Verify helper tests pass**

Run:

```bash
node --import tsx --test tests/stockPartState.test.ts
```

Expected: pass.

### Task 3: Build Envelope Adapters Over Existing Snapshot Caches

**Files:**
- Create: `src/lib/stockDataEnvelopeTypes.ts`
- Create: `src/lib/stockDataEnvelopeAdapters.ts`
- Create: `tests/stockDataEnvelopeAdapters.test.ts`

- [ ] **Step 1: Add adapter tests for existing cache result shapes**

Create `tests/stockDataEnvelopeAdapters.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import {
  chartPartFromResult,
  pricePartFromQuoteResult,
  scorePartFromResult,
} from "../src/lib/stockDataEnvelopeAdapters";

test("quote cache result becomes ready price part", () => {
  const part = pricePartFromQuoteResult({
    payload: { latest_price: 21, latest_price_label: "$21.00" },
    cache: {
      state: "fresh",
      source: "supabase",
      ticker: "US:CPNG",
      fetchedAt: "2026-06-12T00:00:00.000Z",
      expiresAt: "2026-06-12T00:01:00.000Z",
    },
  });

  assert.equal(part.state, "ready");
  assert.equal(part.value.latest_price, 21);
});

test("stale chart cache result remains visible while refresh is active", () => {
  const part = chartPartFromResult({
    payload: { chart_series: [{ date: "2026-06-11", close: 20 }, { date: "2026-06-12", close: 21 }] },
    cache: {
      state: "stale",
      source: "supabase",
      ticker: "US:CPNG",
      fetchedAt: "2026-06-11T00:00:00.000Z",
      expiresAt: "2026-06-11T01:00:00.000Z",
      refreshStarted: true,
    },
  });

  assert.equal(part.state, "stale_ready");
  assert.equal(part.value.chart_series.length, 2);
});

test("price fast path score becomes degraded score part, not a fake fundamentals part", () => {
  const part = scorePartFromResult({
    payload: {
      ok: true,
      score: 47,
      quality_score: 47,
      data_quality: "price_fast_path",
      fetch: { pending_enrichment: true },
      financials: { source: "pending_enrichment" },
    },
    cache: {
      state: "miss",
      source: "market-data",
      ticker: "US:FLNC",
      view: "detail",
      fetchedAt: "2026-06-12T00:00:00.000Z",
      expiresAt: "2026-06-12T00:01:00.000Z",
    },
  });

  assert.equal(part.state, "degraded");
  assert.equal(part.value.quality_score, 47);
});

test("quote-only and identity-only fast paths keep distinct degraded reasons", () => {
  const quoteOnly = scorePartFromResult({
    payload: {
      ok: true,
      score: 50,
      data_quality: "quote_fast_path",
      fetch: { quote_only_fast_path: true },
    },
    cache: {
      state: "miss",
      source: "market-data",
      ticker: "US:QUOTE",
      view: "compare",
      fetchedAt: "2026-06-12T00:00:00.000Z",
      expiresAt: "2026-06-12T00:01:00.000Z",
    },
  });
  const identityOnly = scorePartFromResult({
    payload: {
      ok: true,
      score: 50,
      data_quality: "identity_fast_path",
      fetch: { identity_only_fast_path: true },
    },
    cache: {
      state: "miss",
      source: "symbol-master",
      ticker: "US:IDENT",
      view: "compare",
      fetchedAt: "2026-06-12T00:00:00.000Z",
      expiresAt: "2026-06-12T00:01:00.000Z",
    },
  });

  assert.equal(quoteOnly.state, "degraded");
  assert.equal(quoteOnly.reason, "quote_fast_path");
  assert.equal(identityOnly.state, "degraded");
  assert.equal(identityOnly.reason, "identity_fast_path");
});
```

Run:

```bash
node --import tsx --test tests/stockDataEnvelopeAdapters.test.ts
```

Expected: fail because the adapter module does not exist.

- [ ] **Step 2: Implement adapters without changing existing cache modules**

Create `src/lib/stockDataEnvelopeTypes.ts`:

```ts
import type { PartState } from "@/lib/stockPartState";

export type StockDataEnvelopeView = "detail" | "technical" | "compare";

export type StockDataEnvelope = {
  ticker: string;
  requestedTicker: string;
  view: StockDataEnvelopeView;
  generatedAt: string;
  parts: {
    identity: PartState<Record<string, unknown>>;
    price?: PartState<Record<string, unknown>>;
    chart?: PartState<Record<string, unknown>>;
    fundamentals?: PartState<Record<string, unknown>>;
    industryBenchmark?: PartState<Record<string, unknown>>;
    score?: PartState<Record<string, unknown>>;
    technical?: PartState<Record<string, unknown>>;
    news?: PartState<Record<string, unknown>>;
    judgment?: PartState<Record<string, unknown>>;
  };
};
```

Create `src/lib/stockDataEnvelopeAdapters.ts`:

```ts
import { degradedPart, readyPart, staleReadyPart, type PartState } from "@/lib/stockPartState";
import { stockScorePayloadNeedsEnrichment } from "@/lib/stockQueryCompleteness";
import type { StockChartResult } from "@/lib/stockChartCache";
import type { StockQuoteResult } from "@/lib/stockQuoteCache";
import type { StockScoreResult } from "@/lib/stockScoreContract";

type CacheMeta = {
  state: "fresh" | "stale" | "miss";
  source: string;
  fetchedAt?: string;
  expiresAt?: string;
};

export function pricePartFromQuoteResult(result: StockQuoteResult): PartState<Record<string, unknown>> {
  return visiblePartFromCache(result.payload, result.cache);
}

export function chartPartFromResult(result: StockChartResult): PartState<Record<string, unknown>> {
  return visiblePartFromCache(result.payload, result.cache);
}

export function scorePartFromResult(result: StockScoreResult): PartState<Record<string, unknown>> {
  const fetchedAt = result.cache.fetchedAt || new Date().toISOString();
  if (stockScorePayloadNeedsEnrichment(result.payload)) {
    return degradedPart(result.payload, result.cache.source, degradedReasonFromPayload(result.payload), fetchedAt);
  }
  return visiblePartFromCache(result.payload, result.cache);
}

function visiblePartFromCache<T extends Record<string, unknown>>(value: T, cache: CacheMeta): PartState<T> {
  const fetchedAt = cache.fetchedAt || new Date().toISOString();
  if (cache.state === "stale") return staleReadyPart(value, cache.source, fetchedAt, cache.expiresAt);
  return readyPart(value, cache.source, fetchedAt, cache.expiresAt);
}

function degradedReasonFromPayload(payload: Record<string, unknown>): "price_fast_path" | "quote_fast_path" | "identity_fast_path" {
  const fetch = recordFromUnknown(payload.fetch);
  const financials = recordFromUnknown(payload.financials);
  const dataQuality = typeof payload.data_quality === "string" ? payload.data_quality.toLowerCase() : "";
  if (fetch?.identity_only_fast_path === true || financials?.identity_only_fast_path === true || dataQuality === "identity_fast_path") {
    return "identity_fast_path";
  }
  if (fetch?.quote_only_fast_path === true || financials?.quote_only_fast_path === true || dataQuality === "quote_fast_path") {
    return "quote_fast_path";
  }
  return "price_fast_path";
}

function recordFromUnknown(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
```

- [ ] **Step 3: Verify adapter tests pass**

Run:

```bash
node --import tsx --test tests/stockDataEnvelopeAdapters.test.ts
```

Expected: pass.

### Task 4: Build The Envelope Service And Keep Public Display Contract Stable

**Files:**
- Create: `src/lib/stockDataEnvelopeService.ts`
- Create: `src/lib/stockDataProjectors.ts`
- Modify: `src/lib/stockDisplayTypes.ts`
- Modify: `src/lib/stockDisplayModel.ts`
- Test: `tests/stockDataEnvelopeProjectors.test.ts`
- Test: `tests/stockDisplayModel.test.ts`

- [ ] **Step 1: Add projector tests for the existing public payload**

Create `tests/stockDataEnvelopeProjectors.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { readyPart, degradedPart, unavailablePart } from "../src/lib/stockPartState";
import { stockDisplayPayloadFromEnvelope } from "../src/lib/stockDataProjectors";

test("display projection preserves visible price chart and degraded score without requiring fake financials", () => {
  const payload = stockDisplayPayloadFromEnvelope({
    ticker: "US:FLNC",
    requestedTicker: "US:FLNC",
    view: "detail",
    generatedAt: "2026-06-12T00:00:00.000Z",
    parts: {
      identity: readyPart({ ticker: "US:FLNC", market: "US", symbol: "FLNC", name: "Fluence Energy" }, "symbol-master", "2026-06-12T00:00:00.000Z"),
      price: readyPart({ latest_price: 10 }, "supabase", "2026-06-12T00:00:00.000Z"),
      chart: readyPart({ chart_series: [{ date: "2026-06-11", close: 9 }, { date: "2026-06-12", close: 10 }] }, "supabase", "2026-06-12T00:00:00.000Z"),
      score: degradedPart({ score: 49, quality_score: 49 }, "market-data", "price_fast_path", "2026-06-12T00:00:00.000Z"),
      fundamentals: unavailablePart("not_reported", "2026-06-12T00:00:00.000Z"),
      industryBenchmark: unavailablePart("not_reported", "2026-06-12T00:00:00.000Z"),
    },
  });

  assert.deepEqual(payload.completion.presentParts, ["identity", "price", "chart", "score"]);
  assert.deepEqual(payload.completion.recoveringParts, []);
  assert.deepEqual(payload.completion.unavailableParts, [
    { part: "fundamentals", reason: "not_reported" },
    { part: "industryBenchmark", reason: "not_reported" },
  ]);
  assert.equal(payload.refresh.active, false);
});
```

Run:

```bash
node --import tsx --test tests/stockDataEnvelopeProjectors.test.ts
```

Expected: fail because `src/lib/stockDataProjectors.ts` does not exist.

- [ ] **Step 2: Expand public unavailable reasons before projecting**

Modify `src/lib/stockDisplayTypes.ts`:

```ts
export type StockDisplayUnavailableReason =
  | "unsupported"
  | "no_history"
  | "provider_confirmed_empty"
  | "provider_empty"
  | "not_reported"
  | "configuration";

export type StockDisplayUnavailablePart = {
  part: StockDisplayPartName;
  reason: StockDisplayUnavailableReason;
};
```

Keep `provider_confirmed_empty` as an accepted legacy reason, but new envelope projection should emit the more precise `provider_empty` or `not_reported` reason.

- [ ] **Step 3: Implement projection logic as a pure module**

`src/lib/stockDataProjectors.ts` should map visible `PartState` values into the existing `StockDisplayPayload` shape. It must preserve unavailable reasons instead of treating every non-ready financial fact as provider-confirmed empty.

Minimum public behavior:

```ts
const visibleParts = ["identity", "price", "chart", "score", "technical", "fundamentals", "industryBenchmark", "news"]
  .filter((partName) => partValue(envelope.parts[partName]) !== undefined);
```

Required parts:

```ts
const requiredParts =
  envelope.view === "technical"
    ? ["identity", "price", "chart", "technical"]
    : ["identity", "price", "chart", "score"];
```

No projector may call a provider, enqueue a job, or inspect `financials.source`.

- [ ] **Step 4: Wrap `buildStockDisplayPayload` with the envelope service**

Modify `src/lib/stockDisplayModel.ts` so the exported `buildStockDisplayPayload` delegates to the envelope service. Keep the current `sources` test seam, but route that seam through an envelope builder instead of the legacy completion logic.

Update the existing test named `display model keeps fast-path score visible while recovering fundamentals and industry benchmarks`; after this migration, the correct expectation is that the fast-path score stays visible and financial parts do not recover unless the envelope has an actual refreshing state for those facts.

Required compatibility rule:

```ts
const envelope = input.sources
  ? await buildStockDataEnvelopeFromSources(input)
  : await buildStockDataEnvelope(input);
return stockDisplayPayloadFromEnvelope(envelope);
```

This preserves the existing test seam without preserving the old completion semantics. `buildStockDataEnvelopeFromSources` should call the supplied source functions and convert their settled results to `PartState`; it must not call `displayRequiredParts` or `fundamentalsFromScore`.

- [ ] **Step 5: Verify focused tests**

Run:

```bash
node --import tsx --test tests/stockPartState.test.ts tests/stockDataEnvelopeAdapters.test.ts tests/stockDataEnvelopeProjectors.test.ts tests/stockDisplayModel.test.ts tests/stockDisplayApi.test.ts tests/stockDetailViewModel.test.ts
```

Expected: pass.

### Task 5: Make Fundamentals A First-Class Fact

**Files:**
- Create: `src/lib/stockFundamentalsSnapshotReader.ts`
- Modify: `src/lib/stockDataEnvelopeService.ts`
- Modify: `src/lib/stockCompletionPlanner.ts`
- Test: `tests/stockDataEnvelopeService.test.ts`
- Test: `tests/stockCompletionPlanner.test.ts`

- [ ] **Step 1: Add a reader for `stock_fundamental_snapshots`**

The reader must follow the pattern in `stockScoreSnapshotReader.ts`, but keyed by market/symbol/source because the existing table is `primary key (market, symbol, source)`.

Expected function shape:

```ts
export async function readStockFundamentalsSnapshotForDisplay(
  tickerRef: string,
  options: { source?: string } = {}
): Promise<{
  payload: Record<string, unknown>;
  cache: {
    state: "fresh" | "stale";
    source: string;
    ticker: string;
    fetchedAt: string;
    expiresAt: string;
    staleExpiresAt?: string;
  };
} | undefined>
```

- [ ] **Step 2: Add service tests for a cold ticker with price/chart but no fundamentals**

The envelope service test must assert:

- identity, price, chart, and degraded score are visible when available;
- fundamentals are `refreshing` only if a fundamental job is actually queued or a provider lane is active;
- fundamentals are `unavailable` if the provider confirms absence;
- the display projector does not keep polling for a part marked `unavailable`.

- [ ] **Step 3: Update completion planning**

`fundamentals` and `industryBenchmark` should no longer always enqueue a score refresh. Plan:

- `fundamentals` missing -> queue kind `fundamentals` when supported by ticker/market.
- `industryBenchmark` missing -> queue kind `score` only if industry rows are computed from score snapshots; otherwise queue `fundamentals` or benchmark refresh based on the existing benchmark pipeline.
- Expand public `StockDisplayUnavailablePart.reason` before projector rollout so `not_reported` and `provider_empty` remain distinct.

- [ ] **Step 4: Verify focused tests**

Run:

```bash
node --import tsx --test tests/stockDataEnvelopeService.test.ts tests/stockCompletionPlanner.test.ts
```

Expected: pass.

### Task 6: Remove `pending_enrichment` From Display Readiness Decisions

**Files:**
- Modify: `src/lib/detailScoreFastPath.ts`
- Modify: `src/lib/stockQueryCompleteness.ts`
- Modify: `src/lib/stockQueryFns.ts`
- Modify: `src/lib/stockQueryOptions.ts`
- Test: `tests/stockScorePartialFastPath.test.ts`
- Test: `tests/stockQueryFns.test.ts`
- Test: `tests/stockQueryOptions.test.ts`

- [ ] **Step 1: Keep legacy score partial behavior isolated**

`stockScorePayloadNeedsEnrichment` can remain for legacy `/api/score` classification, but display/detail projection must not call it to decide `fundamentals` readiness.

Required code ownership:

```ts
// Allowed
classifyScorePayload(payload, status) -> stockScorePayloadNeedsEnrichment(payload)

// Not allowed after this task
stockDisplayPayloadFromEnvelope(...) -> stockScorePayloadNeedsEnrichment(...)
stockDisplayModel fundamentalsFromScore(...) -> stockScorePayloadNeedsEnrichment(...)
```

- [ ] **Step 2: Replace user-data process flags in fast path**

`detailScoreFastPath.ts` may keep internal metadata under `fetch`, but must not put user-visible process state under `financials`.

Required before/after:

```ts
// Remove from displayable financials
financials: {
  source: "pending_enrichment",
  detail_fast_path: true,
  message: "정식 재무 데이터는 백그라운드에서 보강됩니다.",
}

// Keep, if legacy score classifier still needs it
fetch: {
  detail_fast_path: true,
  request_fast_path: true,
  pending_enrichment: true,
}
```

The envelope service must read this as score confidence metadata, not as financial data.

- [ ] **Step 3: Verify legacy score still polls while display/detail stops indefinite polling**

Run:

```bash
node --import tsx --test tests/stockScorePartialFastPath.test.ts tests/stockQueryFns.test.ts tests/stockQueryOptions.test.ts tests/stockDisplayModel.test.ts tests/stockDetailViewApi.test.ts
```

Expected: pass.

### Task 7: Worker And Operations Alignment

**Files:**
- Modify: `scripts/stock_snapshot_worker.ts`
- Modify: `scripts/publish_stock_snapshots.py`
- Modify: `scripts/stock_operations_report.ts`
- Modify: `docs/score-system-operations.md`
- Test: `tests/stockSnapshotWorker.test.ts`
- Test: `tests/stockOperationsReportTs.test.ts`
- Test: `tests/test_publish_stock_snapshots.py`

- [ ] **Step 1: Make fundamentals jobs drainable and visible in ops**

The existing Supabase enqueue function supports `fundamentals`; the worker scripts must claim and drain this kind explicitly.

Required operational states:

- queued fundamentals count;
- running fundamentals count;
- stale/dead fundamentals jobs;
- provider-confirmed empty fundamentals count;
- envelope-visible completion rate by view.

- [ ] **Step 2: Stop relying on 5-minute GitHub score cron for user-visible completion**

Keep GitHub Actions as backstop. The primary path should be either:

- an always-on `npm run snapshots:worker` process outside Vercel; or
- a durable serverless workflow that can run immediately per demand job.

The implementation must not wait for `.github/workflows/publish-stock-snapshots.yml` schedule cadence to complete a user-triggered cold ticker.

- [ ] **Step 3: Verify operations checks**

Run:

```bash
npm run ops:report
npm run ops:check
```

Expected: `ops:check` passes or reports only pre-existing production data issues that are documented before deployment.

### Task 8: Production-Like Regression Matrix

**Files:**
- Modify: `scripts/load_test_stock_latency.mjs`
- Modify: `tests/stockLatencyLoadTest.test.ts`
- Add fixtures under `tests/fixtures/market-data/` only when deterministic provider payloads are needed.

- [ ] **Step 1: Add cold-start matrix cases**

The test matrix must include:

- `US:FLNC` detail, technical, compare;
- `US:CPNG` detail, technical, compare;
- `KR:489790` detail, technical, compare;
- one provider-confirmed empty or unsupported synthetic ticker;
- one stale-ready fixture where old facts are visible while refresh is active.

- [ ] **Step 2: Assert part-level outcomes, not generic pending labels**

Pass criteria:

- first display/detail response has identity for every valid ticker;
- price appears if provider/cache has current quote;
- chart appears if provider/cache has at least two bars;
- score appears if either durable score or degraded price-based score exists;
- technical appears independently from detail fundamentals;
- no part remains `refreshing` without a queued/running job, active provider lane, or retryable reason;
- provider-confirmed absence becomes unavailable.

- [ ] **Step 3: Verify locally**

Run:

```bash
node --import tsx --test tests/stockLatencyLoadTest.test.ts
npm test
npm run test:python
npm run test:rust
npm run typecheck
npm run build
```

Expected: pass before deployment.

## Migration Strategy

1. Add types, adapters, and projectors behind tests.
2. Switch `/api/stock/display` and `/api/stock/detail-view` to envelope projection first.
3. Keep `/api/score` compatibility until display/detail/compare are stable.
4. Make fundamentals and industry benchmark first-class envelope facts.
5. Move worker/ops checks from score-centric completion to fact-centric completion.
6. Remove obsolete `financials.source = "pending_enrichment"` display leakage.
7. Only after production smoke passes, simplify legacy source seams in `stockDisplayModel.ts`.

## Acceptance Criteria

- No valid cold ticker stays on a full-page or section skeleton because of hidden `pending_enrichment`.
- Detail, technical, and compare all consume the same envelope-derived part states.
- A part can be `refreshing` only when there is an actual active provider lane, queued/running durable job, or retryable transient reason.
- Provider-confirmed absence is displayed as unavailable/empty, not as indefinite waiting.
- Fast-path score is visible as low-confidence/degraded score data without pretending fundamentals exist.
- Existing public API payload shapes remain backward compatible unless a dedicated migration note and tests cover the change.
- Production smoke for `US:FLNC`, `US:CPNG`, and `KR:489790` verifies detail, technical, and compare.

## Verification Commands

Run focused tests after each task:

```bash
node --import tsx --test tests/stockPartState.test.ts
node --import tsx --test tests/stockDataEnvelopeAdapters.test.ts
node --import tsx --test tests/stockDataEnvelopeProjectors.test.ts
node --import tsx --test tests/stockDisplayModel.test.ts tests/stockDisplayApi.test.ts tests/stockDetailViewApi.test.ts
node --import tsx --test tests/stockCompletionPlanner.test.ts tests/stockQueryFns.test.ts tests/stockQueryOptions.test.ts
```

Run full verification before commit/deploy:

```bash
npm test
npm run test:python
npm run test:rust
npm run typecheck
npm run build
npm run ops:check
```

## Review Notes

The first draft intentionally avoids a new product read-model table. The repository already has quote, chart, score, and fundamental snapshot tables, and the safest root fix is to make their states explicit before introducing another persistence layer.

### Review 1: Existing-Code Regression Check

Compared the proposed tests with `src/lib/stockDisplayModel.ts` and `src/lib/stockQueryCompleteness.ts`. The initial regression test incorrectly supplied `terminalFailures` for `fundamentals` and `industryBenchmark`, which would let the current completion planner stop recovering those parts and could make the test pass without fixing the real bug. The test was revised to model the actual stuck condition: a visible price/chart fast-path score with `pending_enrichment` metadata but no independent fundamentals lane result.

### Review 2: Target-Code Consistency Check

Compared the target adapter sketch against `stockScorePayloadNeedsEnrichment`, which distinguishes quote-only, identity-only, and pending enrichment fast paths. The initial adapter mapped every enrichment-like score to `price_fast_path`; this would erase useful confidence semantics and could make compare cards label identity-only data as price-derived. The plan now adds `quote_fast_path` as a degraded reason and includes tests plus adapter code for reason classification.

### Review 3: Migration-Seam Check

Compared Task 4 with the current `BuildStockDisplayPayloadInput.sources` tests in `tests/stockDisplayModel.test.ts`. A previous compatibility rule would have routed supplied test sources through the legacy display builder, which would preserve the exact `pending_enrichment` behavior the plan is meant to remove. The plan now requires `buildStockDataEnvelopeFromSources(input)` so focused tests and production defaults both exercise the envelope projection. It also calls out the existing fast-path recovery test that must be rewritten because its current expectation protects the skeleton-sticking behavior.

### Review 4: Public Reason Semantics Check

Compared the target `PartUnavailableReason` values with the current `StockDisplayUnavailablePart.reason` union in `src/lib/stockDisplayTypes.ts`. The previous draft mapped `not_reported` to `provider_confirmed_empty` for compatibility, but that would lose the difference between a provider saying the company does not report a field and a provider returning no data for the symbol. The plan now expands the public reason union first and updates projector expectations to preserve `not_reported`.
