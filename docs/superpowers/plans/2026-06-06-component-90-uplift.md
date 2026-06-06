# Component 90+ Uplift Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring every reviewed project component to at least 90/100 through audited, verified, component-scoped improvements.

**Architecture:** Each component follows the same gate: read-only subagent evaluation, targeted implementation, local verification, subagent re-evaluation, then commit and push only after that component is scored 90 or higher. Work proceeds one component at a time to avoid overlapping edits, while read-only audits can run in parallel.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase REST/RPC, Python/yfinance/KIS collector scripts, Rust/Axum market-data service, GitHub Actions.

---

## Global Rules

- Protect command output: commands with unknown or large output must use a byte cap, for example `COMMAND 2>&1 | head -c 4000`.
- Do not edit and commit unrelated files.
- Do not start the next component implementation until the current component has:
  - fresh verification evidence,
  - subagent re-evaluation at `>= 90/100`,
  - a component-scoped commit,
  - a successful push to `origin main`.
- If a subagent discovers a Critical or Important issue, fix it before the component can receive `>= 90`.
- Evaluation subagents are read-only unless the coordinator explicitly dispatches a worker with a disjoint write scope.
- Commit message format: `chore(<component>): raise <component> score to 90+` unless the change is clearly a feature or fix.

## Components And Target Gates

| Component | Baseline | Required Gate |
| --- | ---: | --- |
| Frontend UX and accessibility | 78 | `>=90` from frontend evaluator plus E2E/visual or accessibility verification |
| Chart and visual behavior | 78 | `>=90` from frontend evaluator plus chart render coverage |
| API/cache/security | 88 | `>=90` from API/security evaluator plus Node tests and build |
| Supabase schema/readiness | 85 | `>=90` from API/ops evaluator plus `npm run supabase:readiness` |
| Score model/data quality | 82 | `>=90` from data evaluator plus golden/smoke tests |
| Rust market-data service | 68 | `>=90` from Rust/ops evaluator plus Rust contract tests |
| Operations/deployment | 84 | `>=90` from Rust/ops evaluator plus `npm run ops:check` |
| Documentation/maintainability | 88 | `>=90` from final review plus updated docs for changed workflows |

## Files By Component

Frontend UX and chart:
- Modify: `src/components/StockDashboard.tsx`
- Modify: `src/components/StockCompare.tsx`
- Modify: `src/components/StockHeader.tsx`
- Modify: `src/components/SymbolAutocomplete.tsx`
- Modify: `src/components/TradingPriceChart.tsx`
- Modify: `src/app/globals.css`
- Add or modify tests under `tests/` for helper-level coverage
- Add browser/E2E coverage only if the implementation needs runtime UI verification

API/cache/security:
- Modify: `src/app/api/*/route.ts`
- Modify: `src/lib/apiRateLimit.ts`
- Modify: `src/lib/apiGuards.ts`
- Modify: `src/lib/errorSafety.ts`
- Modify: `src/lib/refreshCooldown.ts`
- Modify: `src/lib/stockSnapshotCache.ts`
- Modify: `src/lib/stockQuoteCache.ts`
- Modify: `src/lib/stockPendingResponse.ts`
- Modify tests under `tests/*.test.ts`

Supabase and operations:
- Modify: `supabase/migrations/*.sql`
- Modify: `scripts/supabase_runtime_readiness.ts`
- Modify: `scripts/stock_operations_report.ts`
- Modify: `.github/workflows/*.yml`
- Modify: `docs/score-system-operations.md`
- Modify tests under `tests/*.test.ts` and `tests/test_*.py`

Score/data quality:
- Modify: `scripts/stock_score/scoring.py`
- Modify: `src/lib/scoreModel.ts`
- Modify: `services/market-data/src/score.rs`
- Modify: `tests/fixtures/golden-score-guardrails.json`
- Modify: `tests/test_score_golden_guardrails.py`
- Modify: `services/market-data/tests/phase2_score_engine.rs`

Rust market-data:
- Modify: `services/market-data/src/service.rs`
- Modify: `services/market-data/src/cache.rs`
- Modify: `services/market-data/src/jobs.rs`
- Modify: `services/market-data/src/provider/kis.rs`
- Modify: `services/market-data/src/http.rs`
- Modify tests under `services/market-data/tests/*.rs`

## Phase 0: Baseline Audit And Plan

### Task 0.1: Start Read-Only Component Evaluators

- [x] Spawn frontend/UI evaluator.
- [x] Spawn API/cache/security evaluator.
- [x] Spawn data/score/model evaluator.
- [x] Spawn Rust/operations evaluator.
- [x] Collect evaluator outputs.
- [x] Merge evaluator findings into the relevant phase below.

Expected evaluator output:

```text
current_score:
top_weaknesses:
exact_tasks:
verification:
```

### Task 0.2: Record Baseline Verification

- [x] Run `npm test`.
- [x] Run `npm run test:python`.
- [x] Run `npm run test:rust`.
- [x] Run `npm run typecheck`.
- [x] Run `npm run build`.
- [x] Run `npm run supabase:readiness`.
- [x] Run `npm run ops:check`.

Current evidence:

```text
npm test: 120 passed
npm run test:python: 62 passed
npm run test:rust: 24 passed
npm run typecheck: exit 0
npm run build: exit 0
npm run supabase:readiness: ok true
npm run ops:check: ok true
```

## Phase 1: Frontend UX, Accessibility, And Chart 90+

Evaluator finding: current score `78/100`. Blocking issues are no E2E/a11y/visual gate, missing page-level `h1`, insufficient chart text fallback, passive pending/error UX, imperfect combobox semantics, custom tab keyboard gaps, visual compare grids without semantic table/ARIA support, and neutral price state styling.

### Task 1.1: Add Frontend Risk Tests

**Files:**
- Modify: `tests/stockDashboardHelpers.test.ts`
- Modify: `tests/stockCompareHelpers.test.ts`
- Create if needed: `tests/frontendContract.test.ts`

- [ ] Add tests for pending, cooldown, quote overlay, ticker normalization, chart point normalization, and comparison removal behavior.
- [ ] Add helper tests for neutral price tone, chart summary stats, and semantic compare table row mapping.
- [ ] Run:

```bash
npm test -- --test-name-pattern "dashboard|compare|frontend|chart" 2>&1 | head -c 12000
```

Expected:

```text
failures: 0
```

### Task 1.2: Improve Accessible UI State Coverage

**Files:**
- Modify: `src/components/SymbolAutocomplete.tsx`
- Modify: `src/components/StockHeader.tsx`
- Modify: `src/components/StockDashboard.tsx`
- Modify: `src/components/StockCompare.tsx`

- [ ] Ensure every async state has a screen-reader visible status or alert.
- [ ] Ensure icon-only controls have explicit `aria-label`.
- [ ] Ensure autocomplete keyboard behavior preserves active option semantics.
- [ ] Ensure compare removal buttons are stable and do not remove the base ticker.
- [ ] Add a real page-level `h1` on detail and compare pages.
- [ ] Add `role="status"` or `role="alert"` for compare pending/error blocks.
- [ ] Add retry actions for recoverable dashboard and compare errors.
- [ ] Add neutral price styling when daily change is missing.
- [ ] Run:

```bash
npm test 2>&1 | head -c 20000
npm run typecheck 2>&1 | head -c 12000
```

Expected:

```text
Node tests: failures 0
TypeScript: exit 0
```

### Task 1.3: Verify Runtime UI

**Files:**
- Modify only if bugs are found: frontend component files listed in Phase 1.

- [ ] Start the dev server:

```bash
npm run dev 2>&1 | head -c 4000
```

- [ ] Open and verify:

```text
http://127.0.0.1:3000/?ticker=US:KO
http://127.0.0.1:3000/compare?tickers=US:KO,US:PEP
```

- [ ] Capture desktop and mobile screenshots with the Browser plugin or Playwright.
- [ ] Verify no blank chart, no overlapping text, visible pending/error states, usable autocomplete, and comparison controls.
- [ ] Verify chart summary/fallback is visible to assistive technologies.
- [ ] Verify autocomplete reports loading, result count, no-result, and error states.

### Task 1.4: Frontend Re-Evaluation Gate

- [ ] Dispatch frontend evaluator with the diff and verification evidence.
- [ ] Required result: frontend UX and chart both `>=90`.
- [ ] If below 90, append exact findings to this phase and continue.
- [ ] Commit and push only after `>=90`:

```bash
git status --short 2>&1 | head -c 4000
git add src/components src/app/globals.css tests
git commit -m "chore(frontend): raise UI score to 90+"
git push origin main
```

## Phase 2: API, Cache, And Security 90+

Evaluator finding: current score `88/100`. Blocking issues are permissive production fallback to memory for distributed guards, implicit proxy header trust, invalid tickers defaulting to `US:ASTS`, non-streaming JSON body limit, missing same-origin/content-type guard on `/api/judgment`, service-role fallback for public reads, incomplete security headers, and raw unredacted log messages.

### Task 2.1: Close API Edge-Case Test Gaps

**Files:**
- Modify: `tests/apiGuards.test.ts`
- Modify: `tests/apiRateLimitIdentity.test.ts`
- Modify: `tests/stockCacheSnapshotMode.test.ts`
- Modify: `tests/stockPendingResponse.test.ts`
- Modify: `tests/kisQuoteClient.test.ts`

- [x] Add targeted tests from API/security evaluator findings.
- [x] Cover malformed input, missing Supabase admin config, refresh cooldown, rate limit headers, and secret redaction.
- [x] Add tests that score/quote routes reject missing or invalid tickers with `400` and `no-store` instead of defaulting to a real ticker.
- [x] Add tests that `/api/judgment` rejects non-JSON and cross-site browser requests.
- [x] Add tests that production read config requires `SUPABASE_PUBLISHABLE_KEY` unless an explicit unsafe override is set.
- [x] Add tests that production guard RPC outages fail closed instead of process-local pass-through.
- [x] Run:

```bash
npm test 2>&1 | head -c 20000
```

Expected:

```text
failures: 0
```

### Task 2.2: Harden API Implementation

**Files:**
- Modify files identified by Task 2.1 failures.

- [x] Keep request handlers returning stable public error contracts.
- [x] Keep production secret requirements strict.
- [x] Keep Supabase fallback behavior explicit and tested.
- [x] Add strict ticker parse helpers for API routes without changing local direct-input helpers.
- [x] Add streaming bounded JSON body read and JSON content-type enforcement.
- [x] Add same-origin browser guard for judgment POST.
- [x] Add explicit trusted proxy env behavior for client IP identity.
- [x] Route all server log error strings through `safeErrorMessage`.
- [x] Add HSTS, COOP, and CORP security headers. Remove production `unsafe-inline` only if it can be done without breaking Next runtime styles/scripts.
- [x] Run:

```bash
npm run typecheck 2>&1 | head -c 12000
npm run build 2>&1 | head -c 20000
```

Expected:

```text
TypeScript: exit 0
Next build: exit 0
```

Current evidence:

```text
npm test: 132 passed
npm run typecheck: exit 0
npm run build: exit 0
npm run supabase:readiness: ok true
npm run ops:check: ok true
```

### Task 2.3: API/Security Re-Evaluation Gate

- [x] Dispatch API/cache/security evaluator with the diff and verification evidence.
- [x] Required result: API/cache/security `>=90`.
- [ ] Commit and push only after `>=90`:

Current evaluator result:

```text
score: 93/100
>=90_gate: pass
remaining non-blocking risks: batch ticker strictness, GET refresh side effects, proxy spoof runtime assumptions, chunked body limit direct test, CSP unsafe-inline
```

```bash
git status --short 2>&1 | head -c 4000
git add src/app/api src/lib tests next.config.ts
git commit -m "chore(api): raise API security score to 90+"
git push origin main
```

## Phase 3: Supabase And Operations 90+

Evaluator finding: operations score `84/100`. Blocking issues are stale-data blind spots, no market-data service health in ops checks, no Rust container smoke in CI, no readiness preflight before queue drain, and score path still split with legacy Python.

### Task 3.1: Strengthen Runtime Readiness And Ops Signals

**Files:**
- Modify: `scripts/supabase_runtime_readiness.ts`
- Modify: `scripts/stock_operations_report.ts`
- Modify: `tests/supabaseRuntimeReadinessTs.test.ts`
- Modify: `tests/stockOperationsReportTs.test.ts`

- [x] Ensure readiness checks cover every runtime table/RPC/public read contract required by the app.
- [x] Ensure ops report distinguishes threshold pass from stale-data risk.
- [x] Add a reported-but-not-failing freshness signal for quote stale rate and oldest queued job age.
- [x] Add an explicit market-data service health section when `MARKET_DATA_SERVICE_URL` and `MARKET_DATA_INTERNAL_TOKEN` are configured.
- [x] Ensure operations report does not hide dead/stale jobs outside the current sampling window.
- [x] Run:

```bash
npm test 2>&1 | head -c 20000
npm run supabase:readiness 2>&1 | head -c 12000
npm run ops:check 2>&1 | head -c 20000
```

Expected:

```text
Node tests: failures 0
Supabase readiness: ok true
Ops check: ok true
```

### Task 3.2: Update Operations Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/score-system-operations.md`

- [x] Document the difference between threshold pass and stale-data freshness.
- [x] Document the component gate workflow for score worker, quote worker, and benchmark worker.
- [x] Document expected stale rates for demand-driven cache and hot-ticker freshness SLOs.
- [x] Document Rust container smoke expectations in CI.
- [x] Run:

```bash
npm run ops:check 2>&1 | head -c 20000
```

Expected:

```text
thresholds.ok: true
```

Current evidence:

```text
npm test: 138 passed
npm run test:python: 66 passed
npm run test:rust: 24 passed
npm run typecheck: exit 0
npm run build: exit 0
npm run supabase:readiness: ok true, readiness_contract includes rpc signature/grant drift fields
npm run ops:check with local market-data service env: ok true, market_data_service ok true, freshness_risks warnings reported
docker build --target market-data: exit 0
market-data smoke: /healthz ok true, /metrics contains market_data_service_info
```

Second-pass evaluator blockers addressed:

```text
package ops:check includes --max-market-data-service-failures 0
market-data URL/token omission fails when service threshold is configured
legacy Python score queue drain preflights stock_runtime_readiness before claim
stock_runtime_readiness migration reports selected RPC signatures and service_role grants
stock_operations_report migration removes the 14-day refresh job filter
```

### Task 3.3: Supabase/Ops Re-Evaluation Gate

- [x] Dispatch Rust/operations evaluator with the diff and verification evidence.
- [x] Required result: Supabase and operations `>=90`.
- [ ] Commit and push only after `>=90`:

Current evaluator result:

```text
supabase_score: 92/100
operations_score: 92/100
>=90_gate: pass
```

```bash
git status --short 2>&1 | head -c 4000
git add scripts tests docs README.md .github/workflows supabase/migrations
git commit -m "chore(ops): raise operations score to 90+"
git push origin main
```

## Phase 4: Score Model And Data Quality 90+

Evaluator finding: current score `82/100`. Blocking issues are Python/Rust score drift, missing Rust inputs for `avg_volume_60`, `atr14_pct`, and `fcf_margin`, coarse financial-data confidence, shallow TS payload validation, separate non-parity golden tests, and industry benchmark gaps not reflected in confidence.

### Task 4.1: Add Cross-Language Drift Guardrails

**Files:**
- Modify: `tests/test_score_golden_guardrails.py`
- Modify: `services/market-data/tests/phase2_score_engine.rs`
- Modify if needed: `tests/fixtures/golden-score-guardrails.json`

- [x] Ensure Python and Rust score paths use the same representative cases for premium growth, sparse data, weak high-risk names, KR enriched fundamentals, and speculative expensive sales.
- [x] Fail if current model version differs across TS, Python, and Rust.
- [x] Load the same representative fixture cases in Python and Rust instead of maintaining unrelated examples.
- [x] Add tolerance-based parity assertions for quality score, opportunity score, and confidence.
- [x] Run:

```bash
npm run test:python 2>&1 | head -c 20000
npm run test:rust 2>&1 | head -c 20000
```

Expected:

```text
Python tests: failures 0
Rust tests: failures 0
```

### Task 4.2: Clarify Financial Confidence Semantics

**Files:**
- Modify: `scripts/stock_score/scoring.py`
- Modify: `services/market-data/src/score.rs`
- Modify: `src/lib/scoreModel.ts`
- Modify related tests.

- [x] Ensure missing data lowers confidence instead of looking like neutral precision.
- [x] Ensure low-confidence high-score cases are capped or flagged.
- [x] Ensure public payload exposes enough confidence metadata for UI and ops reports.
- [x] Port Python opportunity inputs and caps into Rust: `avg_volume_60`, `atr14_pct`, `fcf_margin`, volume acceleration, ATR risk, and thin-liquidity cap.
- [x] Strengthen TS current-payload validation with component keys, confidence fields, and version consistency.
- [x] Run:

```bash
npm run score:smoke 2>&1 | head -c 20000
npm run ops:check 2>&1 | head -c 20000
```

Expected:

```text
score smoke: exit 0
ops check: ok true
```

Current evidence:

```text
node --import tsx --test tests/scoreModel.test.ts: 4 passed
bash scripts/run_python.sh -m unittest tests.test_score_golden_guardrails: 5 passed
npm test: 140 passed
npm run test:python: 68 passed
npm run test:rust: 26 passed
npm run typecheck: exit 0
npm run build: exit 0
npm run score:smoke: OK
docker build --target market-data -t stock-market-data:score-smoke .: exit 0
MARKET_DATA_SERVICE_URL=http://127.0.0.1:18080 MARKET_DATA_INTERNAL_TOKEN=ci-internal-token npm run ops:check: ok true
```

First re-evaluation:

```text
score_model_data_quality_score: 88/100
>=90_gate: fail
blocking_findings:
- Rust quality valuation used only ocf_margin for weak cashflow while opportunity parity had moved to fcf_margin/cashflow_margin.
- TS component validation accepted key-only components even though UI consumes score and label.
- Shared golden guardrail checked opportunity ranges but not parity targets.
remediation:
- Rust guardrailed valuation now uses cashflow_margin(input), with FCF-only negative cashflow coverage.
- TS current-payload validation now requires usable component key, label, and 0..100 score for required quality and opportunity components.
- Golden fixture now declares score/confidence parity targets; Python and Rust assert against them.
```

Current evidence after remediation:

```text
node --import tsx --test tests/scoreModel.test.ts: 5 passed
bash scripts/run_python.sh -m unittest tests.test_score_golden_guardrails: 7 passed
cargo test --manifest-path services/market-data/Cargo.toml --test phase2_score_engine rust_score_uses_shared_golden_opportunity_guardrails: passed
npm test: 141 passed
npm run test:python: 70 passed
npm run test:rust: 27 passed
npm run typecheck: exit 0
npm run build: exit 0
npm run score:smoke: OK
docker build --target market-data -t stock-market-data:score-smoke .: exit 0
MARKET_DATA_SERVICE_URL=http://127.0.0.1:18080 MARKET_DATA_INTERNAL_TOKEN=ci-internal-token npm run ops:check: ok true
```

### Task 4.3: Score/Data Re-Evaluation Gate

- [x] Dispatch data/score/model evaluator with the diff and verification evidence.
- [x] Required result: score model/data quality `>=90`.
- [x] Commit and push only after `>=90`:

Gate result:

```text
score_model_data_quality_score: 94/100
>=90_gate: pass
findings: none
vulnerabilities: none found
remaining_risk:
- Rust shared golden parity covers opportunity score/confidence, while quality parity remains Python-side.
- Intentional recalibration still needs reviewer scrutiny because parity fixture targets are now strict drift guards.
```

```bash
git status --short 2>&1 | head -c 4000
git add scripts/stock_score src/lib/scoreModel.ts services/market-data/src/score.rs tests services/market-data/tests docs
git commit -m "chore(score): raise score model score to 90+"
git push origin main
```

## Phase 5: Rust Market-Data Service 90+

Evaluator finding: Rust market-data score `68/100`. Blocking issues are in-memory production cache/queue, incomplete durable score handoff, weak provider fallback versus Node, shallow health/metrics, no CI container smoke, and config flags for Supabase/Redis that do not yet correspond to durable backends.

### Task 5.1: Expand Provider Coverage And Contract Tests

**Files:**
- Modify: `services/market-data/src/provider/kis.rs`
- Modify: `services/market-data/tests/kis_provider.rs`
- Modify: `services/market-data/tests/phase1_pipeline.rs`

- [ ] Bring Rust US quote fallback behavior closer to the Node KIS path: NAS, NYS, then AMS.
- [ ] Preserve stable error kinds for not found, rate limited, auth failed, provider timeout, and invalid provider response.
- [ ] Add provider metrics counters for fallback attempts and provider error classes if feasible within the existing metrics format.
- [ ] Run:

```bash
npm run test:rust 2>&1 | head -c 20000
```

Expected:

```text
Rust tests: failures 0
```

### Task 5.2: Make Durable-Path Limitations Explicit Or Implement Narrow Durable Bridge

**Files:**
- Modify: `services/market-data/src/service.rs`
- Modify: `services/market-data/src/jobs.rs`
- Modify: `services/market-data/src/http.rs`
- Modify: `README.md`
- Modify: `docs/score-system-operations.md`

- [ ] If implementing durable storage is too large for this component pass, keep `MARKET_DATA_SERVICE_ENABLE_SCORE=0` as the documented default and add explicit health/dependency reporting that score durable mode is unavailable.
- [ ] If implementing a narrow durable bridge, add tests that score refresh jobs are persisted through Supabase instead of memory-only queue.
- [ ] Add `/readyz` with internal bearer protection and checks for durable mode configuration, queue backend, cache backend, and provider configuration without leaking secrets.
- [ ] Add CI coverage for `docker build --target market-data` and authenticated `/metrics` smoke.
- [ ] Run:

```bash
npm run test:rust 2>&1 | head -c 20000
npm run build 2>&1 | head -c 20000
```

Expected:

```text
Rust tests: failures 0
Next build: exit 0
```

### Task 5.3: Rust Re-Evaluation Gate

- [ ] Dispatch Rust/operations evaluator with the diff and verification evidence.
- [ ] Required result: Rust market-data service `>=90`.
- [ ] Commit and push only after `>=90`:

```bash
git status --short 2>&1 | head -c 4000
git add services/market-data README.md docs tests
git commit -m "chore(rust): raise market-data score to 90+"
git push origin main
```

## Phase 6: Final Whole-Project 90+ Review

### Task 6.1: Full Verification

- [ ] Run:

```bash
npm run check:all 2>&1 | head -c 30000
npm run supabase:readiness 2>&1 | head -c 12000
npm run ops:check 2>&1 | head -c 20000
git status --short 2>&1 | head -c 4000
```

Expected:

```text
check:all: exit 0
supabase readiness: ok true
ops check: ok true
git status: clean
```

### Task 6.2: Final Subagent Review

- [ ] Dispatch final read-only evaluator with all component scores and verification evidence.
- [ ] Required result: every component `>=90`.
- [ ] If every component is `>=90`, mark the goal complete.
- [ ] If any component is below `90`, append a focused task to the relevant phase and continue.
