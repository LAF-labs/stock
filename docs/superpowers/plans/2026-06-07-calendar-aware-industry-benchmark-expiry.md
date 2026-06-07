# Calendar-Aware Industry Benchmark Expiry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep industry valuation benchmarks available across weekends and exchange holidays while refreshing them at most once per market day.

**Architecture:** Use exchange calendars to compute benchmark expiry from the next market close plus a maintenance grace window instead of a fixed one-day TTL. Keep database-generated snapshot benchmarks and Finviz-generated external benchmarks aligned, and make judgment cache keys depend on benchmark availability/version so stale fallback judgments do not mask recovered benchmark data.

**Tech Stack:** Supabase SQL migrations, TypeScript/Next API routes, Python maintenance scripts, `pandas-market-calendars`, Node test runner, Python unittest.

---

### Task 1: Calendar Coverage Tests

**Files:**
- Modify: `tests/test_sync_market_calendar.py`
- Modify: `scripts/sync_market_calendar.py`

- [ ] Add failing tests for official 2026 US closures and early closes.
- [ ] Add failing tests for KRX 2026 June 3 local election day and July 17 Constitution Day closures.
- [ ] Implement conservative KRX closure overrides when the bundled calendar lags newly declared holidays.

### Task 2: External Benchmark Expiry Tests

**Files:**
- Modify: `tests/test_sync_external_industry_benchmarks.py`
- Modify: `scripts/sync_external_industry_benchmarks.py`

- [ ] Add failing tests proving Finviz rows expire after the next NYSE market close plus grace across weekend and Juneteenth.
- [ ] Add `expires_at` to external benchmark rows using the same calendar source.

### Task 3: Snapshot Benchmark SQL Expiry

**Files:**
- Create: `supabase/migrations/20260607060000_calendar_aware_industry_benchmark_expiry.sql`
- Modify: `tests/industryBenchmarks.test.ts`

- [ ] Add a migration-source regression test for the calendar-aware SQL helper and refreshed RPC.
- [ ] Add SQL helper functions that map scope/market to US/KR and compute expiry from `market_calendar`.
- [ ] Recreate `refresh_stock_industry_benchmarks` to use the helper instead of `now() + interval '1 day'`.
- [ ] Extend existing rows to the new expiry when needed.

### Task 4: Judgment Cache Benchmark Versioning

**Files:**
- Modify: `tests/apiGuards.test.ts`
- Modify: `src/lib/judgmentCache.ts`
- Modify: `src/app/api/judgment/route.ts`

- [ ] Add a failing test that cache keys differ between no-benchmark and benchmark-backed judgments.
- [ ] Add a stable benchmark cache token helper.
- [ ] Fetch benchmarks before cache lookup and include the token in the judgment cache key.

### Task 5: Verification And Release

**Files:**
- Modify docs if behavior changes need operator visibility.

- [ ] Run focused Python and TypeScript tests.
- [ ] Run full `npm test`, `npm run typecheck`, and relevant Python unittests.
- [ ] Commit only owned files, leaving unrelated untracked documents untouched.
- [ ] Push `main`.
