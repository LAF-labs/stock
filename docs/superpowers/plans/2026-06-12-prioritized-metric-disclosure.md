# Prioritized Metric Disclosure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose high-value hidden metrics without flooding the stock detail and compare UI.

**Architecture:** Keep metric selection in small helpers and render those helpers through existing card/matrix components. Show confidence near score cards, technical price context in a compact detail section, and opportunity component breakdown in the compare page.

**Tech Stack:** Next.js/React TypeScript, Node test runner.

---

### Task 1: Detail Helper Selection

**Files:**
- Modify: `src/components/stockDashboardHelpers.ts`
- Test: `tests/stockDashboardHelpers.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests for `scoreConfidenceChips` and `priceVolatilitySummaryItems` so only useful, finite values are selected.

- [ ] **Step 2: Implement helpers**

Return short label/value rows for score confidence and price/volatility context.

### Task 2: Detail UI

**Files:**
- Modify: `src/components/StockHeader.tsx`
- Modify: `src/components/StockDashboard.tsx`

- [ ] **Step 1: Render confidence chips**

Use `scoreConfidenceChips(data)` below the quality/opportunity score visuals.

- [ ] **Step 2: Render price/volatility summary**

Use `priceVolatilitySummaryItems(displayData)` in a compact `SimpleList` under the chart.

### Task 3: Compare Opportunity Breakdown

**Files:**
- Modify: `src/components/stockCompareHelpers.ts`
- Modify: `src/components/StockCompare.tsx`
- Test: `tests/stockCompareHelpers.test.ts`

- [ ] **Step 1: Write failing test**

Add a test for reading `opportunity_components` scores by key.

- [ ] **Step 2: Implement compare matrix**

Render a second component matrix for `opportunity_momentum`, `opportunity_growth`, `opportunity_analyst`, `opportunity_liquidity`, and `opportunity_risk`.
