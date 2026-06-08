# Cache-First Latency Strategy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce perceived wait time for stock detail, technical analysis, and compare by caching slow-changing data longer and returning ready/stale/pending data parts independently.

**Architecture:** Keep user-facing Vercel APIs snapshot-only. Split stock data into freshness classes, materialize chart and technical data as durable snapshots, and use an always-on worker as the primary queue drain while GitHub Actions remains a backstop.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase REST/RPC/Postgres, Python score collector, KIS OpenAPI, yfinance background cache.

---

## File Structure

- Create: `shared/stock-cache-policy.json`
  - Single source of truth for fresh/stale TTLs by data class.
- Create: `src/lib/stockCachePolicy.ts`
  - TypeScript reader for cache-policy TTLs.
- Create: `scripts/stock_score/cache_policy.py`
  - Python reader for the same policy.
- Create: `supabase/migrations/20260608150000_stock_chart_snapshots.sql`
  - Durable OHLCV chart snapshots and indexes.
- Modify: `src/lib/stockQuoteCache.ts`
  - Use cache policy for quote stale/fresh windows.
- Modify: `src/lib/stockSnapshotCache.ts`
  - Use cache policy for score and technical stale windows.
- Modify: `scripts/stock_score/provider_cache.py`
  - Split yfinance cache windows by field class or emit metadata needed for the split.
- Modify: `scripts/publish_stock_snapshots.ts`
  - Add repeated queue passes and lane-aware worker behavior for quote/chart/score.
- Modify: `scripts/publish_stock_snapshots.py`
  - Keep legacy score worker compatible with new cache policy.
- Modify: `src/app/api/quote/route.ts`
  - Continue serving quote from snapshots but expose part state consistently.
- Modify: `src/app/api/score/route.ts`
  - Avoid whole-response pending when some parts are available.
- Modify: `src/components/StockDashboard.tsx`
  - Render ready/stale sections while missing sections skeletonize.
- Modify: `src/components/TechnicalAnalysisPage.tsx`
  - Render candles first, then overlays/rules as they become available.
- Modify: `src/components/StockCompare.tsx`
  - Render available ticker cards independently.
- Modify: `docs/score-system-operations.md`
  - Document cache TTLs, always-on worker, and operational SLOs.
- Create/Modify: `docs/provider-evaluation-2026-06.md`
  - Captures provider research and later paid-provider decision gates.

---

## Phase 1: Cache Policy Contract

**Files:**
- Create: `shared/stock-cache-policy.json`
- Create: `src/lib/stockCachePolicy.ts`
- Create: `scripts/stock_score/cache_policy.py`
- Modify: `src/lib/quoteContract.ts`
- Modify: `src/lib/marketCalendar.ts`
- Test: `tests/stockCachePolicy.test.ts`
- Test: `tests/test_cache_policy.py`

- [x] **Step 1: Add failing TypeScript policy tests**

Run:

```bash
node --import tsx --test tests/stockCachePolicy.test.ts
```

Expected before implementation: FAIL because `stockCachePolicyFor("identity")` does not exist.

Test cases:

- identity fresh is at least 30 days
- quote open fresh is 300 seconds
- chart stale is at least 30 days
- fundamentals financial-statement stale is longer than ratios stale
- unknown policy keys throw a clear error

- [x] **Step 2: Add failing Python policy tests**

Run:

```bash
bash scripts/run_python.sh -m unittest tests.test_cache_policy
```

Expected before implementation: FAIL because `scripts.stock_score.cache_policy` does not exist.

- [x] **Step 3: Implement shared policy readers**

Create `shared/stock-cache-policy.json` with concrete defaults:

```json
{
  "identity": { "fresh_seconds": 2592000, "stale_seconds": 15552000 },
  "quote": { "fresh_seconds": 300, "stale_seconds": 86400 },
  "chart": { "fresh_seconds": 900, "stale_seconds": 2592000 },
  "technical": { "fresh_seconds": 900, "stale_seconds": 604800 },
  "score": { "fresh_seconds": 1800, "stale_seconds": 604800 },
  "fundamentals_statement": { "fresh_seconds": 604800, "stale_seconds": 15552000 },
  "fundamentals_market_ratio": { "fresh_seconds": 86400, "stale_seconds": 2592000 },
  "industry_classification": { "fresh_seconds": 7776000, "stale_seconds": 31536000 },
  "industry_benchmark": { "fresh_seconds": 86400, "stale_seconds": 604800 },
  "judgment": { "fresh_seconds": 86400, "stale_seconds": 604800 }
}
```

- [x] **Step 4: Wire existing quote/score TTL helpers to the policy**

Keep environment overrides working:

- `STOCK_QUOTE_CACHE_OPEN_SECONDS`
- `STOCK_SCORE_CACHE_FRESH_SECONDS`
- `STOCK_SCORE_DETAIL_CACHE_SECONDS`
- `STOCK_SCORE_COMPARE_CACHE_SECONDS`
- `STOCK_SCORE_TECHNICAL_CACHE_SECONDS`
- `STOCK_SCORE_CACHE_STALE_SECONDS`

- [x] **Step 5: Verify Phase 1**

Run:

```bash
node --import tsx --test tests/stockCachePolicy.test.ts
bash scripts/run_python.sh -m unittest tests.test_cache_policy
npm run typecheck
```

Commit:

```bash
git add shared/stock-cache-policy.json src/lib/stockCachePolicy.ts scripts/stock_score/cache_policy.py src/lib/quoteContract.ts src/lib/marketCalendar.ts tests/stockCachePolicy.test.ts tests/test_cache_policy.py
git commit -m "feat: add stock cache policy contract"
```

---

## Phase 2: Durable Chart Snapshot Lane

**Files:**
- Create: `supabase/migrations/20260608150000_stock_chart_snapshots.sql`
- Create: `src/lib/stockChartCache.ts`
- Modify: `scripts/publish_stock_snapshots.ts`
- Test: `tests/stockChartCache.test.ts`
- Test: `tests/publishStockSnapshotsTs.test.ts`
- Test: `tests/supabaseRuntimeReadinessTs.test.ts`

- [x] **Step 1: Add chart snapshot migration tests/readiness check**

Add test coverage that readiness fails if `stock_chart_snapshots` is missing after this phase.

Run:

```bash
node --import tsx --test tests/supabaseRuntimeReadinessTs.test.ts
```

- [x] **Step 2: Add table migration**

Create a table with:

- `ticker`
- `market`
- `symbol`
- `source`
- `payload`
- `last_bar_date`
- `fetched_at`
- `expires_at`
- `stale_expires_at`
- primary key `(ticker, source)`

Retain stale chart data for at least 30 days.

- [x] **Step 3: Implement `stockChartCache.ts`**

Behavior:

- memory first
- Supabase second
- stale chart is serveable
- miss enqueues refresh without calling KIS from Vercel
- closed historical bars are kept; only recent bars refresh

- [x] **Step 4: Teach worker to publish chart snapshots**

Use the existing KIS technical fast path, extract its `chart_series`, and write `stock_chart_snapshots`. Do not call yfinance for technical chart history in production.

- [x] **Step 5: Verify Phase 2**

Run:

```bash
node --import tsx --test tests/stockChartCache.test.ts tests/stockRefreshQueue.test.ts tests/publishStockSnapshotsTs.test.ts tests/supabaseRuntimeReadinessTs.test.ts tests/stockDataRuntime.test.ts
bash scripts/run_python.sh -m unittest tests.test_supabase_runtime_readiness
npm run typecheck
```

Commit:

```bash
git add supabase/migrations/20260608150000_stock_chart_snapshots.sql src/lib/stockChartCache.ts scripts/publish_stock_snapshots.ts scripts/stock_score/timeseries.py tests/stockChartCache.test.ts tests/test_timeseries_cache.py
git commit -m "feat: cache stock chart snapshots"
```

---

## Phase 3: Partial Snapshot Response Model

**Files:**
- Create: `src/lib/stockPartsResponse.ts`
- Modify: `src/app/api/quote/route.ts`
- Modify: `src/app/api/score/route.ts`
- Modify: `src/lib/stockPendingResponse.ts`
- Modify: `tests/stockPendingResponse.test.ts`
- Test: `tests/stockPartsResponse.test.ts`

- [ ] **Step 1: Add tests for ready/stale/pending parts**

Expected behavior:

- quote fresh + score miss returns HTTP 200 with `parts.score.state="pending"`
- chart stale + technical pending returns HTTP 200 with chart payload
- only total miss returns HTTP 202
- response body does not expose "300초" or queue internals

- [ ] **Step 2: Implement `stockPartsResponse.ts`**

The helper should compose:

- identity part
- quote part
- chart part
- score part
- technical part
- fundamentals part metadata when present

- [ ] **Step 3: Convert score route to partial response**

For detail and technical views, do not throw the entire page into pending when quote or chart is available.

- [ ] **Step 4: Keep compare independently partial**

Each ticker in compare should have its own part state. One cold ticker must not blank already-ready ticker cards.

- [ ] **Step 5: Verify Phase 3**

Run:

```bash
node --import tsx --test tests/stockPartsResponse.test.ts tests/stockPendingResponse.test.ts
npm run typecheck
```

Commit:

```bash
git add src/lib/stockPartsResponse.ts src/app/api/quote/route.ts src/app/api/score/route.ts src/lib/stockPendingResponse.ts tests/stockPartsResponse.test.ts tests/stockPendingResponse.test.ts
git commit -m "feat: return partial stock snapshot states"
```

---

## Phase 4: Section-Level UI Loading

**Files:**
- Modify: `src/components/StockDashboard.tsx`
- Modify: `src/components/TechnicalAnalysisPage.tsx`
- Modify: `src/components/StockCompare.tsx`
- Modify: `src/components/stockDashboardHelpers.ts`
- Modify: `src/components/usePendingRetry.ts`
- Test: `tests/stockDashboardHelpers.test.ts`
- Test: `tests/clientApi.test.ts`
- Test: `tests/technicalOverlayChart.test.ts`
- Test: `tests/stockCompareHelpers.test.ts`

- [ ] **Step 1: Add UI helper tests**

Expected behavior:

- dashboard skeleton is section-level, not full-page, when any useful data is present
- technical page renders candlestick chart before rule summary
- overlay toggles can be disabled while their data is pending
- compare renders ready ticker cards while pending cards keep skeletons

- [ ] **Step 2: Update pending retry behavior**

Polling should be tied to missing parts, not one page-level pending state. Keep short polling with jitter and pause while hidden.

- [ ] **Step 3: Implement dashboard partial rendering**

Render:

- title/identity as soon as identity exists
- quote as soon as quote exists
- score cards if score stale/fresh exists
- section skeletons only where state is `pending` or `miss`

- [ ] **Step 4: Implement technical partial rendering**

Rules:

- price is always candlestick
- non-price overlays can be toggled off/on
- chart renders with available candles even if technical interpretation is pending
- newly listed stocks show limited-mode text

- [ ] **Step 5: Verify Phase 4**

Run:

```bash
npm test -- tests/stockDashboardHelpers.test.ts tests/clientApi.test.ts tests/technicalOverlayChart.test.ts tests/stockCompareHelpers.test.ts
npm run typecheck
```

Commit:

```bash
git add src/components/StockDashboard.tsx src/components/TechnicalAnalysisPage.tsx src/components/StockCompare.tsx src/components/stockDashboardHelpers.ts src/components/usePendingRetry.ts tests/stockDashboardHelpers.test.ts tests/clientApi.test.ts tests/technicalOverlayChart.test.ts tests/stockCompareHelpers.test.ts
git commit -m "feat: render stock data parts progressively"
```

---

## Phase 5: Always-On Queue Worker

**Files:**
- Create: `scripts/stock_snapshot_worker.ts`
- Modify: `scripts/publish_stock_snapshots.ts`
- Modify: `supabase/migrations/20260608153000_refresh_jobs_extended_lanes.sql`
- Modify: `docs/score-system-operations.md`
- Test: `tests/stockSnapshotWorker.test.ts`
- Test: `tests/test_publish_workflow.py`

- [ ] **Step 1: Add worker tests**

Expected behavior:

- worker loops until stopped
- worker claims quote/chart/score/fundamentals lanes independently
- one lane failure does not stop other lanes
- due user-visible jobs are retried before prewarm jobs
- GitHub Actions remains backstop, not primary

- [ ] **Step 2: Extend claim-by-kind if needed**

Current `claim_stock_refresh_jobs_by_kind` accepts quote and score only. Extend to supported lanes used by this phase, or keep chart as score technical only if no separate chart queue is added.

- [ ] **Step 3: Implement long-running worker**

Loop:

1. readiness check
2. claim high-priority quote jobs
3. claim chart/technical jobs
4. claim score jobs
5. claim fundamentals jobs
6. sleep 3-5 seconds

- [ ] **Step 4: Update operations docs**

Document:

- deployment target for the worker
- required environment variables
- queue SLOs
- failure classes
- how to run locally

- [ ] **Step 5: Verify Phase 5**

Run:

```bash
node --import tsx --test tests/stockSnapshotWorker.test.ts
bash scripts/run_python.sh -m unittest tests.test_publish_workflow
npm run typecheck
```

Commit:

```bash
git add scripts/stock_snapshot_worker.ts scripts/publish_stock_snapshots.ts supabase/migrations/20260608153000_refresh_jobs_extended_lanes.sql docs/score-system-operations.md tests/stockSnapshotWorker.test.ts tests/test_publish_workflow.py
git commit -m "feat: add always-on stock snapshot worker"
```

---

## Phase 6: Long-Lived Fundamentals Cache

**Files:**
- Modify: `supabase/migrations/20260605103000_stock_fundamental_snapshots.sql` or create a forward migration
- Modify: `scripts/stock_score/provider_cache.py`
- Modify: `scripts/fetch_stock_score.py`
- Modify: `docs/score-system-operations.md`
- Test: `tests/test_score_helpers.py`
- Test: `tests/test_fetch_stock_score_technical_fast_path.py`

- [ ] **Step 1: Add tests for split fundamentals cache states**

Expected behavior:

- financial-statement fields are still serveable after 30 days when inside the new stale window
- market-ratio fields expire earlier than statement fields
- yfinance fetch remains disabled on user-request workers
- stale fundamentals lower confidence but do not block score payloads

- [ ] **Step 2: Update Supabase retention**

Current `stock_fundamental_snapshots_retention` caps stale expiry at 30 days. Add a forward migration that supports longer statement retention, either by:

- relaxing the retention check to 180 days, or
- splitting normalized field-class snapshots into a new table.

Preferred: split field-class metadata first if implementation complexity is acceptable.

- [ ] **Step 3: Update yfinance cache metadata**

Attach field class and cache state to enrichment payloads:

- `statement`
- `market_ratio`
- `analyst`
- `liquidity`

- [ ] **Step 4: Verify Phase 6**

Run:

```bash
bash scripts/run_python.sh -m unittest tests.test_score_helpers tests.test_fetch_stock_score_technical_fast_path
npm run typecheck
```

Commit:

```bash
git add supabase/migrations scripts/stock_score/provider_cache.py scripts/fetch_stock_score.py docs/score-system-operations.md tests/test_score_helpers.py tests/test_fetch_stock_score_technical_fast_path.py
git commit -m "feat: extend fundamentals cache by field class"
```

---

## Phase 7: Load And Cost Gates

**Files:**
- Create: `scripts/load_test_stock_latency.mjs`
- Modify: `package.json`
- Modify: `scripts/stock_operations_report.ts`
- Modify: `docs/score-system-operations.md`
- Test: `tests/stockOperationsReportTs.test.ts`

- [ ] **Step 1: Add synthetic traffic script**

Traffic mix:

- hot cached detail
- cold detail
- hot technical
- cold technical
- compare with mixed ready/pending tickers

- [ ] **Step 2: Add provider-call guard**

Fail the load gate if Vercel request-path tests call KIS, yfinance, or Python collector.

- [ ] **Step 3: Add queue SLO checks**

Report:

- due age by lane
- oldest user-visible miss
- provider failure class counts
- cold quote time-to-ready
- cold chart/technical time-to-ready

- [ ] **Step 4: Verify Phase 7**

Run:

```bash
npm run build
npm run load:test:stock-latency
node --import tsx --test tests/stockOperationsReportTs.test.ts
```

Commit:

```bash
git add scripts/load_test_stock_latency.mjs package.json scripts/stock_operations_report.ts docs/score-system-operations.md tests/stockOperationsReportTs.test.ts
git commit -m "test: add stock latency and provider cost gates"
```

---

## Phase 8: Provider Research Decision Gate

**Files:**
- Modify: `docs/provider-evaluation-2026-06.md`
- Modify: `docs/score-system-operations.md`

- [x] **Step 1: Consolidate API research**

Use provider research reports to compare:

- KIS
- yfinance
- US quote/chart providers
- fundamentals/analyst providers
- Korea-specific sources

- [x] **Step 2: Decide next provider posture**

Classify each provider as:

- keep current
- add as background enrichment
- add as primary paid provider
- reject for production

- [ ] **Step 3: Revisit after cache/load gates**

After Phase 7, update the document with measured gaps:

- KIS cold quote time-to-ready
- KIS chart cold time-to-ready
- yfinance cache miss rate
- user-visible pending rate by screen
- paid-provider trial need/no-need decision

- [ ] **Step 4: Verify no implementation dependency was added**

Run:

```bash
git diff -- docs/provider-evaluation-2026-06.md docs/score-system-operations.md
```

Commit:

```bash
git add docs/provider-evaluation-2026-06.md docs/score-system-operations.md
git commit -m "docs: evaluate stock data provider options"
```

---

## Rollout Order

1. Phase 1 establishes cache policy without changing behavior much.
2. Phase 2 adds chart snapshots, which unlocks fast technical rendering.
3. Phase 3 changes API shape to avoid whole-page pending.
4. Phase 4 makes the UX match the partial API.
5. Phase 5 removes the GitHub Actions cold-start dependency from the critical path.
6. Phase 6 reduces yfinance pressure and stale-score blanks.
7. Phase 7 proves speed and cost.
8. Phase 8 decides whether a paid provider is worth adding later.

## Acceptance Criteria

- User-facing Vercel requests do not call KIS, yfinance, or Python.
- Cold ticker pages show identity/quote/chart as soon as each part exists.
- Stale score/fundamentals can be served with visible cache state instead of blank loading.
- Technical analysis remains available for every eligible single stock.
- Newly listed stocks render limited technical analysis instead of failing.
- Derivative-like products still do not expose technical analysis entry.
- GitHub Actions is only a backstop; an always-on worker drains user-visible misses.
- Operations report exposes queue age and provider failures by lane.

## Self-Review

- The plan does not require prewarming every listed stock.
- The plan explicitly fixes the 30-day fundamentals retention limit before using longer statement stale windows.
- The chart lane is separated from score so technical analysis can render before full scoring.
- Each phase has a verification command and commit boundary.
- Provider replacement is deliberately deferred to a decision gate after research, not mixed into cache work.
