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

The report checks the refresh queue backlog, dead jobs, stale running jobs, score model rollout, stale score snapshots, quote freshness, industry benchmark expiry, market-calendar coverage, low-confidence high scores, rounded score duplicate buckets, and the Rust `market-data` service when `MARKET_DATA_SERVICE_URL` plus `MARKET_DATA_INTERNAL_TOKEN` are configured. Use this before recalibrating thresholds so score changes are judged by distribution and coverage, not by one ticker.

Before a manual Vercel preview deployment, run the Supabase readiness check. The deploy script also runs it before uploading:

```bash
npm run supabase:readiness
```

For Vercel + Supabase production, set the public app runtime to snapshot-only:

```text
STOCK_DATA_RUNTIME=snapshot
```

Then drain quote snapshots through the TypeScript worker and legacy score snapshots through the Python score worker:

```bash
node --import tsx scripts/publish_stock_snapshots.ts --tickers NVDA,TSLA,KO,MRVL,005930,000660 --drain-queue --kind quote --queue-limit 50 --json
python scripts/publish_stock_snapshots.py --tickers NVDA,TSLA,KO,MRVL,005930,000660 --queue-kind score --json
```

The bundled GitHub Actions queue worker runs every 5 minutes on weekdays and every 30 minutes on weekends. It drains user-driven refresh jobs and uses workflow concurrency to avoid overlapping provider bursts. Quote jobs are drained by the TypeScript worker. Score jobs remain on the kind-filtered legacy Python worker until the durable Rust/TypeScript score worker owns score snapshot writes, but Python setup/install is skipped unless due score jobs or workflow_dispatch manual tickers exist. Configure these repository secrets:

```text
STOCK_API_APP_KEY
STOCK_API_APP_SECRET
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

Relevant repository variables:

```text
STOCK_SNAPSHOT_QUEUE_LIMIT=50
STOCK_SNAPSHOT_SLEEP_SECONDS=0.5
STOCK_LEGACY_SCORE_WORKER_ENABLED=1
MARKET_DATA_SERVICE_URL=https://market-data.internal
```

When `MARKET_DATA_SERVICE_URL` is set, also configure secret `MARKET_DATA_INTERNAL_TOKEN`. CI builds the `market-data` Docker target and smokes `/healthz`, authenticated `/readyz`, and authenticated `/metrics`; the scheduled operations workflow includes the same service in its report. `/readyz` reports active backend modes and deliberately shows `durable_refresh_available=false` for score refresh until Rust owns durable score snapshots end to end.

Use the read-only operations check before release and after score model changes:

```bash
npm run ops:check
```

`ops:check` fails on dead refresh jobs, stale running jobs, excessive backlog, stale score model versions, duplicate-score drift, missing quote prices, expired industry benchmarks, thin market calendars, or configured `market-data` health/metrics failures. `freshness_risks` is separate from `thresholds`: dormant quote snapshots can be stale in a demand-driven cache, so stale quote rate and old due queue age are surfaced as warnings even when the threshold gate passes. Rust `market-data` metrics include bounded memory cache sizes/capacities, refresh queue depth/capacity, cache event counters, provider request count, and provider error counts by stable class.

The package `ops:check` script includes `--max-market-data-service-failures 0`, so release checks require `MARKET_DATA_SERVICE_URL` and `MARKET_DATA_INTERNAL_TOKEN`. Use `npm run ops:report` for Supabase-only observation, or run the market-data Docker target locally before `ops:check`.

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

Industry valuation benchmark refresh runs once per day through `.github/workflows/maintain-industry-benchmarks.yml`, after the US regular/after-hours window. Run it manually only when validating a migration or recovering data:

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
- If a Supabase snapshot is missing in snapshot mode, enqueue `stock_refresh_jobs` and return `snapshot_pending` with `Retry-After`. The default retry hint is 300 seconds, matching the 5-minute GitHub Actions backstop. Tune it with `STOCK_REFRESH_QUEUE_RETRY_AFTER_SECONDS` if a faster external worker is configured.
- In local/Docker mode, `STOCK_DATA_RUNTIME=python` keeps the Python collector fallback available for development and container deployments.
- Keep score detail/compare snapshots fresh for 30 minutes during market hours. The publisher default `STOCK_SCORE_SNAPSHOT_EXPIRES_SECONDS` is 1800.
- Keep `market_calendar` seeded ahead for both `US` and `KR`. The publisher extends quote and score expiry to the next open when the market is closed, so stale/off-hours behavior depends on this table.
- Keep rule-based judgment cache in six-hour buckets.
- Keep yfinance fundamentals in the shared fundamental snapshot cache. The default fresh window is 12 hours with stale fallback up to 7 days; user requests should read cache first and refresh under a file lock only on miss.
- yfinance fundamental cache version `2` includes target price, analyst count, recommendation mean, beta, and average volume fields for opportunity scoring.
- Prewarm only a small hot set: major US names, top domestic names, and symbols currently shown in comparisons. Expand the set using search logs and `snapshot_unavailable` logs, not by refreshing the whole universe on every interval.
- Keep industry benchmark calculation offline. Request handlers should only read benchmark rows.
- Prefer Rust `market-data` for long-term serving. Python collector should remain a score fallback until Rust owns score, batch, and refresh jobs end to end. Keep `MARKET_DATA_SERVICE_ENABLE_SCORE=0` until the durable score refresh/cache path is present and reflected in `/readyz`, `/metrics`, and ops reports.

## Calibration Rules

Recalibrate only with a version bump. A score model change must include:

- updated `SCORE_MODEL_VERSION` in TS, Python, and Rust
- regression tests for premium growth leaders, sparse data, and weak/high-risk names
- smoke check output before deploy
- a short note explaining whether the change affects cached score snapshots

Do not tune thresholds for one ticker unless the change also makes sense for a category of companies and passes the smoke set.
