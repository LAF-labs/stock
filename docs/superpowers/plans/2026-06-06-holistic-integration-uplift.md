# Holistic Integration 90+ Uplift Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:test-driven-development` for code changes and read-only subagent review for the final gate.

**Goal:** Raise the whole-project harmony score from `88/100` to at least `90/100` without regressing any component that already scored 90+.

**Baseline finding:** Individual components are strong, but the integrated system still has contract drift and transitional ownership gaps. The main blockers are divergent Next/Rust quote semantics, mismatched quote cache freshness, and unclear score freshness when quote data is refreshed independently.

## Phase 1: Shared Quote Contract

- [x] Add failing Rust tests proving domestic KIS market division and exchange labels must match the Next path.
- [x] Add failing Rust tests proving the Rust default quote TTL matches the production quote freshness contract.
- [x] Introduce a shared quote contract file consumed by both TypeScript and Rust.
- [x] Update Next KIS quote client, Rust KIS provider, and Rust cache defaults to use the shared contract.
- [x] Run targeted Node and Rust quote/cache tests.

## Phase 2: Score Freshness And Ownership Coherence

- [x] Add tests for explicit score freshness/status text independent from quote freshness.
- [x] Surface score cache state/freshness in the dashboard/header where users interpret the score.
- [x] Tighten operations documentation so the production owner for snapshot scoring versus Rust queued scoring is unambiguous.
- [ ] Run targeted UI/helper/doc checks plus full project verification.

## Phase 3: Holistic Review Gate

- [x] Run `npm run check:all`.
- [x] Run Supabase and operations readiness checks.
- [x] Dispatch one read-only subagent to score the whole project critically, including cross-component harmony.
- [ ] If holistic score is `>=90`, commit and push. If it remains below 90, fix only the new blocking findings and repeat the gate.
