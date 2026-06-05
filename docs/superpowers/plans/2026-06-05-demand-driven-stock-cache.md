# Demand-Driven Stock Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert stock data serving to demand-driven shared snapshots with quote/score TTL separation, safe manual quote refresh, and Vercel/Supabase-friendly refresh protection.

**Architecture:** Next.js API routes read from memory and Supabase snapshots first, then refresh only the requested symbol under Supabase-backed leases. GitHub Actions remains a maintenance worker for queued refreshes and reference-data upkeep rather than a fixed-list prewarmer as the primary data path.

**Tech Stack:** Next.js App Router, TypeScript, Supabase REST/RPC, PostgreSQL migrations, Python snapshot worker for queued/background work.

---

### Task 1: TTL Policy And Refresh Cooldown Defaults

**Files:**
- Modify: `src/lib/marketCalendar.ts`
- Modify: `src/lib/refreshCooldown.ts`
- Modify: `.env.example`
- Test: `tests/marketCalendarCachePolicy.test.ts`

- [ ] **Step 1: Write failing tests for default TTLs**

Create `tests/marketCalendarCachePolicy.test.ts` that clears the relevant env vars and asserts:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { quoteOpenTtlSeconds, scoreOpenTtlSeconds } from "../src/lib/marketCalendar";
import { refreshCooldownSeconds } from "../src/lib/refreshCooldown";

const KEYS = [
  "STOCK_QUOTE_CACHE_OPEN_SECONDS",
  "STOCK_SCORE_CACHE_FRESH_SECONDS",
  "STOCK_SCORE_DETAIL_CACHE_SECONDS",
  "STOCK_SCORE_COMPARE_CACHE_SECONDS",
  "STOCK_REFRESH_COOLDOWN_SECONDS",
] as const;
const original = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

function clearPolicyEnv() {
  for (const key of KEYS) delete process.env[key];
}

test.afterEach(() => {
  for (const key of KEYS) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("default cache policy keeps quotes fresh for five minutes and scores for thirty minutes", () => {
  clearPolicyEnv();
  assert.equal(quoteOpenTtlSeconds("US"), 300);
  assert.equal(quoteOpenTtlSeconds("KR"), 300);
  assert.equal(scoreOpenTtlSeconds("detail"), 1800);
  assert.equal(scoreOpenTtlSeconds("compare"), 1800);
});

test("default manual refresh cooldown is five minutes", () => {
  clearPolicyEnv();
  assert.equal(refreshCooldownSeconds(), 300);
});
```

- [ ] **Step 2: Verify tests fail**

Run: `npm test -- tests/marketCalendarCachePolicy.test.ts`

Expected: assertions fail because the old defaults are quote 180 seconds, score 3600 seconds, cooldown 900 seconds.

- [ ] **Step 3: Change defaults**

Change quote default to 300, score default to 1800, refresh cooldown default to 300. Update `.env.example` comments/defaults to match.

- [ ] **Step 4: Verify tests pass**

Run: `npm test -- tests/marketCalendarCachePolicy.test.ts`

Expected: all tests pass.

### Task 2: Supabase Provider Refresh Lease

**Files:**
- Create: `supabase/migrations/20260605234000_stock_refresh_leases.sql`
- Create: `src/lib/stockRefreshLease.ts`
- Test: `tests/stockRefreshLease.test.ts`

- [ ] **Step 1: Write failing tests for lease RPC client**

Create tests that mock `fetch` and assert `acquireStockRefreshLease` posts to `/rest/v1/rpc/acquire_stock_refresh_lease` with kind, market, symbol, view, and lock seconds.

- [ ] **Step 2: Verify tests fail**

Run: `npm test -- tests/stockRefreshLease.test.ts`

Expected: module missing.

- [ ] **Step 3: Add migration**

Create `stock_refresh_leases` table keyed by `(kind, market, symbol, view_mode)` and RPC `acquire_stock_refresh_lease(...)` returning `acquired`, `lease_until`, `locked_by`. Grant execute only to `service_role`.

- [ ] **Step 4: Add TypeScript client**

Implement `acquireStockRefreshLease` with in-memory fallback for local/dev and Supabase RPC for Vercel. Normalize tickers with the existing `US:`/`KR:` convention.

- [ ] **Step 5: Verify tests pass**

Run: `npm test -- tests/stockRefreshLease.test.ts`

Expected: all tests pass.

### Task 3: Demand-Driven Quote Refresh Semantics

**Files:**
- Modify: `src/lib/stockQuoteCache.ts`
- Modify: `src/app/api/quote/route.ts`
- Test: `tests/stockCacheSnapshotMode.test.ts`

- [ ] **Step 1: Write failing tests for manual refresh and stale serving**

Extend `tests/stockCacheSnapshotMode.test.ts` to prove:

- `forceRefresh` does not return `refresh_background_only` when a fresh Supabase quote snapshot exists.
- Stale quotes remain serveable in snapshot runtime and queue a refresh instead of failing hard.
- Manual refresh only touches quote cache paths.

- [ ] **Step 2: Verify tests fail**

Run: `npm test -- tests/stockCacheSnapshotMode.test.ts`

Expected: at least one new assertion fails before lease-aware implementation.

- [ ] **Step 3: Implement lease-aware refresh path**

When quote is missing or stale, acquire a quote lease before calling a live collector. If runtime cannot run a live collector, enqueue a quote refresh job and return stale data when available. If a lease is already active, return the freshest available snapshot with metadata indicating refresh is in progress.

- [ ] **Step 4: Keep manual refresh quote-only**

Ensure `/api/quote?refresh=1` only invokes `getStockQuote(..., { forceRefresh: true })` and does not call score refresh APIs.

- [ ] **Step 5: Verify tests pass**

Run: `npm test -- tests/stockCacheSnapshotMode.test.ts`

Expected: all tests pass.

### Task 4: Maintenance Job Role

**Files:**
- Modify: `.github/workflows/publish-stock-snapshots.yml`
- Modify: `README.md`
- Modify: `.env.example`

- [ ] **Step 1: Rename workflow language from primary snapshot publishing to maintenance**

Keep queue draining available, but make the default ticker list clearly optional warm targets rather than the source of truth.

- [ ] **Step 2: Document demand-driven cache**

README must explain:

- quote: 5 minutes,
- score: 30 minutes,
- manual quote refresh: per-user 5 minute cooldown,
- reference data: daily/event-driven,
- GitHub Actions: queue/reference-data maintenance only.

- [ ] **Step 3: Verify docs contain the operational rules**

Run: `rg -n "demand-driven|5 minutes|30 minutes|cooldown|queue" README.md .env.example .github/workflows/publish-stock-snapshots.yml`

Expected: each file contains the relevant updated terms.

### Task 5: Final Verification

**Files:**
- All touched files

- [ ] **Step 1: Run TypeScript tests**

Run: `npm test`

Expected: all `.test.ts` tests pass.

- [ ] **Step 2: Run Python tests**

Run: `.venv/bin/python -m unittest tests/test_publish_stock_snapshots.py tests/test_score_helpers.py tests/test_sync_external_industry_benchmarks.py`

Expected: all Python tests pass.

- [ ] **Step 3: Run typecheck and build**

Run: `npm run typecheck && npm run build`

Expected: both commands exit 0.

- [ ] **Step 4: Inspect diff**

Run: `git diff --stat && git diff --check`

Expected: no whitespace errors and changed files match this plan.
