# SEC Filings Summaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show recent SEC filings above news on stock detail pages, with rule-based Korean summaries and original SEC links.

**Architecture:** Keep SEC polling/backfill as a server/script concern, store only filing metadata plus short rule summaries in Supabase, and load the list through one API endpoint. The React detail page renders the first 3 rows and opens a paginated modal for the rest.

**Tech Stack:** Next.js, Supabase REST, Node scripts, TypeScript node:test.

---

### Task 1: Rule summarizer

**Files:**
- Create: `src/lib/secFilingSummary.ts`
- Test: `tests/secFilingSummary.test.ts`

- [ ] Add tests for Form 4 sale, 8-K item mapping, 10-Q revenue/net income, offering forms, and safe fallback.
- [ ] Implement the smallest rule engine that converts normalized filing facts to 1-3 Korean lines.

### Task 2: Storage/API/backfill

**Files:**
- Create: `supabase/migrations/20260615023000_sec_filings.sql`
- Create: `src/lib/secFilings.ts`
- Create: `src/app/api/stock/filings/route.ts`
- Create: `scripts/backfill_sec_filings.ts`
- Test: `tests/secFilings.test.ts`

- [ ] Store unique rows by accession number.
- [ ] Return filings by ticker with limit/offset.
- [ ] Fetch SEC current/submissions documents and upsert recent rows.

### Task 3: UI

**Files:**
- Create: `src/components/useStockFilings.ts`
- Create: `src/components/stock-detail/DisclosureFeed.tsx`
- Modify: `src/components/StockDashboard.tsx`
- Modify: `src/components/stock-detail/DetailSectionIndex.tsx`
- Modify: `src/app/globals.css`

- [ ] Add 공시 section above 뉴스.
- [ ] Show recent 3 filings, red dot for last 7 days.
- [ ] Add 10-row paginated modal, 80% mobile modal width/height.

### Task 4: Verify/deploy

- [ ] Run focused tests, full typecheck/build, sample seed, 1-year backfill.
- [ ] Commit, push current branch, deploy to Vercel production.

