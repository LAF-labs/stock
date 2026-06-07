# Provider Cost Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make stock detail and technical-analysis serving safe for 10k daily users by keeping KIS and yfinance off the user request path.

**Architecture:** Serve user requests from memory, CDN/HTTP cache, and Supabase snapshots. KIS and yfinance are background refresh providers only, with technical-analysis snapshots using the smallest possible provider surface: daily bars plus minimal identity metadata.

**Tech Stack:** Next.js 16, React 19, Supabase REST/RPC, Python score collector, TypeScript refresh worker, KIS Open API, yfinance cache.

---

## Current Readiness Verdict

Do not treat the current state as fully ready for 10k DAU until the provider-cost gates below are fixed. The frontend/bundle optimizations help rendering cost, but the largest operational risk is repeated provider calls when snapshots are missing or cannot be persisted.

### Confirmed Risks

- Technical snapshot writes can fail if the deployed Supabase database has not applied `supabase/migrations/20260607093000_technical_analysis_score_view.sql`. A failed write turns every cache miss into repeated technical recomputation.
- `scripts/fetch_stock_score.py` branches into `view == "technical"` too late. US technical requests currently perform KIS discovery, detail/search work, and `yfinance_fundamentals()` before returning the compact technical payload. KR technical requests also call current price, search info, stock info, yfinance fundamentals, and sometimes yfinance history fallback before returning.
- yfinance docs state that yfinance is not affiliated with Yahoo and is intended for research/educational/personal use. It must not be a request-time dependency for a public traffic spike.
- KIS official portal exposes REST usage through app key/secret plus access token and publishes call-volume/rate-limit notices. KIS access should be globally throttled and queued, not coupled to user page rendering.

## Rollout Gates

- Production must use `STOCK_DATA_RUNTIME=snapshot`.
- Vercel must not enable `STOCK_ALLOW_VERCEL_PYTHON_RUNTIME=1` except for a timed emergency.
- Supabase constraints/functions must accept `view_mode='technical'` for snapshots, refresh jobs, and leases.
- Request-time provider call count must be zero in load tests for cache-hit and cache-miss user requests. Cache misses may enqueue jobs only.
- Technical snapshot payloads must be compact and independently cacheable from detail/compare snapshots.

---

### Task 1: Add An Operations Gate For Technical Snapshots

**Files:**
- Modify: `scripts/stock_operations_report.ts`
- Modify: `docs/score-system-operations.md`
- Test: `tests/stockOperationsReport.test.ts` or nearest existing ops-report test

- [x] **Step 1: Write failing coverage for unapplied technical migration**

Add a test fixture where `stock_score_snapshots` rejects or lacks `view_mode='technical'` coverage and assert the report fails when `--max-missing-technical-payloads 0` is enabled.

- [x] **Step 2: Run the focused ops test**

Run: `npm test -- tests/stockOperationsReport.test.ts`

Expected: FAIL because the readiness gate does not yet detect the migration/capability failure clearly.

- [x] **Step 3: Implement the gate**

Add a technical snapshot capability check that reports:

- technical snapshot count
- missing technical payload count
- stale technical snapshot count
- latest technical write failure hint if available from logs/queue rows

- [x] **Step 4: Document the release command**

Update operations docs with the exact pre-release check:

```bash
npm run ops:check -- --max-missing-technical-payloads 0
```

- [x] **Step 5: Verify and commit**

Run:

```bash
npm test -- tests/stockOperationsReport.test.ts
npm run typecheck
```

Commit: `chore: gate technical snapshot readiness`

---

### Task 2: Split Technical Collection Into A Fast Path

**Files:**
- Modify: `scripts/fetch_stock_score.py`
- Test: `tests/test_fetch_stock_score_technical_fast_path.py`

- [x] **Step 1: Write tests proving technical view skips fundamentals**

Patch/mocking expectations:

- US `view="technical"` does not call `yfinance_fundamentals`.
- KR `view="technical"` does not call `yfinance_fundamentals`.
- KR `view="technical"` does not call `safe_history_for_symbol`.
- Technical payload still includes `technical_analysis`, `chart_series`, `price_metrics`, `market`, `symbol`, `name`, `exchange`, and `latest_price`.

- [x] **Step 2: Run the tests to confirm failure**

Run:

```bash
PYTHON_BIN=/tmp/codex-stock-python-venv/bin/python npm run test:python -- tests/test_fetch_stock_score_technical_fast_path.py
```

Expected: FAIL because technical currently branches after expensive enrichment.

- [x] **Step 3: Add `fetch_technical_score_kis_us`**

Implement a US technical-only collector that:

- validates ticker
- resolves exchange from cached discovery metadata when available
- fetches KIS daily bars
- derives latest price and latest date from daily bars when possible
- calls current price/detail only when daily bars cannot provide a usable latest price
- never calls yfinance fundamentals, news, or analyst fields
- returns `build_technical_score_payload`

- [x] **Step 4: Add `fetch_technical_score_kis_domestic`**

Implement a KR technical-only collector that:

- validates six-digit stock code
- fetches KIS daily bars
- derives latest price/date from bars
- uses lightweight profile/symbol metadata for name/exchange when available
- calls current price only when bars are empty or stale enough to make the chart unusable
- never calls yfinance fundamentals or yfinance history

- [x] **Step 5: Branch early**

At the top of `fetch_score_kis_us` and `fetch_score_kis_domestic`, return the fast path when `view == "technical"`.

- [x] **Step 6: Verify and commit**

Run:

```bash
PYTHON_BIN=/tmp/codex-stock-python-venv/bin/python npm run test:python -- tests/test_fetch_stock_score_technical_fast_path.py
PYTHON_BIN=/tmp/codex-stock-python-venv/bin/python npm run test:python
npm run typecheck
```

Commit: `perf: add technical score provider fast path`

---

### Task 3: Cache KIS US Exchange Discovery

**Files:**
- Modify: `scripts/stock_score/kis_client.py`
- Modify: `src/lib/kisQuoteClient.ts`
- Modify: `services/market-data/src/provider/kis.rs`
- Test: Python, TypeScript, and Rust provider tests near existing KIS coverage

- [x] **Step 1: Write tests for avoiding repeated US search-info**

Assert that a known `US:KO` mapping reuses the successful market/search metadata inside the server instance and avoids repeated KIS `search-info` calls.

- [ ] **Step 2: Add a shared discovery cache contract**

Store successful mapping:

- ticker
- exchange code
- product type
- exchange label
- fetched_at
- expires_at

Store negative mapping for invalid/not-found symbols with a short TTL.

- [x] **Step 3a: Use process-local discovery cache in the Node KIS quote path**

Read the process-local mapping before trying fallback exchanges. On provider errors, evict the mapping and keep the current fallback behavior.

- [ ] **Step 3b: Use durable discovery cache in all KIS quote paths**

Read cached mapping before trying fallback exchanges. On provider errors, keep the current fallback behavior but write successful mapping afterward.

- [ ] **Step 4: Verify and commit**

Run:

```bash
npm test
npm run test:rust
PYTHON_BIN=/tmp/codex-stock-python-venv/bin/python npm run test:python
```

Commit: `perf: cache KIS overseas exchange discovery`

---

### Task 4: Make yfinance Background-Only In Production

**Files:**
- Modify: `scripts/stock_score/provider_cache.py`
- Modify: `scripts/fetch_stock_score.py`
- Modify: `docs/score-system-operations.md`
- Test: `tests/test_provider_cache.py`, score collector tests

- [x] **Step 1: Add production no-provider mode**

Introduce an environment flag such as `STOCK_YFINANCE_REQUEST_FETCH=0`, defaulting to off in production/snapshot workers unless explicitly enabled in a scheduled enrichment job.

- [x] **Step 2: Update cache behavior**

When request fetch is disabled:

- return fresh Supabase cache if present
- return stale Supabase/file cache with reduced confidence if present
- return an empty cache miss metadata object without calling `yf.Ticker(...).info`

- [x] **Step 3: Keep batch enrichment explicit**

Allow scheduled/batch jobs to opt into provider refresh with an explicit env flag and bounded concurrency.

- [x] **Step 4: Verify and commit**

Run:

```bash
PYTHON_BIN=/tmp/codex-stock-python-venv/bin/python npm run test:python
npm run typecheck
```

Commit: `perf: isolate yfinance to background enrichment`

---

### Task 5: Load-Test The Request Path

**Files:**
- Create: `scripts/load_test_stock_pages.mjs`
- Modify: `package.json`
- Modify: `docs/score-system-operations.md`

- [ ] **Step 1: Add synthetic 10k DAU traffic shape**

Model:

- detail page reads
- technical page reads
- autocomplete reads
- mixed hot/cold tickers
- cache-hit and cache-miss cases

- [ ] **Step 2: Count provider calls during the test**

Fail the test if user-facing requests trigger KIS or yfinance calls directly.

- [ ] **Step 3: Set latency targets**

Initial targets:

- cached detail p95 under 500 ms locally
- cached technical p95 under 700 ms locally
- cache miss returns `202 snapshot_pending` or stale snapshot within 500 ms

- [ ] **Step 4: Verify and commit**

Run:

```bash
npm run build
npm run load:test:stock
```

Commit: `test: add stock page provider load gate`

---

## Execution Order

1. Task 1 first, because a broken technical snapshot write path destroys every other optimization.
2. Task 2 second, because it removes the largest avoidable provider cost.
3. Task 3 third, because US exchange probing multiplies KIS calls under misses.
4. Task 4 fourth, because yfinance should be legally and operationally treated as background enrichment.
5. Task 5 last, because it proves the request path is cheap before rollout.

## Success Definition

- Technical analysis remains available for every eligible single stock.
- Derivatives still never expose the technical CTA and forced entry redirects to detail.
- Newly listed stocks show limited technical interpretation using available bars.
- User-facing requests do not call yfinance.
- User-facing requests do not call KIS except through an intentionally enabled stale-while-refresh backend service.
- Missing snapshots enqueue one deduplicated refresh job and return quickly.
- Ops checks fail before release if technical snapshots cannot be written.
