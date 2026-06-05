# Demand-Driven Stock Cache Design

## Goal

Move stock data serving from prebuilt fixed snapshots to demand-driven shared snapshots that are created or refreshed when users actually view a stock.

## Product Rules

- Quote data, including current price and daily change, is fresh for 5 minutes during market hours.
- A manual quote refresh updates only quote data. It does not force score or analysis recalculation.
- Manual quote refresh has a 5 minute per-user cooldown, regardless of ticker.
- A successful manual quote refresh becomes the shared server quote snapshot for every user for the next 5 minutes.
- Score, judgment, and analysis data is fresh for 30 minutes during market hours.
- Financial statement snapshots are updated after a company releases earnings, normally on the next calendar day.
- The UI should show the latest known earnings release date, the reporting period covered, and the next earnings date when available. Estimated future dates must be marked as estimates.
- Industry benchmark data is updated once after the relevant after-market session has ended.
- Full industry classification and symbol metadata should not be refreshed daily. Daily work only updates newly listed and delisted symbols discovered during industry benchmark maintenance.
- Delisted symbols are hidden from search and display a delisted state when directly accessed.
- Newly listed symbols can display a newly listed pending state until quote/financial data exists.

## Architecture

The Next.js API remains the user-facing backend on Vercel. Supabase stores shared snapshots, refresh cooldowns, refresh leases, and long-lived reference data. External market data calls must be protected by Supabase-backed locks so that many concurrent users cannot fan out into many duplicate provider calls.

The main read path is read-through cache:

1. Read memory cache.
2. Read Supabase snapshot.
3. If fresh, return immediately.
4. If stale but still serveable, return stale data and request/perform one background refresh.
5. If missing, try one controlled refresh path. If a live refresh cannot run in the Vercel function, enqueue refresh work and return a pending response.

## Freshness Policy

| Data | Market open TTL | Closed/holiday TTL |
| --- | ---: | --- |
| Quote/current price/change | 5 minutes | Until next open after a close-confirmed snapshot |
| Score/analysis/judgment inputs | 30 minutes | Until next open after a close-confirmed snapshot |
| Financial statement snapshots | Event-driven | Stale until earnings-next-day refresh completes |
| Industry benchmarks | Daily after after-market | Until next daily maintenance |
| Symbol listing status | Daily delta during industry maintenance | Until next maintenance |

Closed/holiday extension must not turn an old intraday price into a next-day valid quote. A quote should only be extended through a closed session when it was fetched after the market close or when the data provider reports the latest bar date for the completed session.

## Refresh Protection

Two separate controls are required:

- Per-user manual refresh cooldown: 5 minutes, using the existing refresh user cookie and Supabase cooldown RPC.
- Per-target provider refresh lease: short global lock keyed by data kind, market, symbol, and view. This prevents many users from refreshing the same stale symbol concurrently.

If a user manually refreshes a quote while another refresh lease is active, the API should return the freshest available snapshot and still report the user cooldown. It should not call the provider again.

## Batch Job Role

GitHub Actions should no longer be responsible for constantly rebuilding a fixed ticker list as the primary strategy. Its useful work is:

- drain refresh jobs that could not be completed inline,
- warm yesterday's or recently popular symbols before/around market open,
- refresh close-confirmed quotes for popular symbols after close,
- update industry benchmarks once after after-market,
- update listing deltas for newly listed and delisted symbols,
- clean snapshots that have not been viewed for a retention window.

## Vercel/Supabase Constraints

- Vercel API routes should not depend on Python subprocess execution for the critical user-facing quote refresh path.
- Score generation can remain queued/background if it is too heavy for Vercel, but stale score data should be served when available.
- Supabase service role access must stay server-only.
- No secret values should be exposed through health endpoints, logs, or UI payloads.

## Acceptance Criteria

- Default quote TTL is 300 seconds.
- Default score TTL is 1800 seconds.
- Manual quote refresh uses a 300 second per-user cooldown.
- Manual quote refresh does not refresh score snapshots.
- Concurrent quote refreshes for the same symbol use one provider refresh lease.
- In Vercel snapshot runtime, stale quote/score data can still be served while a refresh is queued or leased.
- GitHub Actions no longer presents fixed-list prewarming as the primary cache strategy.
- README and env examples explain the demand-driven cache model.
