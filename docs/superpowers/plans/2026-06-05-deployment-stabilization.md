# Deployment Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Vercel preview app stable under snapshot-only serving by turning cold ticker misses into queued refresh work, preventing missing env during manual preview deploys, and keeping Python off the public request path.

**Architecture:** The public Next.js app reads Supabase snapshots and never depends on Python in Vercel. When a score or quote snapshot is missing, the API writes a deduplicated `stock_refresh_jobs` row and returns a pending payload. A Python publisher worker remains the short-term collector because it already owns KIS/yfinance scoring logic, but it runs outside Vercel and drains queued jobs.

**Tech Stack:** Next.js 16, TypeScript, Supabase REST/RPC, GitHub Actions, Vercel CLI, Python collector scripts.

---

### Task 1: Snapshot Pending API Contract

**Files:**
- Modify: `src/lib/stockDataRuntime.ts`
- Create: `src/lib/stockRefreshQueue.ts`
- Test: `tests/stockRefreshQueue.test.ts`

- [ ] Add a typed pending payload for `snapshot_pending`.
- [ ] Add a Supabase RPC client for `enqueue_stock_refresh_job`.
- [ ] Make queue writes best-effort and safe when admin env is absent.
- [ ] Verify with Node tests that score and quote jobs generate the expected RPC body.

### Task 2: API Miss Handling

**Files:**
- Modify: `src/app/api/score/route.ts`
- Modify: `src/app/api/quote/route.ts`
- Modify: `src/app/api/score/batch/route.ts`

- [ ] On `StockDataUnavailableError`, enqueue a matching refresh job.
- [ ] Return `snapshot_pending` with `Retry-After` instead of a generic unavailable error for ordinary misses.
- [ ] Preserve refresh cooldown behavior and no-store headers.
- [ ] Keep batch responses honest by returning per-item pending payloads.

### Task 3: Publisher Queue Drain

**Files:**
- Modify: `scripts/publish_stock_snapshots.py`
- Test: `tests/test_publish_stock_snapshots.py`
- Modify: `.github/workflows/publish-stock-snapshots.yml`

- [ ] Add `--from-queue`, `--queue-limit`, and worker id options.
- [ ] Claim jobs through Supabase RPC, publish quote/score snapshots, and mark jobs succeeded.
- [ ] Requeue transient failures with backoff and dead-letter exhausted jobs.
- [ ] Run configured prewarm tickers and queued misses in the scheduled workflow.

### Task 4: UI Pending State

**Files:**
- Modify: `src/components/StockDashboard.tsx`

- [ ] Parse `snapshot_pending` payloads without treating them as generic errors.
- [ ] Show a neutral pending status for cold tickers.
- [ ] Keep quote refresh errors from replacing the whole detail page when the score is pending.

### Task 5: Preview Deploy Safety

**Files:**
- Create: `scripts/vercel_preview_deploy.sh`
- Modify: `package.json`
- Modify: `README.md`

- [ ] Pull branch-scoped preview env before deploying.
- [ ] Verify required env names are present without printing values.
- [ ] Deploy preview from a git archive with explicit env injection.
- [ ] Document Vercel runtime env, GitHub worker env, and local dev env separately.

### Task 6: Verification

**Files:**
- Existing test/build commands.

- [ ] Run targeted Node and Python tests.
- [ ] Run full `npm test`, Python unittest, typecheck, and build.
- [ ] Deploy preview only.
- [ ] Verify health and known API endpoints on the preview.
- [ ] Commit and push.
