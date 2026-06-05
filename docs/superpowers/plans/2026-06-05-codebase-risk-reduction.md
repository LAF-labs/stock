# Codebase Risk Reduction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the highest-risk Vercel/Supabase hot-path bottlenecks and clean obsolete project files before the next preview deployment.

**Architecture:** Keep Next.js as the public API, but move symbol search to Supabase RPC when available and lazy-load the local generated universe only as a fallback. Serve stale quote snapshots immediately while a single background refresh updates the shared server snapshot. Add listing status to symbol metadata so delisted/newly listed states can be represented without refreshing the whole symbol universe.

**Tech Stack:** Next.js App Router, TypeScript, Supabase REST/RPC, PostgreSQL migrations, Python maintenance worker, Node test runner, Python unittest.

---

### Task 1: Symbol Search Hot Path

**Files:**
- Create: `src/lib/symbolSearch.ts`
- Modify: `src/app/api/symbols/route.ts`
- Modify: `src/lib/symbolTypes.ts`
- Create: `tests/symbolSearch.test.ts`
- Create: `supabase/migrations/20260605235500_symbol_search_and_listing_status.sql`

- [x] Add listing status fields to shared symbol types.
- [x] Add a Supabase RPC that searches `stock_symbol_profiles`, excludes delisted rows, and returns ranked results.
- [x] Add a TypeScript search helper that calls the RPC with a short timeout and lazy-loads `symbols.generated.json` only when Supabase is unavailable.
- [x] Replace route-local full JSON scan/sort with the helper.
- [x] Add tests for RPC success, RPC empty-result behavior, RPC failure fallback, and delisted exclusion.

### Task 2: Quote Stale-While-Refresh Semantics

**Files:**
- Modify: `src/lib/stockQuoteCache.ts`
- Modify: `tests/stockCacheSnapshotMode.test.ts`

- [x] Add a failing test proving a stale quote is returned immediately instead of blocking on a live inline provider.
- [x] Trigger inline refresh in the background when live quote refresh is available.
- [x] Keep force refresh blocking because the user explicitly requested a new price.
- [x] Preserve queued refresh behavior when inline providers are unavailable.

### Task 3: Quote Name and Profile Quality

**Files:**
- Modify: `src/lib/symbolProfiles.ts`
- Modify: `tests/symbolProfiles.test.ts`

- [x] Fill quote `name` from `stock_symbol_profiles.name` when provider returns only the raw ticker.
- [x] Keep existing provider names when they are meaningful.
- [x] Include listing status fields in profile enrichment metadata.

### Task 4: Maintenance Queue Throughput

**Files:**
- Modify: `.github/workflows/publish-stock-snapshots.yml`
- Modify: `scripts/publish_stock_snapshots.py`
- Modify: `tests/test_publish_stock_snapshots.py`
- Modify: `README.md`

- [x] Raise default queued maintenance drain from 10 to 50 jobs per run.
- [x] Document that GitHub Actions is a backstop for queued jobs, not the primary snapshot source.
- [x] Add a parser default test so the operational default does not silently regress.

### Task 5: Project Hygiene

**Files:**
- Delete: `demo_app.py`
- Delete: `SIA-Score-UI-Demo.command`
- Modify: `docs/superpowers/plans/2026-06-05-codebase-risk-reduction.md`

- [x] Remove obsolete local mock demo files that are not part of the deployed service.
- [x] Record deferred follow-up for splitting `scripts/fetch_yfinance_score.py`, `src/components/StockDashboard.tsx`, and `src/app/globals.css`.

Deferred follow-up: split the monolithic Python collector into provider, normalization, factor, scoring, and CLI modules; split `StockDashboard.tsx` into quote header, score summary, factor detail, chart, and data-status panels; split `globals.css` by app shell, dashboard, compare, forms, and shared tokens. These are maintenance wins, but they are lower immediate launch risk than the Vercel/Supabase hot-path changes above.

### Task 6: Verification and Deployment

**Files:**
- No code ownership; verification only.

- [x] Run targeted tests after each change.
- [x] Run full `npm test`.
- [x] Run Python unittest suite.
- [x] Run `npm run typecheck`.
- [x] Run `npm run build` and inspect whether the symbols API chunk no longer eagerly carries the 3.8 MB JSON payload.
- [x] Apply Supabase migration to the linked preview project.
- [ ] Commit, push, and deploy preview manually with Vercel CLI.

Verification notes:
- `npm test`: 54 passed.
- Python unittest suite: 17 passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `.next/server/app/api/symbols/route.js`: 384B; `symbols.generated.json` remains only as a fallback lazy chunk in the route trace.
- Remote Supabase RPC `search_stock_symbols('nvda')`: HTTP 200 with listing status fields.
