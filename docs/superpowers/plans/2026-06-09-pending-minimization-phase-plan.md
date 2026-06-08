# PENDING Minimization Phase Plan

Date: 2026-06-09

## Objective

Minimize user-visible `snapshot_pending` for detail, compare, and technical analysis without moving expensive Python/yfinance work back into Vercel request handlers. Keep KIS/yfinance usage conservative, cache durable data longer, and make the UI reveal useful partial data as soon as it exists.

## Research Summary

- Code architecture review found that quote/score jobs had queue drains, but chart jobs could be enqueued without an Actions backstop. Technical score payloads also carried chart data that was not reused as chart snapshots.
- KIS OpenAPI review: production API capacity is useful but still rate-limited; token reuse, market-calendar gating, and batched/queued collection are required.
- yfinance review: unofficial and best used in background workers with caching, not on a request path.
- Ops/cost review: Vercel should stay snapshot-only. A queue worker or Actions backstop should claim lanes by kind and avoid exact queue counts.
- QA review: cold US/KR single stocks and derivative-like products must be tested across detail, compare, and technical routes.

Primary references:
- KIS OpenAPI portal: https://apiportal.koreainvestment.com/apiservice-apiservice
- KIS OpenAPI introduction: https://apiportal.koreainvestment.com/about-open-api
- yfinance README: https://github.com/ranaroussi/yfinance/blob/main/README.md
- yfinance documentation: https://ranaroussi.github.io/yfinance/

## Review Rounds

Round 1:
- Provider: avoid duplicate KIS/yfinance calls; chart reuse from technical score is high leverage.
- UX: never expose internal retry seconds; keep partial/skeleton states stable.
- Ops/cost: Actions is a backstop, not an always-on low-latency worker.
- Code quality: add chart lane tests and keep priority policy centralized.
- Security/legal: keep service-role keys server-only and avoid raw provider redistribution beyond app use.

Round 2:
- Queue status must use row existence, not exact counts.
- Force refresh must outrank user-visible misses.
- Technical chart sidecar failures must not fail score jobs.
- Technical retry state must be preserved only for the same ticker.
- Workflow should drain score before chart to reuse technical chart payloads.

Round 3 checkpoints:
- Verify full test/build before commit.
- Verify production deploy alias, CI, and live APIs after push.
- QA must include never-before-seen US/KR samples and derivative blocking behavior.

## Phase Tasks

### Phase 1. Retry and Priority Policy

- Add centralized refresh priorities: force, user quote miss, user chart miss, technical score miss, detail/compare score miss, stale refresh lanes.
- Make `score + snapshot_miss` default retry 5 seconds; keep generic queue retry at 300 seconds.
- Update tests and operations docs.

### Phase 2. Chart Lane and Provider Deduplication

- Let `stock_refresh_queue_status.ts` check due `chart` jobs.
- Add chart queue drain to `publish-stock-snapshots.yml` with a bounded queue limit.
- Drain legacy score before chart so technical score can reuse chart data first.
- Reuse technical `chart_series` as `stock_chart_snapshots`.
- Catch/log optional chart sidecar failures without failing score jobs.

### Phase 3. UX Stability

- Preserve pending/partial screens during automatic retry for the same ticker.
- Reset to skeleton immediately when the requested ticker set changes.
- In compare retry failures, keep existing visible data and only mark newly missing tickers as errors.

### Phase 4. Verification and Deployment

- Run focused tests, full `npm test`, `npm run typecheck`, `npm run build`, and provider-adjacent Python/Rust tests where relevant.
- Commit and push to `main`.
- Wait for GitHub Actions and Vercel production deployment.
- QA production with three US and three KR never-before-seen samples, mixing eligible single stocks and derivative-like products across detail, compare, and technical.

## Acceptance Criteria

- Missing score snapshots return `retry_after_seconds: 5`.
- Chart jobs are claimable and drainable without exact Supabase counts.
- Technical score jobs can populate chart snapshots without a second provider call.
- Pending partial technical responses do not enqueue a second chart job for the same cold miss.
- Chart backstop jobs re-check durable chart freshness before collecting.
- Optional chart write failure cannot mark the score job failed.
- UI does not regress to a blank/error state during automatic retry when usable partial data exists.
- Unsupported derivative-like products do not expose technical analysis and forced `/technical` entry redirects to detail.
