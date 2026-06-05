# Project Completion Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the stock score service from a promising preview into an operationally verifiable, maintainable, Vercel/Supabase-ready product, then reconcile and implement the redesign in `DESIGN.md`.

**Architecture:** Complete the backend first by adding measurable worker/score operations, then reduce collector complexity, harden data quality and reference-data lifecycle, and only then redesign UI surfaces on top of stable APIs. Every phase produces evidence: tests, build, operational reports, and a commit/push checkpoint.

**Tech Stack:** Next.js App Router, TypeScript, Supabase REST/RPC/PostgreSQL migrations, Python collector/maintenance scripts, Node test runner, Python unittest, Vercel preview deployment.

---

### Phase 1: Operational Score And Worker Observability

**Files:**
- Create: `scripts/stock_operations_report.py`
- Create: `tests/test_stock_operations_report.py`
- Create: `supabase/migrations/20260606010000_stock_operations_report.sql`
- Modify: `README.md`
- Modify: `docs/score-system-operations.md`

- [x] Add a Supabase RPC that reports refresh queue counts by status/kind, stale running jobs, dead jobs, score snapshot model distribution, and recent snapshot freshness.
- [x] Add a Python CLI that calls the RPC and, for offline tests, can summarize supplied rows.
- [x] Compute score calibration metrics: count, score min/max/mean, quality/opportunity mean, confidence mean, low-confidence high-score count, duplicate score buckets, missing model count, stale snapshot count.
- [x] Return machine-readable JSON and human-readable text.
- [x] Add tests for queue summary and calibration edge cases.
- [x] Document daily use and thresholds.

Phase 1 evidence:
- `tests/test_stock_operations_report.py` covers queue aggregation, duplicate score buckets, low-confidence high-score detection, stale/model counts, and Supabase call shape.
- Remote Supabase migration `20260606010000_stock_operations_report.sql` was applied.
- Live report sample on the preview project returned queue total 2, dead 0, stale running 0, score snapshots 12, current model 12, duplicate bucket rate 0.0.
- Live queue drain exposed an invalid ticker retry loop; `20260606012000_permanent_refresh_job_failures.sql` and `permanent_refresh_failure()` now route permanent failures such as `kis_not_found` to dead jobs instead of repeated retry.

Phase 1 verification:
- Python unittest subset: 22 tests passed.
- `npm test`: 54 tests passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.

### Phase 2: Collector Decomposition Without Behavior Drift

**Files:**
- Create package modules under `scripts/stock_score/`
- Modify: `scripts/fetch_yfinance_score.py`
- Modify: `tests/test_score_helpers.py`

- [ ] Extract pure scoring helpers and factor dataclasses into focused modules while preserving imports used by existing tests.
- [ ] Extract symbol parsing/provider normalization helpers.
- [ ] Keep the public CLI and `fetch_score`/`fetch_quote` contracts stable.
- [ ] Add import-compatibility tests before each extraction.
- [ ] Run smoke checks against representative tickers after each split.

### Phase 3: Data Quality Lifecycle

**Files:**
- Modify/create scripts for industry mapping, listing delta, earnings metadata, and benchmark refresh.
- Modify Supabase migrations only when schema changes are required.
- Modify docs under `docs/`.

- [ ] Add conservative canonical industry audit reports for over-split or suspicious industries.
- [ ] Add earnings metadata fields and a next-day financial refresh queue strategy.
- [ ] Add listing delta workflow for newly listed and delisted symbols without refreshing the entire universe daily.
- [ ] Document data-source ownership and refresh cadence.

### Phase 4: Supabase/Vercel Cost And Runtime Hardening

**Files:**
- Modify API routes, symbol fallback, cache settings, and docs as needed.

- [ ] Remove tracked local symbol fallback JSON from the Vercel hot package or move fallback to Supabase/blob storage.
- [ ] Add slow-query and API miss operational checks.
- [ ] Revisit queue worker strategy: GitHub Actions as backstop, optional separate worker for sustained backlog.
- [ ] Verify Vercel preview using deployment-protected `npx vercel curl`.

### Phase 5: DESIGN.md Reconciliation And Redesign

**Files:**
- Modify: `DESIGN.md`
- Modify: `src/app/page.tsx`
- Modify: `src/components/StockDashboard.tsx`
- Modify: `src/components/StockCompare.tsx`
- Modify: `src/components/SymbolAutocomplete.tsx`
- Modify: `src/app/globals.css`

- [ ] Audit `DESIGN.md` against the stabilized backend and actual product constraints.
- [ ] Rewrite any stale or conflicting design guidance.
- [ ] Implement the redesign in component-sized steps.
- [ ] Verify desktop/mobile layouts, text overflow, and API state handling.
- [ ] Deploy preview and run browser/API checks.

### Completion Gates

- [ ] `npm test`
- [ ] Python unittest suite
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] Supabase migrations applied
- [ ] Vercel preview deployed and verified
- [ ] Final commit and push
- [ ] Goal completion audit against the full user objective
