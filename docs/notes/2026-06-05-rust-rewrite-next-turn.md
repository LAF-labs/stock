# Rust Rewrite Next-Turn Memo

## Start Here

- Create an implementation branch: `codex/rust-market-data-rewrite`.
- Start with `docs/superpowers/plans/2026-06-05-rust-market-data-rewrite.md`.
- First concrete coding target: `services/market-data` Rust skeleton with `/healthz`, `/metrics`, config loading, internal bearer auth, and tests.
- Keep existing Next/Python behavior as the fallback until Rust parity is proven.

## Highest-Value Rust Rewrite Points

1. Request-time collector execution
   - Current hot path: `src/lib/stockSnapshotCache.ts` and `src/lib/stockQuoteCache.ts` spawn `scripts/fetch_stock_score.py`.
   - Rust value: removes process spawn overhead, gives typed errors, centralizes timeouts and rate limits, and makes horizontal scaling predictable.

2. KIS client, auth token, and throttle
   - Current code is embedded in `scripts/fetch_stock_score.py`.
   - Rust value: long-lived HTTP client, shared token cache, global provider throttle, predictable retry/error mapping.

3. Cache refresh orchestration
   - Current cache refresh is mixed into public request handling.
   - Rust value: singleflight locks, stale-while-revalidate, background jobs, and no duplicated provider calls under traffic spikes.

4. Score calculation core
   - Current calculations are duplicated across US/KR branches inside one large Python file.
   - Rust value: small typed modules, deterministic tests, clear parity fixtures, lower CPU/memory overhead.

5. LLM judgment generation
   - Current hardening added six-hour cache, but public request flow can still perform generation on cache miss.
   - Rust/job value: cache-read public route, queued generation, duplicate suppression by ticker/model/prompt/payload hash.

## Keep Out Of Rust For Now

- UI components and chart rendering.
- Symbol autocomplete ranking unless `symbols.generated.json` becomes too large for Next route memory.
- yfinance fundamentals extraction until the Rust KIS path is stable; keep it behind an adapter and stale cache.
- Supabase migrations that already work, except the new refresh jobs table.

## Assumptions To Carry Forward

- Supabase remains the durable Postgres store.
- Redis or Valkey is allowed for production hot cache, locks, token cache, and provider coordination.
- Existing public JSON response shape stays stable in the first rewrite pass.
- Freshness favors stability over tick-level real time: serve fresh/stale cache first, refresh asynchronously when possible.
- Daily traffic target is 100k users, with validation focused on cached-read peak behavior and provider-call suppression.

## First Command Set Next Turn

```bash
git status --short --branch 2>&1 | head -c 4000
cargo --version 2>&1 | head -c 1000
mkdir -p services/market-data/src services/market-data/tests
```

After that, add the Rust `Cargo.toml`, health/auth/config modules, and run:

```bash
cargo fmt --check --manifest-path services/market-data/Cargo.toml
cargo test --manifest-path services/market-data/Cargo.toml
```
