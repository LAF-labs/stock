# Score System Operations

## Current Model

- Current score model: `score-v5-dual-quality-opportunity-2026-06-05`
- The public `score` remains a backward-compatible alias for `quality_score`.
- The model now exposes two separate scores:
  - `quality_score`: profitability, growth, health, momentum, valuation.
  - `opportunity_score`: momentum setup, estimated growth, analyst/target upside, liquidity attention, risk control.
- Domestic scores enrich KIS price/quote data with cached yfinance fundamentals (`.KS`/`.KQ`) when available. This adds margins, growth, leverage, liquidity ratios, Forward PER, and EV/Revenue without making every request depend on a fresh Yahoo call.
- Missing factor inputs are not filled with a neutral-looking score. They lower factor confidence, and the final score is pulled toward 50 when coverage is weak.
- Expensive valuation is still penalized, but high profitability and growth can partially moderate the valuation penalty. This prevents premium compounders from being scored like distressed stocks only because headline multiples are high.
- Quality weights are profitability 24%, growth 22%, health 18%, valuation 22%, momentum 14%. Momentum is intentionally a supporting signal, not the main path to a high quality score.
- Opportunity weights are momentum 30%, estimated growth 25%, analyst/target upside 20%, liquidity attention 15%, risk control 10%. Missing opportunity inputs reduce confidence and anchor the final opportunity score toward 50.
- If Forward PER is unavailable, weak-profitability growth stories with expensive EV/Revenue or Price/Sales are capped on valuation and carry lower confidence.
- The rule-based judgment layer is separate from the numeric score. It prefers Forward PER benchmarks before trailing PER, then can fall back to PER, EV/Revenue, Price/Sales, or PBR for valuation explanation.

## Migration And Cache Rollout

Apply all Supabase migrations, including:

```text
supabase/migrations/20260605172000_score_model_version_snapshots.sql
```

This adds a generated `stock_score_snapshots.score_model_version` column from the cached JSON payload. It is for audits, cleanup, and rollout checks; application writes still store the public payload JSON.

The Next score cache rejects snapshots whose payload version is not the current model. This is intentional. After a model change, old memory and Supabase score snapshots should miss and be recomputed instead of being served as stale scores.

Useful rollout query:

```sql
select score_model_version, count(*) as snapshots, max(fetched_at) as newest_snapshot
from public.stock_score_snapshots
group by score_model_version
order by newest_snapshot desc;
```

Optional cleanup after the v5 model has been live long enough:

```sql
delete from public.stock_score_snapshots
where score_model_version <> 'score-v5-dual-quality-opportunity-2026-06-05';
```

## Daily Operation

Run the guardrail smoke check after deployment and at least once per trading day:

```bash
npm run score:smoke
```

Local venv example:

```bash
PYTHON_BIN=.venv/bin/python npm run score:smoke
```

Run the operations report before and after material score/worker changes:

```bash
npm run ops:report
node --import tsx scripts/stock_operations_report.ts --sample-limit 500 --json
```

The report checks the refresh queue backlog, dead jobs, stale running jobs, score model rollout, stale score snapshots, technical snapshot coverage, quote freshness, industry benchmark expiry, market-calendar coverage, low-confidence high scores, rounded score duplicate buckets, and the Rust `market-data` service when `MARKET_DATA_SERVICE_URL` plus `MARKET_DATA_INTERNAL_TOKEN` are configured. Use this before recalibrating thresholds so score changes are judged by distribution and coverage, not by one ticker.

Before a manual Vercel preview deployment, run the Supabase readiness check. The deploy script also runs it before uploading:

```bash
npm run supabase:readiness
```

For Vercel + Supabase production, set the public app runtime to snapshot-only:

```text
STOCK_DATA_RUNTIME=snapshot
```

Run an always-on snapshot worker outside Vercel as the primary queue drain. The worker reads Supabase `stock_refresh_jobs`, claims quote/chart lanes independently, and keeps running until the process is stopped:

```bash
npm run snapshots:worker
```

Default worker lanes are `quote,chart`. To also drain detail/compare/technical score jobs with the current Python collector fallback, run the worker with explicit fallback enabled:

```bash
STOCK_SNAPSHOT_ALLOW_SCORE_FALLBACK=1 npm run snapshots:worker -- --lanes quote,chart,score --allow-score-python-fallback
```

For a one-pass local check:

```bash
npm run snapshots:worker -- --once --lanes quote,chart --queue-limit 5
```

The bundled GitHub Actions queue workflow is now a backstop, not the primary drain. Keep it enabled to catch host outages, but user-visible pending time should be governed by the always-on worker cadence. The worker calls `stock_runtime_readiness` before every pass, uses kind-specific claims, and lets quote/chart/score lanes fail independently so a KIS quote issue does not stop due chart or score jobs. Configure these secrets wherever the always-on worker runs:

```text
STOCK_API_APP_KEY
STOCK_API_APP_SECRET
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

Relevant repository variables:

```text
STOCK_SNAPSHOT_QUEUE_LIMIT=50
STOCK_SNAPSHOT_WORKER_IDLE_MS=4000
STOCK_SNAPSHOT_WORKER_LANE_SLEEP_MS=250
STOCK_SNAPSHOT_ALLOW_SCORE_FALLBACK=1
MARKET_DATA_SERVICE_URL=https://market-data.internal
```

When `MARKET_DATA_SERVICE_URL` is set, also configure secret `MARKET_DATA_INTERNAL_TOKEN`. CI builds the `market-data` Docker target and smokes `/healthz`, authenticated `/readyz`, and authenticated `/metrics`; the scheduled operations workflow includes the same service in its report. `/readyz` reports active backend modes and deliberately shows `durable_refresh_available=false` for score refresh until Rust owns durable score snapshots end to end.

Quote semantics shared across Next and Rust are owned by `shared/quote-contract.json`. It defines domestic KIS market division `UN`, domestic exchange label `KRX/NXT`, US fallback order `NAS` -> `NYS` -> `AMS`, and the default quote cache windows. Do not tune the Rust quote TTL or domestic provider label separately from that file.

Use the read-only operations check before release and after score model changes:

```bash
npm run ops:check
```

`ops:check` fails on dead refresh jobs, stale running jobs, excessive backlog, stale score model versions, duplicate-score drift, missing quote prices, expired industry benchmarks, thin market calendars, or configured `market-data` health/metrics failures. `freshness_risks` is separate from `thresholds`: dormant quote snapshots can be stale in a demand-driven cache, so stale quote rate and old due queue age are surfaced as warnings even when the threshold gate passes. Rust `market-data` metrics include bounded memory cache sizes/capacities, refresh queue depth/capacity, cache event counters, provider request count, and provider error counts by stable class.

Run the stock latency gate against a built server before production deployment:

```bash
npm run build
STOCK_RATE_LIMIT_SECRET=local_load_test_secret_32_chars_minimum STOCK_ALLOW_MEMORY_GUARD_FALLBACK=1 npm run start -- -p 3002
npm run load:test:stock-latency -- --base-url http://localhost:3002 --iterations 1
```

The latency gate hits hot detail, cold detail, hot technical, cold technical, and mixed compare API paths with `partial=1`. It fails on non-2xx responses and on explicit request-path provider execution markers. Use the p95 and per-scenario rows to decide whether the always-on worker is draining quickly enough; cold technical pending responses above a few seconds usually mean eligibility/profile lookup, Supabase readiness, or chart/technical queue creation is still too slow.

Technical analysis snapshots use `view_mode='technical'` in the same score snapshot table. They are counted separately in `score_calibration.technical_snapshots`, `score_calibration.stale_technical_snapshots`, and `score_calibration.missing_technical_payload_count` because the compact technical payload may not contain the root quality/opportunity score fields used by score calibration. Score distribution and duplicate-score rates use `score_calibration.score_snapshot_count`, so technical rows cannot dilute calibration drift. After the technical-analysis release flag is enabled, add `--max-missing-technical-payloads 0` to the release gate or scheduled ops check. Before that flag is enabled, keep it as an observation metric only.

The package `ops:check` script includes `--max-market-data-service-failures 0`, so release checks require `MARKET_DATA_SERVICE_URL` and `MARKET_DATA_INTERNAL_TOKEN`. Use `npm run ops:report` for Supabase-only observation, or run the market-data Docker target locally before `ops:check`.

Current release gate values:

| Threshold key | Field | Gate |
| --- | --- | ---: |
| `max_dead_refresh_jobs` | `refresh_queue.dead_jobs` | `0` |
| `max_stale_running_refresh_jobs` | `refresh_queue.stale_running_jobs` | `0` |
| `max_queued_refresh_jobs` | `refresh_queue.queued_jobs` | `1000` |
| `max_stale_score_snapshots` | `score_calibration.stale_snapshots` | `100` |
| `min_current_score_model_rate` | `score_calibration.current_model_rate` | `0.9` |
| `max_duplicate_score_rate` | `score_calibration.duplicate_score_rate` | `0.5` |
| `max_low_confidence_high_score` | `score_calibration.low_confidence_high_score_count` | `0` |
| `max_missing_technical_payloads` | `score_calibration.missing_technical_payload_count` | enable at `0` after technical-analysis rollout |
| `max_missing_quote_price` | `quote_freshness.missing_price_count` | `25` |
| `max_expired_industry_benchmark_rows` | `industry_benchmarks.expired_rows` | `0` |
| `max_market_calendar_thin_markets` | `market_calendar.missing_or_thin_markets` | `0` |
| `max_market_data_service_failures` | `market_data_service.failure_count` | `0` |

Freshness warning cutoffs:

| Warning key | Medium | High | First response |
| --- | ---: | ---: | --- |
| `quote_stale_rate` | `>= 0.75` | `>= 0.95` | Check quote provider errors, queue drain cadence, and hot ticker coverage |
| `refresh_queue_due_age` | `> 60m` | `> 240m` | Check scheduled workflow, worker preflight, and Supabase RPC/table readiness |

Queue-drain workers call `stock_runtime_readiness` before claiming jobs. If a required table or RPC is missing, the worker exits before it locks refresh jobs. Keep `npm run supabase:readiness` in deployment preflight and use `npm run ops:check` after migrations to confirm runtime health.

Configure repository variable `STOCK_SNAPSHOT_TICKERS` for the prewarm set. Keep it focused on search/autocomplete hot names, top domestic names, and comparison defaults. Do not try to refresh every listed symbol every 5 minutes.

The default smoke set is `NVDA`, `TSLA`, `IONQ`, `MRVL`, `005930`, `000660`, `253590`. It checks:

- every score is finite and in `0..100`
- `quality_score` and `opportunity_score` are finite and in `0..100`
- every confidence is in `0..1`
- `opportunity_confidence` is in `0..1`
- payload score model version matches the application version
- low-confidence names do not get aggressive high scores
- NVDA-like premium growth leaders stay above the configured minimum, default `80`

Industry valuation benchmark refresh runs once per day through `.github/workflows/maintain-industry-benchmarks.yml`, after the US regular/after-hours window. Benchmark rows expire at the next relevant market close plus a maintenance grace window, so Friday/holiday refreshes remain usable until the next trading session can be refreshed. Snapshot-derived benchmarks run before external provider sync; Finviz/provider failures should not block the snapshot fallback from refreshing. Run the workflow manually only when validating a migration or recovering data:

```bash
python scripts/sync_market_calendar.py --days 550
python scripts/sync_external_industry_benchmarks.py
python scripts/run_industry_maintenance.py --refresh-benchmarks
python scripts/industry_quality_audit.py --json
```

Classification data should not be refreshed daily. Refresh classifications quarterly, or when a listing/delisting/data-source change makes it necessary.

## Efficient Serving Strategy

- Serve score reads from memory first, then Supabase snapshots. In Vercel snapshot mode, never invoke Python from a request handler.
- Vercel fails closed to snapshot mode. `STOCK_DATA_RUNTIME=python` is ignored on Vercel unless `STOCK_ALLOW_VERCEL_PYTHON_RUNTIME=1` is explicitly set for a one-off emergency.
- If a Supabase snapshot is missing in snapshot mode, enqueue `stock_refresh_jobs` and return `snapshot_pending` with `Retry-After`. Score snapshot misses default to a 5-second retry hint via `STOCK_SCORE_MISS_RETRY_AFTER_SECONDS` so the UI can pick up quickly drained user-visible jobs. Generic queue pending remains 300 seconds via `STOCK_REFRESH_QUEUE_RETRY_AFTER_SECONDS` for slower backstop work.
- Technical score collection should reuse its `chart_series` as a chart snapshot when available. The chart queue still drains as an independent, bounded backstop after score drain, so the system avoids duplicate provider calls when technical score already produced the chart.
- Pending partial responses may read existing chart snapshots, but should not enqueue a separate chart job for the same technical score miss. The technical score job owns first collection; the chart backstop re-checks freshness before calling the collector.
- For stale quote snapshots, prefer one refresh path. If inline KIS/market-data refresh is available, serve stale immediately and refresh inline instead of also enqueueing a queued stale backstop.
- Technical analysis is available on demand for every eligible single stock. Do not gate product eligibility by a warmup list or popularity list. The detail-page CTA and `/technical` route block ETFs, ETNs, leveraged/inverse wrappers, warrants, funds, and other derivative-like products; eligible single stocks enqueue `view_mode='technical'` snapshots when missing.
- Technical analysis collection must use the technical fast path. It should fetch daily chart rows and minimal identity data only; yfinance fundamentals, news, analyst data, and broad KIS search/detail enrichment belong to detail/compare or background jobs.
- KIS token caches are shared through `kis_access_tokens`. If KIS returns an expired-token response even though the cached expiry looks fresh, the Node quote worker and Python score worker invalidate the local/shared token cache and retry the provider call once with a newly issued token.
- Newly listed eligible stocks should still render the technical page. The rule engine downgrades the page to a limited/starter interpretation and warns users that only the available daily bars were used.
- The detail UI displays score `server_cache` freshness separately from quote refresh status. A fresh quote does not imply a fresh score; stale score snapshots should stay visible until the score worker writes a new snapshot.
- In local/Docker mode, `STOCK_DATA_RUNTIME=python` keeps the Python collector fallback available for development and container deployments.
- Keep score detail/compare snapshots fresh for 30 minutes during market hours. The publisher default `STOCK_SCORE_SNAPSHOT_EXPIRES_SECONDS` is 1800.
- Keep `market_calendar` seeded ahead for both `US` and `KR`. The publisher extends quote and score expiry to the next open when the market is closed, so stale/off-hours behavior depends on this table.
- Keep rule-based judgment cache in six-hour buckets.
- Keep yfinance fundamentals in the shared fundamental snapshot cache with field-class expiry. Statement-like fields such as revenue, margins, cash flow, debt, and liquidity ratios can remain stale-serveable for up to 180 days; market-ratio, analyst, and liquidity-market fields expire sooner, currently 30 days stale. Production snapshot serving should set `STOCK_YFINANCE_REQUEST_FETCH=0`, or rely on the Vercel/snapshot default, so user requests never call Yahoo on cache miss. Scheduled enrichment jobs may opt in with `STOCK_YFINANCE_REQUEST_FETCH=1` and bounded worker concurrency.
- yfinance fundamental cache version `2` includes target price, analyst count, recommendation mean, beta, and average volume fields for opportunity scoring.
- Prewarm only a small hot set: major US names, top domestic names, and symbols currently shown in comparisons. Expand the set using search logs and `snapshot_unavailable` logs, not by refreshing the whole universe on every interval. Prewarm lists are operational acceleration only; they must never define which single stocks can use technical analysis.
- Keep industry benchmark calculation offline. Request handlers should only read benchmark rows.
- Prefer Rust `market-data` for long-term serving. Python collector should remain a score fallback until Rust owns score, batch, and refresh jobs end to end. Keep `MARKET_DATA_SERVICE_ENABLE_SCORE=0` until the durable score refresh/cache path is present and reflected in `/readyz`, `/metrics`, and ops reports.

## Known Deployment Constraints

- Production CSP currently allows `script-src 'unsafe-inline'` and `style-src 'unsafe-inline'` for Next runtime compatibility. Treat this as a documented defense-in-depth gap; removing it needs nonce/hash support and a verified Next deployment path.
- `script-src 'unsafe-eval'` is development-only. It must not appear in production headers.
- Vercel fail-closes to snapshot mode. `STOCK_DATA_RUNTIME=python` is ignored on Vercel unless `STOCK_ALLOW_VERCEL_PYTHON_RUNTIME=1` is explicitly set for an emergency.
- Vercel must not point `MARKET_DATA_SERVICE_URL` at localhost. Use a reachable service URL/token pair or leave Rust service integration disabled for that environment.
- Public Supabase reads should use `SUPABASE_PUBLISHABLE_KEY`. Production service-role fallback for reads requires an explicit unsafe override; `SUPABASE_SERVICE_ROLE_KEY` remains server-only for writes, queue claims, and cache persistence.
- Rust `market-data` uses bounded memory cache/queue unless a durable backend is configured. Do not infer durable score refresh from `REDIS_URL`; `/readyz` is the source of truth for active backend modes and `durable_refresh_available`.

Before enabling the technical-analysis CTA in production, apply `supabase/migrations/20260607093000_technical_analysis_score_view.sql` and run:

```bash
npm run ops:check
```

The default gate includes `--max-missing-technical-payloads 0`, so an unapplied `view_mode='technical'` migration or malformed technical snapshot blocks release instead of silently causing repeated provider work.

## Calibration Rules

Recalibrate only with a version bump. A score model change must include:

- updated `SCORE_MODEL_VERSION` in TS, Python, and Rust
- regression tests for premium growth leaders, sparse data, and weak/high-risk names
- smoke check output before deploy
- a short note explaining whether the change affects cached score snapshots

Do not tune thresholds for one ticker unless the change also makes sense for a category of companies and passes the smoke set.
