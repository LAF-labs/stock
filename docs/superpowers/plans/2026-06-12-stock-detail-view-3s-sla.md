# Stock Detail View 3s SLA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-grade stock detail read model that gets users off the full-page skeleton within 3 seconds for every non-irreversible stock lookup, then keeps filling missing data automatically.

**Architecture:** Add a `StockDetailViewModel` layer on top of the existing display snapshot pipeline instead of replacing the whole data system. `/api/stock/detail-view` returns one product-shaped model with `partial`, `ready`, or `failed_irreversible`, while React Query polls this endpoint from `nextPollMs` and the dashboard renders available sections immediately.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, TanStack Query v5, Node test runner, Supabase-backed stock snapshots and refresh queue.

---

## Scope Check

The design touches three related surfaces: read model, API/query, and dashboard rendering. This plan keeps them in one implementation sequence because each step depends on the same `StockDetailViewModel` contract and produces a testable stock detail experience.

This plan does not migrate compare or technical pages. It creates the detail-view pattern in a way those pages can reuse after the stock detail path is stable.

## Product Quality Bar

This feature is not complete when it merely returns JSON. It is complete when the stock detail experience feels like a reliable consumer product:

- Valid stock searches do not leave users staring at a full-page skeleton after the first detail-view response.
- The first real screen has a clear company identity, stable layout, and useful available data without explaining internal queue states.
- Missing sections are quiet and localized; the page does not try to persuade users that broken data loading is acceptable.
- The page refreshes itself from `nextPollMs`; manual refresh is a backup control, not the main path.
- Temporary provider or worker failures degrade to partial/recovering views and keep retrying.
- Irreversible failures are rare, explicit, and short.
- Production readiness requires local build, focused tests, browser QA, latency smoke, operations readiness, and post-deploy production smoke against `https://stock-khaki.vercel.app`.

## File Structure

- Create `src/lib/stockDetailViewTypes.ts`
  - Owns the public detail-view model, part states, job hints, and irreversible failure payload type.
- Create `src/lib/stockDetailViewModel.ts`
  - Converts `StockDisplayPayload` into `StockDetailViewModel`.
  - Encodes `partial` versus `ready`, degraded identity-only state, `nextPollMs`, and part-state mapping.
- Create `src/app/api/stock/detail-view/route.ts`
  - Parses ticker/view, builds the existing `StockDisplayPayload`, schedules missing parts, and returns the detail view model.
- Modify `src/lib/stockQueryTypes.ts`
  - Adds `DetailViewQueryResult` if the query layer keeps the existing `ApiReady` style.
- Modify `src/lib/stockQueryKeys.ts`
  - Adds `stockQueryKeys.detailView(ticker)`.
- Modify `src/lib/stockQueryFns.ts`
  - Adds `fetchStockDetailView`.
- Modify `src/lib/stockQueryOptions.ts`
  - Adds `detailViewQueryOptions` with `nextPollMs`-driven polling.
- Modify `src/components/useStockDashboardQueries.ts`
  - Uses the detail-view query as the primary display state source.
  - Keeps score/quote only where they are still needed for judgment and fresh quote overlay during migration.
- Modify `src/components/StockDashboard.tsx`
  - Stops using full-page skeleton as the long-lived identity-only state once `detail-view` returns.
  - Renders partial data from the detail-view model.
- Modify `src/components/stockDashboardHelpers.ts`
  - Adds focused helper tests for detail-view state conversion.
- Create `tests/stockDetailViewModel.test.ts`
  - Contract tests for model conversion.
- Create `tests/stockDetailViewApi.test.ts`
  - Route tests for non-irreversible partial response and irreversible failure.
- Modify `tests/stockQueryFns.test.ts`
  - Verifies request path and classifier behavior for `fetchStockDetailView`.
- Modify `tests/stockQueryOptions.test.ts`
  - Verifies `nextPollMs` polling and no polling for irreversible failures.
- Modify `tests/stockDashboardHelpers.test.ts`
  - Verifies dashboard state leaves full skeleton once detail-view data exists.

---

### Task 1: Detail View Model Contract

**Files:**
- Create: `src/lib/stockDetailViewTypes.ts`
- Create: `src/lib/stockDetailViewModel.ts`
- Test: `tests/stockDetailViewModel.test.ts`

- [ ] **Step 1: Write the failing model tests**

Create `tests/stockDetailViewModel.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { stockDetailViewFromDisplayPayload } from "../src/lib/stockDetailViewModel";
import type { StockDisplayPayload } from "../src/lib/stockDisplayTypes";

function baseDisplayPayload(overrides: Partial<StockDisplayPayload> = {}): StockDisplayPayload {
  return {
    ok: true,
    ticker: "US:VLD",
    requestedTicker: "US:VLD",
    view: "detail",
    generatedAt: "2026-06-12T00:00:00.000Z",
    snapshotVersion: "display-v1",
    hotnessTier: "active",
    identity: {
      value: { ticker: "US:VLD", market: "US", symbol: "VLD", name: "Velo3D" },
      freshness: "fresh",
      source: "symbol-master",
    },
    completion: {
      requiredParts: ["identity", "price", "chart", "score"],
      presentParts: ["identity"],
      missingParts: ["price", "chart", "score"],
      recoveringParts: ["price", "chart", "score"],
      unavailableParts: [],
    },
    refresh: {
      active: true,
      staleParts: [],
      recoveringParts: ["price", "chart", "score"],
      nextPollMs: 1500,
    },
    capabilities: { canCompare: true, canTechnical: true },
    ...overrides,
  };
}

test("detail view returns degraded partial for identity-only display payload", () => {
  const view = stockDetailViewFromDisplayPayload(baseDisplayPayload());

  assert.equal(view.ok, true);
  assert.equal(view.mode, "partial");
  assert.equal(view.degradedReason, "identity_only");
  assert.equal(view.nextPollMs, 1500);
  assert.equal(view.identity.symbol, "VLD");
  assert.equal(view.parts.price.state, "refreshing");
  assert.equal(view.parts.chart.state, "refreshing");
  assert.equal(view.parts.score.state, "refreshing");
  assert.equal(view.sections.price, undefined);
});

test("detail view returns partial with visible price and chart sections", () => {
  const view = stockDetailViewFromDisplayPayload(baseDisplayPayload({
    price: {
      value: { latest_price: 12.34, latest_price_label: "$12.34" },
      freshness: "fresh",
      source: "market-data",
    },
    chart: {
      value: { chart_series: [{ date: "2026-06-11", close: 12 }, { date: "2026-06-12", close: 12.34 }] },
      freshness: "fresh",
      source: "market-data",
    },
    completion: {
      requiredParts: ["identity", "price", "chart", "score"],
      presentParts: ["identity", "price", "chart"],
      missingParts: ["score"],
      recoveringParts: ["score"],
      unavailableParts: [],
    },
    refresh: {
      active: true,
      staleParts: [],
      recoveringParts: ["score"],
      nextPollMs: 1500,
    },
  }));

  assert.equal(view.mode, "partial");
  assert.equal(view.degradedReason, undefined);
  assert.equal(view.sections.price?.latest_price, 12.34);
  assert.equal(Array.isArray(view.sections.chart?.chart_series), true);
  assert.equal(view.parts.price.state, "ready");
  assert.equal(view.parts.chart.state, "ready");
  assert.equal(view.parts.score.state, "refreshing");
});

test("detail view returns ready when no display parts are missing or recovering", () => {
  const view = stockDetailViewFromDisplayPayload(baseDisplayPayload({
    price: {
      value: { latest_price: 12.34 },
      freshness: "fresh",
      source: "market-data",
    },
    chart: {
      value: { chart_series: [{ date: "2026-06-11", close: 12 }, { date: "2026-06-12", close: 12.34 }] },
      freshness: "fresh",
      source: "market-data",
    },
    score: {
      value: { quality_score: 69, score: 69 },
      freshness: "fresh",
      source: "derived",
    },
    completion: {
      requiredParts: ["identity", "price", "chart", "score"],
      presentParts: ["identity", "price", "chart", "score"],
      missingParts: [],
      recoveringParts: [],
      unavailableParts: [],
    },
    refresh: {
      active: false,
      staleParts: [],
      recoveringParts: [],
    },
  }));

  assert.equal(view.mode, "ready");
  assert.equal(view.nextPollMs, undefined);
  assert.equal(view.parts.score.state, "ready");
  assert.equal(view.sections.score?.quality_score, 69);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --import tsx --test tests/stockDetailViewModel.test.ts
```

Expected: FAIL with a module-not-found error for `src/lib/stockDetailViewModel`.

- [ ] **Step 3: Add the detail-view types**

Create `src/lib/stockDetailViewTypes.ts`:

```ts
import type {
  StockChartView,
  StockDisplayPartName,
  StockDisplayView,
  StockIdentityView,
  StockPriceView,
  StockScoreView,
} from "@/lib/stockDisplayTypes";

export type StockDetailViewMode = "partial" | "ready" | "failed_irreversible";

export type StockDetailPartName = "price" | "chart" | "score" | "financials" | "analyst";

export type StockDetailPartState =
  | "ready"
  | "stale_ready"
  | "refreshing"
  | "failed_retrying"
  | "missing"
  | "unsupported";

export type StockDetailPartStatus = {
  state: StockDetailPartState;
  displayPart?: StockDisplayPartName;
  reason?: string;
};

export type StockDetailViewModel = {
  ok: true;
  mode: Exclude<StockDetailViewMode, "failed_irreversible">;
  ticker: string;
  requestedTicker: string;
  view: StockDisplayView;
  generatedAt: string;
  snapshotVersion: string;
  degradedReason?: "identity_only";
  nextPollMs?: number;
  identity: StockIdentityView;
  sections: {
    price?: StockPriceView;
    chart?: StockChartView;
    score?: StockScoreView;
    financials?: Record<string, unknown>;
    analyst?: Record<string, unknown>;
  };
  parts: Record<StockDetailPartName, StockDetailPartStatus>;
  jobs: Array<{
    part: StockDetailPartName;
    state: "queued" | "retrying";
  }>;
};

export type StockDetailIrreversibleFailure = {
  ok: false;
  mode: "failed_irreversible";
  error: string;
  message: string;
  ticker?: string;
};

export type StockDetailViewResponse = StockDetailViewModel | StockDetailIrreversibleFailure;
```

- [ ] **Step 4: Add the display-to-detail model adapter**

Create `src/lib/stockDetailViewModel.ts`:

```ts
import type { DisplayPartFreshness, StockDisplayPartName, StockDisplayPayload } from "@/lib/stockDisplayTypes";
import type { StockDetailPartName, StockDetailPartStatus, StockDetailViewModel } from "@/lib/stockDetailViewTypes";

const DETAIL_PART_TO_DISPLAY_PART: Record<StockDetailPartName, StockDisplayPartName[]> = {
  price: ["price"],
  chart: ["chart"],
  score: ["score"],
  financials: ["fundamentals", "industryBenchmark"],
  analyst: ["judgment", "news"],
};

export function stockDetailViewFromDisplayPayload(payload: StockDisplayPayload): StockDetailViewModel {
  const parts = detailPartStatuses(payload);
  const hasVisibleNonIdentitySection = Boolean(payload.price || payload.chart || payload.score || payload.fundamentals || payload.industryBenchmark || payload.judgment || payload.news);
  const mode = payload.refresh.active || payload.completion.missingParts.length || payload.completion.recoveringParts.length ? "partial" : "ready";

  return {
    ok: true,
    mode,
    ticker: payload.ticker,
    requestedTicker: payload.requestedTicker,
    view: payload.view,
    generatedAt: payload.generatedAt,
    snapshotVersion: payload.snapshotVersion,
    ...(!hasVisibleNonIdentitySection ? { degradedReason: "identity_only" as const } : {}),
    ...(payload.refresh.active ? { nextPollMs: payload.refresh.nextPollMs || 1_500 } : {}),
    identity: payload.identity.value,
    sections: {
      ...(payload.price ? { price: payload.price.value } : {}),
      ...(payload.chart ? { chart: payload.chart.value } : {}),
      ...(payload.score ? { score: payload.score.value } : {}),
      ...(payload.fundamentals ? { financials: payload.fundamentals.value } : {}),
      ...(payload.judgment ? { analyst: payload.judgment.value } : {}),
    },
    parts,
    jobs: jobsFromParts(parts),
  };
}

function detailPartStatuses(payload: StockDisplayPayload): Record<StockDetailPartName, StockDetailPartStatus> {
  return {
    price: detailPartStatus(payload, "price"),
    chart: detailPartStatus(payload, "chart"),
    score: detailPartStatus(payload, "score"),
    financials: detailPartStatus(payload, "financials"),
    analyst: detailPartStatus(payload, "analyst"),
  };
}

function detailPartStatus(payload: StockDisplayPayload, part: StockDetailPartName): StockDetailPartStatus {
  const displayParts = DETAIL_PART_TO_DISPLAY_PART[part];
  const present = displayParts.filter((displayPart) => payload.completion.presentParts.includes(displayPart));
  const unavailable = payload.completion.unavailableParts.find((item) => displayParts.includes(item.part));
  const recovering = displayParts.some((displayPart) => payload.completion.recoveringParts.includes(displayPart));
  const missing = displayParts.some((displayPart) => payload.completion.missingParts.includes(displayPart));

  if (present.length > 0) {
    return {
      state: displayPartFreshness(payload, present[0]) === "stale" ? "stale_ready" : "ready",
      displayPart: present[0],
    };
  }
  if (recovering) return { state: "refreshing", displayPart: displayParts[0] };
  if (unavailable) return { state: "unsupported", displayPart: unavailable.part, reason: unavailable.reason };
  if (missing) return { state: "missing", displayPart: displayParts[0] };
  return { state: "missing", displayPart: displayParts[0] };
}

function displayPartFreshness(payload: StockDisplayPayload, part: StockDisplayPartName): DisplayPartFreshness | undefined {
  return payload[part as keyof StockDisplayPayload] && typeof payload[part as keyof StockDisplayPayload] === "object"
    ? (payload[part as keyof StockDisplayPayload] as { freshness?: DisplayPartFreshness }).freshness
    : undefined;
}

function jobsFromParts(parts: Record<StockDetailPartName, StockDetailPartStatus>): StockDetailViewModel["jobs"] {
  return (Object.entries(parts) as Array<[StockDetailPartName, StockDetailPartStatus]>)
    .filter(([, status]) => status.state === "refreshing" || status.state === "failed_retrying")
    .map(([part, status]) => ({ part, state: status.state === "failed_retrying" ? "retrying" : "queued" }));
}
```

- [ ] **Step 5: Run the model test to verify it passes**

Run:

```bash
node --import tsx --test tests/stockDetailViewModel.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/lib/stockDetailViewTypes.ts src/lib/stockDetailViewModel.ts tests/stockDetailViewModel.test.ts
git commit -m "feat: add stock detail view model"
```

---

### Task 2: Detail View API Route

**Files:**
- Create: `src/app/api/stock/detail-view/route.ts`
- Test: `tests/stockDetailViewApi.test.ts`

- [ ] **Step 1: Write failing route tests**

Create `tests/stockDetailViewApi.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import { GET } from "../src/app/api/stock/detail-view/route";

test("stock detail-view endpoint returns partial model for a valid cold ticker", async () => {
  const response = await GET(new NextRequest("http://localhost/api/stock/detail-view?ticker=KR:005930"));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, "partial");
  assert.equal(payload.ticker, "KR:005930");
  assert.equal(payload.identity.symbol, "005930");
  assert.equal(payload.degradedReason, "identity_only");
  assert.equal(payload.parts.price.state, "refreshing");
  assert.equal(payload.nextPollMs, 1500);
  assert.match(response.headers.get("Cache-Control") || "", /max-age=0/);
});

test("stock detail-view endpoint returns irreversible failure for invalid ticker", async () => {
  const response = await GET(new NextRequest("http://localhost/api/stock/detail-view?ticker=BAD"));
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.mode, "failed_irreversible");
  assert.equal(payload.error, "invalid_ticker");
  assert.match(response.headers.get("Cache-Control") || "", /no-store/);
});
```

- [ ] **Step 2: Run the route test to verify it fails**

Run:

```bash
node --import tsx --test tests/stockDetailViewApi.test.ts
```

Expected: FAIL with module-not-found for `src/app/api/stock/detail-view/route`.

- [ ] **Step 3: Implement the detail-view route**

Create `src/app/api/stock/detail-view/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { publicVercelCdnCacheHeaders } from "@/lib/httpCacheHeaders";
import { scheduleStockDisplayPayloadCompletion } from "@/lib/stockCompletionPlanner";
import { stockDetailViewFromDisplayPayload } from "@/lib/stockDetailViewModel";
import { buildStockDisplayPayload } from "@/lib/stockDisplayModel";
import type { StockDisplayView } from "@/lib/stockDisplayTypes";
import { parseStrictTickerRef, resolveTickerAlias } from "@/lib/tickerRef";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tickerParam = searchParams.get("ticker");
  const view = cleanDisplayView(searchParams.get("view"));
  const resolved = resolveTickerAlias(tickerParam);
  const strict = resolved.ok ? parseStrictTickerRef(resolved.ticker) : parseStrictTickerRef(tickerParam);

  if (!strict.ok) {
    return NextResponse.json({
      ok: false,
      mode: "failed_irreversible",
      error: strict.error,
      message: "조회할 수 없는 종목 형식입니다.",
    }, {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const displayPayload = await buildStockDisplayPayload({
    ticker: strict.ticker,
    view,
  });
  scheduleStockDisplayPayloadCompletion(displayPayload);

  const detailView = stockDetailViewFromDisplayPayload(displayPayload);

  return NextResponse.json(detailView, {
    status: 200,
    headers: detailViewHeaders(detailView.nextPollMs !== undefined),
  });
}

function cleanDisplayView(value: string | null): StockDisplayView {
  if (value === "technical") return "technical";
  if (value === "compare") return "compare";
  return "detail";
}

function detailViewHeaders(refreshActive: boolean): HeadersInit {
  if (refreshActive) {
    return publicVercelCdnCacheHeaders({
      sMaxAgeSeconds: 3,
      staleWhileRevalidateSeconds: 30,
      staleIfErrorSeconds: 300,
    });
  }
  return publicVercelCdnCacheHeaders({
    sMaxAgeSeconds: 60,
    staleWhileRevalidateSeconds: 300,
    staleIfErrorSeconds: 900,
  });
}
```

- [ ] **Step 4: Run route tests**

Run:

```bash
node --import tsx --test tests/stockDetailViewApi.test.ts tests/stockDetailViewModel.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/app/api/stock/detail-view/route.ts tests/stockDetailViewApi.test.ts
git commit -m "feat: add stock detail view endpoint"
```

---

### Task 3: Query Function And Polling Options

**Files:**
- Modify: `src/lib/stockQueryKeys.ts`
- Modify: `src/lib/stockQueryFns.ts`
- Modify: `src/lib/stockQueryOptions.ts`
- Test: `tests/stockQueryFns.test.ts`
- Test: `tests/stockQueryOptions.test.ts`

- [ ] **Step 1: Add failing query function test**

Append to `tests/stockQueryFns.test.ts`:

```ts
test("detail-view fetcher calls the detail-view endpoint and returns the product model", async () => {
  const calls = mockJsonFetch({
    ok: true,
    mode: "partial",
    ticker: "US:VLD",
    requestedTicker: "US:VLD",
    view: "detail",
    generatedAt: "2026-06-12T00:00:00.000Z",
    snapshotVersion: "display-v1",
    nextPollMs: 1500,
    identity: { ticker: "US:VLD", market: "US", symbol: "VLD", name: "Velo3D" },
    sections: {},
    parts: {
      price: { state: "refreshing", displayPart: "price" },
      chart: { state: "refreshing", displayPart: "chart" },
      score: { state: "refreshing", displayPart: "score" },
      financials: { state: "missing", displayPart: "fundamentals" },
      analyst: { state: "missing", displayPart: "judgment" },
    },
    jobs: [{ part: "price", state: "queued" }],
  });

  const result = await fetchStockDetailView({ ticker: "US:VLD" });

  assert.equal(result.ok, true);
  assert.equal(result.mode, "partial");
  assert.equal(result.ticker, "US:VLD");
  assert.equal(calls[0], "/api/stock/detail-view?ticker=US%3AVLD&view=detail");
});
```

Also add `fetchStockDetailView` to the import list from `../src/lib/stockQueryFns`.

- [ ] **Step 2: Add failing query option test**

Append to `tests/stockQueryOptions.test.ts`:

```ts
test("detail-view query options poll from nextPollMs while recovering", () => {
  const option = detailViewQueryOptions("US:VLD", "detail");
  assert.deepEqual(option.queryKey, ["stock", "detail-view", "detail", "US:VLD"]);

  const partial = {
    ok: true,
    mode: "partial",
    ticker: "US:VLD",
    requestedTicker: "US:VLD",
    view: "detail",
    generatedAt: "2026-06-12T00:00:00.000Z",
    snapshotVersion: "display-v1",
    nextPollMs: 1500,
    identity: { ticker: "US:VLD", market: "US", symbol: "VLD", name: "Velo3D" },
    sections: {},
    parts: {
      price: { state: "refreshing" },
      chart: { state: "refreshing" },
      score: { state: "refreshing" },
      financials: { state: "missing" },
      analyst: { state: "missing" },
    },
    jobs: [],
  };

  assert.equal(stockDetailViewRefetchIntervalMs(partial), 1500);
  assert.equal(stockDetailViewRefetchIntervalMs({ ...partial, mode: "ready", nextPollMs: undefined }), false);
  assert.equal(stockDetailViewRefetchIntervalMs({ ok: false, mode: "failed_irreversible", error: "invalid_ticker", message: "bad" }), false);
});
```

Also add `detailViewQueryOptions` and `stockDetailViewRefetchIntervalMs` to the import list from `../src/lib/stockQueryOptions`.

- [ ] **Step 3: Run query tests to verify they fail**

Run:

```bash
node --import tsx --test tests/stockQueryFns.test.ts tests/stockQueryOptions.test.ts
```

Expected: FAIL because `fetchStockDetailView`, `detailViewQueryOptions`, and `stockDetailViewRefetchIntervalMs` are not exported.

- [ ] **Step 4: Add the detail-view query key**

Modify `src/lib/stockQueryKeys.ts`:

```ts
export const stockQueryKeys = {
  score: (ticker: string, view = "detail") => ["stock", "score", view, ticker] as const,
  display: (ticker: string, view = "detail") => ["stock", "display", view, ticker] as const,
  detailView: (ticker: string, view = "detail") => ["stock", "detail-view", view, ticker] as const,
  quote: (ticker: string) => ["stock", "quote", ticker] as const,
  compare: (tickers: readonly string[]) => ["stock", "compare", tickers.join(",")] as const,
  symbols: (query: string, market?: string) => ["stock", "symbols", market || "all", query] as const,
  judgment: (ticker: string, scoreVersion: string, inputHash: string) => ["stock", "judgment", ticker, scoreVersion, inputHash] as const,
};
```

- [ ] **Step 5: Add the query fetcher**

Modify `src/lib/stockQueryFns.ts`:

```ts
import type { StockDetailViewResponse } from "@/lib/stockDetailViewTypes";
```

Add after `fetchStockDisplay`:

```ts
export async function fetchStockDetailView({
  ticker,
  view = "detail",
  signal,
}: {
  ticker: string;
  view?: StockDisplayView;
  signal?: AbortSignal;
}): Promise<StockDetailViewResponse> {
  const query = new URLSearchParams({ ticker, view });
  const { payload } = await apiJson(`/api/stock/detail-view?${query.toString()}`, noStoreInit(signal));
  return payload as StockDetailViewResponse;
}
```

- [ ] **Step 6: Add query options**

Modify `src/lib/stockQueryOptions.ts`:

```ts
import type { StockDetailViewResponse } from "@/lib/stockDetailViewTypes";
```

Add `fetchStockDetailView` to the existing import from `@/lib/stockQueryFns`.

Add after `displayQueryOptions`:

```ts
export function detailViewQueryOptions(ticker: string, view: StockScoreView = "detail") {
  return queryOptions({
    queryKey: stockQueryKeys.detailView(ticker, view),
    queryFn: ({ signal }) => fetchStockDetailView({ ticker, view, signal }),
    staleTime: 0,
    gcTime: STOCK_QUERY_CACHE_MAX_AGE_MS,
    refetchOnMount: (query) => stockDetailViewRefetchIntervalMs(query.state.data as StockDetailViewResponse | undefined) ? "always" : true,
    refetchInterval: (query) => stockDetailViewRefetchIntervalMs(query.state.data as StockDetailViewResponse | undefined),
    meta: { feature: "stock-detail-view", view },
  });
}

export function stockDetailViewRefetchIntervalMs(result: StockDetailViewResponse | undefined): number | false {
  if (!result || result.ok === false) return false;
  if (result.mode === "ready") return false;
  return typeof result.nextPollMs === "number" && Number.isFinite(result.nextPollMs) && result.nextPollMs > 0
    ? result.nextPollMs
    : 1_500;
}
```

- [ ] **Step 7: Run query tests**

Run:

```bash
node --import tsx --test tests/stockQueryFns.test.ts tests/stockQueryOptions.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

```bash
git add src/lib/stockQueryKeys.ts src/lib/stockQueryFns.ts src/lib/stockQueryOptions.ts tests/stockQueryFns.test.ts tests/stockQueryOptions.test.ts
git commit -m "feat: add stock detail view query"
```

---

### Task 4: Dashboard State Migration

**Files:**
- Modify: `src/components/useStockDashboardQueries.ts`
- Modify: `src/components/stockDashboardHelpers.ts`
- Test: `tests/stockDashboardHelpers.test.ts`

- [ ] **Step 1: Add failing dashboard state helper tests**

Append to `tests/stockDashboardHelpers.test.ts`:

```ts
test("dashboard can leave full skeleton for identity-only detail view after first load", () => {
  const state = dashboardStateFromDetailView({
    ok: true,
    mode: "partial",
    ticker: "US:VLD",
    requestedTicker: "US:VLD",
    view: "detail",
    generatedAt: "2026-06-12T00:00:00.000Z",
    snapshotVersion: "display-v1",
    degradedReason: "identity_only",
    nextPollMs: 1500,
    identity: { ticker: "US:VLD", market: "US", symbol: "VLD", name: "Velo3D" },
    sections: {},
    parts: {
      price: { state: "refreshing" },
      chart: { state: "refreshing" },
      score: { state: "refreshing" },
      financials: { state: "missing" },
      analyst: { state: "missing" },
    },
    jobs: [],
  });

  assert.equal(state.status, "partial");
  assert.equal(state.data.symbol, "VLD");
  assert.equal(shouldShowStockSkeleton("partial", false, true), false);
});
```

Add imports for `dashboardStateFromDetailView` and the new third argument to `shouldShowStockSkeleton` after the implementation step. The third argument is `hasDetailViewResponse`.

- [ ] **Step 2: Run the helper test to verify it fails**

Run:

```bash
node --import tsx --test tests/stockDashboardHelpers.test.ts
```

Expected: FAIL because `dashboardStateFromDetailView` does not exist or `shouldShowStockSkeleton` still treats identity-only partial as full skeleton.

- [ ] **Step 3: Add helper conversion functions**

Modify `src/components/stockDashboardHelpers.ts`:

```ts
import type { StockDetailViewResponse } from "@/lib/stockDetailViewTypes";
```

Add near the skeleton helper:

```ts
export function shouldShowStockSkeleton(status: string, hasUsefulPartialData = false, hasDetailViewResponse = false): boolean {
  if (hasDetailViewResponse) return status === "loading";
  return status === "loading" || ((status === "pending" || status === "partial") && !hasUsefulPartialData);
}

export function dashboardStateFromDetailView(result: StockDetailViewResponse | undefined): { status: "partial" | "success" | "error"; data?: StockScoreResponse; error?: string } | undefined {
  if (!result) return undefined;
  if (result.ok === false) {
    return { status: "error", error: result.message };
  }
  const data: StockScoreResponse = {
    requested_ticker: result.ticker,
    market: result.identity.market,
    symbol: result.identity.symbol,
    name: result.identity.name,
    display_name: result.identity.name,
    korean_name: result.identity.koreanName,
    english_name: result.identity.englishName,
    exchange: result.identity.exchange,
    instrument_type: result.identity.instrumentType,
    latest_price: typeof result.sections.price?.latest_price === "number" ? result.sections.price.latest_price : undefined,
    latest_price_label: stringFromUnknown(result.sections.price?.latest_price_label),
    latest_bar_date: stringFromUnknown(result.sections.price?.latest_bar_date) || stringFromUnknown(result.sections.chart?.latest_bar_date),
    chart_series: Array.isArray(result.sections.chart?.chart_series) ? result.sections.chart.chart_series as StockScoreResponse["chart_series"] : undefined,
    quality_score: typeof result.sections.score?.quality_score === "number" ? result.sections.score.quality_score : undefined,
    score: typeof result.sections.score?.score === "number" ? result.sections.score.score : undefined,
    server_cache: {
      state: result.mode === "ready" ? "ready" : "recovering",
      source: "detail-view",
      fetched_at: result.generatedAt,
      refresh_started: result.mode === "partial",
      recovering_parts: Object.entries(result.parts).filter(([, value]) => value.state === "refreshing").map(([key]) => key),
    },
  };
  return { status: result.mode === "ready" ? "success" : "partial", data };
}
```

If `shouldShowStockSkeleton` already exists, replace its signature with the three-argument version instead of creating a duplicate.

- [ ] **Step 4: Run helper tests**

Run:

```bash
node --import tsx --test tests/stockDashboardHelpers.test.ts
```

Expected: PASS.

- [ ] **Step 5: Wire the detail-view query into the dashboard hook**

Modify `src/components/useStockDashboardQueries.ts`:

```ts
import { dashboardStateFromDetailView } from "@/components/stockDashboardHelpers";
import { detailViewQueryOptions } from "@/lib/stockQueryOptions";
```

Inside `useStockDashboardQueries`, after `tickerKey` is defined:

```ts
const detailViewQuery = useQuery({
  ...detailViewQueryOptions(tickerKey, "detail"),
  enabled,
});
```

After the existing `const state = dashboardStateFromQuery(...)` block, replace it with:

```ts
const legacyState = dashboardStateFromQuery({
  ticker,
  scoreResult: scoreQuery.data,
  scoreError: scoreQuery.error,
  isScoreLoading: scoreQuery.isLoading,
  quoteData,
  displayData,
});
const detailViewState = dashboardStateFromDetailView(detailViewQuery.data);
const state = detailViewState || legacyState;
```

Add `detailViewQuery.refetch()` to `retryLoad`:

```ts
void detailViewQuery.refetch();
```

Add `detailViewQuery` to the callback dependency list.

- [ ] **Step 6: Expose detail-view response presence**

Extend `StockDashboardQueryView`:

```ts
hasDetailViewResponse: boolean;
```

Return:

```ts
hasDetailViewResponse: Boolean(detailViewQuery.data),
```

- [ ] **Step 7: Commit Task 4**

```bash
git add src/components/useStockDashboardQueries.ts src/components/stockDashboardHelpers.ts tests/stockDashboardHelpers.test.ts
git commit -m "feat: drive dashboard state from detail view"
```

---

### Task 5: Dashboard Rendering And Skeleton Deadline

**Files:**
- Modify: `src/components/StockDashboard.tsx`
- Test: `tests/stockDashboardHelpers.test.ts`

- [ ] **Step 1: Add failing skeleton-deadline helper test**

Append to `tests/stockDashboardHelpers.test.ts`:

```ts
test("dashboard only keeps full skeleton for detail-view before the first response", () => {
  assert.equal(shouldShowStockSkeleton("loading", false, false), true);
  assert.equal(shouldShowStockSkeleton("partial", false, false), true);
  assert.equal(shouldShowStockSkeleton("partial", false, true), false);
  assert.equal(shouldShowStockSkeleton("success", false, true), false);
});
```

- [ ] **Step 2: Run helper test**

Run:

```bash
node --import tsx --test tests/stockDashboardHelpers.test.ts
```

Expected: PASS if Task 4 changed the helper correctly. If it fails, adjust `shouldShowStockSkeleton` to the Task 4 contract.

- [ ] **Step 3: Use `hasDetailViewResponse` in the dashboard**

Modify the destructuring in `src/components/StockDashboard.tsx`:

```ts
const {
  state,
  quoteState,
  priceRefreshState,
  judgmentState,
  scorePending,
  quotePending,
  quoteData,
  data,
  partialData,
  hasDetailViewResponse,
  retryLoad,
  refreshPrice,
} = useStockDashboardQueries(tickerParam, initialDisplayPayload);
```

Modify the skeleton condition:

```tsx
{tickerParam && !displayData && shouldShowStockSkeleton(state.status, hasDisplayablePartialData, hasDetailViewResponse) && (
  <StockDetailLoadingSkeleton tickerLabel={dashboardInputValue(tickerParam)} />
)}
```

- [ ] **Step 4: Allow identity-only detail-view partial to render the partial shell**

Modify the partial rendering condition:

```tsx
{displayPartialData && (hasDisplayablePartialData || hasDetailViewResponse) && !displayData ? (
  <PartialStockFeed data={displayPartialData} quote={quoteData} pending={state.status === "partial" ? state.pending : undefined} onRetry={retryLoad} />
) : null}
```

This keeps the user out of the full skeleton after the first detail-view response. Section-level absence remains quiet because `PartialStockFeed` already checks `hasChart`, `hasFactors`, `hasMetrics`, and similar booleans before rendering sections.

- [ ] **Step 5: Run focused dashboard tests**

Run:

```bash
node --import tsx --test tests/stockDashboardHelpers.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add src/components/StockDashboard.tsx tests/stockDashboardHelpers.test.ts
git commit -m "feat: leave stock skeleton after detail view response"
```

---

### Task 6: Durable Job State Hardening

**Files:**
- Modify: `src/lib/stockCompletionPlanner.ts`
- Modify: `tests/stockCompletionPlanner.test.ts`
- Modify: `scripts/publish_stock_snapshots.ts`
- Modify: `tests/publishStockSnapshotsTs.test.ts`

- [ ] **Step 1: Add a completion planner test for high-priority identity-only recovery**

Append to `tests/stockCompletionPlanner.test.ts`:

```ts
test("identity-only detail display plans quote chart and score recovery", () => {
  const plan = planStockDisplayCompletion({
    ticker: "US:VLD",
    view: "detail",
    presentParts: ["identity"],
    requiredParts: ["identity", "price", "chart", "score"],
  });

  assert.deepEqual(plan.missingParts, ["price", "chart", "score"]);
  assert.deepEqual(plan.recoveringParts, ["price", "chart", "score"]);
  assert.deepEqual(plan.actions.map((action) => action.queueKind), ["quote", "chart", "score"]);
  assert.equal(plan.actions.find((action) => action.part === "price")?.kind, "fetch_quote");
  assert.equal(plan.actions.find((action) => action.part === "chart")?.kind, "fetch_chart");
  assert.equal(plan.actions.find((action) => action.part === "score")?.kind, "refresh_score");
});
```

- [ ] **Step 2: Run completion planner test**

Run:

```bash
node --import tsx --test tests/stockCompletionPlanner.test.ts
```

Expected: PASS if existing planner already satisfies the contract. If it fails, adjust `actionForPart` only for missing `price`, `chart`, or `score` behavior.

- [ ] **Step 3: Keep ok:false worker hardening in place**

If the current branch already contains the `assertSuccessfulScorePayload` change in `scripts/publish_stock_snapshots.ts`, keep it. If not, add:

```ts
function assertSuccessfulScorePayload(payload: StockPayload) {
  if (payload.ok !== false) return;
  throw new Error(stringValue(payload.error) || stringValue(payload.message) || "score_payload_failed");
}
```

And call it immediately after score collection:

```ts
const result = await collectScore(ticker, view);
assertSuccessfulScorePayload(result.payload);
await tryUpsertChartSnapshotFromTechnicalPayload(config, ticker, view, result.payload);
```

- [ ] **Step 4: Verify worker hardening test exists**

Ensure `tests/publishStockSnapshotsTs.test.ts` contains:

```ts
test("TypeScript snapshot worker fails ok false score payloads instead of completing empty snapshots", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input, init) => {
    calls.push({
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : {},
    });
    return new Response(null, { status: 204 });
  }) as typeof fetch;

  const options = parseOptions(["--drain-queue", "--kind", "score", "--allow-score-python-fallback", "--worker-id", "worker-1"], {});
  const row = await publishQueueJobWithCollector(
    { id: "job-vld", kind: "score", market: "US", symbol: "VLD", view_mode: "detail", attempts: 1 },
    { url: "https://example.supabase.co", key: "service-role-key" },
    options,
    async () => ({
      payload: {
        ok: false,
        status: 404,
        error: "kis_not_found",
        message: "not found",
      },
    })
  );

  const failCall = calls.find((call) => call.url.endsWith("/rest/v1/rpc/fail_stock_refresh_job"));
  const completeCall = calls.find((call) => call.url.endsWith("/rest/v1/rpc/complete_stock_refresh_job"));
  assert.equal(row.status, "failed");
  assert.ok(failCall);
  assert.equal(completeCall, undefined);
  assert.equal(failCall.body.p_job_id, "job-vld");
  assert.equal(failCall.body.p_error, "kis_not_found");
  assert.equal(failCall.body.p_permanent, false);
});
```

- [ ] **Step 5: Run durable job tests**

Run:

```bash
node --import tsx --test tests/stockCompletionPlanner.test.ts tests/publishStockSnapshotsTs.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 6**

```bash
git add src/lib/stockCompletionPlanner.ts tests/stockCompletionPlanner.test.ts scripts/publish_stock_snapshots.ts tests/publishStockSnapshotsTs.test.ts
git commit -m "test: lock durable stock recovery jobs"
```

---

### Task 7: End-To-End Verification

**Files:**
- No new source files unless previous tasks reveal a type or import issue.

- [ ] **Step 1: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 2: Run focused stock detail test set**

Run:

```bash
node --import tsx --test \
  tests/stockDetailViewModel.test.ts \
  tests/stockDetailViewApi.test.ts \
  tests/stockQueryFns.test.ts \
  tests/stockQueryOptions.test.ts \
  tests/stockDashboardHelpers.test.ts \
  tests/stockCompletionPlanner.test.ts \
  tests/publishStockSnapshotsTs.test.ts
```

Expected: PASS.

- [ ] **Step 3: Start the dev server**

Run:

```bash
npm run dev 2>&1 | head -c 12000
```

Expected: Next dev server starts on an available localhost port, normally `http://localhost:3000`.

- [ ] **Step 4: Verify the detail-view API manually**

Run:

```bash
curl -sS 'http://127.0.0.1:3000/api/stock/detail-view?ticker=US%3AVLD' 2>&1 | head -c 4000
```

Expected: JSON contains either `"mode":"partial"` or `"mode":"ready"` for non-irreversible responses. It must not return a long-lived skeleton mode.

- [ ] **Step 5: Verify the dashboard experience in the browser**

Open:

```text
http://127.0.0.1:3000/?ticker=US%3AVLD
```

Expected after initial load:

- The page does not stay on full-page skeleton once `/api/stock/detail-view` has responded.
- If only identity exists, the page renders the stock shell for VLD with quiet missing-section affordances.
- If price, chart, or score exists, those sections render immediately.
- No long-lived “안 됩니다” explanation appears unless the API returns `failed_irreversible`.

- [ ] **Step 6: Stop the dev server**

Stop the `npm run dev` session with Ctrl-C and verify port cleanup:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN 2>&1 | head -c 4000
```

Expected: no listener remains on port 3000.

- [ ] **Step 7: Commit verification fixes if any were needed**

If verification required code fixes:

```bash
git add <changed-files>
git commit -m "fix: stabilize stock detail view SLA flow"
```

If no fixes were needed, do not create an empty commit.

---

### Task 8: Production Readiness And Vercel Deployment

**Files:**
- No source files unless release verification exposes a blocker.

- [ ] **Step 1: Run the full local release gate**

Run:

```bash
npm run check:all 2>&1 | head -c 30000
```

Expected: PASS. This includes TypeScript tests, Python tests, Rust tests, typecheck, and Next build. If the command fails because an external service credential is absent, capture the exact missing prerequisite and run the strongest available local subset:

```bash
npm test 2>&1 | head -c 30000
npm run typecheck 2>&1 | head -c 30000
npm run build 2>&1 | head -c 30000
```

- [ ] **Step 2: Run Supabase runtime readiness**

Run:

```bash
npm run supabase:readiness 2>&1 | head -c 12000
```

Expected: PASS. Required tables and RPCs for refresh queue, snapshots, and cooldowns must exist before production deploy.

- [ ] **Step 3: Run operations gate**

Run:

```bash
npm run ops:check 2>&1 | head -c 30000
```

Expected: PASS. Dead refresh jobs, stale running jobs, missing quote prices, expired industry benchmark rows, missing market calendar data, and market-data service failures must stay within configured thresholds.

- [ ] **Step 4: Run built-server stock latency gate**

Run:

```bash
npm run build 2>&1 | head -c 30000
STOCK_RATE_LIMIT_SECRET=local_load_test_secret_32_chars_minimum STOCK_ALLOW_MEMORY_GUARD_FALLBACK=1 npm run start -- -p 3002 2>&1 | head -c 12000
```

In a second shell while the built server is running:

```bash
npm run load:test:stock-latency -- --base-url http://localhost:3002 --iterations 1 2>&1 | head -c 30000
```

Expected: PASS. The gate must not report request-path provider execution markers or non-2xx detail responses.

- [ ] **Step 5: Browser QA the production-like local build**

Open:

```text
http://127.0.0.1:3002/?ticker=US%3AVLD
http://127.0.0.1:3002/?ticker=KR%3A005930
```

Expected:

- Initial layout is stable and polished on desktop and mobile.
- Full-page skeleton does not persist after the detail-view response.
- Identity-only recovery, if it occurs, presents a real stock shell rather than a failure explanation.
- Price/chart/score sections appear as soon as data exists.
- No text overlaps or stale fast-path copy dominates the screen.

- [ ] **Step 6: Commit release fixes**

If release verification required changes:

```bash
git add <changed-files>
git commit -m "fix: polish stock detail production readiness"
```

If no fixes were required, do not create an empty commit.

- [ ] **Step 7: Deploy to Vercel production**

Run the production deploy from a clean committed state:

```bash
git status --short 2>&1 | head -c 4000
npx vercel deploy --prod --yes 2>&1 | head -c 30000
```

Expected: Vercel returns a production deployment URL for the project that serves `https://stock-khaki.vercel.app`.

- [ ] **Step 8: Smoke the production URL**

Run:

```bash
curl -sS 'https://stock-khaki.vercel.app/api/stock/detail-view?ticker=US%3AVLD' 2>&1 | head -c 4000
curl -sS 'https://stock-khaki.vercel.app/api/stock/detail-view?ticker=KR%3A005930' 2>&1 | head -c 4000
npm run load:test:stock-latency -- --base-url https://stock-khaki.vercel.app --iterations 1 2>&1 | head -c 30000
```

Expected:

- Non-irreversible responses use `mode:"partial"` or `mode:"ready"`.
- Production latency smoke passes.
- No endpoint returns a long-lived skeleton mode.

- [ ] **Step 9: Final production report**

Record the final status in the user-facing completion response:

```text
Production Deploy Ready: https://stock-khaki.vercel.app
Verified:
- npm run check:all
- npm run supabase:readiness
- npm run ops:check
- local built-server latency gate
- browser QA
- Vercel production deploy
- production detail-view smoke
```

Only include a check in the final report if that exact verification passed.

---

## Self-Review Checklist

- Spec coverage:
  - 3-second skeleton deadline is covered by Task 4 and Task 5.
  - Single detail read model endpoint is covered by Task 1 through Task 3.
  - Automatic refresh through `nextPollMs` is covered by Task 3.
  - Durable job continuation is covered by Task 6.
  - Browser verification is covered by Task 7.
  - Production readiness and deployment to `https://stock-khaki.vercel.app` are covered by Task 8.
- Type consistency:
  - The public response type is `StockDetailViewResponse`.
  - Non-failure model is `StockDetailViewModel`.
  - Failure model is `StockDetailIrreversibleFailure`.
  - Query key is `stockQueryKeys.detailView(ticker, view)`.
- Scope boundary:
  - This plan migrates stock detail only.
  - Compare and technical pages remain on their existing query paths until a follow-up migration.
