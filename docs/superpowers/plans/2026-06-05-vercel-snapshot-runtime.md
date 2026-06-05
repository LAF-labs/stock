# Vercel Snapshot Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Python collector execution from the Vercel public request path while keeping Supabase-backed stock data available through scheduled snapshot publishing.

**Architecture:** Add an explicit runtime mode helper, make score/quote caches respect snapshot-only mode, return a stable snapshot-miss error, and provide an external Supabase publisher script. Vercel serves memory/Supabase reads only; Python runs in GitHub Actions, local admin, or Docker/VM contexts.

**Tech Stack:** Next.js 16, TypeScript Node runtime, Supabase REST, Python collector scripts, GitHub Actions.

---

### Task 1: Runtime Mode Contract

**Files:**
- Create: `src/lib/stockDataRuntime.ts`
- Test: `tests/stockDataRuntime.test.ts`

- [x] Write tests proving Vercel defaults to snapshot mode, local defaults to Python mode, and the public `snapshot_unavailable` payload is stable.
- [x] Implement `stockDataRuntimeMode`, `pythonCollectorEnabled`, `StockDataUnavailableError`, and payload helpers.
- [x] Run `npm test -- tests/stockDataRuntime.test.ts`.

### Task 2: Cache Layer Enforcement

**Files:**
- Modify: `src/lib/stockSnapshotCache.ts`
- Modify: `src/lib/stockQuoteCache.ts`
- Modify: `src/app/api/score/route.ts`
- Modify: `src/app/api/quote/route.ts`
- Modify: `src/app/api/score/batch/route.ts`
- Test: `tests/stockCacheSnapshotMode.test.ts`

- [x] Write tests proving snapshot mode does not fall through to Python collector on score miss or quote refresh.
- [x] Make score stale reads avoid Python background refresh in snapshot mode.
- [x] Make score and quote misses throw `StockDataUnavailableError` when Python collector is disabled.
- [x] Make API routes return the specific payload instead of generic collector outage.
- [x] Run snapshot mode tests.

### Task 3: External Snapshot Publisher

**Files:**
- Create: `scripts/publish_stock_snapshots.py`
- Test: `tests/test_publish_stock_snapshots.py`
- Create: `.github/workflows/publish-stock-snapshots.yml`

- [x] Write Python unit tests for ticker normalization, TTL timestamps, and Supabase row shape.
- [x] Implement publisher helpers and CLI.
- [x] Add GitHub Actions workflow for scheduled/manual snapshot publishing.
- [x] Run Python publisher tests.

### Task 4: Operations Documentation

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/score-system-operations.md`
- Create: `docs/superpowers/specs/2026-06-05-vercel-snapshot-runtime-design.md`

- [x] Document `STOCK_DATA_RUNTIME=snapshot` for Vercel.
- [x] Document publisher command, GitHub secrets, and prewarm set strategy.
- [x] Keep Docker/VM collector fallback documented separately.

### Task 5: Verification

- [x] Run TypeScript unit tests.
- [x] Run Python unit tests.
- [x] Run typecheck.
- [x] Run build.
- [x] Check git diff for accidental local files.
