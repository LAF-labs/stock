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

- [x] Extract pure scoring helpers and factor dataclasses into focused modules while preserving imports used by existing tests.
- [x] Extract symbol parsing/provider normalization helpers.
- [x] Keep the public CLI and `fetch_score`/`fetch_quote` contracts stable.
- [x] Add import-compatibility tests before each extraction.
- [x] Run smoke checks against representative tickers after each split.

Phase 2 evidence so far:
- `scripts/stock_score/scoring.py` now owns `FactorScore`, `OpportunityResult`, weighted/composite score helpers, valuation guardrails, momentum and opportunity scoring helpers.
- `scripts/stock_score/symbols.py` now owns ticker regexes, `clean_ticker`, `parse_symbol_ref`, and `domestic_yfinance_symbol`.
- `scripts/fetch_yfinance_score.py` re-exports those names for legacy callers and dropped about 330 lines from the monolith.
- `tests/test_score_helpers.py` proves legacy imports and extracted module exports are the same objects.
- NVDA compare smoke passed with score 83.1/83.1 across extraction checks. Domestic smoke reached the KIS request path but failed once due to a provider connection close, so that is recorded as external provider instability rather than extraction failure.
- Python unittest subset: 24 tests passed.
- `npm test`: 54 tests passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.

### Phase 3: Data Quality Lifecycle

**Files:**
- Modify/create scripts for industry mapping, listing delta, earnings metadata, and benchmark refresh.
- Modify Supabase migrations only when schema changes are required.
- Modify docs under `docs/`.

- [x] Add conservative canonical industry audit reports for over-split or suspicious industries.
- [ ] Add earnings metadata fields and a next-day financial refresh queue strategy.
- [ ] Add listing delta workflow for newly listed and delisted symbols without refreshing the entire universe daily.
- [ ] Document data-source ownership and refresh cadence.

Phase 3 evidence so far:
- `scripts/industry_quality_audit.py` now paginates Supabase REST results instead of silently auditing only the first 1000 rows.
- The audit separates missing industry rows into actionable `asset_class = stock` rows and exempt ETF/ETN/preferred/SPAC/REIT/other rows.
- Preview audit after taxonomy cleanup: active profiles 16,861; missing primary 8,384 total; actionable stock missing 7; exempt non-stock missing 8,377; unmapped source keys 1; canonical groups 317; small groups 163; similar groups 0.
- `20260606023000_merge_similar_industry_taxonomy_labels.sql` merged domestic `반도체 제조업` into `반도체` and `보험업` into `보험`; migration was applied to the linked preview Supabase project.

### Phase 4: Supabase/Vercel Cost And Runtime Hardening

**Files:**
- Modify API routes, symbol fallback, cache settings, and docs as needed.

- [ ] Remove tracked local symbol fallback JSON from the Vercel hot package or move fallback to Supabase/blob storage.
- [ ] Add slow-query and API miss operational checks.
- [x] Revisit queue worker strategy: GitHub Actions as backstop, optional separate worker for sustained backlog.
- [x] Align public rate limits, pending retry hints, and publisher TTLs with the demand-driven cache policy.
- [ ] Verify Vercel preview using deployment-protected `npx vercel curl`.

Phase 4 evidence so far:
- Supabase read config now prefers `SUPABASE_PUBLISHABLE_KEY` for read paths and reserves `SUPABASE_SERVICE_ROLE_KEY` for writes/RPCs.
- `/api/symbols` now uses the shared API rate limiter with `STOCK_SYMBOL_SEARCH_RATE_LIMIT`.
- Missing score/quote snapshots return `snapshot_pending` with a default 300-second `Retry-After`, matching the 5-minute queue worker backstop.
- The stock snapshot publisher now defaults score snapshot TTL to 1800 seconds, matching the product rule that score/analysis is fresh for 30 minutes during market hours.
- The GitHub Actions queue worker now runs every 5 minutes on weekdays and has workflow-level concurrency to avoid overlapping provider calls.
- Preview queue was drained after the worker/TTL changes: queued 0, running 0, dead 0, succeeded 10; score snapshots 35, current model 35, stale 0.
- Tests added: `tests/supabaseRest.test.ts`, `tests/symbolsRoute.test.ts`, `tests/test_publish_workflow.py`, plus new assertions in `tests/stockDataRuntime.test.ts` and `tests/test_publish_stock_snapshots.py`.

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
