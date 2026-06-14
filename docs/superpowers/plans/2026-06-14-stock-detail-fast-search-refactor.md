# Stock Detail Fast Search Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make stock search and detail navigation feel immediate without breaking freshness, skeleton, or industry classification behavior.

**Architecture:** Keep the search input as an optimistic client interaction and keep stock detail data as a last-confirmed, background-refreshing read model. The route shell must render immediately; detail data is filled by TanStack Query from `/api/stock/detail-view`, while missing or stale parts enqueue refresh work and render section-level skeletons instead of replacing visible content abruptly.

**Tech Stack:** Next.js App Router, React client components, TanStack Query, Node test runner with `tsx`, Supabase-backed snapshots and refresh jobs.

---

## Safety Contract

- `SymbolAutocomplete` must never submit while Korean/Japanese/Chinese IME composition is active.
- Exact deterministic aliases such as `애플 -> US:AAPL` remain canonical in `tickerRef.ts` and local symbol search.
- `src/app/page.tsx` must not wait on `buildStockDisplayPayload` before rendering `StockDashboard`; client navigation should show the shell immediately.
- Existing skeleton policy stays intact: missing detail sections may show skeletons, but already visible confirmed content must not suddenly disappear or change without a pending/loading state.
- Industry/sector data is handled as reference data by the parallel DB mapping task; this branch must not rewrite those mappings.

## File Structure

- Modify: `src/components/symbolAutocompleteHelpers.ts`
  - Own pure search/autocomplete decision helpers, including IME composition detection.
- Modify: `src/components/SymbolAutocomplete.tsx`
  - Use the IME helper before Enter submission and suppress accidental form submit triggered by a composition Enter.
- Modify: `src/app/page.tsx`
  - Render `StockDashboard` immediately and keep share metadata generation separate.
- Modify: `src/lib/stockQueryOptions.ts`
  - Poll recoverable detail partials even when `nextPollMs` is omitted, while avoiding polling static missing-only partials.
- Modify: `src/components/useStockDashboardQueries.ts`
  - Convert detail-view partials into truthful pending copy based on actual jobs/refreshing parts.
- Modify: `src/components/StockDashboard.tsx`
  - Show partial state labels that distinguish automatic updates from static partial data.
- Modify: `tests/symbolAutocompleteHelpers.test.ts`
  - Pure regression coverage for composition Enter detection.
- Modify: `tests/queryPipelineNoLegacyFetch.test.ts`
  - Source-level architecture guard that route rendering does not block on full display payload assembly.
- Modify: `tests/stockQueryOptions.test.ts`
  - Polling behavior coverage for recoverable, explicit, and static partial detail responses.
- Modify: `tests/useStockDashboardQueries.test.ts`
  - Pending copy coverage for queued recovery and static partial states.
- Create: `docs/superpowers/plans/2026-06-14-stock-detail-fast-search-refactor.md`
  - This implementation plan and handoff.

## Task 1: IME-Safe Search Submission

**Files:**
- Modify: `src/components/symbolAutocompleteHelpers.ts`
- Modify: `src/components/SymbolAutocomplete.tsx`
- Test: `tests/symbolAutocompleteHelpers.test.ts`

- [x] **Step 1: Write the failing test**

```ts
test("autocomplete ignores Enter while an IME composition is still active", () => {
  assert.equal(isAutocompleteImeCompositionEvent({ key: "Enter", nativeEvent: { isComposing: true } }), true);
  assert.equal(isAutocompleteImeCompositionEvent({ key: "Enter", nativeEvent: { keyCode: 229 } }), true);
  assert.equal(isAutocompleteImeCompositionEvent({ key: "Enter", keyCode: 229 }), true);
  assert.equal(isAutocompleteImeCompositionEvent({ key: "Enter", nativeEvent: { isComposing: false, keyCode: 13 } }), false);
});
```

- [x] **Step 2: Run the test and verify RED**

Run:

```bash
node --import tsx --test tests/symbolAutocompleteHelpers.test.ts tests/queryPipelineNoLegacyFetch.test.ts
```

Expected before implementation: FAIL because `isAutocompleteImeCompositionEvent` is not exported.

- [x] **Step 3: Implement the helper**

Add this helper to `src/components/symbolAutocompleteHelpers.ts`:

```ts
type AutocompleteKeyboardEventLike = {
  key?: string;
  keyCode?: number;
  nativeEvent?: {
    isComposing?: boolean;
    keyCode?: number;
  };
};

export function isAutocompleteImeCompositionEvent(event: AutocompleteKeyboardEventLike): boolean {
  return Boolean(event.nativeEvent?.isComposing || event.nativeEvent?.keyCode === 229 || event.keyCode === 229);
}
```

- [x] **Step 4: Use the helper in the component**

In `src/components/SymbolAutocomplete.tsx`, import `isAutocompleteImeCompositionEvent`, add a `suppressNextSubmitRef`, and ignore composing Enter before `submitCurrentInput`:

```ts
if (isAutocompleteImeCompositionEvent(event)) {
  if (event.key === "Enter") suppressNextSubmitRef.current = true;
  return;
}
```

The `submit` handler must check and clear `suppressNextSubmitRef.current` before calling `submitCurrentInput()`.

- [x] **Step 5: Run the target test and verify GREEN**

Run:

```bash
node --import tsx --test tests/symbolAutocompleteHelpers.test.ts
```

Expected after implementation: PASS.

## Task 2: Non-Blocking Detail Route Shell

**Files:**
- Modify: `src/app/page.tsx`
- Test: `tests/queryPipelineNoLegacyFetch.test.ts`

- [x] **Step 1: Write the failing architecture guard**

```ts
test("stock detail route renders the client shell without blocking on display payload assembly", () => {
  const page = appSource("page.tsx");

  assert.doesNotMatch(page, /buildStockDisplayPayload/, "route rendering must not wait on full display payload assembly");
  assert.doesNotMatch(page, /buildInitialDisplayPayload/, "route rendering must not keep a blocking initial display builder");
  assert.match(page, /return\s+<StockDashboard\s*\/>/, "route rendering should hand off immediately to the client query shell");
});
```

- [x] **Step 2: Run the test and verify RED**

Run:

```bash
node --import tsx --test tests/symbolAutocompleteHelpers.test.ts tests/queryPipelineNoLegacyFetch.test.ts
```

Expected before implementation: FAIL because `page.tsx` imports and awaits `buildStockDisplayPayload`.

- [x] **Step 3: Remove blocking initial display assembly**

Change `src/app/page.tsx` so the page component is:

```tsx
export default function Page() {
  return <StockDashboard />;
}
```

Keep `generateMetadata` and `buildShareMetadataPayload` unchanged so share cards still use stock metadata.

- [x] **Step 4: Run the target test and verify GREEN**

Run:

```bash
node --import tsx --test tests/queryPipelineNoLegacyFetch.test.ts
```

Expected after implementation: PASS.

## Task 3: Truthful Partial Recovery State

**Files:**
- Modify: `src/lib/stockQueryOptions.ts`
- Modify: `src/components/useStockDashboardQueries.ts`
- Modify: `src/components/StockDashboard.tsx`
- Test: `tests/stockQueryOptions.test.ts`
- Test: `tests/useStockDashboardQueries.test.ts`

- [x] **Step 1: Cover recoverable detail partial polling**

```ts
assert.equal(stockDetailViewRefetchIntervalMs(partialWithRefreshingPartAndJob), 1500);
assert.equal(stockDetailViewRefetchIntervalMs(partialWithOnlyMissingParts), false);
```

- [x] **Step 2: Cover truthful pending copy**

```ts
assert.deepEqual(detailViewPendingFromResult(recovering, "US:LH"), {
  message: "부족한 데이터가 들어오면 자동으로 업데이트해요.",
  ticker: "US:LH",
  queued: true,
  retryAfterSeconds: 2,
});
```

- [x] **Step 3: Implement polling and pending-state helpers**

`stockDetailViewRefetchIntervalMs` now uses a default 1500ms poll only when a partial response has jobs or parts in `refreshing`/`failed_retrying`.

`detailViewPendingFromResult` now reports `queued: true` only when there is actual recovery work, and reports static partials as currently available data.

- [x] **Step 4: Update partial UI labels**

`PartialStockSummary` now uses "자동 업데이트 중" and "업데이트 확인" only while recovery work is queued.

## Task 4: Verification, Merge, Deploy

**Files:**
- No new production file changes unless verification reveals a real regression.

- [x] **Step 1: Run focused tests**

```bash
node --import tsx --test tests/symbolAutocompleteHelpers.test.ts tests/queryPipelineNoLegacyFetch.test.ts
```

- [x] **Step 2: Run full JS test suite**

```bash
npm test
```

- [x] **Step 3: Run typecheck/build check**

```bash
npm run check
```

- [ ] **Step 4: Rebase or merge latest main before final merge**

```bash
git fetch origin
git switch main
git pull --ff-only origin main
git merge --no-ff codex/stock-detail-fast-refactor
```

If conflicts appear, resolve only files touched by this plan unless the conflicting main change is directly related.

- [ ] **Step 5: Verify after merge**

```bash
npm test
npm run check
```

- [ ] **Step 6: Deploy**

Preview deploy unless the user explicitly confirms production:

```bash
vercel deploy /Users/gimgibeom/Documents/stock -y
```

If Vercel CLI is not authenticated, use the fallback deploy script from the `vercel-deploy` skill.

## Self-Review

- Spec coverage: search Enter bug, instant shell navigation, skeleton/freshness constraints, and industry data separation are covered.
- Placeholder scan: no implementation step uses TBD/TODO/fill-in wording.
- Type consistency: helper name `isAutocompleteImeCompositionEvent` is used consistently in tests and production code.
