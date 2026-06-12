# Bounded Partial Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make cold-start stock screens feel continuous by showing confirmed price data immediately, keeping only still-recovering sections skeletal for a short bounded window, then replacing lingering skeletons with investor-facing unavailable copy.

**Architecture:** Add a small pure loading-state helper that turns `hasContent`, `isRecovering`, and elapsed time into `content`, `loading`, `unavailable`, or `hidden`. Detail and compare components consume that helper; data fetching and provider contracts stay unchanged.

**Tech Stack:** Next.js React components, TanStack Query results, Node test runner with `tsx`, TypeScript.

---

### Task 1: Loading State Helper

**Files:**
- Modify: `src/components/stockDashboardHelpers.ts`
- Test: `tests/stockDashboardHelpers.test.ts`

- [ ] **Step 1: Write failing helper tests**

Add tests that require a recovering empty section to be `loading` before the deadline, `unavailable` after the deadline, and always `content` when data exists.

- [ ] **Step 2: Run helper tests**

Run: `node --import tsx --test tests/stockDashboardHelpers.test.ts`
Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement helper**

Export `PARTIAL_SECTION_SKELETON_DEADLINE_MS`, `partialSectionDisplayState`, and a small text helper for investor-facing empty section copy.

- [ ] **Step 4: Verify helper tests**

Run: `node --import tsx --test tests/stockDashboardHelpers.test.ts`
Expected: PASS.

### Task 2: Detail Partial Feed

**Files:**
- Modify: `src/components/StockDashboard.tsx`
- Test: existing dashboard helper and UI guardrail tests

- [ ] **Step 1: Track partial view start per ticker**

Use local React state to remember when a ticker first enters a visible partial state. Reset it when the ticker changes or full data is ready.

- [ ] **Step 2: Apply bounded section states**

Use the helper for chart, factor, valuation, and financial sections. Render content if present, skeleton only before the deadline, and a compact unavailable section after the deadline.

- [ ] **Step 3: Verify targeted tests**

Run: `node --import tsx --test tests/stockDashboardHelpers.test.ts tests/uiCssGuardrails.test.ts`
Expected: PASS.

### Task 3: Compare Partial Feed

**Files:**
- Modify: `src/components/useStockCompareQueries.ts`
- Modify: `src/components/StockCompare.tsx`
- Test: `tests/useStockCompareQueries.test.ts`

- [ ] **Step 1: Write failing compare skeleton tests**

Require overview and chart skeleton helpers to stop after the bounded loading window when partial data is already visible.

- [ ] **Step 2: Implement bounded compare helpers**

Pass a boolean `loadingExpired` into compare skeleton decisions. Add an unavailable chart section when comparison chart data is still absent after the deadline.

- [ ] **Step 3: Verify compare tests**

Run: `node --import tsx --test tests/useStockCompareQueries.test.ts`
Expected: PASS.

### Task 4: Verification

**Files:**
- All modified files above

- [ ] **Step 1: Run targeted tests**

Run: `node --import tsx --test tests/stockDashboardHelpers.test.ts tests/useStockCompareQueries.test.ts tests/uiCssGuardrails.test.ts`
Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Run broader TypeScript tests if targeted checks pass**

Run: `npm test`
Expected: PASS.
