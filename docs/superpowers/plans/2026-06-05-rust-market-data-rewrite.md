# Rust Market Data Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move market-data collection, cache refresh, scoring, and provider rate limiting out of request-time Next.js/Python subprocesses into a Rust service that can reliably serve 100k daily users.

**Architecture:** Use a strangler migration. Next.js remains the UI and public BFF; a new Rust `market-data` service owns KIS access, cache reads/writes, refresh jobs, score calculation, and metrics. Keep existing public JSON responses stable first, then simplify the API after parity is proven.

**Tech Stack:** Next.js 16, Rust 1.95, Axum, Tokio, Reqwest with rustls, Serde, SQLx/Postgres via Supabase, Valkey/Redis for hot cache and distributed locks, Docker, Node test runner, Cargo tests.

---

## Decisions

- Keep Supabase/Postgres as the durable store. Do not replace the DB during the first rewrite pass.
- Keep existing public routes: `/api/quote`, `/api/score`, `/api/score/batch`, `/api/judgment`, `/api/symbols`.
- Add an internal Rust service behind `MARKET_DATA_SERVICE_URL` and `MARKET_DATA_INTERNAL_TOKEN`; public clients never call it directly.
- Preserve current response payload fields from `src/lib/types.ts` until the UI and tests prove parity.
- Remove Python subprocess execution from request paths. Python may remain as a yfinance fundamentals adapter behind a Rust-managed worker boundary.
- Treat cache as the primary serving layer: quote cache seconds, score cache hour-level, stale fallback one day, LLM judgment cache six hours.
- Use Valkey/Redis in production for hot responses, singleflight locks, provider throttle state, and token cache. Supabase remains the source of durable snapshots.

## Current Evidence

- `src/lib/stockSnapshotCache.ts` and `src/lib/stockQuoteCache.ts` spawn `scripts/fetch_yfinance_score.py` during API requests.
- `scripts/fetch_yfinance_score.py` is 2,658 lines and mixes KIS auth, token caching, provider calls, yfinance fundamentals, Supabase cache, score calculation, and JSON formatting.
- The current emergency hardening added rate limits and stale cache behavior, but the high-risk shape remains: request-time provider access and process spawning.
- `src/lib/types.ts` already documents the de facto public payload contract and should anchor parity tests.

## Target Internal API

The Rust service exposes only internal endpoints:

- `GET /healthz`: process and dependency readiness.
- `GET /v1/quote/{market}/{symbol}?refresh=0|1`: returns the existing `StockQuoteResponse` shape plus `server_cache`.
- `GET /v1/score/{market}/{symbol}?view=detail|compare&refresh=0|1`: returns the existing `StockScoreResponse` shape plus `server_cache`.
- `POST /v1/score/batch`: body `{"items":[{"market":"US","symbol":"KO"}],"view":"compare"}`, max five symbols.
- `POST /v1/refresh`: body `{"kind":"quote|score|fundamentals|judgment","market":"US|KR","symbol":"KO","view":"detail|compare"}`; enqueues refresh and returns job status.
- `GET /metrics`: Prometheus text metrics, protected by the same internal token.

All internal endpoints require `Authorization: Bearer $MARKET_DATA_INTERNAL_TOKEN`.

## Implementation Tasks

### Task 1: Contract Harness

**Files:**
- Create: `tests/fixtures/market-data/quote-us-ko.json`
- Create: `tests/fixtures/market-data/score-us-ko-detail.json`
- Create: `tests/fixtures/market-data/score-kr-005930-detail.json`
- Create: `tests/marketDataContract.test.ts`

- [ ] Capture sanitized fixtures from current successful responses for `US:KO`, `KR:005930`, and one compare response.
- [ ] Add tests that assert required public fields exist: `ok`, `market`, `symbol`, `name`, `latest_price`, `price_metrics`, `server_cache`, and score-only fields `score`, `components`, `key_metrics`, `chart_series`, `sia_snapshot`.
- [ ] Add tests that reject accidental removal of `refresh_cooldown` and six-hour judgment cache metadata.
- [ ] Run: `npm test`.
- [ ] Commit: `test: pin market data response contracts`.

### Task 2: Rust Service Skeleton

**Files:**
- Create: `services/market-data/Cargo.toml`
- Create: `services/market-data/src/main.rs`
- Create: `services/market-data/src/config.rs`
- Create: `services/market-data/src/http.rs`
- Create: `services/market-data/src/auth.rs`
- Modify: `Dockerfile`
- Modify: `.dockerignore`

- [ ] Create an Axum service with `/healthz`, `/metrics`, and internal bearer auth middleware.
- [ ] Add config loading for `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STOCK_API_APP_KEY`, `STOCK_API_APP_SECRET`, `STOCK_API_BASE`, `REDIS_URL`, `MARKET_DATA_INTERNAL_TOKEN`.
- [ ] Add structured tracing with no secret logging.
- [ ] Add Docker build stage for the Rust service while keeping the existing Next container runnable.
- [ ] Run: `cargo fmt --check --manifest-path services/market-data/Cargo.toml`.
- [ ] Run: `cargo test --manifest-path services/market-data/Cargo.toml`.
- [ ] Commit: `feat: add rust market data service skeleton`.

### Task 3: KIS Provider Client

**Files:**
- Create: `services/market-data/src/provider/kis.rs`
- Create: `services/market-data/src/provider/models.rs`
- Create: `services/market-data/src/rate_limit.rs`
- Create: `services/market-data/tests/kis_provider.rs`

- [ ] Implement KIS token acquisition with Redis token cache and a local in-memory fallback for development.
- [ ] Implement global provider throttle with Redis lock keys for KIS request spacing.
- [ ] Implement US quote/detail/search/daily/news calls and KR quote/daily/search/stock-info/news calls.
- [ ] Use typed Serde models at the boundary and convert provider errors to stable app errors: `invalid_ticker`, `kis_rate_limited`, `kis_auth_failed`, `provider_unavailable`.
- [ ] Add mock HTTP tests for token reuse, 429 mapping, auth failure mapping, and timeout handling.
- [ ] Run: `cargo test --manifest-path services/market-data/Cargo.toml kis_provider`.
- [ ] Commit: `feat: implement rust kis provider client`.

### Task 4: Score Engine Parity

**Files:**
- Create: `services/market-data/src/score/mod.rs`
- Create: `services/market-data/src/score/indicators.rs`
- Create: `services/market-data/src/score/payload.rs`
- Create: `services/market-data/tests/score_parity.rs`

- [ ] Port pure calculations first: ticker normalization, percentage parsing, averages, RSI, ATR, moving averages, grade, signal, component scoring.
- [ ] Build typed intermediate structs for quote, daily bars, fundamentals, and profile data before formatting public JSON.
- [ ] Assert parity with current fixture outputs within numeric tolerance `0.1` for scores and exact matches for labels that the UI depends on.
- [ ] Keep yfinance fundamentals as an adapter input. Do not block the Rust score path on Python when stale fundamentals exist.
- [ ] Run: `cargo test --manifest-path services/market-data/Cargo.toml score`.
- [ ] Commit: `feat: port stock score engine to rust`.

### Task 5: Cache Store And Refresh Jobs

**Files:**
- Create: `services/market-data/src/store.rs`
- Create: `services/market-data/src/cache.rs`
- Create: `services/market-data/src/jobs.rs`
- Create: `supabase/migrations/20260605130000_market_data_jobs.sql`

- [ ] Keep writing existing `stock_quote_snapshots`, `stock_score_snapshots`, `stock_fundamental_snapshots`, and `stock_ai_judgments` tables.
- [ ] Add `stock_refresh_jobs` with `id`, `kind`, `market`, `symbol`, `view_mode`, `priority`, `status`, `available_at`, `locked_until`, `attempts`, `last_error`, timestamps, and indexes for pending jobs.
- [ ] Serve fresh cache immediately, serve stale cache with background enqueue, and block only when there is no usable cache.
- [ ] Add singleflight refresh locks by `{kind}:{market}:{symbol}:{view}` in Redis.
- [ ] Add tests for fresh hit, stale hit with enqueue, cache miss with refresh, provider failure with stale fallback, and provider failure without stale data.
- [ ] Run: `cargo test --manifest-path services/market-data/Cargo.toml cache jobs`.
- [ ] Commit: `feat: add rust cache and refresh job pipeline`.

### Task 6: Next.js BFF Cutover

**Files:**
- Modify: `src/app/api/quote/route.ts`
- Modify: `src/app/api/score/route.ts`
- Modify: `src/app/api/score/batch/route.ts`
- Create: `src/lib/marketDataClient.ts`
- Modify: `.env.example`
- Modify: `README.md`

- [ ] Add `MARKET_DATA_BACKEND=python|rust|dual_shadow`; default local development to `python`, production to `rust`.
- [ ] Implement `marketDataClient` with timeout, internal bearer token, retry only for safe cache reads, and no secret output.
- [ ] In `dual_shadow`, serve Python responses while logging Rust parity differences without exposing them to users.
- [ ] In `rust`, remove request-time subprocess use from public API routes.
- [ ] Preserve public route rate limits, refresh cooldown behavior, and cache headers.
- [ ] Run: `npm test`.
- [ ] Run: `npm run check`.
- [ ] Commit: `feat: route market data api through rust service`.

### Task 7: LLM Judgment Cache And Async Generation

**Files:**
- Modify: `src/app/api/judgment/route.ts`
- Create: `services/market-data/src/judgment.rs`
- Create: `tests/judgmentCache.test.ts`

- [ ] Make public judgment reads cache-first and return `202` with a stable empty state when generation is queued but not ready.
- [ ] Keep six-hour cache keys based on ticker, compact stock payload hash, prompt version, and model.
- [ ] Move OpenAI generation behind server-only job execution so anonymous clients cannot directly trigger unlimited model calls.
- [ ] Add tests proving repeated requests inside six hours do not enqueue duplicate generation jobs.
- [ ] Run: `npm test`.
- [ ] Run: `cargo test --manifest-path services/market-data/Cargo.toml judgment`.
- [ ] Commit: `feat: make ai judgments async cached jobs`.

### Task 8: Operational Verification

**Files:**
- Create: `docker-compose.yml`
- Create: `scripts/smoke-market-data.sh`
- Create: `scripts/load-market-data.js`
- Modify: `README.md`

- [ ] Add local compose for Next, Rust service, and Redis while using Supabase remote env for Postgres.
- [ ] Add smoke script for `/healthz`, `/api/quote?ticker=US:KO`, `/api/score?ticker=US:KO`, `/api/score?ticker=KR:005930`, `/api/score/batch`.
- [ ] Add k6 or autocannon load script targeting cached reads at 200 RPS for five minutes.
- [ ] Acceptance gate: p95 cached quote route under 150 ms locally, no Python process spawned during cached reads, no provider calls on fresh cache hits, no secret output in logs.
- [ ] Run: `npm run check`.
- [ ] Run: `cargo test --manifest-path services/market-data/Cargo.toml`.
- [ ] Run: `docker compose up --build`.
- [ ] Run: `bash scripts/smoke-market-data.sh`.
- [ ] Run: load script and capture p50/p95/error rate in README.
- [ ] Commit: `chore: add market data operational verification`.

## Rollout

- Phase 1: Land contract tests and Rust skeleton while production still uses Python.
- Phase 2: Run `dual_shadow` locally and compare Rust/Python payloads for representative US and KR tickers.
- Phase 3: Enable `MARKET_DATA_BACKEND=rust` in staging or preview only.
- Phase 4: Enable production Rust backend after one full market session with no parity-critical regressions.
- Phase 5: Remove Python subprocess request path after Rust handles quote, score, batch, and judgment cache reliably.

## Acceptance Criteria

- Public UI works with unchanged `/api/*` routes.
- Cached quote and score reads do not spawn Python.
- Cache miss does not fan out duplicate provider requests for the same ticker.
- KIS token, throttle, and provider errors are globally coordinated across service instances.
- LLM judgment generation is capped by six-hour cache and job de-duplication.
- `npm test`, `npm run check`, `cargo test`, `cargo clippy`, Docker smoke, and load checks pass.
- No Supabase service role key, KIS secret, OpenAI key, or internal token appears in logs or browser payloads.

