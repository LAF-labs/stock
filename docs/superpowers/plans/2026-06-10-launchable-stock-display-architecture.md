# Launchable Stock Display Architecture Remediation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the stock detail, compare, technical analysis, search, cache, and refresh pipeline around one product rule: a user who searches a valid stock should see the best available stock view immediately, and provider-available missing parts must complete without the user managing retries or reading pipeline status.

**Architecture:** Use a Selective Always-Ready Display Snapshot. Supabase stores a product-shaped `display_snapshot` read model by ticker/view/part; Vercel/HTTP cache and TanStack Query persisted cache serve it quickly; provider calls happen through budgeted, deduped completion workers and selective prewarm, not uncontrolled request-time fan-out. React renders available parts immediately and tracks missing provider-available parts as completion obligations, never as user-facing pending states.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, `@tanstack/react-query@5.101.0`, `@tanstack/react-query-persist-client@5.101.0`, `idb-keyval@6.2.5`, Supabase REST, KIS market data, existing Python/yfinance enrichment as background-only.

---

## Why This Plan Exists

The current code has moved from manual fetching to TanStack Query, but the product is still shaped by the old pipeline. The UI asks "is the collector done?" before it asks "what can the user see now?" That is the wrong center of gravity.

The service is not large enough to justify three separate frontend load-state machines, multiple partial translators, conservative cache persistence that discards useful fast-path data, and user-visible empty/pending states for sections that should simply be absent until data exists.

This plan deliberately supersedes the softer interpretation of `docs/superpowers/plans/2026-06-10-tanstack-query-data-pipeline-upgrade.md`: query migration alone is not the goal. The goal is a launchable product contract that makes failure rare, stale data useful, and internal orchestration invisible.

## Chosen Balance Strategy

The target is not "fetch everything on demand" and not "prewarm every stock constantly." Both are bad tradeoffs.

The chosen balance is **Selective Always-Ready Display Snapshot**:

1. Keep a product-shaped `display_snapshot` table as the primary read model.
2. Serve snapshots through Vercel/HTTP cache and TanStack Query persisted cache before reaching providers.
3. Prewarm only the stocks that are likely to be viewed: popular, recent, active search candidates, compare list items, and currently open pages.
4. For long-tail cold stocks, return identity or the last useful snapshot immediately, then start provider-budgeted completion jobs for missing core parts.
5. Enforce provider budgets globally. A provider call is a scarce resource, not a per-request entitlement.
6. Never allow missing provider-available core data to become a completed state.

Explicit non-goals:

- Do not keep every supported KR/US stock fully hot every minute.
- Do not call quote/chart/score providers directly from React components.
- Do not let compare or search prefetch fan out beyond provider budget.
- Do not solve speed by hiding missing data forever.

### Hotness Tiers

Each ticker belongs to one or more hotness tiers. Tiers decide prewarm priority and refresh frequency; they do not change the display contract.

| Tier | Examples | Required behavior |
| --- | --- | --- |
| Active page | current detail, technical, compare tickers | keep visible payload current; recover missing core parts immediately |
| Search candidates | top 3-5 autocomplete results after debounce | prefetch display snapshots; enqueue missing core parts only within provider budget |
| Recent/user-visible | recently viewed or compared tickers | keep display snapshot warm for a bounded TTL |
| Popular market list | top searched/traded/curated tickers | scheduled prewarm by part TTL |
| Long tail | valid stock with no recent demand | identity-first display plus deduped completion on demand |

### Provider Budget Rules

Provider capacity is the hard operating constraint. The code already has a KIS provider guard at `src/lib/kisQuoteClient.ts:104` with a conservative default of 120 calls per 60 seconds. The new architecture should centralize and strengthen that idea instead of bypassing it.

Rules:

1. All provider calls must pass through a distributed provider budget keyed by provider, market, endpoint kind, and app credential.
2. Each completion job must be idempotent by ticker, view, part, and freshness bucket.
3. A compare request for five stocks creates at most five deduped completion plans. It must not trigger uncontrolled quote/chart/score fan-out.
4. Search prefetch is capped to the top 3-5 candidates and must use existing snapshots first.
5. US exchange discovery must be cached by symbol so quote/chart recovery does not retry every exchange on every request.
6. Chart recovery and quote recovery should share provider results where possible; score and technical should derive from cached chart/price instead of making avoidable provider calls.
7. Provider rate limit, timeout, or temporary outage keeps a part in `recovering`; it does not create user-facing failure when stale or partial display exists.

### Cost Rules

Supabase and Vercel costs stay small only if display reads are cacheable and coarse-grained.

Rules:

1. Store product-ready display snapshots in Supabase; do not reconstruct large pages from many per-section Supabase reads.
2. Keep one compact display payload per ticker/view, with part-level freshness inside the payload.
3. Cache display endpoint responses with stale-while-revalidate semantics where safe.
4. Persist successful display payloads in TanStack Query so repeat views avoid network work.
5. Avoid sending large unchanged chart arrays on every refetch; use part `fetchedAt`/`version` metadata or endpoint splitting if payload size becomes material.
6. Measure cache hit rate before increasing provider refresh frequency.

The intended shape is:

```text
provider -> budgeted ingestion/completion -> display_snapshot -> Vercel/HTTP cache -> TanStack Query persisted cache -> UI
```

The request path should mostly read. The worker path should mostly create and repair.

## Sources Touched Before The Full Audit Ledger

- `docs/superpowers/plans/2026-06-10-tanstack-query-data-pipeline-upgrade.md`
- `docs/superpowers/plans/2026-06-09-pending-minimization-phase-plan.md`
- `docs/superpowers/specs/2026-06-08-cache-first-latency-strategy-design.md`
- `src/components/StockDashboard.tsx`
- `src/components/StockCompare.tsx`
- `src/components/TechnicalAnalysisPage.tsx`
- `src/components/TechnicalAnalysisSections.tsx`
- `src/components/StockDetailSections.tsx`
- `src/components/StockHeader.tsx`
- `src/components/SymbolAutocomplete.tsx`
- `src/components/useStockDashboardQueries.ts`
- `src/components/useStockCompareQueries.ts`
- `src/components/useTechnicalAnalysisQueries.ts`
- `src/components/QueryProvider.tsx`
- `src/components/stockDashboardHelpers.ts`
- `src/components/stockCompareHelpers.ts`
- `src/lib/stockQueryFns.ts`
- `src/lib/stockQueryOptions.ts`
- `src/lib/stockQueryTypes.ts`
- `src/lib/stockPartsResponse.ts`
- `src/lib/stockSnapshotCache.ts`
- `src/lib/stockQueryCompleteness.ts`
- `src/lib/detailScoreFastPath.ts`
- `src/app/api/score/route.ts`
- `src/app/api/score/batch/route.ts`

## Full Audit Ledger

This section exists because a first-pass hotspot review is not the same thing as a full code audit. Any future worker must update this ledger instead of claiming that the whole codebase has been reviewed.

### Inventory Baseline

- `src` TypeScript/TSX files inventoried: 77
- Test files inventoried: 54
- `src/components`, `src/app`, and `src/lib` combined line count from `wc -l`: 16,168
- Largest risk files by line count:
  - `src/components/stockDashboardHelpers.ts`: 1061
  - `src/lib/detailScoreFastPath.ts`: 799
  - `src/lib/kisQuoteClient.ts`: 767
  - `src/components/StockDashboard.tsx`: 719
  - `src/components/StockCompare.tsx`: 670
  - `src/lib/stockSnapshotCache.ts`: 463
  - `src/lib/technicalAnalysisEngine.ts`: 462
  - `src/components/TradingPriceChart.tsx`: 454
  - `src/lib/stockQuoteCache.ts`: 439
  - `src/components/StockDetailSections.tsx`: 427

### Line Ranges Audited In The Current Pass

- App route shells:
  - `src/app/page.tsx:1-70`
  - `src/app/compare/page.tsx:1-70`
  - `src/app/technical/page.tsx:1-60`
- Frontend screens and components:
  - `src/components/StockDashboard.tsx:1-719`
  - `src/components/StockCompare.tsx:1-670`
  - `src/components/StockHeader.tsx:1-204`
  - `src/components/StockDetailSections.tsx:1-427`
  - `src/components/TechnicalAnalysisPage.tsx:1-47`
  - `src/components/TechnicalAnalysisSections.tsx:1-294`
  - `src/components/TechnicalOverlayChart.tsx:1-291`
  - `src/components/TradingPriceChart.tsx:1-454`
  - `src/components/SymbolAutocomplete.tsx:1-258`
- Frontend hooks and helpers:
  - `src/components/useStockDashboardQueries.ts:1-348`
  - `src/components/useStockCompareQueries.ts:1-171`
  - `src/components/useTechnicalAnalysisQueries.ts:1-185`
  - `src/components/useSymbolSearchQuery.ts:1-53`
  - `src/components/symbolAutocompleteHelpers.ts:1-15`
  - `src/components/stockDashboardHelpers.ts:1-1061`
  - `src/components/stockCompareHelpers.ts:1-335`
  - `src/components/technicalAnalysisHelpers.ts:1-110`
- Query/cache/API path:
  - `src/components/QueryProvider.tsx:1-113`
  - `src/lib/stockQueryOptions.ts:1-284`
  - `src/lib/stockQueryFns.ts:1-312`
  - `src/lib/stockQueryTypes.ts:1-80`
  - `src/lib/stockQueryCompleteness.ts:1-54`
  - `src/lib/stockQueryKeys.ts:1-8`
  - `src/app/api/score/route.ts:1-202`
  - `src/app/api/score/batch/route.ts:1-207`
  - `src/app/api/quote/route.ts:1-122`
  - `src/lib/stockScorePartialFastPath.ts:1-79`
  - `src/lib/stockPartsResponse.ts:1-281`
  - `src/lib/stockPendingResponse.ts:1-94`
  - `src/lib/stockSnapshotCache.ts:1-463`
  - `src/lib/stockChartCache.ts:1-280`
  - `src/lib/stockQuoteCache.ts:1-439`
  - `src/lib/stockCachePolicy.ts:1-34`
  - `src/lib/httpCacheHeaders.ts:1-30`
  - `shared/stock-cache-policy.json:1-42`
- Fast-path, provider, worker-adjacent path:
  - `src/lib/detailScoreFastPath.ts:1-799`
  - `src/lib/technicalScoreFastPath.ts:1-47`
  - `src/lib/technicalAnalysisEngine.ts:1-462`
  - `src/lib/marketDataServiceClient.ts:1-379`
  - `src/lib/pythonStockCollector.ts:1-88`
  - `src/lib/kisQuoteClient.ts:1-767`
  - `src/lib/stockRefreshQueue.ts:1-107`
  - `src/lib/stockRefreshLease.ts:1-158`
  - `src/lib/symbolSearch.ts:1-334`
  - `src/lib/symbolProfiles.ts:1-387`
  - `src/lib/marketCalendar.ts:1-320`
- Tests sampled for current assumptions:
  - `tests/stockLatencyLoadTest.test.ts:1-80`
  - `tests/queryProvider.test.ts:1-68`
  - `tests/useStockCompareQueries.test.ts:1-50`
  - `tests/stockQueryOptions.test.ts:1-220`

### Not Yet Fully Audited

- All 54 test files for coverage adequacy and obsolete assumptions
- Full CSS visual/spacing audit of `src/app/globals.css`
- Build config and deployment scripts beyond route-level behavior
- Supabase schema/RPC implementation behind `enqueue_stock_refresh_job`, `acquire_stock_refresh_lease`, and snapshot tables

The plan below is implementation-ready for the audited display/query/UI/provider surface. It is not yet a full verdict on the full test suite, CSS, deployment configuration, or Supabase-side RPC/schema behavior.

### Additional Findings From The Full Audit Pass

| File and lines | Finding | Product impact | Required action |
| --- | --- | --- | --- |
| `src/components/StockDashboard.tsx:142` | `visibleDetailSections` is always `DETAIL_SECTIONS`. | The navigation advertises sections even when the part data is absent. | Build section list from actual display parts. |
| `src/components/StockDashboard.tsx:143-144` | `compareHref` and `pageTitle` depend only on full `data`, not useful partial/display data. | Fast-path pages lose normal navigation/title behavior. | Derive these from identity regardless of score completeness. |
| `src/components/StockDashboard.tsx:276` | `PartialStockFeed` accepts a `pending` prop that is not used. | Dead state prop proves partial UI is carrying obsolete pipeline concepts. | Delete the prop with the old partial component. |
| `src/components/StockDashboard.tsx:642-719` | `StockSkeleton` is a full product screen full of readiness copy. | A valid stock can feel broken instead of showing the best available data. | Replace with a minimal identity shell or omit when identity exists. |
| `src/components/StockCompare.tsx:54`, `src/components/StockCompare.tsx:98` | Base item lookup uses `displayTickerRef(ticker)`. | Market-prefixed symbols can collide or fail identity matching. | Match on canonical ticker, keep display ticker as presentation only. |
| `src/components/StockCompare.tsx:137-145` | Pending banner appears when no compare items exist. | Valid selected tickers can be hidden behind a waiting message. | Render identity cards immediately. |
| `src/components/StockCompare.tsx:254` | Single item summary says "비교할 종목을 기다리고 있어요". | The UI blames waiting even when one selected stock can be shown. | Make add-more state an action affordance, not a loading diagnosis. |
| `src/components/StockCompare.tsx:499-505` | Compare chart has an empty fallback even though the parent renders it only when `hasCompareChart` is true. | Dead fallback indicates responsibility is split and not trustworthy. | Move chart availability logic into one display component. |
| `src/components/TradingPriceChart.tsx:82` | `lightweight-charts` is dynamically imported inside render effect. | The first chart draw waits for JS chunk loading after section activation. | Preload chart chunk for searched detail/technical routes; keep deferred only for below-fold optional charts. |
| `src/components/StockDetailSections.tsx:107-135` | Chart waits on `IntersectionObserver` before loading the chart chunk. | Above-the-fold or user-expected chart can show a placeholder even when data exists. | Eager-load primary chart once chart data exists; lazy-load secondary charts only. |
| `src/components/TechnicalAnalysisSections.tsx:176` | Partial technical page renders chart only when `chartPointCount >= 2`; otherwise no chart-area fallback exists. | User sees a partial hero with no visual recovery path. | Technical page should request/display chart part independently of technical score. |
| `src/components/TechnicalOverlayChart.tsx:68-77` | Insufficient chart data becomes a section-level "more data needed" message. | For valid stocks, this can look like service failure rather than limited history. | Omit chart or show one concise limited-history note only when relevant. |
| `src/lib/stockScorePartialFastPath.ts:13-14` | Interactive timeout defaults to 4,000 ms. | The request can already consume most of a 5-second UX budget before partial quote/chart assembly starts. | Treat 5 seconds as budget ceiling: identity/quote/chart should race in parallel from request start. |
| `src/lib/stockPartsResponse.ts:88-102` | Partial payload starts quote and chart together, but after score timeout. | Useful parts are fetched after waiting for the score path, not alongside it. | Race identity/quote/chart/score from the beginning in the display model. |
| `src/lib/stockPartsResponse.ts:176-189` | If local identity exists, quote/chart wait is capped at 120 ms; if identity is absent, it waits for quote/chart promises. | Stocks missing local symbol metadata can cross the 5-second target because score timeout plus Supabase reads stack. | Local identity lookup should never decide whether quote/chart work starts late. |
| `src/lib/stockSnapshotCache.ts:354-365` | Score cache reads Supabase before trying market-data/fast-path on miss. | Cold stocks can pay Supabase read timeout before the fastest live path. | Query cache, quote, chart, and fast display builders in parallel; choose first useful display. |
| `src/lib/stockSnapshotCache.ts:385-417` | Fast-path is gated after cache lookup and market-data attempt. | A valid cold stock can wait on slower layers before an available fast path. | Make fast-path display an early lane, not a last fallback. |
| `src/lib/stockQuoteCache.ts:303-314` | Quote path also waits for Supabase before live market-data. | Current price can be delayed by a cache miss read. | Race stale cache read with live quote when under interactive request. |
| `src/lib/stockChartCache.ts:152-163` | Chart path waits for Supabase read before declaring miss/enqueue. | Technical chart can stay absent even while another lane could provide score chart data. | Display model should use score chart, chart snapshot, and stale chart as interchangeable chart sources. |
| `src/components/QueryProvider.tsx:65-75` | Persistent browser cache excludes useful partial/fast display payloads. | Revisit and slow provider scenarios still blank or show waiting copy. | Persist displayable data, not only durable score snapshots. |
| `src/lib/httpCacheHeaders.ts:20-22` | Browser `max-age` is intentionally zero while CDN uses SWR headers. | This satisfies "do not expose browser cache", but client persistence must carry instant revisit UX. | Keep browser HTTP max-age hidden/zero; use React Query persistence for product display cache. |
| `src/lib/detailScoreFastPath.ts:49-64` | Detail fast path waits for daily chart first, then falls back to quote. | Quote could be visible earlier, but the current order can spend the daily timeout before fetching quote. | Start quote and daily chart together; render whichever display lane wins first. |
| `src/lib/detailScoreFastPath.ts:59-60`, `791-798` | Daily fast path timeout defaults to 2,800 ms. | This is reasonable alone, but it stacks after cache/service attempts in the current request path. | Count it inside a single request budget, not as one step in a serial chain. |
| `src/lib/detailScoreFastPath.ts:125`, `253`, `353` | Fast-path summaries tell users enrichment is pending. | The copy exposes internal incompleteness as the product story. | Replace with confidence/coverage copy at display boundary. |
| `src/lib/detailScoreFastPath.ts:147-150`, `280-284`, `354-358` | Process flags and messages are placed inside `financials`. | `financials` is user-rendered data; pipeline metadata leaks into financial sections. | Move these fields under internal metadata or remove from display payload. |
| `src/lib/detailScoreFastPath.ts:482-493`, `558-563` | Score components include "보강 상태: 대기". | Internal queue state is treated as an investment factor. | Delete these metric rows; show a confidence label outside factor scoring. |
| `src/lib/detailScoreFastPath.ts:752-756` | Raw signal values are internal enum strings. | Any missed translation exposes `price_momentum_positive`. | Display model should emit `signalLabel`, not `raw_signal`, for UI consumption. |
| `src/lib/technicalScoreFastPath.ts:12-13` | Technical fast path awaits `fetchKisDailyChart` with no local timeout wrapper. | If KIS is slow, the technical score request can wait on provider I/O instead of showing stale/identity/chart alternatives. | Use a budgeted race and never gate identity/price display on this call. |
| `src/lib/kisQuoteClient.ts:167-202` | US quote tries candidate markets sequentially after optional cached exchange. | Cold US symbols can spend multiple provider attempts before any useful fallback appears. | Use symbol master exchange hints and/or parallel bounded probes; never block display identity on discovery. |
| `src/lib/kisQuoteClient.ts:417-467` | Every KIS API call can wait up to 12 seconds by default. | Direct provider calls cannot be part of a guaranteed 5-second user display path. | Provider calls belong behind background refresh or short display-budget races. |
| `src/lib/kisQuoteClient.ts:474-523` | Token acquisition can read shared token, wait on lock, and issue a new token before data fetch. | Token cold start can dominate first request latency. | Prewarm/refresh tokens out of band; direct requests should fall back to stale/display cache quickly. |
| `src/lib/pythonStockCollector.ts:85-87` | Python collector timeout is 35 seconds. | Any request path that reaches this cannot satisfy the product requirement. | Make Python collector background-only for all production-like interactive routes. |
| `src/lib/marketDataServiceClient.ts:62`, `159-185` | Market data service timeout defaults to 1,500 ms. | Useful as one lane, harmful if serially followed by Supabase/KIS/Python attempts. | Run as a parallel lane in display builder; first useful result wins. |
| `src/lib/stockRefreshQueue.ts:64-90`, `105-107` | Enqueue can spend up to 2,500 ms and then returns queue metadata. | Refresh bookkeeping can delay user-visible display. | Enqueue after response or in background; never wait for queue metadata to render a valid stock. |
| `src/lib/stockRefreshLease.ts:45-82` | Lease acquisition can spend 2,500 ms and fail closed in production. | Correct for provider protection, but wrong as a gate before stale data display. | Serve stale/display payload first; lease only controls background refresh. |
| `src/lib/symbolSearch.ts:49-58`, `120-130` | Search/exact alias paths try Supabase before local fallback in common flows. | Identity display can wait on a network lookup even when local symbol master has the name. | For display identity, local symbol master should be first; Supabase can refine later. |
| `src/lib/symbolProfiles.ts:84-89` | Profile enrichment awaits profile and taxonomy before returning payload. | Optional industry metadata can delay the main display. | Do not await optional profile enrichment on the first display response. |
| `src/lib/marketCalendar.ts:91-126` | Cache expiry calculation can read Supabase calendar with a 2-second timeout. | Cache header calculation can become part of response latency. | Use in-memory/day cache or fallback immediately for interactive responses. |
| `tests/queryProvider.test.ts:40-64` | Tests assert that partial/fast-path data must not persist. | The test suite protects the wrong UX. | Rewrite tests around displayable payload persistence. |
| `tests/useStockCompareQueries.test.ts:7-49` | Tests expect identity-only partials not to become compare items. | This contradicts the product rule that selected stocks should render as cards immediately. | Replace with display item tests where identity-only is a valid card. |
| `tests/stockLatencyLoadTest.test.ts:22-30` | Load test hits legacy `/api/score` partial endpoints and classifies pending/partial as states. | The benchmark measures old pipeline survival, not user-perceived display success. | Move load test to display endpoints and assert visible parts, not pending categories. |
| `tests/stockQueryOptions.test.ts:64-111` | Polling tests preserve backend pending/enrichment state as query policy. | React Query remains tied to collector vocabulary. | Rewrite around `refresh.active` and display-part freshness. |

## Senior-Level Diagnosis

### 1. The Product State Is Currently an Internal Pipeline State

`DashboardLoadState`, `TechnicalLoadState`, and `CompareLoadState` all encode `loading`, `partial`, `pending`, `error`, and `success`. Those are not product states. They are collector states. A product state should be closer to:

- identity is available
- price is available
- chart is available
- score is available
- technical rules are available
- freshness is fresh/stale/fallback
- terminal failure exists or does not exist

The current structure makes every screen reinterpret the same API result differently. That is why a cold stock can show a header on one screen, a waiting state on another screen, and a missing chart on technical analysis.

### 2. "Completeness" Is Confused With "Usefulness"

`stockScorePayloadNeedsEnrichment()` treats quote-only, identity-only, and pending-enrichment payloads as incomplete. That is fine for deciding whether a full score snapshot is durable. It is not fine for deciding whether the user should see it or whether the browser should persist it.

For a user, `identity + price`, `identity + chart`, or `identity + price + fast score` is useful. The current cache and query layers are too eager to treat those as second-class data.

### 3. Fast Paths Exist, But the UI Still Punishes Them

`detailScoreFastPath.ts` can build useful price/chart-based payloads. `stockPartsResponse.ts` can build partial payloads with identity, quote, and chart parts. But then `stockQueryFns.ts` classifies them as `partial`, and each screen decides whether `partial` is good enough.

The fast path should produce a display payload, not a "pending snapshot that happens to contain some data."

### 4. The Search Box Still Has the Wrong Owner

The selected ticker belongs to the route. The visible company name belongs to the loaded display payload. The text currently being edited belongs only to the user.

`StockDashboard.tsx` still synchronizes `tickerInput` from route/data state. Even if the latest patch avoids one forced rewrite case, this is fragile by design. Search input must not be a mirror of query data while focused.

### 5. Empty Cards Are Product Debt

`StockDetailSections.tsx` returns cards such as "표시할 데이터가 없어요." for chart, factors, metrics, records, and news. For this product, most missing section data is not a user-actionable failure. The correct UX is:

- render the section if useful data exists
- omit the section if useful data does not exist
- surface a terminal or scope limitation only when the whole requested product cannot be shown

### 6. Compare Is Still Batch-Centered Instead of Stock-Centered

Users add up to five stocks and expect five stock cards. The current query returns a batch result, then `useStockCompareQueries.ts` reconstructs per-ticker states and promotes some partial data with local heuristics.

Compare should be a list of `StockDisplayPayload` items. Batch status should never hide item-level progress.

### 7. Technical Analysis Is Not Chart-First Enough

Technical analysis should be "show price candles first, then overlays/rules as available." Current code still has skeletons and pending feeds that can dominate the page even when price or chart data exists.

The technical page should not depend on a full technical score state to feel alive. It should render:

- identity
- latest price if present
- candles if present
- overlays if present
- rules if present
- limited-history explanation only when relevant

### 8. Cache Persistence Is Too Conservative

`QueryProvider.tsx` persists only `ready` query results and detail score only when it does not need enrichment. That preserves theoretical cleanliness while sacrificing the practical product: revisit should show the last useful display immediately.

The persistence rule should be "persist displayable payloads", not "persist only fully durable score snapshots."

### 9. The API Contract Leaks Internal Orchestration

`/api/score` and `/api/score/batch` expose `snapshot_pending`, `partial_stock_snapshot`, `pending_snapshot`, `refresh_request`, and `retry_after_seconds` into client-facing result types. Even when the UI hides the words, the frontend model is still built around them.

Those fields can exist as internal metadata, but the public UI contract should be a display read model with a background refresh flag.

### 10. The Codebase Is Too Large in the Wrong Places

File size is not automatically bad, but the largest files are carrying too many responsibilities:

- `src/components/stockDashboardHelpers.ts`: 1061 lines; formatting, identity, partial conversion, labels, records, copy, freshness.
- `src/components/StockDashboard.tsx`: 719 lines; route input, search sync, scroll chrome, data states, detail rendering, partial rendering, landing content.
- `src/components/StockCompare.tsx`: 670 lines; route state, input, query-derived state rendering, chart, matrices.
- `src/lib/detailScoreFastPath.ts`: 799 lines; provider fast path, scoring, display rows, technical payload, copy.

The problem is not just length. The problem is mixed ownership.

## Critical Code Audit Addendum

This section treats current code as guilty until proven necessary. The goal is not to preserve working lines. The goal is to remove lines that make the product slower, less reliable, harder to reason about, or more likely to expose internal state.

### P0: Product-Blocking Architecture Smells

| File and lines | Suspicion | Why it is harmful | Required action |
| --- | --- | --- | --- |
| `src/components/useStockDashboardQueries.ts:30-35` | `DashboardLoadState` is a UI-facing copy of backend orchestration. | It turns `partial` and `pending` into product states, so the dashboard keeps asking "is the score ready?" instead of "what can I show?" | Delete this union. Replace with `StockDisplayViewModel` containing available parts. |
| `src/components/useTechnicalAnalysisQueries.ts:19-24` | Technical analysis repeats the same load-state union. | A chart page becomes blocked by technical-rule readiness. | Delete this union. Technical page should render chart from display `chart` part and rules from display `technical` part. |
| `src/components/useStockCompareQueries.ts:17-22` | Compare has its own per-ticker load-state union. | Five-stock compare becomes a batch-status problem instead of five independent stock displays. | Replace with `CompareDisplayItem[]`; every item starts at identity and fills optional fields. |
| `src/lib/stockQueryFns.ts:135-147` | Score classification demotes useful fast-path payloads into `partial`. | A payload with price/chart/fast score is useful, but the name `partial` keeps pushing it into waiting UX. | Query functions should return display payloads. "Needs enrichment" should become freshness/confidence metadata. |
| `src/lib/stockQueryFns.ts:224-235` | Client query layer fabricates `snapshot_pending` for enrichment. | The frontend is inventing backend-style failure state for data that is already useful. | Remove fabricated pending payloads. Use `refresh.active = true` on the display model. |
| `src/components/QueryProvider.tsx:65-75` | Persistence keeps only `ready` and durable score data. | Revisit performance loses exactly the fallback data users need during cold starts or provider slowness. | Persist displayable payloads: identity-only short TTL, price/chart/fast-score longer TTL, terminal failures only when useful. |
| `src/lib/stockSnapshotCache.ts:227-234` | Fast-path snapshots are not remembered unless they are durable. | The system computes useful payloads then refuses to keep them. | Split score-durability cache from display-persistence cache. |
| `src/lib/stockSnapshotCache.ts:444-447` | HTTP cache is disabled for payloads needing enrichment. | "Needs enrichment" is treated as "not worth caching", which fights stale-while-revalidate UX. | Cache display payloads with conservative TTL and explicit freshness, even when enrichment is pending. |
| `src/app/api/score/route.ts:77-118` | `/api/score` mixes score collection, partial display construction, chart attachment, profile enrichment, cooldown, and response headers. | One endpoint owns too many responsibilities and cannot be reasoned about as a product read model. | Add `/api/stock/display`; leave `/api/score` as a compatibility adapter only. |
| `src/app/api/score/route.ts:119-156` | Catch path builds either partial display or pending queue response. | Error handling becomes a second product renderer. | Catch path should ask the display model for last useful payload before returning terminal failure. |
| `src/app/api/score/batch/route.ts:58-148` | Batch repeats single-score partial/pending logic per ticker. | Compare inherits duplicated branching and inconsistent headers. | Build compare from `StockDisplayPayload[]`; batch response status cannot dominate item rendering. |

### P0: Direct UX Regressions Waiting To Reappear

| File and lines | Suspicion | Why it is harmful | Required action |
| --- | --- | --- | --- |
| `src/components/StockDashboard.tsx:60-61` | Search input and edit mode live inside the dashboard that also owns query-derived display data. | Data arrival and route changes can still fight user typing. | Split `draftQuery`, `selectedTicker`, and `displayLabel`; focused input is user-owned. |
| `src/components/StockDashboard.tsx:115-130` | Effect rewrites the input from route/data state. | This is exactly the class of bug where backspace stops working or text gets replaced. | Remove data-driven input rewrites while focused. Only selection/blur/clear can change the draft. |
| `src/components/stockDashboardHelpers.ts:247-286` | `dashboardSearchSyncDecision` exists because ownership is wrong. | Helper patches symptoms while preserving a dangerous model. | Delete after search ownership rewrite. |
| `src/components/StockDashboard.tsx:208-216` | Skeleton/partial branches are driven by `state.status`. | The top-level page still centers loading state instead of available parts. | Render by part availability; no full-page pending branch for valid stocks. |
| `src/components/StockCompare.tsx:137-145` | Pending banner appears when no items exist. | If identities exist, the user should see selected stock cards, not a batch pending explanation. | Remove pending banner for valid tickers; render identity cards immediately. |
| `src/components/StockCompare.tsx:208-237` | Waiting cards say "대기 중", "준비 중". | This advertises internal slowness rather than fulfilling the compare task. | Replace waiting cards with normal stock cards containing available fields. |
| `src/components/TechnicalAnalysisSections.tsx:58-100` | Technical skeleton is a whole feed with pending hero and pending chart panel. | Technical analysis feels broken even when identity/price/chart may be available. | Delete as default screen. Use small chart-area skeleton only when chart part is truly absent. |
| `src/components/TechnicalAnalysisPage.tsx:35-44` | Page chooses skeleton/pending/error/success/partial before rendering data. | Status branch comes before value branch. | Compute display parts first, then render available sections. |
| `src/components/StockDetailSections.tsx:61-63` | Missing chart returns an empty card. | No chart is usually not user-actionable; showing "없어요" makes the service feel failed. | Return `null` unless chart absence is the primary requested technical scope. |
| `src/components/StockDetailSections.tsx:159`, `219`, `252`, `314` | Optional missing sections render empty/failure copy. | Users want the best available analysis, not a list of missing backend fields. | Omit optional sections by default. |
| `src/components/StockHeader.tsx:72-79`, `117-125` | Header exposes quote loading/pending/error notes. | The most valuable area of the page becomes a pipeline status strip. | Header should show price if present; refresh issues belong in a subtle action state or telemetry. |
| `src/components/StockHeader.tsx:181-194` | Judgment absence becomes "판단을 준비하고 있어요." | Missing generated judgment should not make the main verdict feel unfinished if score/price exist. | Use deterministic local summary fallback from score parts; judgment enhances, not gates. |

### P1: Data Contract and Cache Smells

| File and lines | Suspicion | Why it is harmful | Required action |
| --- | --- | --- | --- |
| `src/lib/stockPartsResponse.ts:75-147` | `pendingPartialStockPayload` returns useful identity/quote/chart inside a `partial_stock_snapshot`. | Useful display data is wrapped in a pending envelope, forcing every client to unwrap it. | Replace with display builder that returns parts directly and keeps pending metadata internal. |
| `src/components/stockDashboardHelpers.ts:296-328` | UI helper reconstructs `StockScoreResponse` from partial payloads. | Frontend is reverse-engineering server internals. | Move normalization to server display model or shared non-React adapter. |
| `src/components/stockDashboardHelpers.ts:319-323` | Partial display data is assigned `server_cache.state = "pending"`. | Once data is shown, the part itself is not pending; only refresh is pending. | Use part freshness plus `refresh.active`, not fake pending cache state. |
| `src/components/stockDashboardHelpers.ts:566-594` | UI helper parses `snapshot_pending` into user messages. | The UI remains coupled to internal error codes even with softer copy. | Remove from component layer. Terminal failures only. |
| `src/lib/stockQueryOptions.ts:121-135` | Polling is driven by query update count and a global pending backoff. | The product wants "refresh until display is better"; the current policy wants "poll while backend says pending." | Poll from display `refresh.active` and per-part freshness. |
| `src/lib/stockQueryOptions.ts:138-153` | Polling treats `partial` as pollable and `ready needs enrichment` as pollable. | Enrichment state leaks into query behavior and page UX. | Store enrichment as display metadata; poll only if the server explicitly says background refresh is active. |
| `src/components/useStockDashboardQueries.ts:66-77` | Judgment runs only on `ready` score. | Fast-path score could still support a useful local verdict; current logic makes partial pages feel unfinished. | Generate deterministic local verdict from display score; optional remote judgment can enhance later. |
| `src/components/useStockDashboardQueries.ts:123-126` | Score query seeds quote query via effect. | Cross-query stitching is hidden mutable behavior. | Display model composes price once; query cache sharing should be explicit and typed. |
| `src/components/useSymbolSearchQuery.ts:19-31` | Search query trims, debounces, filters visible items, and derives status in one hook. | This is acceptable only if input ownership is fixed; otherwise it still contributes to input-state confusion. | Keep as local search helper, but never let result state mutate focused input. |
| `src/components/SymbolAutocomplete.tsx:120-125` | Selecting a suggestion writes display text into the input, blurs, then navigates. | On slow navigation, input text and selected route can temporarily diverge. | Selection should emit the item; owner decides route and display label. |

### P1: Presentation Boundary Smells

| File and lines | Suspicion | Why it is harmful | Required action |
| --- | --- | --- | --- |
| `src/components/StockHeader.tsx:22-37` | Header defines query-shaped state unions. | Presentational component now knows server-state mechanics. | Header props should be plain display values: identity, price, score, actions. |
| `src/components/StockHeader.tsx:81-82`, `149-151` | Raw signal and risk enums are translated inside header flow. | Internal enum leakage can reappear anywhere another component skips translation. | Translate at display boundary; header receives already-safe labels. |
| `src/components/stockDashboardHelpers.ts:634-664` | `signalLabel` uses substring heuristics. | Heuristics hide unknown backend keys instead of enforcing a boundary. | Keep a strict enum map plus `unknown -> 확인 필요`; add no-raw-key tests. |
| `src/lib/detailScoreFastPath.ts:147-150`, `280-284` | Fast-path payload puts pending enrichment messages into `financials`. | Internal process metadata enters a user-rendered record card. | Move to display metadata; never place process status in financial records. |
| `src/lib/detailScoreFastPath.ts:482-493`, `558-563` | Score components include "보강 상태: 대기". | Internal incompleteness is shown as an investment factor. | Replace with honest confidence metadata outside the factor list. |
| `src/components/StockDetailSections.tsx:171-175` | Factor title falls back to `component.key`. | Internal keys can surface when label is absent. | Display model must require labels or drop unlabeled factors. |
| `src/components/TechnicalAnalysisSections.tsx:251-265` | Technical rules render `title`, `plain`, `evidence`, `rule` directly. | If engine emits raw or overly technical strings, UI shows them. | Normalize rule copy at technical display boundary; tests must reject raw enum-like strings. |

### P2: Complexity and Maintainability Smells

| File and lines | Suspicion | Why it is harmful | Required action |
| --- | --- | --- | --- |
| `src/components/stockDashboardHelpers.ts` whole file | 1061 lines of unrelated helpers. | Partial parsing, formatting, identity, copy, records, cache freshness, and tooltips are impossible to reason about together. | Split into `stockIdentityView`, `stockPriceView`, `stockSectionFormatters`, `stockUiCopy`, and remove partial parsing from UI. |
| `src/components/StockDashboard.tsx` whole file | 719-line page mixes route, search chrome, scroll spy, data branching, landing, detail, partial, skeleton. | Every feature edit risks input, loading, or section regressions. | Split page shell, search chrome, detail feed, landing, section index. |
| `src/components/StockCompare.tsx` whole file | 670-line compare component owns input, routing, status rendering, cards, chart, matrices. | Compare performance and correctness are hard to test independently. | Split route/input shell from pure display widgets. |
| `src/lib/detailScoreFastPath.ts` whole file | 799-line fast path builds provider calls, score math, technical payload, copy, financial placeholders. | Fast path is doing model, presentation, and provider fallback at once. | Split provider read, signal calculation, display score projection, and metadata. |
| `src/components/useStockDashboardQueries.ts:90-101` | Cooldown tick timer exists only to refresh disabled state. | Fine-grained UI timer adds moving state to data hook. | Move to button-level local state or compute on render from timestamp. |
| `src/components/StockDashboard.tsx:147-182` | Scroll spy runs only when full `data` exists. | Partial/fast display can lack section index behavior even when sections are visible. | Section index should derive from rendered sections, not full score success. |

### Delete-First Checklist

Before implementing new features, delete or quarantine these concepts from React-facing code:

- `DashboardLoadState`
- `TechnicalLoadState`
- `CompareLoadState`
- `ApiPartial`
- `ApiPending`
- `partialStockDataFromPayload`
- `snapshotPendingFromPayload`
- `pending_snapshot`
- `partial_stock_snapshot`
- page-level pending cards
- optional-section `EmptyCard`
- fast-path "보강 상태" rows
- header quote pending notes
- search input data-sync effect

Any remaining usage must be justified as server/worker internals, not user-facing product logic.

## Non-Negotiable Product Rules

1. Search input must always be editable. Data arrival must not overwrite focused user text.
2. A valid stock route must render identity immediately when local symbol metadata exists.
3. If price exists, the header shows price. Score readiness must not block price.
4. If chart exists, detail and technical pages show chart. Rule readiness must not block chart.
5. If stale score exists, show it and refresh quietly.
6. If fast-path score exists, show it as a normal useful score with appropriate confidence, not as a pending apology.
7. Missing fundamentals, news, industry benchmark, or judgment must not block the page.
8. Empty sections are omitted by default.
9. Internal enum keys must never appear in UI.
10. Internal cache implementation labels must never appear in UI.
11. Terminal failure copy appears only for invalid ticker, unsupported product entry, permission/configuration failure, or a verified no-data condition.
12. Five-stock compare renders per-stock progress. One slow ticker cannot suppress four usable cards.
13. First useful display is not completion. Missing provider-suppliable parts must trigger fetch/recovery until they are shown or proven unavailable.
14. If chart data is missing for a supported stock, the system fetches chart data immediately and keeps recovering it. The UI may show other parts first, but the pipeline may not treat missing chart as acceptable final state.
15. Visually omitting an empty optional section does not mean abandoning its data fetch. It only means the user should not see an empty/failure card while the system continues recovery.

## Target Contract

Create a single display contract. Exact field names can evolve, but the ownership must not.

```ts
export type StockDisplayPayload = {
  ok: true;
  ticker: string;
  requestedTicker: string;
  generatedAt: string;
  snapshotVersion: string;
  hotnessTier: "active" | "search_candidate" | "recent" | "popular" | "long_tail";
  identity: DisplayPart<StockIdentityView>;
  price?: DisplayPart<StockPriceView>;
  chart?: DisplayPart<StockChartView>;
  score?: DisplayPart<StockScoreView>;
  technical?: DisplayPart<StockTechnicalView>;
  fundamentals?: DisplayPart<StockFundamentalsView>;
  news?: DisplayPart<StockNewsView>;
  industryBenchmark?: DisplayPart<StockIndustryBenchmarkView>;
  judgment?: DisplayPart<StockJudgmentView>;
  completion: {
    requiredParts: StockDisplayPartName[];
    presentParts: StockDisplayPartName[];
    missingParts: StockDisplayPartName[];
    recoveringParts: StockDisplayPartName[];
    unavailableParts: Array<{
      part: StockDisplayPartName;
      reason: "unsupported" | "no_history" | "provider_confirmed_empty" | "configuration";
    }>;
  };
  capabilities: {
    canCompare: boolean;
    canTechnical: boolean;
    technicalHref?: string;
  };
  refresh: {
    active: boolean;
    staleParts: StockDisplayPartName[];
    recoveringParts: StockDisplayPartName[];
    nextPollMs?: number;
    terminal?: StockDisplayTerminalFailure;
  };
};

export type StockDisplayPartName =
  | "identity"
  | "price"
  | "chart"
  | "score"
  | "technical"
  | "fundamentals"
  | "news"
  | "industryBenchmark"
  | "judgment";

export type DisplayPart<T> = {
  value: T;
  freshness: "fresh" | "stale" | "fallback";
  source: "memory" | "supabase" | "market-data" | "symbol-master" | "fast-path" | "derived";
  version?: string;
  fetchedAt?: string;
  expiresAt?: string;
};

export type StockDisplayTerminalFailure =
  | { code: "invalid_ticker"; userMessage: string }
  | { code: "unsupported_product"; userMessage: string; redirectTo?: string }
  | { code: "not_found"; userMessage: string }
  | { code: "server_misconfigured"; userMessage: string };
```

Rules:

- `ok: true` means there is enough to render a product screen.
- Background refresh state is metadata, not a user-facing message source.
- `completion.missingParts` means the system still owes the user data and must recover those parts.
- `completion.unavailableParts` is allowed only after a provider or product rule proves the part cannot exist.
- `snapshot_pending`, queue IDs, retry seconds, and collector errors do not cross into React components except as internal test/telemetry data.
- `ok: false` exists only for terminal failures.

## Root Data Display Solution

The product must not wait for "the stock pipeline" to finish. The product must assemble the best screen from every usable source, return the first useful payload quickly, and continue enrichment after the user already sees the stock.

This is the concrete solution that turns the architecture above into data on screen.

### First Useful Display Algorithm

Implement `buildStockDisplayPayload()` as a server-side display assembler with parallel lanes. Every lane starts at request time unless the ticker is syntactically invalid.

```ts
type BuildStockDisplayInput = {
  requestedTicker: string;
  view: "detail" | "technical" | "compare";
  now: Date;
  deadlineMs?: number;
};

type DisplayLaneResult =
  | { lane: "identity"; part: DisplayPart<StockIdentityView> }
  | { lane: "persisted-display"; payload: StockDisplayPayload }
  | { lane: "score-snapshot"; part: DisplayPart<StockScoreView>; linkedParts?: Partial<StockDisplayPayload> }
  | { lane: "quote-snapshot"; part: DisplayPart<StockPriceView> }
  | { lane: "chart-snapshot"; part: DisplayPart<StockChartView> }
  | { lane: "live-quote"; part: DisplayPart<StockPriceView> }
  | { lane: "live-chart"; part: DisplayPart<StockChartView> }
  | { lane: "fast-score"; part: DisplayPart<StockScoreView>; linkedParts?: Partial<StockDisplayPayload> }
  | { lane: "terminal"; failure: StockDisplayTerminalFailure };
```

Required order of operations:

1. Normalize and validate the ticker. If syntax is invalid, return terminal `invalid_ticker`.
2. Start these lanes in parallel:
   - local symbol-master identity lookup
   - persisted display snapshot lookup
   - durable score snapshot lookup
   - quote snapshot lookup
   - chart snapshot lookup
   - live quote lookup
   - live chart lookup where supported
   - fast score builder
   - background refresh enqueue check
3. Compose a display payload whenever any useful combination is available.
4. Return the first displayable payload before the hard deadline.
5. Continue background refresh without changing the first response into a waiting state.

The first response must be chosen by user value, not backend completion order:

| Available data | Response | User-facing result |
| --- | --- | --- |
| identity only | `ok: true` | named stock page shell renders immediately |
| identity + stale display | `ok: true` | last useful stock view renders; refresh is quiet |
| identity + price | `ok: true` | header/current price renders |
| identity + chart | `ok: true` | detail/technical chart renders |
| identity + price + chart | `ok: true` | useful detail/technical page renders even without score |
| identity + stale score | `ok: true` | score renders with freshness metadata internal to UI |
| identity + fast score | `ok: true` | score renders as useful lower-confidence analysis |
| price/chart without identity | wait only until identity soft deadline, then derive identity from requested ticker if valid |
| no identity and provider says not found | `ok: false` | terminal not-found copy |
| provider timeout with any stale/displayable part | `ok: true` | stale/displayable data renders; refresh stays active |

### Complete Display Recovery Obligation

First useful display is only the first paint strategy. It is not the data strategy.

For a valid supported stock, the system must actively pursue a complete display payload after the first useful response. A missing provider-suppliable part is a recovery task, not a final UI condition.

Required part targets by view:

| View | Required target parts | Recovery behavior |
| --- | --- | --- |
| detail | identity, price, chart, score | fetch missing price/chart/score immediately; update the visible page part-by-part |
| technical | identity, price, chart, technical | fetch chart immediately; run technical analysis when enough bars exist; never let missing rules block chart |
| compare | identity, price, chart, score | each ticker recovers independently; one ticker's missing part cannot block another card |
| enrichment | fundamentals, news, judgment, industry benchmark | recover in background after core parts; omit empty sections visually until data arrives |

Required recovery rules:

1. If `chart` is missing and the stock supports historical prices, start chart fetch immediately. Do not wait for score, profile, fundamentals, queue lease, or user navigation.
2. If `price` is missing and the stock supports live or delayed quote, start quote fetch immediately.
3. If `score` is missing, start durable score lookup and fast-score computation in parallel. Show fast score first if durable score is slow, then replace it.
4. If `technical` is missing but chart exists, run technical analysis from chart data. If chart is missing, chart recovery is the prerequisite task.
5. If fundamentals, news, judgment, or industry benchmark are missing, enqueue background enrichment after core display lanes. The UI may omit those sections, but the completion state must keep them as recovering unless proven unavailable.
6. A provider timeout does not mark a part unavailable. It marks the part as recovering and schedules retry with backoff.
7. A part becomes `unavailable` only when the provider confirms no history/no data, the product does not support that view for the instrument, or required server configuration is absent.
8. Every successful recovered part must update cache and React Query so the visible page improves without refresh.

The user should experience this as a page that keeps becoming more complete, not a page that explains why it is incomplete.

### Completion Loop

Every display response must schedule or continue a completion loop for missing required parts:

```ts
type CompletionPlan = {
  ticker: string;
  view: "detail" | "technical" | "compare";
  requiredParts: StockDisplayPartName[];
  missingParts: StockDisplayPartName[];
  nextActions: Array<
    | { kind: "fetch_quote"; deadlineMs: 1800 }
    | { kind: "fetch_chart"; deadlineMs: 2200 }
    | { kind: "compute_fast_score"; deadlineMs: 2500 }
    | { kind: "load_score_snapshot"; deadlineMs: 800 }
    | { kind: "run_technical_analysis" }
    | { kind: "enqueue_enrichment" }
  >;
};
```

Completion loop requirements:

- It runs after first display without blocking first display.
- It has idempotent per-ticker/per-part jobs so repeated page loads do not create duplicate work.
- It writes recovered parts to the display snapshot cache, not only to raw score tables.
- It triggers query invalidation or polling through `refresh.recoveringParts`.
- It stops only when all required parts are present or explicitly unavailable.
- It records which part failed and why internally; it does not turn recoverable absence into user-facing failure copy.

### Hard Timing Budgets

The 5-second goal is a product ceiling, not a license for every layer to spend 5 seconds. Each lane needs its own budget so slow providers cannot block visible data.

| Work | Budget | Blocking rule |
| --- | ---: | --- |
| ticker syntax normalization | 20 ms | may block |
| local symbol-master identity | 100 ms | may block only before identity shell |
| persisted React Query/browser display hydrate | 300 ms | client-side first paint source |
| server display snapshot lookup | 300 ms | may contribute, must not block beyond budget |
| quote snapshot lookup | 400 ms | may contribute, must not block first display beyond budget |
| chart snapshot lookup | 600 ms | may contribute, must not block price/identity |
| durable score snapshot lookup | 800 ms | may contribute, must not block price/chart |
| live quote | 1200 ms soft / 1800 ms hard | must race, not serialize after score |
| live chart | 1500 ms soft / 2200 ms hard | must race, not serialize after score |
| fast score | 1800 ms soft / 2500 ms hard | must race, not wait for full enrichment |
| first completion retry for missing core part | starts within 100 ms after first display | must run for price/chart/score/technical gaps |
| background refresh enqueue/lease | 100 ms visible-path budget | must never block first display after budget |
| profile/fundamentals/news/judgment enrichment | 0 ms visible-path budget | background only |
| full first useful display for valid cold ticker | 5000 ms hard | if missed, return best stale/identity payload and record telemetry |
| core display completion for provider-available data | 5000 ms target after request start | price/chart/score/technical should appear if provider can supply them |

Forbidden first-display blockers:

- yfinance or Python collector execution
- full financial enrichment
- generated judgment
- news fetch
- industry benchmark fetch
- Supabase refresh queue lease
- KIS token refresh beyond live quote hard deadline
- market calendar lookup beyond cached value
- profile enrichment

Those jobs may improve the next payload. They must not decide whether the current payload can be shown.

Important distinction: a job may be forbidden from blocking first display and still be required for completion. For example, chart fetch must not block identity/price rendering, but chart fetch must still start immediately and keep retrying until chart data appears or is proven unavailable.

### Display Assembly Precedence

When multiple lanes return overlapping parts, choose the part with the best user value, not the newest-looking internal status.

1. Prefer fresh live price over stale snapshot price.
2. Prefer fresh chart snapshot/live chart over chart embedded in old score.
3. Prefer durable score over fast score when both arrive within the current response deadline.
4. Prefer fast score over no score.
5. Prefer stale score over no score when the ticker identity still matches.
6. Prefer local symbol-master identity over provider-derived display names.
7. Never discard a useful part because another optional part is missing.

Freshness affects subtle UI confidence and background refresh. Freshness must not demote a payload into a waiting page.

### Terminal Failure Decision Table

Most provider failures are not terminal. A terminal failure is allowed only when there is no useful display payload and the request cannot reasonably become useful by waiting or refreshing.

| Situation | Terminal? | Required behavior |
| --- | --- | --- |
| malformed ticker string | yes | return `invalid_ticker` |
| market/product unsupported by the requested view | yes | return `unsupported_product` or redirect to supported detail page |
| symbol master and provider both confirm no such symbol | yes | return `not_found` |
| required server credentials missing | yes | return `server_misconfigured` |
| KIS timeout but stale price/chart exists | no | return stale display with quiet refresh |
| KIS timeout and identity exists | no | return identity shell with quiet refresh |
| Supabase timeout but local identity exists | no | return identity shell or local cached display |
| score builder timeout but price/chart exists | no | return price/chart display |
| chart unavailable but price exists | no | render price and omit chart |
| fundamentals/news/judgment missing | no | omit optional sections |
| refresh queue enqueue fails | no | render display; record telemetry only |

### Client Display Rule

React Query and React components must treat `StockDisplayPayload.ok === true` as successful data. Client code must not reclassify the payload into `pending`, `partial`, or `loading` because optional parts are absent.

Client rendering must follow this order:

1. Render route-owned shell.
2. Hydrate persisted display payload if present.
3. Render identity as soon as available.
4. Render price, chart, score, technical, fundamentals, news, and judgment independently as their parts exist.
5. During refetch, keep the last useful display visible via `placeholderData`.
6. Replace individual parts when fresher data arrives.
7. Show terminal failure only when the display payload is `ok: false`.

No component may ask "is the backend done?" before rendering a valid part. Components may only ask "does this part exist?"

### Required Telemetry

The app needs internal measurements so regressions are caught without exposing pipeline state to users.

Record these values server-side or analytics-side, not as visible UI copy:

- `first_display_ms`
- `first_identity_ms`
- `first_price_ms`
- `first_chart_ms`
- `first_score_ms`
- `display_source`
- `stale_parts`
- `refresh_enqueued`
- `terminal_failure_code`
- `provider_timeout_lane`

Any release that increases cold valid ticker `first_display_ms` over 5000 ms or hot ticker display over 1500 ms fails product verification.

## Target File Boundaries

### Create

- `src/lib/stockDisplayTypes.ts`: public display payload and view model types.
- `src/lib/stockDisplayModel.ts`: server-side builder that composes identity, quote, chart, score, technical, fundamentals, news, and judgment into `StockDisplayPayload`.
- `src/lib/stockDisplayParts.ts`: small pure functions that normalize existing score/quote/chart payloads into display parts.
- `src/lib/stockDisplayFreshness.ts`: freshness and persistence rules for display parts.
- `src/lib/stockDisplaySnapshotStore.ts`: read/write compact product-shaped display snapshots by ticker/view/part.
- `src/lib/stockProviderBudget.ts`: distributed provider token bucket and endpoint-level budget policy.
- `src/lib/stockCompletionPlanner.ts`: missing-part to deduped completion-job planner.
- `src/lib/stockPrewarmPlanner.ts`: hotness-tier and selective prewarm policy.
- `src/lib/stockDisplayQueryFns.ts`: client query functions for display endpoints.
- `src/lib/stockDisplayQueryOptions.ts`: query keys, stale times, persistence helpers, and refetch rules for display payloads.
- `src/components/useStockDisplay.ts`: single-stock display hook used by detail and technical screens.
- `src/components/useStockCompareDisplay.ts`: compare hook returning one display item per ticker.
- `tests/stockDisplayModel.test.ts`
- `tests/stockDisplayQueryOptions.test.ts`
- `tests/stockDisplayViewModel.test.ts`
- `tests/searchInputOwnership.test.ts`
- `tests/noInternalUiCopy.test.ts`

### Rewrite

- `src/components/StockDashboard.tsx`: route/search shell plus display sections only.
- `src/components/StockCompare.tsx`: URL-driven compare shell plus display item rendering only.
- `src/components/TechnicalAnalysisPage.tsx`: chart-first technical page using the single-stock display hook.
- `src/components/StockHeader.tsx`: consume display view model; remove query-state shaped props.
- `src/components/StockDetailSections.tsx`: return `null` for absent optional sections instead of empty cards by default.
- `src/components/TechnicalAnalysisSections.tsx`: render candles/overlays/rules by part availability, not page pending state.
- `src/components/SymbolAutocomplete.tsx`: keep only local UI state; never force input from loaded stock data while focused.
- `src/components/QueryProvider.tsx`: persist displayable payloads, including stale/fast-path data.
- `src/app/api/score/route.ts`: become a compatibility adapter or delegate to the display builder.
- `src/app/api/score/batch/route.ts`: become a compatibility adapter or delegate to compare display builder.

### Delete After Migration

- `DashboardLoadState` from `src/components/useStockDashboardQueries.ts`
- `TechnicalLoadState` from `src/components/useTechnicalAnalysisQueries.ts`
- `CompareLoadState` from `src/components/useStockCompareQueries.ts`
- `ApiPartial` and `ApiPending` as React-facing types from `src/lib/stockQueryTypes.ts`
- `partialStockDataFromPayload()` from UI helpers
- `snapshotPendingFromPayload()` from UI helpers
- pending card components whose only purpose is to explain internal queue progress
- user-facing "준비 중", "대기 중", "표시할 데이터가 없어요" copy for non-terminal optional parts

## Phase 0: Product Guardrails Before Refactor

**Goal:** Freeze the intended behavior before moving code.

**Files:**

- Create: `tests/noInternalUiCopy.test.ts`
- Create: `tests/searchInputOwnership.test.ts`
- Create: `tests/stockDisplayProductContract.test.ts`

**Tasks:**

- [ ] Add a no-internal-copy test scanning React components for blocked user-visible strings:

```ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const blocked = [
  "snapshot_pending",
  "partial_stock_snapshot",
  "price_momentum_positive",
  "client_cache",
  "브라우저 캐시",
  "HH:MM 기준",
];

describe("user-facing copy", () => {
  test("does not expose internal pipeline terms", () => {
    const files = componentFiles("src/components");
    const offenders = files.flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return blocked.filter((term) => text.includes(term)).map((term) => `${file}: ${term}`);
    });
    assert.deepEqual(offenders, []);
  });
});

function componentFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return componentFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}
```

- [ ] Add a search ownership test that models focused input as user-owned:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { dashboardSearchSyncDecision } from "../src/components/stockDashboardHelpers";

test("focused search input is not replaced by arriving stock data", () => {
  const decision = dashboardSearchSyncDecision({
    tickerParam: "KR:005930",
    previousTickerParam: "KR:005930",
    isSearchEditing: true,
    data: { requested_ticker: "KR:005930", market: "KR", symbol: "005930", name: "삼성전자" },
  });
  assert.equal(decision.action, "none");
});
```

- [ ] Add product contract tests for three cases: identity-only displayable, price-only displayable, stale score displayable.
- [ ] Run: `npm test -- tests/noInternalUiCopy.test.ts tests/searchInputOwnership.test.ts tests/stockDisplayProductContract.test.ts`
- [ ] Expected: fail before implementation where blocked copy or missing display model exists.

## Phase 0A: Snapshot, Budget, and Prewarm Foundation

**Goal:** Make the balanced architecture enforceable before endpoint rewrites begin.

**Files:**

- Create: `src/lib/stockDisplaySnapshotStore.ts`
- Create: `src/lib/stockProviderBudget.ts`
- Create: `src/lib/stockCompletionPlanner.ts`
- Create: `src/lib/stockPrewarmPlanner.ts`
- Test: `tests/stockDisplaySnapshotStore.test.ts`
- Test: `tests/stockProviderBudget.test.ts`
- Test: `tests/stockCompletionPlanner.test.ts`
- Test: `tests/stockPrewarmPlanner.test.ts`

**Tasks:**

- [ ] Define the Supabase `display_snapshot` read model shape: ticker, view, snapshot version, parts, completion state, hotness tier, and freshness timestamps.
- [ ] Implement snapshot read/write helpers that can return a compact payload in one read.
- [ ] Implement provider budget policies by provider, market, endpoint kind, and app credential.
- [ ] Move KIS quote/chart calls behind the provider budget abstraction. The existing conservative 120/60 guard remains the default ceiling unless environment config lowers it.
- [ ] Implement completion planner that converts missing required parts into idempotent jobs.
- [ ] Implement hotness tiers: active, search candidate, recent, popular, long tail.
- [ ] Implement selective prewarm policy: active pages and recent/popular tickers get priority; search candidates are capped; long tail is on-demand.
- [ ] Add tests proving five compare tickers create deduped completion plans without exceeding provider budget.
- [ ] Add tests proving search prefetch caps candidates and reads snapshots before scheduling provider work.
- [ ] Add tests proving long-tail cold stock does not trigger full-universe prewarm.
- [ ] Run: `npm test -- tests/stockDisplaySnapshotStore.test.ts tests/stockProviderBudget.test.ts tests/stockCompletionPlanner.test.ts tests/stockPrewarmPlanner.test.ts`

## Phase 1: Server Display Model

**Goal:** Build the best available display payload on the server before React sees anything.

**Files:**

- Create: `src/lib/stockDisplayTypes.ts`
- Create: `src/lib/stockDisplayParts.ts`
- Create: `src/lib/stockDisplayModel.ts`
- Test: `tests/stockDisplayModel.test.ts`

**Tasks:**

- [ ] Define `StockDisplayPayload`, `DisplayPart<T>`, part view types, capabilities, and terminal failure types.
- [ ] Implement `buildStockDisplayPayload()` as a snapshot-first assembler, not as a wrapper around the old score request.
- [ ] Read `display_snapshot` before live provider lanes. Provider lanes may improve or complete the payload, but snapshots are the first-class read path.
- [ ] Implement `completion.requiredParts`, `completion.missingParts`, `completion.recoveringParts`, and `completion.unavailableParts`.
- [ ] Start identity, persisted display, score snapshot, quote snapshot, chart snapshot, live quote, live chart, fast score, and refresh enqueue lanes in parallel.
- [ ] Enforce lane-specific deadlines from the Root Data Display Solution. Slow optional lanes must return `undefined`, not block the payload.
- [ ] Generate a `CompletionPlan` for every missing required provider-suppliable part.
- [ ] Run provider lanes only when `stockProviderBudget` allows them; otherwise keep parts recovering and rely on queued completion.
- [ ] Missing chart must create a chart recovery action for supported stocks. This is mandatory even when identity/price already render.
- [ ] Missing price must create a quote recovery action for supported stocks.
- [ ] Missing score must create fast-score and durable-score recovery actions.
- [ ] Missing technical analysis must create chart recovery first, then technical analysis recovery after chart exists.
- [ ] Implement identity part from local symbol master first. If local identity exists, a display payload can render even before quote/score.
- [ ] Implement price part from quote snapshot, score payload quote fields, or fast-path score payload.
- [ ] Implement chart part from chart snapshot or score `chart_series`.
- [ ] Implement score part from durable score or fast-path score. Add `confidenceLabel` rather than showing pending-enrichment internals.
- [ ] Implement technical part from `technical_analysis` only when valid. Missing rules must not invalidate chart.
- [ ] Implement terminal failure mapping for invalid ticker, unsupported product, not found, and server misconfiguration.
- [ ] Add tests proving provider timeout plus stale data returns `ok: true`.
- [ ] Add tests proving provider timeout plus identity returns `ok: true`.
- [ ] Add tests proving refresh queue failure does not change display success into terminal failure.
- [ ] Add tests proving partial/fast/stale inputs return `ok: true`.
- [ ] Add tests proving missing chart is tracked as `recovering`, not silently omitted.
- [ ] Add tests proving unavailable chart requires explicit provider-confirmed no-history or unsupported status.
- [ ] Run: `npm test -- tests/stockDisplayModel.test.ts`

## Phase 2: Display API Endpoints

**Goal:** Stop making React call score endpoints as if they were product screens.

**Files:**

- Create: `src/app/api/stock/display/route.ts`
- Create: `src/app/api/stock/compare/route.ts`
- Modify: `src/app/api/score/route.ts`
- Modify: `src/app/api/score/batch/route.ts`
- Test: `tests/apiRouteSecurity.test.ts`
- Test: `tests/stockDisplayApi.test.ts`

**Tasks:**

- [ ] Add `GET /api/stock/display?ticker=KR:005930&view=detail|technical`.
- [ ] Add `GET /api/stock/compare?tickers=KR:005930,US:KO`.
- [ ] Ensure display endpoints call read-model/cache helpers only. They must not call yfinance from a request path.
- [ ] Ensure display endpoints do not wait on fundamentals, news, generated judgment, industry benchmark, profile enrichment, queue lease, or Python collection before returning displayable data.
- [ ] Ensure live quote/chart/fast-score lanes are raced from request start. They must not begin only after score timeout.
- [ ] Ensure missing required parts trigger completion jobs before the response finishes.
- [ ] Ensure completion jobs are idempotent by ticker, view, part, and freshness bucket.
- [ ] Ensure chart recovery uses the fastest available historical-price provider path before falling back to slower enrichment.
- [ ] Ensure endpoints return cached display snapshots when provider budget is exhausted instead of attempting over-budget calls.
- [ ] Ensure endpoint response headers support cacheable stale-while-revalidate display reads where safe.
- [ ] Return `ok: true` for any displayable identity/price/chart/score payload.
- [ ] Return `ok: false` only for terminal failures.
- [ ] Keep `/api/score` and `/api/score/batch` temporarily as compatibility adapters until the frontend migrates.
- [ ] Add endpoint tests with fake slow providers proving first response returns a useful payload before provider completion.
- [ ] Add endpoint tests proving `identity`-only first response also schedules price/chart/score recovery.
- [ ] Add endpoint tests proving `identity + price` first response schedules chart/score recovery.
- [ ] Add endpoint tests proving `identity + chart` technical response schedules technical analysis recovery.
- [ ] Add API tests for identity-only cold stock, price fast-path stock, chart-only technical stock, and mixed compare readiness.
- [ ] Run: `npm test -- tests/stockDisplayApi.test.ts tests/apiRouteSecurity.test.ts`

## Phase 3: Display Query Layer

**Goal:** Make TanStack Query cache product display data, not collector state.

**Files:**

- Create: `src/lib/stockDisplayQueryFns.ts`
- Create: `src/lib/stockDisplayQueryOptions.ts`
- Modify: `src/components/QueryProvider.tsx`
- Test: `tests/stockDisplayQueryOptions.test.ts`
- Test: `tests/queryProvider.test.ts`

**Tasks:**

- [ ] Implement `fetchStockDisplay({ ticker, view })`.
- [ ] Implement `fetchStockCompareDisplay(tickers)`.
- [ ] Query results should be successful data for displayable payloads, including stale and fast-path payloads.
- [ ] `refetchInterval` should depend on `payload.refresh.active`, not `pending` state names.
- [ ] `refetchInterval` should continue while `completion.recoveringParts` contains required core parts.
- [ ] `refetchInterval` should respect `payload.refresh.nextPollMs` so provider-budgeted polling is not accidentally converted into aggressive client polling.
- [ ] `placeholderData` should keep the last display payload visible during refetch.
- [ ] Persist any `StockDisplayPayload` with `ok: true` and at least identity plus one of price/chart/score, or identity alone if no other data exists yet.
- [ ] Do not persist terminal failures except unsupported product metadata if it prevents repeated invalid technical entry.
- [ ] Add hydration tests proving a previously useful display appears before network refetch resolves.
- [ ] Add tests proving React Query `isPending` or `isFetching` never hides an existing display payload.
- [ ] Add tests proving recovered chart/price/score parts replace the previous display without full-page remount.
- [ ] Run: `npm test -- tests/stockDisplayQueryOptions.test.ts tests/queryProvider.test.ts`

## Phase 4: Detail Page Display-First Rewrite

**Goal:** Detail page always renders the best available stock display and never centers pending state.

**Files:**

- Modify: `src/components/StockDashboard.tsx`
- Modify: `src/components/StockHeader.tsx`
- Modify: `src/components/StockDetailSections.tsx`
- Create: `src/components/useStockDisplay.ts`
- Test: `tests/stockDisplayViewModel.test.ts`
- Test: `tests/stockDashboardHelpers.test.ts`

**Tasks:**

- [ ] Replace `DashboardLoadState` with a display view model: `identity`, `price`, `score`, `chart`, `sections`, `refreshing`, `terminalFailure`.
- [ ] Render header whenever identity exists.
- [ ] Render price whenever price exists.
- [ ] Render score whenever score exists, including fast-path score.
- [ ] Render chart whenever chart has at least two points.
- [ ] Omit factors, metrics, profile, valuation, financials, and news sections when absent.
- [ ] Replace full-page skeleton with a deterministic identity shell only for the brief period before local identity resolves.
- [ ] Remove user-facing pending messages from detail.
- [ ] Keep a subtle refresh affordance, but do not tell the user the backend is preparing snapshots.
- [ ] Run: `npm test -- tests/stockDisplayViewModel.test.ts tests/stockDashboardHelpers.test.ts`

## Phase 5: Search Input Ownership Rewrite

**Goal:** Make the search box impossible to lock or overwrite while the user edits.

**Files:**

- Modify: `src/components/StockDashboard.tsx`
- Modify: `src/components/SymbolAutocomplete.tsx`
- Test: `tests/searchInputOwnership.test.ts`
- Test: `tests/symbolAutocompleteHelpers.test.ts`

**Tasks:**

- [ ] Split state into `selectedTicker`, `displayLabel`, and `draftQuery`.
- [ ] On focus or input change, `draftQuery` becomes user-owned until submit/select/blur clear action.
- [ ] Data arrival may update `displayLabel`; it must not update `draftQuery` while editing.
- [ ] Backspace on a focused input must always delete a character unless the input is already empty.
- [ ] Clear button clears `draftQuery` only. It must not mutate route unless the user submits an empty search as a navigation action.
- [ ] Run: `npm test -- tests/searchInputOwnership.test.ts tests/symbolAutocompleteHelpers.test.ts`

## Phase 6: Compare Rewrite Around Per-Stock Display Items

**Goal:** Five selected stocks produce five independently useful display cards within the same query.

**Files:**

- Modify: `src/components/StockCompare.tsx`
- Create: `src/components/useStockCompareDisplay.ts`
- Modify: `src/components/stockCompareHelpers.ts`
- Test: `tests/stockCompareHelpers.test.ts`
- Test: `tests/stockDisplayViewModel.test.ts`

**Tasks:**

- [ ] Replace `CompareLoadState` with `CompareDisplayItem`.
- [ ] A compare item renders if identity exists.
- [ ] Score, price, chart, and metrics are optional parts inside the item, not gates before the item exists.
- [ ] Batch-level refresh state cannot hide item-level cards.
- [ ] Remove "waiting cards" for valid identities. Use selected stock cards with available fields instead.
- [ ] If one ticker has a terminal failure, show that ticker's failure chip without suppressing other cards.
- [ ] Preserve base ticker order. Do not sort query keys unless the base ticker is encoded separately.
- [ ] Run: `npm test -- tests/stockCompareHelpers.test.ts tests/stockDisplayViewModel.test.ts`

## Phase 7: Technical Analysis Chart-First Rewrite

**Goal:** Technical page is a chart page first and a rule page second.

**Files:**

- Modify: `src/components/TechnicalAnalysisPage.tsx`
- Modify: `src/components/TechnicalAnalysisSections.tsx`
- Modify: `src/components/TechnicalOverlayChart.tsx`
- Test: `tests/technicalAnalysisHelpers.test.ts`
- Test: `tests/stockDisplayViewModel.test.ts`

**Tasks:**

- [ ] Render identity and price from display payload immediately.
- [ ] Render candles whenever chart part exists.
- [ ] Render overlays only when technical part has overlay data.
- [ ] Render rules only when technical signals exist.
- [ ] If chart exists but rules are absent, show the chart and omit rule cards.
- [ ] For limited-history stocks, show one concise scope sentence tied to available bars.
- [ ] Remove "기술적 분석 준비 중" as the default main screen.
- [ ] Run: `npm test -- tests/technicalAnalysisHelpers.test.ts tests/stockDisplayViewModel.test.ts`

## Phase 8: Cache and Persistence Correction

**Goal:** Persist last useful display, not only complete score snapshots.

**Files:**

- Modify: `src/components/QueryProvider.tsx`
- Modify: `src/lib/stockSnapshotCache.ts`
- Modify: `src/lib/stockQueryCompleteness.ts`
- Create or migrate: `src/lib/stockDisplaySnapshotCache.ts`
- Test: `tests/queryProvider.test.ts`
- Test: `tests/stockCacheSnapshotMode.test.ts`

**Tasks:**

- [ ] Add a display snapshot persistence policy separate from score durability.
- [ ] Save fast-path display payloads if they contain identity plus price, chart, or score.
- [ ] Save identity-only payloads with a short TTL so cold routes can still render a named shell.
- [ ] Keep durable score snapshot policy for full score correctness, but do not use it to decide UI persistence.
- [ ] On request failure, return the last useful display payload with `refresh.active = true` or `refresh.terminal` only if terminal.
- [ ] Run: `npm test -- tests/queryProvider.test.ts tests/stockCacheSnapshotMode.test.ts`

## Phase 9: Internal Copy and Enum Boundary

**Goal:** Internal enums and pipeline terms cannot reach UI components.

**Files:**

- Modify: `src/components/stockDashboardHelpers.ts`
- Modify: `src/components/technicalAnalysisHelpers.ts`
- Modify: `src/components/StockHeader.tsx`
- Modify: `src/lib/detailScoreFastPath.ts`
- Test: `tests/noInternalUiCopy.test.ts`
- Test: `tests/stockDashboardHelpers.test.ts`

**Tasks:**

- [ ] Move signal enum translation to the display model boundary.
- [ ] Remove "보강 상태: 대기" rows from fast-path payloads or mark them internal-only before display normalization.
- [ ] Remove UI fallback that concatenates labels with raw keys.
- [ ] Ensure unknown enum values become neutral product copy such as "확인 필요", never the raw key.
- [ ] Run: `npm test -- tests/noInternalUiCopy.test.ts tests/stockDashboardHelpers.test.ts`

## Phase 10: Delete Legacy Pipeline Traces

**Goal:** After display endpoints and screens are migrated, remove the old hybrid pipeline.

**Files:**

- Delete or shrink: `src/components/useStockDashboardQueries.ts`
- Delete or shrink: `src/components/useTechnicalAnalysisQueries.ts`
- Delete or shrink: `src/components/useStockCompareQueries.ts`
- Modify: `src/lib/stockQueryFns.ts`
- Modify: `src/lib/stockQueryTypes.ts`
- Modify: `src/components/stockDashboardHelpers.ts`
- Test: `tests/queryPipelineNoLegacyFetch.test.ts`

**Tasks:**

- [ ] Remove React-facing `ApiPartial` and `ApiPending`.
- [ ] Remove `partialStockDataFromPayload()` from UI helpers.
- [ ] Remove `snapshotPendingFromPayload()` from UI helpers.
- [ ] Remove page-level pending cards that exist only to explain background collection.
- [ ] Keep server-side pending queue helpers only inside API/cache/worker modules.
- [ ] Run: `npm test -- tests/queryPipelineNoLegacyFetch.test.ts tests/noInternalUiCopy.test.ts`

## Phase 11: Browser and Latency Verification

**Goal:** Prove the product behaves correctly from the user's point of view.

**Commands:**

```bash
npm test
npm run typecheck
npm run build
npm run load:test:stock-latency -- --base-url http://localhost:3000 --iterations 3 --max-p95-ms 5000
```

**Manual browser matrix:**

- Home search input: type Korean text, delete with backspace, select result, return to input, delete again.
- Detail hot KR: `/?ticker=KR:005930`.
- Detail cold KR: a valid stock absent from current snapshots.
- Detail hot US: `/?ticker=US:KO`.
- Detail cold US: a valid stock absent from current snapshots.
- Compare five mixed tickers: all five cards appear independently.
- Technical hot ticker: chart appears before or with rules.
- Technical cold ticker: identity/price/chart appear as available; no long-lived "snapshot generation" screen.
- Unsupported technical product: redirects or terminal scope message only.

**Automated browser assertions to add:**

- Hot detail route renders identity within 500 ms and first useful price/chart/score content within 1500 ms.
- Cold valid detail route renders identity or stale display within 1500 ms, and at least one of price/chart/score within 5000 ms when any provider can supply it.
- Cold valid detail route eventually renders all provider-available core parts: price, chart, and score. Missing chart is a failed test unless the provider confirms unsupported/no-history.
- Cold valid detail route never shows a full-page wait/snapshot/pending message while identity or stale display exists.
- Technical route renders chart if chart data exists, even when technical rules are absent.
- Technical route actively fetches chart when chart is absent; if chart arrives, technical analysis recovery runs after it.
- Compare route with five tickers renders five identity cards independently before waiting for all score data.
- Compare route continues recovering price/chart/score per ticker after first card render.
- Existing display remains visible during refetch and provider timeout.
- Search input remains editable while display data, autocomplete results, and route data update.
- Search prefetch does not schedule provider work for more than the capped candidate count.
- Compare five tickers does not exceed provider budget and still renders available snapshots.

**Pass conditions:**

- No user-visible `snapshot`, `pending`, `partial`, raw enum key, browser cache label, or minute-level cache chip.
- No page tells a valid user to wait when identity, price, chart, or stale score exists.
- No optional section says "표시할 데이터가 없어요" on the main feed.
- Stale display appears before background refresh completes.
- Compare does not blank all cards because one ticker is slow.
- Provider timeout, refresh queue failure, or enrichment failure cannot produce a user-visible failure when any useful display part exists.
- Missing provider-available chart, price, score, or technical analysis cannot be treated as a completed state.
- A valid supported ticker with missing chart must show an internal recovery action and must render the chart after recovery succeeds.
- A release fails if valid cold-stock `first_display_ms` exceeds 5000 ms in the load test or browser telemetry.
- A release fails if valid provider-available core parts do not complete within the 5000 ms target after request start.
- A release fails if hot-stock first useful display exceeds 1500 ms unless the test environment itself is unavailable.
- A release fails if provider calls bypass `stockProviderBudget`.
- A release fails if search/compare prefetch can create uncapped provider fan-out.
- A release fails if a provider outage causes cacheable display reads to disappear instead of serving the last useful snapshot.

## What Not To Do

- Do not add more `pending` copy to make the current model feel clearer.
- Do not create another per-screen load-state union.
- Do not treat `@tanstack/react-query` status as the product status.
- Do not discard fast-path payloads because they are not full score snapshots.
- Do not put provider calls in client components.
- Do not show a skeleton for a section when the section can be omitted.
- Do not make the user read queue state, retry state, cache source, or collector status.

## Final Architecture Check

The end state should make these searches mostly disappear from React components:

```bash
rg -n "snapshot_pending|partial_stock_snapshot|ApiPending|ApiPartial|DashboardLoadState|TechnicalLoadState|CompareLoadState" src/components
rg -n "표시할 데이터가 없어요|준비 중|대기 중|브라우저 캐시|HH:MM 기준" src/components
```

The only acceptable remaining hits are test fixtures, server/worker internals, or deliberately internal telemetry.
