# Market Cap Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a cached CompaniesMarketCap-style dashboard for top market-cap single stocks across all/KR/overseas tabs, with DB-sector filtering and hamburger navigation entry points.

**Architecture:** Server-only provider code fetches KIS ranking APIs and normalizes rows into a dashboard snapshot. A snapshot store serves stale-while-refresh data from memory/Supabase so page loads do not wait for provider calls, while API routes read snapshots and trigger hourly refreshes on the hour only when a relevant market is active. Korea refreshes through NXT hours (08:00-20:00 KST), and the US refreshes through regular after-hours (regular close plus four hours). Client components render the dashboard and shared navigation without exposing provider keys.

**Tech Stack:** Next.js App Router, TypeScript, React 19, Node test runner, KIS Open API, Supabase REST.

---

### Task 1: Market-Cap Ranking Domain

**Files:**
- Create: `src/lib/marketCapRankingTypes.ts`
- Create: `src/lib/marketCapRankingProvider.ts`
- Test: `tests/marketCapRankingProvider.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDomesticMarketCapRow,
  normalizeOverseasMarketCapRow,
  mergeMarketCapRows,
} from "../src/lib/marketCapRankingProvider";

test("normalizes domestic KIS market-cap rows into KRW common dashboard rows", () => {
  const row = normalizeDomesticMarketCapRow({
    data_rank: "1",
    mksc_shrn_iscd: "005930",
    hts_kor_isnm: "삼성전자",
    stck_prpr: "70000",
    prdy_vrss: "1000",
    prdy_ctrt: "1.45",
    stck_avls: "4500000",
  }, "2026-06-12T01:00:00.000Z");

  assert.equal(row.ticker, "KR:005930");
  assert.equal(row.market, "KR");
  assert.equal(row.marketCap, 450000000000000);
  assert.equal(row.currency, "KRW");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/marketCapRankingProvider.test.ts`

- [ ] **Step 3: Implement normalization and merge helpers**

Create row/snapshot types, numeric parsing, KR market-cap unit conversion, US row parsing, single-stock heuristics, and stable ranking sort.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/marketCapRankingProvider.test.ts`

### Task 2: Snapshot Store And Refresh Policy

**Files:**
- Create: `src/lib/marketCapSnapshotStore.ts`
- Test: `tests/marketCapSnapshotStore.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { shouldRefreshMarketCapSnapshot } from "../src/lib/marketCapSnapshotStore";

test("does not refresh when every relevant market session is closed and a snapshot exists", () => {
  assert.equal(shouldRefreshMarketCapSnapshot({
    scope: "all",
    nowMs: Date.parse("2026-06-12T11:00:00.000Z"),
    snapshotFetchedAt: "2026-06-12T10:00:00.000Z",
    sessions: [
      { market: "KR", state: "closed" },
      { market: "US", state: "closed" },
    ],
  }), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/marketCapSnapshotStore.test.ts`

- [ ] **Step 3: Implement memory/Supabase snapshot read/write and refresh gating**

Use hourly freshness, stale serving, Supabase admin writes, read fallback, and market-session checks.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/marketCapSnapshotStore.test.ts`

### Task 3: API Routes

**Files:**
- Create: `src/app/api/market-cap/route.ts`
- Create: `src/app/api/market-cap/refresh/route.ts`
- Test: `tests/marketCapApi.test.ts`

- [ ] **Step 1: Write failing tests**

Test query parsing for `scope`, `sector`, and refresh gating without requiring provider calls.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/marketCapApi.test.ts`

- [ ] **Step 3: Implement API route handlers**

Expose cached snapshots with small CDN headers and an optional refresh route for cron/worker use.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/marketCapApi.test.ts`

### Task 4: Dashboard UI

**Files:**
- Create: `src/app/market-cap/page.tsx`
- Create: `src/components/MarketCapDashboard.tsx`
- Create: `src/components/useMarketCapDashboardQuery.ts`
- Modify: `src/app/globals.css`
- Test: `tests/marketCapDashboardHelpers.test.ts`
- Test: `tests/uiCssGuardrails.test.ts`

- [ ] **Step 1: Write failing tests**

Test tab/filter URL state, row formatting, detail links, and expected CSS hooks.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/marketCapDashboardHelpers.test.ts tests/uiCssGuardrails.test.ts`

- [ ] **Step 3: Implement dashboard client UI**

Render tabs, top-right sector filter, top 100 rows, loading/stale states, and clickable stock rows.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/marketCapDashboardHelpers.test.ts tests/uiCssGuardrails.test.ts`

### Task 5: Hamburger Navigation

**Files:**
- Create: `src/components/AppNavigationMenu.tsx`
- Modify: `src/components/StockDashboard.tsx`
- Modify: `src/components/StockCompare.tsx`
- Modify: `src/components/TechnicalAnalysisPage.tsx`
- Modify: `src/components/TechnicalAnalysisSections.tsx`
- Modify: `src/app/globals.css`
- Test: `tests/appNavigationMenu.test.ts`
- Test: `tests/uiCssGuardrails.test.ts`

- [ ] **Step 1: Write failing tests**

Test page-specific menu item lists and CSS hooks for desktop floating/mobile search-left placement.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/appNavigationMenu.test.ts tests/uiCssGuardrails.test.ts`

- [ ] **Step 3: Implement shared menu and mount it on each page**

Support hover/click desktop opening, modal popover mobile opening, and collapsed search expansion coordination.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/appNavigationMenu.test.ts tests/uiCssGuardrails.test.ts`

### Task 6: Verification

**Files:**
- Modified files from previous tasks.

- [ ] **Step 1: Run focused tests**

Run: `npm test -- tests/marketCapRankingProvider.test.ts tests/marketCapSnapshotStore.test.ts tests/marketCapDashboardHelpers.test.ts tests/appNavigationMenu.test.ts tests/uiCssGuardrails.test.ts`

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`

- [ ] **Step 3: Run build**

Run: `npm run build`

- [ ] **Step 4: Start dev server and inspect UI**

Run: `npm run dev`, then verify `/market-cap`, `/`, `/technical`, and `/compare` with the in-app browser.
