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

For Vercel + Supabase production, set the public app runtime to snapshot-only:

```text
STOCK_DATA_RUNTIME=snapshot
```

Then publish hot quote/score snapshots from GitHub Actions, a local admin machine, or another worker that can safely run Python dependencies:

```bash
python scripts/publish_stock_snapshots.py --tickers NVDA,TSLA,KO,MRVL,005930,000660 --json
```

The bundled GitHub Actions workflow runs on weekdays every 30 minutes. Configure these repository secrets:

```text
STOCK_API_APP_KEY
STOCK_API_APP_SECRET
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

Configure repository variable `STOCK_SNAPSHOT_TICKERS` for the prewarm set. Keep it focused on search/autocomplete hot names, top domestic names, and comparison defaults. Do not try to refresh every listed symbol every 30 minutes.

The default smoke set is `NVDA`, `TSLA`, `IONQ`, `MVRL`, `005930`, `000660`, `253590`. It checks:

- every score is finite and in `0..100`
- `quality_score` and `opportunity_score` are finite and in `0..100`
- every confidence is in `0..1`
- `opportunity_confidence` is in `0..1`
- payload score model version matches the application version
- low-confidence names do not get aggressive high scores
- NVDA-like premium growth leaders stay above the configured minimum, default `80`

Run industry valuation benchmark refresh once per day, not on every user request:

```bash
python scripts/run_industry_maintenance.py --refresh-benchmarks
```

Classification data should not be refreshed daily. Refresh classifications quarterly, or when a listing/delisting/data-source change makes it necessary.

## Efficient Serving Strategy

- Serve score reads from memory first, then Supabase snapshots. In Vercel snapshot mode, never invoke Python from a request handler.
- If a Supabase snapshot is missing in snapshot mode, return `snapshot_unavailable` with HTTP 503. That is an ingestion/prewarm issue, not a public API collector outage.
- In local/Docker mode, `STOCK_DATA_RUNTIME=python` keeps the Python collector fallback available for development and container deployments.
- Keep score detail cache hour-level during market hours and serve stale only for short recovery windows.
- Keep rule-based judgment cache in six-hour buckets.
- Keep yfinance fundamentals in the shared fundamental snapshot cache. The default fresh window is 12 hours with stale fallback up to 7 days; user requests should read cache first and refresh under a file lock only on miss.
- yfinance fundamental cache version `2` includes target price, analyst count, recommendation mean, beta, and average volume fields for opportunity scoring.
- Prewarm only a small hot set: major US names, top domestic names, and symbols currently shown in comparisons. Expand the set using search logs and `snapshot_unavailable` logs, not by refreshing the whole universe on every interval.
- Keep industry benchmark calculation offline. Request handlers should only read benchmark rows.
- Prefer Rust `market-data` for long-term serving. Python collector should remain a fallback until Rust owns quote, score, batch, and refresh jobs end to end.

## Calibration Rules

Recalibrate only with a version bump. A score model change must include:

- updated `SCORE_MODEL_VERSION` in TS, Python, and Rust
- regression tests for premium growth leaders, sparse data, and weak/high-risk names
- smoke check output before deploy
- a short note explaining whether the change affects cached score snapshots

Do not tune thresholds for one ticker unless the change also makes sense for a category of companies and passes the smoke set.
