# Market Console Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the app into token-driven financial web content with console-grade clarity while making the landing page a stronger Signature Dashboard.

**Architecture:** Keep the existing Next.js and component structure, but make `DESIGN.md`, `src/styles/design-tokens.css`, `src/styles/primitives.css`, and the final global CSS layer define one coherent visual system. The app remains readable web content, not a full-screen admin dashboard. Avoid broad component rewrites unless markup is currently preventing the target layout.

**Tech Stack:** Next.js App Router, React, TypeScript, CSS modules via global CSS, existing local UI primitives, Playwright/browser screenshot verification.

---

### Task 1: Design Source Of Truth

**Files:**
- Create: `DESIGN.md`
- Create: `docs/superpowers/specs/2026-06-14-market-console-design.md`
- Create: `docs/superpowers/plans/2026-06-14-market-console-rework.md`
- Modify: `src/styles/design-tokens.css`

- [ ] Add the approved Market Console and Signature Dashboard rules to `DESIGN.md`.
- [ ] Map existing CSS custom properties to the new token names without breaking current class references.
- [ ] Run `npm test -- --runInBand tests/uiCssGuardrails.test.ts` and confirm token guardrails still pass.

### Task 2: Shared Shell And Navigation Polish

**Files:**
- Modify: `src/app/globals.css`
- Modify if needed: `src/components/layout/AppShellNav.tsx`
- Modify if needed: `src/components/layout/AppGlobalSearch.tsx`
- Modify if needed: `src/components/AppNavigationMenu.tsx`

- [ ] Make the desktop GNB visually flatter: white surface, hairline bottom, no floating-card look.
- [ ] Keep navigation links left and global search right.
- [ ] Ensure global search always routes to detail and has consistent suggestion rows.
- [ ] Ensure desktop side rails sit under the GNB, remain compact, and do not create blank lower fill.

### Task 3: Detail Page Market Console Surface

**Files:**
- Modify: `src/app/globals.css`
- Modify if markup blocks the design: `src/components/StockDashboard.tsx`
- Modify if needed: `src/components/StockHeader.tsx`
- Modify if needed: `src/components/StockDetailSections.tsx`

- [ ] Flatten the hero/summary surface into a calm content header rather than a glowing dashboard card.
- [ ] Make quick metrics and score panels use one row/list language with hairlines.
- [ ] Keep repeated metric cards valid, but remove decorative card-in-card styling.
- [ ] Verify PC detail and mobile detail do not overlap search, rail, or content.

### Task 4: Compare Page Market Console Surface

**Files:**
- Modify: `src/app/globals.css`
- Modify if needed: `src/components/StockCompare.tsx`
- Modify if needed: `src/components/compare/CompareSelectedTickerList.tsx`

- [ ] Keep compare editing in the floating rail on desktop and fullscreen sheet on mobile.
- [ ] Make compare cards, chart, matrix, and component lists share one section rhythm.
- [ ] Remove rough blue glow/card layering left from earlier variants.
- [ ] Confirm mobile compare search, selected ticker editing, and floating action controls do not collide.
- [ ] Confirm compare still reads as web content with bounded width rather than an edge-to-edge dashboard.

### Task 5: Market-Cap Dashboard Table

**Files:**
- Modify: `src/app/globals.css`
- Modify if needed: `src/components/MarketCapDashboard.tsx`

- [ ] Make the market-cap page table-first and aligned with the same shell tokens.
- [ ] Keep tabs and sector filter compact at the top right/toolbar.
- [ ] Improve row hover, number alignment, sticky-like visual hierarchy, and mobile horizontal scrolling.
- [ ] Keep desktop table wide enough for scanning but still presented as a web content section.

### Task 6: Signature Dashboard Landing

**Files:**
- Modify: `src/components/StockDashboard.tsx`
- Modify: `src/app/globals.css`

- [ ] Preserve immediate search access.
- [ ] Make the first viewport feel more memorable with a dark console/product preview.
- [ ] Show actual service workflows: score, comparison, market cap, technical flow.
- [ ] Avoid generic marketing hero cards, nested cards, and decorative blobs.
- [ ] Keep the landing content-led; do not make it a full-screen dashboard shell.

### Task 7: Verification And Cleanup

**Files:**
- Modify tests only if current tests encode outdated visual assumptions.

- [ ] Run `npm test`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build`.
- [ ] Start local dev server and take PC/mobile screenshots of `/`, `/?ticker=...`, `/compare?...`, and `/market-cap`.
- [ ] Fix visible overlap, cramped text, or inconsistent surfaces found in screenshots.
- [ ] Specifically check mobile keyboard/search/sheet/floating action behavior.
- [ ] Commit the rework.
