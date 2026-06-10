# TanStack Query Data Pipeline Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-rolled client data pipeline with a single `@tanstack/react-query` based server-state layer so stock detail, technical analysis, compare, quote refresh, judgment, and symbol search share consistent cache, retry, polling, persistence, and invalidation behavior.

**Architecture:** Keep the current server snapshot model and Vercel CDN headers. Move all browser-side API ownership into typed query functions, query key factories, query option factories, and mutation helpers. UI components should render derived query state instead of owning fetch lifecycles with `useEffect`, `AbortController`, `reloadVersion`, `latest*Ref`, manual localStorage, or custom pending retry timers.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, `@tanstack/react-query@5.101.0`, `@tanstack/react-query-persist-client@5.101.0`, `@tanstack/query-async-storage-persister@5.101.0`, `@tanstack/react-query-devtools@5.101.0`, `idb-keyval@6.2.5`.

---

## Source Map

Official docs checked on 2026-06-10:

- TanStack Query important defaults: queries are stale by default; `staleTime`, `gcTime`, retry behavior, structural sharing, and focus/reconnect refetch must be set intentionally. Source: https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults
- TanStack Query persistence: `PersistQueryClientProvider` prevents fetching while persisted cache restore is in progress; `gcTime` must be greater than or equal to `persistQueryClient.maxAge`. Source: https://tanstack.com/query/latest/docs/framework/react/plugins/persistQueryClient
- TanStack async storage persister: async storage supports throttled persistence and custom serialize/deserialize. Source: https://tanstack.com/query/latest/docs/framework/react/plugins/createAsyncStoragePersister
- TanStack advanced SSR: with Next App Router, `QueryClientProvider` lives in a client provider; Server Components can act as loader/prefetch owners with hydration boundaries. Source: https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr
- TanStack broadcast plugin: `broadcastQueryClient` is experimental and can break in patch releases, so it is not part of the default production plan. Source: https://tanstack.com/query/latest/docs/framework/react/plugins/broadcastQueryClient

Local sources checked:

- `package.json`: no TanStack/SWR/query persistence dependency exists yet.
- `src/app/layout.tsx`: no root provider exists.
- `src/app/page.tsx`, `src/app/technical/page.tsx`, `src/app/compare/page.tsx`: server pages parse search params and render client components, but do not prefetch/dehydrate query state.
- `src/components/StockDashboard.tsx`: owns score, quote, judgment, manual quote refresh, manual cache restore/save, pending retry, useful-data deadline, abort controllers, and ref-based cross-query stitching.
- `src/components/StockHeader.tsx`: presentational header, but its props are shaped by legacy score/quote/refresh/judgment state machines.
- `src/components/StockDetailSections.tsx`: presentational detail sections; `ChartStory` owns local viewport/lazy-render UI state that should stay outside server-state queries.
- `src/components/TechnicalAnalysisPage.tsx`: owns quote and technical score fetches, pending retry, useful-data deadline, and quote/score stitching.
- `src/components/TechnicalAnalysisSections.tsx`: presentational technical feed, pending feed, rules, warnings, glossary.
- `src/components/TechnicalOverlayChart.tsx`: owns local overlay visibility UI state; data comes from `chart_series` and `technical_analysis.overlays`.
- `src/components/StockCompare.tsx`: owns batch score fetch, pending retry, useful-data deadline, and retry reload version.
- `src/components/SymbolAutocomplete.tsx`: owns debounced symbol search fetch and active result state.
- `src/components/usePendingRetry.ts`: custom polling and hidden-tab pause logic that should become TanStack `refetchInterval` and query state.
- `src/components/stockDashboardClientCache.ts` and helper cache functions in `src/components/stockDashboardHelpers.ts`: manual localStorage persistence that should be replaced by TanStack persisted cache.
- `src/components/clientApi.ts`: useful low-level response parser; should be kept or moved under a query API module.
- `src/app/api/quote/route.ts`: quote contract supports force refresh, cooldown, pending queue payloads, and quote cache headers.
- `src/app/api/score/route.ts`: score contract supports `partial=1`, `view=detail|technical`, force refresh cooldown, pending queue payloads, technical eligibility, and technical chart attachment.
- `src/app/api/score/batch/route.ts`: compare contract supports up to 5 tickers, concurrency 2, `partial=1`, per-item pending/partial results, and batch cache headers.
- `src/app/api/symbols/route.ts`: symbol search contract is CDN-cacheable and rate-limited.
- `src/lib/technicalAnalysisEligibility.ts` and `src/lib/technicalAnalysisLinks.ts`: technical page eligibility and unsupported product redirects.
- `src/lib/technicalScoreFastPath.ts`, `src/lib/technicalAnalysisEngine.ts`, `src/lib/technicalAnalysisTypes.ts`: technical fast path, rule engine, and payload shape.
- `docs/superpowers/specs/2026-06-08-cache-first-latency-strategy-design.md`: source of truth for data classes, partial data rules, and stale-but-useful UI behavior.

## Current Pipeline Findings

| Area | Current trace | Required replacement |
| --- | --- | --- |
| Detail score | `StockDashboard.tsx` fetches `/api/score?...partial=1` in an effect, owns abort, pending classification, background pending, local refs, and cache writes. | `useQuery(scoreQueryOptions(ticker, "detail"))` plus selectors. |
| Detail quote | `StockDashboard.tsx` fetches `/api/quote`, owns quote state, cooldown state, local refs, and cache writes. | `useQuery(quoteQueryOptions(ticker))` plus quote refresh mutation. |
| Detail judgment | `StockDashboard.tsx` posts `/api/judgment` in an effect after score success. | `useQuery(judgmentQueryOptions(scoreData))` with stable input hash key. |
| Quote refresh | `StockDashboard.tsx` keeps `quoteRefreshControllerRef` and a separate refresh state machine. | `useMutation(refreshQuote)` and `queryClient.setQueryData` / `invalidateQueries`. |
| Technical page | `TechnicalAnalysisPage.tsx` independently fetches quote and technical score, then stitches with `quoteRef`. | Shared quote query and technical score query. |
| Compare page | `StockCompare.tsx` owns batch fetch, per-ticker state mapping, pending retry, and URL-driven refetch. | `useQuery(compareQueryOptions(tickers))` with derived per-ticker view state. |
| Symbol search | `SymbolAutocomplete.tsx` owns debounce timer, fetch, loading, stale query guard, and error state. | `useQuery(symbolSearchQueryOptions(deferredQuery))` while preserving active item guard. |
| Pending retry | `usePendingRetry.ts` manually schedules hidden-tab-aware polling. | Query `refetchInterval` based on classified pending/partial data. |
| Client persistence | `stockDashboardClientCache.ts` and helper functions write score/quote to localStorage. | IndexedDB-backed TanStack persisted cache only. |
| Legacy user labels | Helper tests still mention browser cache freshness detail for old `client_cache`. | Remove `client_cache` source and keep implementation labels out of UI. |

## Feature Contract Audit

This section is the implementation audit map. Do not preserve existing code just because it is working. Preserve product behavior, API contracts, and local UI state; delete hand-rolled server-state ownership.

### Detail Lookup

| Feature slice | Current code and risk | TanStack owner | Preserve | Delete or replace |
| --- | --- | --- | --- | --- |
| Route parsing and fallback | `src/app/page.tsx` parses `ticker` and renders a lightweight fallback. Safe, but it does not prefetch. | Route remains parser-only in Phases 1-9; Phase 10 evaluates hydration with measurement. | No default ticker when URL is empty. Fallback shows selected ticker identity. | Do not add provider calls directly in the server page. |
| Search input value | `StockDashboard.tsx` syncs `tickerInput` from `dashboardSearchInputValue(state.data, quoteState.data, ticker)`. This fixed ticker-forcing, but it is coupled to page state. | Dashboard query adapter selector. | Search box displays stock name from ready/partial data; direct ticker remains visible before identity is known. | Remove effect-driven input rewrites that race with query results. |
| Symbol selection | `SymbolAutocomplete` calls `onSelect`; dashboard pushes `/?ticker=...`. | URL remains source of selected ticker. Symbol search result data comes from `symbols` query. | Selection must use canonical `market:ticker`. | No stock API fetch in autocomplete component. |
| Score data | Score effect fetches `/api/score?partial=1`, classifies payload, writes local cache, manages pending. | `scoreQueryOptions(ticker, "detail")`. | Server `partial_stock_snapshot`, `snapshot_pending`, `snapshot_unavailable` contracts. | `state` ownership, `AbortController`, `latestScoreRef`, cache writes. |
| Quote data | Quote effect fetches `/api/quote`, classifies pending/cooldown, writes local cache. | `quoteQueryOptions(ticker)`. | Quote can update the detail header before score is ready. | `quoteState` as server-state source, `latestQuoteRef`, local cache writes. |
| Score plus quote stitching | `scoreDataWithQuote` is called from effects and refs. | Pure selector inside `useStockDashboardQueries`. | Quote should override stale score price fields when quote is fresher. | Ref-based data bus. |
| Manual quote refresh | `refreshQuote()` owns controller, cooldown state, quote state updates. | `useMutation(refreshQuoteMutationOptions())`. | Cooldown payload and user-facing disabled refresh button. | `quoteRefreshControllerRef`, long-lived local refresh state machine. |
| Judgment | Effect posts `/api/judgment` after score success. | `judgmentQueryOptions(scoreData)` with stable input hash. | Rule-based judgment cache behavior and compact request payload. | Fire-and-forget effect tied to component lifecycle. |
| Pending retry | `usePendingRetry` schedules refetch with hidden-tab checks. | `refetchInterval` on pending/partial query data. | Do not poll when queued is false and no retry hint exists. | Component-level retry timer and `reloadVersion`. |
| First useful paint | `FIRST_USEFUL_DATA_DEADLINE_MS` fabricates ticker-only partial after 4.5s. | `placeholderData` from ticker identity plus persisted query cache. | User sees identity immediately and price as soon as quote is ready. | Deadline timers that can hide stuck server pipelines. |
| Header and freshness | `StockHeader` consumes legacy state objects; helpers can expose "브라우저 캐시" and `HH:MM 기준`. | Header adapter fed by query result and mutation state. | Score freshness shows business state like "최신 스냅샷" or "새 점수 준비 중". | Browser-cache source text and minute-chip freshness labels. |
| Chart story | `ChartStory` lazy-renders `TradingPriceChart` with IntersectionObserver. This is UI state, not server state. | Keep local component state. Data source is query-selected `chart_series`. | Lazy chart render and chart mode controls. | No fetch or retry logic here. |
| Detail sections | Factors, metrics, news, profile, valuation, financials are presentational. | Props from selected score query data. | Formatting and beginner-friendly copy. | No direct query ownership inside section components. |
| Technical CTA | Detail page builds technical link from payload eligibility. | Selector continues using `technicalAnalysisHrefForPayload`. | Unsupported products should not show invalid technical CTA. | Do not make technical eligibility a client-only guess when server route already guards. |
| Compare CTA | Detail index links to `/compare?tickers=${ticker}`. | Keep URL-driven flow. | The selected detail ticker becomes compare base ticker. | Do not normalize away base order. |

### Compare

| Feature slice | Current code and risk | TanStack owner | Preserve | Delete or replace |
| --- | --- | --- | --- | --- |
| Route parsing | `src/app/compare/page.tsx` and `parseTickers` cap to 5 and preserve first ticker as base. | Route parser plus query key factory. | Order is semantic: `tickers[0]` is base. | Never sort compare key unless a separate order-preserving field is used. |
| Batch score data | `StockCompare.tsx` fetches `/api/score/batch?partial=1` and maps result index to ticker. | `compareQueryOptions(tickers)`. | Batch API result order and per-item pending/partial/error. | Manual fetch effect and per-render abort controller. |
| Per-ticker state | `states: LoadState[]` stores success, partial, pending, error. | Derived view model from classified batch query data. | Partial cards, waiting cards, errors, and loaded cards can coexist. | Stateful result array that duplicates query cache. |
| Add ticker | `addTicker` normalizes input and pushes URL. | Keep as URL mutation. Query key changes automatically. | Max 5, dedupe, aliases, direct ticker submit. | Do not manually merge new server state. |
| Remove ticker | `removeCompareTicker` keeps base ticker. | Keep helper. | Base ticker cannot be removed. | Do not reset unrelated cached compare data. |
| Selected chips | Labels come from loaded item, partial identity, or ticker. | Selector from query view model. | Use company names when available. | Do not force chips back to raw ticker after data loads. |
| Pending retry | `usePendingRetry` polls while any pending/partial state exists. | `refetchInterval` while at least one result is pending/partial and queued. | Use shortest retry hint across pending results. | `reloadVersion`, useful-data timeout, custom retry hook. |
| Existing cards during changes | Current code tries to preserve partial/success during retry. | `placeholderData` and structural sharing. | Old useful data stays visible during refetch. | Component state preservation logic. |
| Compare brief/cards | `CompareBrief`, `CompareCards` are pure derived views. | Keep presentational. | Score, opportunity, summary, strongest/weakest, market cap. | No query calls inside these components. |
| Compare chart | `CompareChart` uses `normalizedPoints(item.data.chart_series)`. | Keep presentational; data from compare query. | Normalized 1-year-ish line chart and accessible summary. | No separate chart state unless a first-class chart query is introduced. |
| Metric matrices | `CompareMatrix`, `ComponentMatrix` derive rows from loaded items. | Keep presentational. | Accessible table fallback and visual rows. | Do not hide partial progress just because one ticker is pending. |

### Technical Analysis

| Feature slice | Current code and risk | TanStack owner | Preserve | Delete or replace |
| --- | --- | --- | --- | --- |
| Route eligibility | `src/app/technical/page.tsx` calls `technicalEligibilityForTicker` and redirects unsupported products. | Keep server route guard; query layer handles API unsupported payload defensively. | ETF/ETN/derivative redirect to detail. | Do not duplicate eligibility rules in random client components. |
| Quote data | `quoteForTechnicalPage` fetches `/api/quote` and stores `quoteRef`. | Shared `quoteQueryOptions(ticker)`. | Technical hero can show price before technical overlays are ready. | `quoteRef`, quote effect, local quote state as source of truth. |
| Technical score | Effect fetches `/api/score?view=technical&partial=1`. | `technicalScoreQueryOptions(ticker)`. | API still owns fast path, chart attachment, partial payloads, unsupported payloads. | Manual score effect, abort controller, `reloadVersion`. |
| Unsupported payload | Client checks `technical_unsupported_product` and redirects safely. | Query classifier returns typed unsupported state; route redirect remains primary. | `safeInternalRedirectPath` protection. | Window redirect buried inside generic fetch chain. |
| Pending and partial | Page starts with ticker-only partial and later upgrades with quote or score partial. | Query `placeholderData` plus selected partial/ready states. | Pending feed shows identity/price/chart when available. | 4.5s deadline timer. |
| Feed selection | Component chooses skeleton, pending, error, success, partial manually. | Derived technical view model. | Same visual states and copy. | Duplicated state union in component. |
| Overlay chart | `TechnicalOverlayChart` owns overlay visibility with `useState`. | Keep local UI state. Data from technical score query. | EMA/FVG/OB/fib toggles, disabled controls when data absent. | No server-state fetches inside chart. |
| Rule cards and glossary | `TechnicalAnalysisSections` derives signals/warnings/bullets. | Keep presentational helpers. | Limited/newly listed warnings and beginner copy. | No lifecycle effects here. |
| Fast path | `technicalScoreFastPath` uses KIS daily chart and `buildTechnicalAnalysis`. | Server contract remains. Client query must not bypass it. | `STOCK_TECHNICAL_REQUEST_FAST_PATH` behavior. | Do not move technical calculation to browser. |
| Payload shape | `TechnicalAnalysisPayload` is already typed but query result is not. | Query classifier and tests validate payload type. | `type: "technical_analysis"`, coverage tiers, overlays. | Treating missing technical payload as a generic string error only. |

### Symbol Search

| Feature slice | Current code and risk | TanStack owner | Preserve | Delete or replace |
| --- | --- | --- | --- | --- |
| Debounce | `SymbolAutocomplete` owns `setTimeout(120)`. | `useDeferredValue` or a small reusable debounce hook feeding `symbolSearchQueryOptions`. | Avoid querying one-character input. | Fetch timer and abort controller in component. |
| Result ownership | Component stores `items`, `itemsQuery`, loading, searched, error. | Symbol search query state plus local active index. | Stale result guard: active item must match result query. | Independent fetch state that can diverge from cache. |
| Direct input | `directInputSymbolItem` supports aliases and raw tickers. | Keep helper outside query. | Direct submit for valid ticker-like input. | Do not block direct submit on query loading. |
| Dropdown UI | Active index, open/close, outside click, collapsed floating action. | Keep local UI state. | Keyboard navigation and accessibility. | No server fetch ownership. |

## Document Versus Code Mismatches

| Requirement from docs/specs | Code reality | Plan decision |
| --- | --- | --- |
| Quote should be the fastest lane and make the header useful quickly. | Detail and technical already fetch quote separately, but every screen owns its own lifecycle and cache. | One quote query key shared across detail, technical, and refresh mutation. |
| Missing parts should not turn the whole response into `snapshot_pending`. | Server partial payloads support this, but clients still maintain timeout fallbacks and pending state manually. | Classify partial payloads as successful query data and poll deliberately. |
| Technical chart should appear from cached OHLCV while overlays are prepared. | Technical page can render chart from partial score payload, but there is no independent client chart query. | Keep current server score/partial contract first. Add a chart query only after adding a first-class API contract and tests. |
| Compare should show prepared tickers while others are pending. | UI supports mixed states, but the state array is rebuilt manually from batch results. | Derive mixed states from `CompareQueryResult`; keep partial progress visible with `placeholderData`. |
| Browser cache and `HH:MM 기준` labels must not be exposed. | `scoreFreshnessSourceLabel`, `scoreFreshnessTimeChip`, `stockHeaderFreshnessTimeChip`, and tests still expose legacy concepts. | Remove browser-cache source from UI helpers and replace time chips with product-state copy. |
| Cold pending should auto-recover. | `usePendingRetry` can poll, but it is disconnected from query cache and can be bypassed by component state bugs. | Pending/partial data drives query `refetchInterval`; queued false without retry hint stops polling. |

## Non-Negotiable End State

- No `fetch(`/api/score`, `fetch(`/api/quote`, `fetch(`/api/score/batch`, `fetch(`/api/symbols`, or `fetch("/api/judgment"` directly inside UI components.
- No component-level `reloadVersion` used only to force refetch.
- No custom `usePendingRetry` hook on stock data routes.
- No manual dashboard localStorage cache or `client_cache` freshness source.
- No `latestScoreRef` / `latestQuoteRef` used as an implicit data bus.
- No first-useful-data `setTimeout` fallback owned by page components.
- No browser-visible "브라우저 캐시" or "HH:MM 기준" label.
- Pending, partial, stale, success, cooldown, and refresh states must be derived from query data and mutation state.
- Server request handlers, Supabase snapshot caches, queue workers, and Vercel CDN cache headers remain intact.

## Target Query Model

Create a narrow client data layer:

- `src/lib/clientApi.ts`: move or re-export current response parsing plus typed `apiJson`.
- `src/lib/stockQueryKeys.ts`: canonical keys.
- `src/lib/stockQueryTypes.ts`: discriminated client query result types.
- `src/lib/stockQueryFns.ts`: fetchers for score, quote, batch score, technical score, symbols, judgment, quote refresh.
- `src/lib/stockQueryOptions.ts`: `queryOptions` factories with `staleTime`, `gcTime`, `retry`, `refetchInterval`, `enabled`, `placeholderData`, and `select`.
- `src/components/QueryProvider.tsx`: `PersistQueryClientProvider` and development-only devtools.
- Phase 10 evaluates `src/components/HydrationBoundaryProvider.tsx` or route-level `HydrationBoundary` after the client query layer is stable.

Canonical query keys:

```ts
export const stockQueryKeys = {
  all: ["stock"] as const,
  score: (ticker: string, view: "detail" | "compare" | "technical") => ["stock", "score", view, ticker] as const,
  quote: (ticker: string) => ["stock", "quote", ticker] as const,
  compare: (tickers: readonly string[]) => ["stock", "compare", tickers.join(",")] as const,
  symbols: (query: string, market?: string) => ["stock", "symbols", market || "all", query.trim()] as const,
  judgment: (ticker: string, scoreVersion: string, inputHash: string) => ["stock", "judgment", ticker, scoreVersion, inputHash] as const,
};
```

The compare key preserves order because `tickers[0]` is the base ticker in the UI and in the detail-to-compare flow.

## Phase 0: Baseline And Guardrail Tests

**Goal:** Freeze current behavior before replacing the pipeline.

**Files:**

- Modify: `tests/stockDashboardHelpers.test.ts`
- Modify: `tests/stockCompareHelpers.test.ts`
- Modify: `tests/clientApi.test.ts`
- Create: `tests/stockQueryKeys.test.ts`
- Create: `tests/stockQueryFns.test.ts`
- Create: `tests/stockQueryOptions.test.ts`
- Create: `tests/queryPipelineNoLegacyFetch.test.ts`

**Tasks:**

- [ ] Add a grep-style guard test that fails if `StockDashboard.tsx`, `TechnicalAnalysisPage.tsx`, `StockCompare.tsx`, or `SymbolAutocomplete.tsx` contains stock API `fetch(` calls after migration.
- [ ] Add a guard test that fails if those components contain `reloadVersion`, `usePendingRetry`, `readDashboardClientCache`, `rememberDashboardClientCache`, `latestScoreRef`, `latestQuoteRef`, or `FIRST_USEFUL_DATA_DEADLINE_MS`.
- [ ] Preserve existing tests for partial payloads, pending messages, stock header identity, and hidden browser cache labels.
- [ ] Add query key tests for ticker normalization, compare key stability, and symbol search debounce eligibility.
- [ ] Add a detail regression test that KR tickers with Korean names keep the search input on the stock name after partial and ready payloads.
- [ ] Add a compare regression test proving `["KR:004020","US:KO"]` and `["US:KO","KR:004020"]` are different query keys because the base ticker changes.
- [ ] Add a technical regression test for unsupported product redirect payload handling and `safeInternalRedirectPath`.
- [ ] Add source-level guard coverage for `StockHeader.tsx`, `StockDetailSections.tsx`, `TechnicalAnalysisSections.tsx`, and `TechnicalOverlayChart.tsx` to prevent new stock API fetches in presentational components.
- [ ] Validation: `npm test -- tests/queryPipelineNoLegacyFetch.test.ts tests/stockDashboardHelpers.test.ts tests/stockCompareHelpers.test.ts tests/clientApi.test.ts`.

## Phase 1: Install TanStack Dependencies And Provider

**Goal:** Add the runtime foundation without changing data behavior.

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/components/QueryProvider.tsx`
- Modify: `src/app/layout.tsx`
- Test: `tests/queryProvider.test.ts`

**Tasks:**

- [ ] Install `@tanstack/react-query@5.101.0`, `@tanstack/react-query-persist-client@5.101.0`, `@tanstack/query-async-storage-persister@5.101.0`, `@tanstack/react-query-devtools@5.101.0`, and `idb-keyval@6.2.5`.
- [ ] Create a client `QueryProvider` using `PersistQueryClientProvider`.
- [ ] Set default query options deliberately:
  - `retry`: retry network/5xx once or twice, never retry `snapshot_pending`/partial API states.
  - `refetchOnWindowFocus`: false for quote/score by default; opt in per query only when wanted.
  - `gcTime`: at least 3 days to match persisted cache max age.
  - `staleTime`: overridden per query type.
- [ ] Use IndexedDB via `idb-keyval` and `createAsyncStoragePersister`; avoid localStorage for large stock payloads.
- [ ] Gate devtools behind `process.env.NODE_ENV !== "production"`.
- [ ] Wrap `<body>{children}</body>` with `QueryProvider` in `src/app/layout.tsx`.
- [ ] Validation: `npm run typecheck` and `npm test -- tests/queryProvider.test.ts`.

## Phase 2: Typed API Client And Result Classifier

**Goal:** Make fetch behavior reusable and testable before touching screens.

**Files:**

- Create: `src/lib/stockQueryTypes.ts`
- Create: `src/lib/stockQueryFns.ts`
- Create: `src/lib/stockQueryKeys.ts`
- Modify or move: `src/components/clientApi.ts`
- Test: `tests/stockQueryFns.test.ts`
- Test: `tests/stockQueryKeys.test.ts`

**Tasks:**

- [ ] Add `ApiPending`, `ApiPartial`, `ApiReady`, `ApiError`, `QuoteQueryResult`, `ScoreQueryResult`, `CompareQueryResult`, and `SymbolSearchQueryResult` discriminated types.
- [ ] Implement `apiJson<T>(url, init)` with AbortSignal support and the current empty/malformed response behavior.
- [ ] Implement payload classifiers:
  - `snapshot_pending` -> `state: "pending"`
  - `partial_stock_snapshot` -> `state: "partial"`
  - normal `ok: true` score/quote -> `state: "ready"`
  - non-recoverable error -> throw typed error.
- [ ] Keep pending/partial payloads as successful query data, not thrown errors, so TanStack can poll intentionally instead of retrying as failures.
- [ ] Implement query functions for:
  - `fetchStockScore({ ticker, view })`
  - `fetchStockQuote(ticker)`
  - `fetchCompareScores(tickers)`
  - `fetchSymbols({ query, market })`
  - `postJudgment(payload)`
  - `refreshQuote(ticker)` as a mutation function.
- [ ] Preserve `readClientApiPayload` behavior for empty or malformed responses, but expose it through the client data layer instead of importing it from UI modules.
- [ ] Include server cache metadata in typed ready/partial results without letting UI copy expose provider/cache implementation details.
- [ ] Model refresh cooldown as a typed mutation result, not as a thrown error.
- [ ] Model `technical_unsupported_product` separately from transient network/server errors.
- [ ] Validation: `npm test -- tests/stockQueryFns.test.ts tests/stockQueryKeys.test.ts tests/clientApi.test.ts`.

## Phase 3: Query Option Factories And Freshness Policy

**Goal:** Encode product-specific freshness in one place.

**Files:**

- Create: `src/lib/stockQueryOptions.ts`
- Test: `tests/stockQueryOptions.test.ts`

**Tasks:**

- [ ] Define `scoreQueryOptions(ticker, "detail")` with `staleTime` near score HTTP CDN freshness, `gcTime` 3 days, and `refetchInterval` only while data is pending or partial with a queued pending snapshot.
- [ ] Define `technicalScoreQueryOptions(ticker)` with faster pending polling, limited attempts via query meta, and no polling for unsupported product errors.
- [ ] Define `quoteQueryOptions(ticker)` with short `staleTime`, long `gcTime`, and placeholder support from persisted cache.
- [ ] Define `compareQueryOptions(tickers)` with batch result classification and pending polling while at least one ticker is pending.
- [ ] Define `symbolSearchQueryOptions(query, market)` with `enabled: shouldFetchSymbolSearch(query)`, small debounce in component or `useDeferredValue`, and a long enough `staleTime` to reuse CDN hits.
- [ ] Define `judgmentQueryOptions(scoreData)` enabled only for ready detail score data.
- [ ] Encode polling delays by copying the current backoff array into `stockQueryOptions.ts`; Phase 11 deletes `usePendingRetry`.
- [ ] Encode poll-stop rules in one place: no polling for terminal errors, unsupported technical products, queued false without retry hint, or disabled queries.
- [ ] Use `placeholderData` for ticker identity and previous useful data. Do not recreate the 4.5s timeout as a query option.
- [ ] Give quote, detail score, compare score, technical score, symbol search, and judgment distinct `staleTime` values matching their business freshness.
- [ ] Add query meta for route and view names so debugging output can distinguish detail score, compare score, and technical score.
- [ ] Validation: `npm test -- tests/stockQueryOptions.test.ts`.

## Phase 4: Migrate Stock Dashboard Queries

**Goal:** Remove the most tangled manual pipeline first.

**Files:**

- Modify: `src/components/StockDashboard.tsx`
- Create: `src/components/useStockDashboardQueries.ts`
- Test: `tests/stockDashboardHelpers.test.ts`
- Test: `tests/queryPipelineNoLegacyFetch.test.ts`

**Tasks:**

- [x] Replace the score `useEffect` with `useQuery(scoreQueryOptions(ticker, "detail"))`.
- [x] Replace the quote `useEffect` with `useQuery(quoteQueryOptions(ticker))`.
- [x] Replace `latestScoreRef/latestQuoteRef` stitching with a pure selector that combines query data: `scoreDataWithQuote(scoreData, quoteData)`.
- [x] Replace `scoreBackgroundPending` with query-derived pending data from score query result.
- [x] Replace `FIRST_USEFUL_DATA_DEADLINE_MS` with deterministic placeholder data from ticker identity and `placeholderData`.
- [x] Replace `reloadVersion` with `queryClient.invalidateQueries` or `refetch` from the relevant query.
- [x] Replace judgment `useEffect` with `useQuery(judgmentQueryOptions(scoreData))`.
- [x] Replace manual quote refresh with `useMutation(refreshQuote)` and on success update `stockQueryKeys.quote(ticker)`; related score/compare invalidation remains in Phase 9 to avoid extra detail-path refetches.
- [x] Preserve search input display rule: once real/partial data has a stock name, search box shows the stock name, not a forced ticker.
- [x] Create a dashboard view-model selector that returns `data`, `quote`, `pending`, `error`, `isSkeletonVisible`, `headerRefreshState`, and `judgment` without exposing raw query internals to `StockHeader`.
- [x] Keep `StockHeader` and `StockDetailSections` presentational. They can receive derived query state; they must not import query hooks.
- [x] Keep `ChartStory` lazy viewport state, chart mode, and `TradingPriceChart` dynamic import as local UI state.
- [x] Replace browser-cache and time-chip freshness props with product-state labels before wiring the header.
- [x] Verify partial quote-only data can render `PartialStockFeed` without waiting for score query success.
- [x] Validation: `npm test -- tests/stockDashboardHelpers.test.ts tests/queryPipelineNoLegacyFetch.test.ts` and Playwright/browser smoke for `/?ticker=KR:004020`.

## Phase 5: Migrate Technical Analysis Page

**Goal:** Share quote and technical score cache with the dashboard.

**Files:**

- Modify: `src/components/TechnicalAnalysisPage.tsx`
- Create or extend: `src/components/useTechnicalAnalysisQueries.ts`
- Test: `tests/technicalAnalysisHelpers.test.ts`
- Test: `tests/queryPipelineNoLegacyFetch.test.ts`

**Tasks:**

- [x] Replace `quoteForTechnicalPage` and quote `useEffect` with `useQuery(quoteQueryOptions(ticker))`.
- [x] Replace technical score `useEffect` with `useQuery(technicalScoreQueryOptions(ticker))`.
- [x] Convert unsupported product redirects into query result handling or keep the existing server route redirect as the primary path.
- [x] Remove `quoteRef`, `reloadVersion`, `usePendingRetry`, and useful-data timer.
- [x] Derive `TechnicalAnalysisFeed` vs `TechnicalAnalysisPendingFeed` from query state and classified payload.
- [x] Preserve server route eligibility in `src/app/technical/page.tsx`; do not shift ETF/ETN/product filtering entirely to the browser.
- [x] Keep `TechnicalOverlayChart` overlay visibility in local state; do not persist overlay toggles in server-state cache.
- [x] Ensure quote query data enriches technical hero price even when technical score is partial or pending.
- [x] Ensure `technical_analysis` absence in an otherwise ok score payload becomes a typed technical data error with stable copy.
- [x] Ensure limited/newly listed coverage renders warnings and disabled overlay buttons without polling forever.
- [x] Validation: `npm test -- tests/technicalAnalysisHelpers.test.ts tests/queryPipelineNoLegacyFetch.test.ts` and smoke `/technical?ticker=KR:004020`.

## Phase 6: Migrate Compare Page

**Goal:** Make batch compare a single query with per-ticker derived states.

**Files:**

- Modify: `src/components/StockCompare.tsx`
- Create or extend: `src/components/useStockCompareQueries.ts`
- Test: `tests/stockCompareHelpers.test.ts`
- Test: `tests/queryPipelineNoLegacyFetch.test.ts`

**Tasks:**

- [x] Replace batch score `useEffect` with `useQuery(compareQueryOptions(tickers))`.
- [x] Derive `states`, `items`, partial states, waiting states, and errors from the compare query result.
- [x] Remove `reloadVersion`, `usePendingRetry`, useful-data timer, and manual `AbortController`.
- [x] On add/remove ticker, rely on URL state and query key change.
- [x] Use `placeholderData` to keep existing compare cards while a changed ticker set refetches.
- [x] Preserve ticker order in query keys and view models because first ticker is the selected/base ticker.
- [x] Build a `compareViewModelFromQuery` helper that derives loaded items, partial states, waiting states, pending retry hints, and error states from one query result.
- [x] Keep partially ready tickers visible while other tickers are pending, even when the batch response status is 202.
- [x] Verify batch result index-to-ticker mapping is tested and never inferred from display ticker labels.
- [x] Ensure removing a non-base ticker does not invalidate the quote query for the base detail page.
- [x] Validation: `npm test -- tests/stockCompareHelpers.test.ts tests/queryPipelineNoLegacyFetch.test.ts` and smoke `/compare?tickers=KR:004020,US:KO`.

## Phase 7: Migrate Symbol Autocomplete

**Goal:** Remove ad hoc debounce/fetch/cache state from search.

**Files:**

- Modify: `src/components/SymbolAutocomplete.tsx`
- Create: `src/components/useSymbolSearchQuery.ts`
- Test: `tests/symbolAutocompleteHelpers.test.ts`
- Test: `tests/queryPipelineNoLegacyFetch.test.ts`

**Tasks:**

- [x] Use `useDeferredValue` or a small `useDebouncedValue` for input debounce.
- [x] Use `useQuery(symbolSearchQueryOptions(deferredQuery))`.
- [x] Preserve direct ticker submit for short/unsafe-to-fetch values.
- [x] Preserve stale result protection: active item must belong to the query that produced it.
- [x] Remove `items`, `itemsQuery`, `isLoading`, `hasSearched`, and `searchError` as independent fetch state where query state can supply them.
- [x] Keep active index, open/closed state, collapsed floating action, focus management, and outside-click close as local UI state.
- [x] Ensure cached symbol results reopen only when the input is focused and the result query exactly matches the current query.
- [x] Ensure direct input remains available while the symbol query is loading or errored.
- [x] Validation: `npm test -- tests/symbolAutocompleteHelpers.test.ts tests/queryPipelineNoLegacyFetch.test.ts`.

## Phase 8: Persisted Cache Migration And Manual Cache Removal

**Goal:** Remove the dashboard-specific localStorage cache completely.

**Files:**

- Delete: `src/components/stockDashboardClientCache.ts`
- Modify: `src/components/stockDashboardHelpers.ts`
- Modify: `tests/stockDashboardHelpers.test.ts`
- Delete or rewrite: `tests/stockDashboardClientCache.test.ts`
- Test: `tests/queryProvider.test.ts`

**Tasks:**

- [x] Remove `dashboardClientCacheKey`, `dashboardClientCacheJson`, `dashboardClientCacheFromJson`, `DASHBOARD_CLIENT_CACHE_VERSION`, and `DASHBOARD_CLIENT_CACHE_MAX_AGE_MS`.
- [x] Remove the `client_cache` server_cache source and browser cache freshness labels from helpers/tests.
- [x] Use TanStack persisted cache as the only client persistence layer.
- [x] Ensure persisted score/quote data is hydrated before queries fetch. Use `PersistQueryClientProvider`.
- [x] Set `persistOptions.maxAge` to 3 days initially; increase only if memory/storage budgets are measured.
- [x] Persist large technical payloads only when the Phase 5 measured persisted payload size stays within the recorded storage budget; otherwise exclude technical or chart-heavy queries via `shouldDehydrateQuery`/custom persister filtering.
- [x] Delete or rewrite `tests/stockDashboardClientCache.test.ts`; do not keep tests that assert localStorage implementation details.
- [x] Replace helper tests that expected `server_cache.source = "client_cache"` with tests for query-cache placeholder behavior and hidden implementation labels.
- [x] Verify persisted cache restore does not show "브라우저 캐시", local timestamp chips, or stale implementation text in `StockHeader`.
- [x] Validation: `rg -n "client_cache|dashboardClientCache|stock-dashboard:v|브라우저 캐시|localStorage" src tests` returns no legacy dashboard pipeline hits.

## Phase 9: Invalidation, Mutations, And Cross-Screen Cache Sharing

**Goal:** Make user actions update the shared query cache instead of scattered state.

**Files:**

- Modify: `src/lib/stockQueryOptions.ts`
- Modify: `src/components/StockDashboard.tsx`
- Modify: `src/components/StockCompare.tsx`
- Modify: `src/components/TechnicalAnalysisPage.tsx`
- Test: `tests/stockQueryOptions.test.ts`

**Tasks:**

- [x] Quote refresh mutation writes successful quote payload into `stockQueryKeys.quote(ticker)`.
- [x] Quote refresh pending result updates quote query data to pending without destroying last ready data.
- [x] Quote refresh cooldown is mutation state plus payload metadata, not a separate long-lived local state machine.
- [x] Score/technical/compare pending polling invalidates or refetches only the affected query key.
- [x] When dashboard gets fresh quote, compare and technical pages reuse it through the same query key.
- [x] When a score query returns ready data, seed related quote query data only through a typed helper and only when ticker identity matches.
- [x] When quote refresh returns cooldown, preserve previous quote query data and expose cooldown only through mutation/view model state.
- [x] When compare query gets partial data for a ticker, do not overwrite a ready score query for the same ticker with partial score data.
- [x] When technical query gets ready data with `chart_series`, do not invalidate detail score unless the server marks score freshness as changed.
- [x] Validation: focused tests plus manual navigation between detail, technical, compare for the same ticker without duplicate quote calls when cache is fresh.

## Phase 10: SSR Prefetch And Hydration Decision

**Goal:** Use App Router server pages as loaders where it materially improves first paint.

**Files:**

- Modify: `src/app/page.tsx`
- Modify: `src/app/technical/page.tsx`
- Modify: `src/app/compare/page.tsx`
- Create: `src/components/HydrationBoundaryProvider.tsx` only when the Phase 10 measurement proves SSR prefetch improves first useful paint.
- Test: `npm run build`, route smoke tests, and any available App Router render tests.

**Tasks:**

- [ ] Start with client-only persisted query migration; do not mix SSR until the client pipeline is stable.
- [ ] Prefetch identity-light queries only if it improves first paint without duplicating server request work.
- [ ] Use `dehydrate` and `HydrationBoundary` for score/quote only when server route fetches can reuse CDN/read-model cheaply.
- [ ] Keep expensive provider work out of route render. Server prefetch must call only app API endpoints or read-model helpers, never Python/yfinance.
- [ ] Keep route fallbacks simple and deterministic; they should not own polling, timers, or provider work.
- [ ] Measure whether hydration reduces first useful paint after persisted client query cache is already enabled.
- [ ] Validation: build, route smoke, and latency load test before and after hydration.

## Phase 11: Remove Legacy Pipeline Traces

**Goal:** Make the cleanup explicit so no inefficient hybrid remains.

**Files:**

- Delete: `src/components/usePendingRetry.ts`
- Delete: `src/components/stockDashboardClientCache.ts`
- Modify: `src/components/StockDashboard.tsx`
- Modify: `src/components/TechnicalAnalysisPage.tsx`
- Modify: `src/components/StockCompare.tsx`
- Modify: `src/components/SymbolAutocomplete.tsx`
- Modify tests that imported deleted helpers.

**Removal checklist:**

- [ ] `rg -n "usePendingRetry|pendingRetryDelayMs|technicalPendingRetryDelayMs" src tests` has no production hits.
- [ ] `rg -n "reloadVersion|setReloadVersion" src/components` returns no hits.
- [ ] `rg -n "fetch\\(`/api/(score|quote|symbols)|fetch\\(\"/api/judgment\"" src/components` returns no hits.
- [ ] `rg -n "readDashboardClientCache|rememberDashboardClientCache|dashboardClientCache|client_cache|stock-dashboard:v" src tests` returns no hits.
- [ ] `rg -n "latestScoreRef|latestQuoteRef|quoteRef" src/components` returns no data-pipeline hits.
- [ ] `rg -n "FIRST_USEFUL_DATA_DEADLINE_MS" src/components` returns no hits.
- [ ] `rg -n "브라우저 캐시|HH:MM 기준" src tests` returns no user-facing hits.
- [ ] `rg -n "cache: \"no-store\"|cache: 'no-store'|cache: \"force-cache\"|cache: 'force-cache'" src/components` returns no client component stock-data fetch hits.
- [ ] `rg -n "new AbortController\\(|\\.abort\\(\\)" src/components/StockDashboard.tsx src/components/StockCompare.tsx src/components/TechnicalAnalysisPage.tsx src/components/SymbolAutocomplete.tsx` returns no stock-data lifecycle hits.
- [ ] `rg -n "setTimeout\\(" src/components/StockDashboard.tsx src/components/StockCompare.tsx src/components/TechnicalAnalysisPage.tsx src/components/SymbolAutocomplete.tsx` returns no fetch debounce/retry/deadline hits, except a documented focus-management timer in `SymbolAutocomplete`.
- [ ] `rg -n "useQuery|useMutation|queryOptions" src/components/StockHeader.tsx src/components/StockDetailSections.tsx src/components/TechnicalAnalysisSections.tsx src/components/TechnicalOverlayChart.tsx` returns no hits.

## Phase 12: Verification, Performance, And Release

**Goal:** Prove the new pipeline is faster, stable, and simpler.

**Commands:**

```bash
npm test
npm run typecheck
npm run build
npm run load:test:stock-latency -- --base-url https://stock-khaki.vercel.app --iterations 3 --warmup-iterations 1 --max-p95-ms 5000 --json
npm run ops:report
```

**Acceptance criteria:**

- [ ] All unit tests pass.
- [ ] Build succeeds.
- [ ] Legacy pipeline guard tests pass.
- [ ] Detail page, technical page, compare page, and symbol search render with TanStack Query state.
- [ ] Re-visiting a ticker uses persisted query cache immediately, then background refreshes according to stale policy.
- [ ] Manual quote refresh updates the shared quote query and does not force unrelated queries to reset.
- [ ] Pending cold-start UI never gets stuck without scheduled refetch while queue work is available.
- [ ] Browser labels do not expose cache implementation details.
- [ ] `npm run ops:report` freshness risks are recorded separately from client pipeline migration risks.

## Feature Verification Matrix

| Route or feature | Test data | Must prove |
| --- | --- | --- |
| Detail hot KR stock | `/?ticker=KR:004020` | Search input becomes company name when identity is known; quote appears before or alongside score; no browser cache or `HH:MM 기준` label. |
| Detail hot US stock | `/?ticker=US:KO` | Persisted query cache paints immediately on revisit; background refresh does not reset header, chart, or judgment. |
| Detail cold stock | Any valid ticker absent from snapshots | Query shows identity/quote partial first, polls while queued, and upgrades without manual reload. |
| Detail quote refresh | Header refresh button | Successful refresh updates shared quote query; cooldown preserves previous price and disables only refresh action. |
| Detail judgment | Ready score payload | Judgment query runs once per stable input hash and does not refire on unrelated quote updates. |
| Detail chart | `ChartStory` viewport | Chart lazy render still works after query migration and never fetches data itself. |
| Compare two hot stocks | `/compare?tickers=KR:004020,US:KO` | Base ticker is KR:004020; reversing order changes base and query key; cards, chart, matrix render from one compare query. |
| Compare mixed readiness | One ready ticker and one pending ticker | Ready card remains visible; pending card polls; batch 202 does not hide successful items. |
| Compare add/remove | Add up to 5, remove non-base | URL drives query key; base cannot be removed; previous useful data remains while refetching. |
| Technical hot stock | `/technical?ticker=KR:004020` | Shared quote query fills hero; technical query fills overlays/rules; no `quoteRef` or timer required. |
| Technical cold stock | Valid stock without technical snapshot | Price or identity appears first; pending query polls; overlay controls stay disabled until data exists. |
| Technical unsupported product | ETF/ETN/derivative ticker | Server route redirects to detail; client classifier handles unsupported API payload safely. |
| Technical limited history | Newly listed or short-history ticker | Limited warnings render; chart can show candles; query does not treat limited status as retryable failure. |
| Symbol search | Korean alias, US symbol, direct ticker | Query cache reuses results; stale result guard holds; direct submit works during loading/error. |

## Red Flags During Implementation

- A component imports `fetch`, `AbortController`, `usePendingRetry`, or dashboard client-cache helpers for server data.
- A presentational component imports `useQuery`, `useMutation`, query keys, or query option factories.
- A partial payload is thrown as an error instead of becoming successful query data.
- A retry timer is implemented with `setTimeout` in a page component.
- A compare query key sorts tickers and loses base-ticker semantics.
- A quote refresh clears ready quote data while waiting for the refresh response.
- A technical limited-history payload is treated as an error.
- A browser-visible string mentions cache implementation, local storage, `client_cache`, "브라우저 캐시", or minute-level freshness chips.

## Risks And Decisions

- `broadcastQueryClient` is experimental; do not ship it by default. If multi-tab sync becomes essential, pin exact patch versions and isolate behind a feature flag.
- Persisting large technical payloads can exceed practical IndexedDB/storage budgets. Measure persisted size after Phase 5; exclude technical/chart-heavy queries when persisted data exceeds the Phase 8 storage budget.
- TanStack Query will not fix stale server snapshots or queue backlog. Worker freshness remains a separate operations requirement.
- `cache: "no-store"` in server-side Supabase/provider fetches is not a client pipeline smell; keep it where it prevents stale server reads.
- SSR hydration can improve first paint, but adding it too early can create duplicate fetches. Complete the client query layer first.

## Suggested Commit Sequence

1. `test: add query pipeline guardrails`
2. `feat: add tanstack query provider`
3. `feat: add stock query keys and fetchers`
4. `feat: migrate stock dashboard queries`
5. `feat: migrate technical and compare queries`
6. `feat: migrate symbol search query`
7. `refactor: remove legacy client cache and pending retry`
8. `test: verify query pipeline cleanup`
