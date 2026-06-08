# Stock Hardening Phases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the reviewed hardening work in order, with a verified phase gate, reflection, improvement pass, commit, and final push.

**Architecture:** Work from the system boundary inward: ticker input contracts first, then batch/API cost controls, pending queue semantics, market-data observability, UX polling/search behavior, public-surface hardening, and finally lower-priority performance/CI cleanup. Each phase must leave the repository in a verified state before the next phase begins.

**Tech Stack:** Next.js 16, React 19, TypeScript, Node test runner, Supabase REST/RPC contracts, Python collector tests, Rust market-data service tests where relevant.

---

## Phase Gate Rules

- Start each phase by writing or extending tests for the phase behavior.
- Run the focused test and verify it fails for the intended reason before production code changes.
- Implement the smallest change that makes the focused tests pass.
- Run the focused test again, then the relevant broader verification command.
- Perform a reflection/code review pass:
  - Confirm the phase changed only the intended boundary.
  - Look for hidden coupling, over-broad behavior, and missed negative cases.
  - Apply any small improvement found during review.
  - Re-run the relevant verification after the improvement.
- Commit the phase with a focused message.

## Phase 0: Baseline And Plan

- [x] Create branch `codex/stock-hardening-phases`.
- [x] Run baseline Node tests.
- [x] Run baseline TypeScript typecheck.
- [x] Save this implementation plan.
- [x] Prepare the baseline plan commit.

Verification recorded:

```text
npm test
tests 190
pass 190
fail 0

npm run typecheck
tsc --noEmit
exit 0
```

Reflection:

- The current `main` already includes technical-analysis fast path and technical snapshot operations gates, so those are not standalone implementation phases.
- The highest-risk remaining path is still invalid ticker input flowing into search, batch, cache, queue, and provider boundaries.
- The first implementation phase should therefore narrow ticker contracts before enabling more automatic retry or polling behavior.

## Phase 1: Ticker Input Contract

Goal: Prevent unsupported raw ticker forms from being cleaned into apparently valid symbols.

Tasks:

- [x] Add tests proving strict parsing rejects slash tickers such as `US:BRK/B` and `US:XFLH/UN` while keeping `US:BRK.B` valid.
- [x] Change `validTickerSymbolForMarket()` to validate the raw normalized symbol instead of `cleanTickerSymbol(symbol)`.
- [x] Add symbol-search tests proving slash ticker master rows are not returned by local or RPC search normalization.
- [x] Keep `cleanTickerSymbol()` available for display/helper fallback paths, but stop using it as a strict API validator.
- [x] Document the current ticker policy and the intentional lack of slash ticker support until provider-specific mappings exist.
- [x] Review and fix compare direct-input normalization so slash tickers are not cleaned into aliases.

Verification:

```bash
npm test -- tests/tickerRef.test.ts tests/symbolSearch.test.ts tests/apiRouteSecurity.test.ts
npm run typecheck
```

Verification recorded:

```text
npm test -- tests/tickerRef.test.ts tests/symbolSearch.test.ts tests/apiRouteSecurity.test.ts tests/technicalAnalysisEligibility.test.ts tests/stockCompareHelpers.test.ts
tests 193
pass 193
fail 0

npm run typecheck
tsc --noEmit
exit 0
```

Reflection:

- The first implementation fixed the strict API and search boundary, but review found a second UI helper path in compare direct input that also cleaned slash ticker aliases.
- Using `parseStrictTickerRef()` in compare normalization is narrower and keeps direct entry aligned with score/quote API routes.
- `normalizeTickerRef()` and `parseTickerRef()` still intentionally support loose internal/fallback canonicalization; future phases should not use those helpers for public API validation.

## Phase 2: Batch API Cost And Validation

Goal: Make batch score requests no looser or more expensive than single score requests.

Tasks:

- [x] Add route tests proving `refresh=1` returns `batch_refresh_unsupported` before rate-limit acquisition.
- [x] Add strict batch ticker parsing that returns per-item invalid ticker errors instead of silently normalizing bad input.
- [x] Add route tests for mixed valid/invalid batch requests.
- [x] Limit internal batch fan-out concurrency to a small fixed value.
- [x] Keep response cache headers private/no-store when any batch item is invalid or pending.

Verification:

```bash
npm test -- tests/apiRouteSecurity.test.ts tests/stockCompareHelpers.test.ts
npm run typecheck
```

Verification recorded:

```text
npm test -- tests/apiRouteSecurity.test.ts tests/apiGuards.test.ts tests/concurrency.test.ts
tests 197
pass 197
fail 0

npm run typecheck
tsc --noEmit
exit 0
```

Reflection:

- Moving `refresh=1` ahead of the rate-limit guard avoids charging unsupported requests and avoids production secret failures on a known-invalid operation.
- Batch parsing now preserves invalid raw user input for per-item errors while only valid strict tickers enter score/cache work.
- A small shared `mapWithConcurrency()` helper keeps the route readable and gives the batch fan-out limit a focused unit test.
- Test review found that route tests with global `fetch` mocks can interfere with the full Node runner; the mock now delegates unknown URLs to the original fetch instead of throwing.

## Phase 3: Queue And Pending Semantics

Goal: Ensure pending payloads describe the actual refresh reason before client polling is added.

Tasks:

- [ ] Extend stock data unavailable reasons with `stale_refresh`.
- [ ] Use `stale_refresh` when serving stale score or quote snapshots while queueing background refresh work.
- [ ] Update queue payload and pending-response tests for the new reason.
- [ ] Keep `snapshot_miss` for true cache misses only.
- [ ] Review user-facing copy so stale refresh does not read like missing data.

Verification:

```bash
npm test -- tests/stockCacheSnapshotMode.test.ts tests/stockPendingResponse.test.ts tests/stockDashboardHelpers.test.ts tests/stockRefreshQueue.test.ts
npm run typecheck
```

## Phase 4: Market-Data Observability

Goal: Preserve fallback behavior while making service failure classes visible.

Tasks:

- [ ] Replace silent `undefined` market-data call failures with a typed internal result.
- [ ] Add tests for timeout, HTTP error, invalid JSON, invalid payload, and disabled feature paths.
- [ ] Skip Rust score calls for `view=technical` until Rust supports that view explicitly.
- [ ] Add structured fallback logging without exposing tokens or raw provider bodies.
- [ ] Keep public response contracts unchanged.

Verification:

```bash
npm test -- tests/marketDataServiceClient.test.ts tests/marketDataContract.test.ts tests/stockCacheSnapshotMode.test.ts
npm run typecheck
```

## Phase 5: Client UX And Request Discipline

Goal: Improve waiting/search behavior only after backend reasons and cost controls are stable.

Tasks:

- [ ] Create a shared client API response parser for browser components.
- [ ] Replace duplicated `readApiPayload()` and API message helpers in dashboard and technical pages.
- [ ] Add a pending polling hook that respects `retry_after_seconds`, caps attempts, adds jitter, and pauses while the tab is hidden.
- [ ] Apply the polling hook to detail, compare, and technical pending states.
- [ ] Store autocomplete result query alongside items and prevent stale active-item submit.
- [ ] Avoid server symbol searches for one-character free text unless an exact ticker/direct entry is being submitted.

Verification:

```bash
npm test -- tests/stockDashboardHelpers.test.ts tests/stockCompareHelpers.test.ts tests/symbolsRoute.test.ts tests/symbolSearch.test.ts
npm run typecheck
```

## Phase 6: Security And Public Surface

Goal: Reduce accidental public exposure while preserving intentional public cache behavior.

Tasks:

- [ ] Add a snapshot payload sanitizer or deep-scan guard for secret/debug-like keys.
- [ ] Apply the sanitizer before score and quote snapshot writes.
- [ ] Add production allowed-origin handling with `STOCK_ALLOWED_ORIGINS`.
- [ ] Test Host spoofing against same-origin browser write guard.
- [ ] Defer Supabase public-view migration unless the sanitizer reveals a concrete schema problem.

Verification:

```bash
npm test -- tests/apiRouteSecurity.test.ts tests/stockCacheSnapshotMode.test.ts tests/kisQuoteClient.test.ts
npm run typecheck
```

## Phase 7: Performance And CI Cleanup

Goal: Apply only low-risk cleanup with measurable or policy value.

Tasks:

- [ ] Add `cargo fmt --check` and `cargo clippy -- -D warnings` CI gates if the Rust service already passes them cleanly or can be fixed narrowly.
- [ ] Add chart/scroll performance changes only if a focused measurement or test demonstrates the issue.
- [ ] Keep large component splitting out of scope unless required by a previous phase.
- [ ] Document any deferred performance items with evidence.

Verification:

```bash
npm test
npm run typecheck
npm run test:python
npm run test:rust
```

## Final Gate

- [ ] Run full verification:

```bash
npm run check:all
```

- [ ] Inspect git history and working tree.
- [ ] Push branch `codex/stock-hardening-phases`.
