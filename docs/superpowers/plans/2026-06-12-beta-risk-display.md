# Beta Risk Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each stock's beta in both the detail risk/trading-stability card and the compare risk table, then audit useful fetched/calculated values that remain hidden.

**Architecture:** The Rust score engine already receives `ScoreEngineInput.beta` and uses it in the risk score, so expose it through the existing component `metrics` payload. The compare UI reads numeric fields through `CompareItem`, so add a `beta` field sourced from payload records and render a risk-row entry.

**Tech Stack:** Rust score engine, Next.js/React TypeScript UI helpers, Node test runner, Cargo tests.

---

### Task 1: Detail Risk Metric

**Files:**
- Modify: `services/market-data/src/score.rs`
- Test: `services/market-data/tests/phase2_score_engine.rs`

- [ ] **Step 1: Write the failing test**

Add an assertion that the `opportunity_risk` component contains a `Beta` metric when `beta` is present:

```rust
let risk_metrics = output
    .payload
    .get("opportunity_components")
    .and_then(Value::as_array)
    .and_then(|components| {
        components.iter().find(|component| {
            component.get("key").and_then(Value::as_str) == Some("opportunity_risk")
        })
    })
    .and_then(|component| component.get("metrics"))
    .and_then(Value::as_array)
    .expect("risk metrics");
assert!(risk_metrics.iter().any(|metric| {
    metric.get("label").and_then(Value::as_str) == Some("Beta")
        && metric.get("value").and_then(Value::as_str) == Some("1.90")
}));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path services/market-data/Cargo.toml beta -- --nocapture`
Expected: FAIL because risk component metrics are empty.

- [ ] **Step 3: Write minimal implementation**

Pass `ScoreEngineInput` into `opportunity_components_for`, and build the `opportunity_risk` component with metric rows for ATR14, RSI14, and Beta where values exist.

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path services/market-data/Cargo.toml beta -- --nocapture`
Expected: PASS.

### Task 2: Compare Beta Row

**Files:**
- Modify: `src/components/stockCompareHelpers.ts`
- Modify: `src/components/StockCompare.tsx`
- Test: `tests/stockCompareHelpers.test.ts` or the closest existing compare helper test file

- [ ] **Step 1: Write the failing test**

Add a `toCompareItem` test that supplies `financials: { beta: 1.23 }` and expects `item.beta === 1.23`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/stockCompareHelpers.test.ts`
Expected: FAIL because `CompareItem` does not expose `beta`.

- [ ] **Step 3: Write minimal implementation**

Add `beta?: number` to `CompareItem`, populate it from `financials.beta`, `price_metrics.beta`, or a `key_metrics` item labeled `베타`, then add a `베타` row to the `risk` metric group with `best: "low"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/stockCompareHelpers.test.ts`
Expected: PASS.

### Task 3: Hidden Metric Audit

**Files:**
- Read only unless a low-risk display gap is obvious.

- [ ] **Step 1: Inventory payload fields**

Search existing payload builders and UI renderers for score fields, price metrics, financial metrics, technical fields, and snapshot fields.

- [ ] **Step 2: Classify hidden useful values**

Report values already fetched/calculated but not prominently rendered, grouped by "easy to expose", "needs context", and "probably internal".

- [ ] **Step 3: Verify**

Run targeted tests and typecheck if practical:
`npm test -- tests/stockCompareHelpers.test.ts tests/stockDashboardHelpers.test.ts`
`cargo test --manifest-path services/market-data/Cargo.toml`
