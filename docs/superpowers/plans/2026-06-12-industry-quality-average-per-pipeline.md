# Industry Quality And Average PER Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve domestic and US industry mapping quality, rename user-facing benchmark labels from "업종 기준" to average labels, and make industry/sector/market average PER/PBR appear reliably for single-stock pages while excluding derivative-like products by explicit rules.

**Architecture:** Keep Finviz 144 industries as the shared canonical taxonomy. Prefer symbol-level `stock_symbol_industry_tags.taxonomy = finviz_canonical` for display and benchmark aggregation, fall back to `industry_taxonomy_map`, then sector/market benchmark rows when an industry sample is not available. Exclude non-single-stock asset classes before requesting industry benchmarks.

**Tech Stack:** TypeScript app/server helpers, Python taxonomy maintenance scripts, Supabase SQL RPC, Node test runner, Python unittest.

---

### Task 1: User-Facing Label Rename

**Files:**
- Modify: `src/lib/stockIndustryBenchmarkEnrichment.ts`
- Modify: `tests/stockIndustryBenchmarkEnrichment.test.ts`
- Modify: `tests/stockDisplayAdapters.test.ts`

- [x] Write failing tests that expect `업종 평균 PER`, `업종 평균 PBR`, and legacy-row replacement from `업종 기준 PER`.
- [x] Update benchmark label constants and duplicate-detection aliases.
- [x] Run targeted Node tests.

### Task 2: Benchmark Eligibility Rules

**Files:**
- Modify: `src/lib/stockIndustryBenchmarkEnrichment.ts`
- Modify: `src/lib/ruleBasedJudgment.ts`
- Test: `tests/stockIndustryBenchmarkEnrichment.test.ts`

- [x] Add failing tests proving ETF/ETN/preferred/SPAC/REIT/derivative-like payloads skip industry benchmark enrichment.
- [x] Add a focused eligibility helper using `asset_class`, `industry_profile.asset_class`, `instrument_type`, and derivative-like ticker metadata.
- [x] Run targeted Node tests.

### Task 3: Symbol-Level Tags In Benchmark Aggregation

**Files:**
- Add/modify Supabase migration under `supabase/migrations/`
- Test: existing SQL text checks or targeted runtime verification.

- [x] Keep `refresh_stock_industry_benchmarks` preferring `stock_symbol_industry_tags.taxonomy = finviz_canonical`.
- [x] Ensure aggregation still falls back to taxonomy map, raw profile, payload, sector, and market aggregates.
- [x] Apply migration and refresh benchmark rows.

### Task 4: Industry Mapping Quality Audit

**Files:**
- Modify: `scripts/sync_canonical_industry_tags.py`
- Modify: `tests/test_sync_canonical_industry_tags.py`
- Modify docs as needed.

- [x] Add tests for high-risk US/KR product keyword splits.
- [x] Keep product keyword/manual override counts in sync output.
- [x] Regenerate canonical tags and verify KR/US coverage, invalid names, and low-confidence counts.

### Task 5: Verification

**Files:**
- Existing test suites and DB checks.

- [x] Run Python unittest discovery.
- [x] Run TypeScript test suite.
- [x] Query DB coverage for KR and US canonical primary tags.
