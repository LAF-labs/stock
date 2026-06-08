# KIS/yfinance Provider-Optimized Snapshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep detail, technical-analysis, and compare data preparation reliable with the current KIS OpenAPI and yfinance provider set.

**Architecture:** User-facing Vercel APIs read snapshots only. KIS and yfinance are background providers, with KIS token recovery and quote/score queue isolation preventing one provider failure from blocking all views.

**Tech Stack:** Next.js 16, TypeScript, Supabase REST/RPC, GitHub Actions, Python score collector, KIS OpenAPI, yfinance cache.

---

## Phase 0: Immediate Provider Stabilization

**Files:**
- Modify: `src/lib/kisTokenCache.ts`
- Modify: `src/lib/kisQuoteClient.ts`
- Modify: `scripts/stock_score/provider_cache.py`
- Modify: `scripts/stock_score/kis_client.py`
- Modify: `.github/workflows/publish-stock-snapshots.yml`
- Test: `tests/kisQuoteClient.test.ts`
- Test: `tests/test_score_helpers.py`
- Test: `tests/test_publish_workflow.py`

- [x] **Step 1: Write failing Node KIS token retry test**

Run:

```bash
node --import tsx --test tests/kisQuoteClient.test.ts
```

Expected before implementation: FAIL on `fetchKisQuote invalidates an expired shared KIS token and retries once`.

- [x] **Step 2: Implement Node token invalidation**

Add `deleteSharedKisAccessToken(cacheKey)` and retry `kisGet` once when KIS returns an expired token message.

- [x] **Step 3: Write failing Python KIS token retry test**

Run:

```bash
bash scripts/run_python.sh -m unittest tests.test_score_helpers.ScoreHelperTests.test_kis_get_invalidates_expired_shared_token_and_retries_once
```

Expected before implementation: FAIL with `KisApiError: 기간이 만료된 token 입니다.`

- [x] **Step 4: Implement Python token invalidation**

Add Supabase token delete support, delete the local token file, and retry `kis_get` once with a fresh token.

- [x] **Step 5: Write failing workflow isolation test**

Run:

```bash
bash scripts/run_python.sh -m unittest tests.test_publish_workflow.PublishWorkflowTests.test_refresh_queue_worker_keeps_score_job_independent_from_quote_failures
```

Expected before implementation: FAIL because the workflow only has one `maintain` job.

- [x] **Step 6: Split quote and score workflow jobs**

Change `.github/workflows/publish-stock-snapshots.yml` so `quote` and `score` are independent jobs. Do not add `needs: quote` to `score`.

## Phase 1: Provider-Aware Queue Reporting

**Files:**
- Modify: `scripts/stock_operations_report.ts`
- Modify: `docs/score-system-operations.md`
- Test: `tests/stockOperationsReportTs.test.ts`

- [ ] **Step 1: Add queue summaries by `kind` and `view_mode`**

Add report fields for due quote jobs, due score detail jobs, due score compare jobs, and due score technical jobs.

- [ ] **Step 2: Classify provider failures**

Record stable error classes for `kis_auth_expired`, `kis_auth_failed`, `kis_rate_limited`, `yfinance_disabled`, `yfinance_miss`, and `yfinance_refresh_error`.

- [ ] **Step 3: Verify**

Run:

```bash
node --import tsx --test tests/stockOperationsReportTs.test.ts
npm run typecheck
```

## Phase 2: Lightweight Self-Hosted Worker

**Files:**
- Create: `scripts/stock_snapshot_worker.ts`
- Modify: `package.json`
- Modify: `docs/score-system-operations.md`
- Test: `tests/stockSnapshotWorker.test.ts`

- [ ] **Step 1: Add a long-running claim loop**

The worker should claim one kind at a time with `claim_stock_refresh_jobs_by_kind`, process bounded batches, sleep briefly, and repeat until stopped.

- [ ] **Step 2: Keep GitHub Actions as backstop**

The scheduled workflow remains enabled, but docs should treat it as fallback rather than the primary queue drain.

- [ ] **Step 3: Verify**

Run:

```bash
node --import tsx --test tests/stockSnapshotWorker.test.ts
npm run typecheck
```

## Phase 3: Partial Read Model

**Files:**
- Modify: `src/lib/stockSnapshotCache.ts`
- Modify: `src/components/StockDashboard.tsx`
- Modify: `src/components/TechnicalAnalysisPage.tsx`
- Modify: `src/components/StockComparePage.tsx`
- Test: `tests/stockCacheSnapshotMode.test.ts`
- Test: `tests/stockDashboardHelpers.test.ts`
- Test: `tests/stockCompareHelpers.test.ts`

- [ ] **Step 1: Return ready/stale/pending parts**

Represent quote, score, and technical sections independently so the UI can render each part as it becomes available.

- [ ] **Step 2: Keep provider calls out of request handlers**

Cache misses enqueue jobs only. Tests must fail if KIS or yfinance is called during Vercel snapshot-mode user requests.

- [ ] **Step 3: Verify**

Run:

```bash
npm test -- tests/stockCacheSnapshotMode.test.ts tests/stockDashboardHelpers.test.ts tests/stockCompareHelpers.test.ts
npm run typecheck
```
