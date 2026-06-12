# Finviz Canonical Industry Taxonomy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use Finviz's 144 industries as the shared canonical industry taxonomy for both KR and US stocks, while displaying Korean sector and industry labels.

**Architecture:** Add a small Python taxonomy module that owns the Finviz industry master, Korean labels, exact Finviz matching, and Korean/raw provider fallback rules. Reuse it from both taxonomy seeding and external Finviz benchmark sync so display labels and benchmark lookup keys stay aligned.

**Tech Stack:** Python maintenance scripts, Supabase REST upserts, unittest, existing `stock_symbol_profiles`, `industry_taxonomy_map`, and `stock_industry_benchmarks` tables.

---

### Task 1: Lock The Canonical Contract In Tests

**Files:**
- Create: `tests/test_finviz_industry_taxonomy.py`
- Modify: `tests/test_sync_external_industry_benchmarks.py`
- Modify: `tests/test_seed_industry_taxonomy_map.py`

- [ ] Add tests asserting the Finviz master has 144 unique raw industry names.
- [ ] Add tests asserting raw US labels and Korean raw labels map into the same Korean canonical label.
- [ ] Add tests asserting Finviz benchmark rows store Korean display industries while preserving raw Finviz names in `provider_group_name`.

### Task 2: Add The Finviz Taxonomy Module

**Files:**
- Create: `scripts/finviz_industry_taxonomy.py`

- [ ] Define `FINVIZ_INDUSTRIES` with raw industry name, raw sector name, Korean sector label, Korean industry label, and stable slug.
- [ ] Expose exact raw-name lookup for Finviz/Nasdaq/yfinance labels.
- [ ] Expose keyword fallback mapping for KR source industries and broad raw provider labels.
- [ ] Return low confidence for fallback mappings that are heuristic rather than exact.

### Task 3: Reuse The Taxonomy In Existing Pipeline

**Files:**
- Modify: `scripts/sync_external_industry_benchmarks.py`
- Modify: `scripts/seed_industry_taxonomy_map.py`

- [ ] Replace broad `US_INDUSTRY_RULES` mapping with the Finviz 144 master.
- [ ] Fetch the all-industry Finviz valuation page by default and infer sectors from the master.
- [ ] Keep `provider_group_name` as raw Finviz text and store Korean display labels in benchmark `sector` and `industry`.
- [ ] Seed `profile_primary` mappings for KR and US raw profile source keys into the same Korean canonical labels.

### Task 4: Refresh DB Data

**Files:**
- No repository file changes.

- [ ] Upsert `industry_taxonomy_map` rows from the updated seeding script.
- [ ] Upsert Finviz `stock_industry_benchmarks` rows from the updated external sync script.
- [ ] Patch SpaceX cached profile/snapshot labels from the old broad label to `항공우주·방산`.

### Task 5: Verify

**Files:**
- No repository file changes.

- [ ] Run focused Python unit tests.
- [ ] Run DB verification that `finviz_industry` has 144 rows, every canonical industry label is Korean, and KR/US benchmark scopes remain separate.
- [ ] Run `git diff --stat` and summarize only the files touched by this task.
