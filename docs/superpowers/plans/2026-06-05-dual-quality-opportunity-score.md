# Dual Quality And Opportunity Score Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 품질점수와 새 기회점수를 API, 캐시 검증, Python collector, Rust score engine, UI에 함께 제공한다.

**Architecture:** `score`는 하위 호환을 위해 품질점수 alias로 유지한다. 기회점수는 같은 raw market/fundamental input에서 별도 산식으로 계산하고, confidence와 risk caps를 함께 내보낸다. TypeScript cache validator는 새 필드가 없는 payload를 stale로 본다.

**Tech Stack:** Python yfinance/KIS collector, Rust market-data service, Next.js/TypeScript UI, node:test, unittest, cargo test.

---

### Task 1: RED Tests

**Files:**
- Modify: `tests/test_score_helpers.py`
- Modify: `services/market-data/tests/phase2_score_engine.rs`
- Modify: `tests/scoreModel.test.ts`
- Modify: `tests/marketDataContract.test.ts`

- [x] Add failing tests for Python opportunity scoring, Rust payload contract, TypeScript cache contract, and public fixture contract.
- [x] Run focused tests and confirm they fail because the dual score contract is missing.

### Task 2: Shared Contract

**Files:**
- Modify: `src/lib/scoreModel.ts`
- Modify: `src/lib/types.ts`

- [x] Bump score model version to `score-v5-dual-quality-opportunity-2026-06-05`.
- [x] Require numeric `quality_score`, `opportunity_score`, `opportunity_confidence`, array `opportunity_components`, and matching `sia_snapshot` fields for current cache acceptance.
- [x] Add TypeScript response types for the new fields.

### Task 3: Python Collector

**Files:**
- Modify: `scripts/fetch_yfinance_score.py`

- [x] Add yfinance cached fields for target price, analyst count, recommendation mean, beta, and average volume.
- [x] Implement `opportunity_factor_score`.
- [x] Add `quality_score`, `opportunity_score`, `opportunity_components`, and snapshot fields to US/KR KIS payloads.
- [x] Keep legacy yfinance fallback structurally compatible.

### Task 4: Rust Score Engine

**Files:**
- Modify: `services/market-data/src/score.rs`
- Modify: `services/market-data/tests/phase2_score_engine.rs`

- [x] Add optional input fields for target price, analyst count, recommendation mean, and beta.
- [x] Port the Python opportunity formula and risk caps.
- [x] Emit the same payload contract as Python.

### Task 5: UI

**Files:**
- Modify: `src/components/StockDashboard.tsx`
- Modify: `src/components/StockCompare.tsx`
- Modify: `src/app/globals.css`

- [x] Rename first score display to 품질 점수.
- [x] Add 기회 점수 beside it when available.
- [x] Include opportunity in compare cards without changing the existing quality ranking.

### Task 6: Verify And Commit

**Files:**
- Update fixtures under `tests/fixtures/market-data` if the public contract changes.
- Update `docs/score-system-operations.md`.

- [x] Run Python unit tests and py_compile.
- [x] Run Rust cargo tests.
- [x] Run npm tests and typecheck.
- [x] Run score smoke check on representative US/KR speculative/quality names.
- [x] Build the app.
- [x] Commit and push.
