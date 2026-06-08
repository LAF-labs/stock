# Pending Retry Guardrails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent users from seeing repeated refresh-like loading when a cold stock ticker is still preparing data.

**Architecture:** Keep automatic polling, but collapse score and quote pending into one retry trigger per ticker so the page reloads at most once per retry window. Preserve manual retry and existing pending partial UI while making duplicate pending sources share one scheduler.

**Tech Stack:** Next.js client components, React hooks, Node test runner with `tsx`.

---

### Task 1: Pending Retry Deduplication

**Files:**
- Modify: `src/components/StockDashboard.tsx`
- Test: `tests/stockDashboardRetry.test.ts`

- [ ] **Step 1: Write the failing test**

Add a test proving the dashboard retry coordinator schedules one reload when both score and quote are pending for the same ticker.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/stockDashboardRetry.test.ts`

Expected: FAIL before the coordinator exists.

- [ ] **Step 3: Implement minimal retry coordinator**

Move pending retry target selection into a pure helper exported from `StockDashboard.tsx`, then call `usePendingRetry` once with the combined pending target.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- tests/stockDashboardRetry.test.ts tests/clientApi.test.ts`

Expected: PASS.

- [ ] **Step 5: Run full verification**

Run: `npm test && npm run typecheck && npm run build`

Expected: all commands exit 0.
