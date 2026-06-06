# Score Data Enrichment Review

## Decision

The highest-return improvement available now is to enrich domestic KIS score payloads with cached yfinance fundamentals.

KIS remains the serving source for domestic quotes, prices, chart rows, trading status, and stock identity. yfinance is used only for slower-moving fundamentals by Yahoo symbols derived from exchange:

- KOSPI: `005930.KS`
- KOSDAQ/KONEX: `253590.KQ`
- `Q`-prefixed domestic input is normalized before suffixing.

The request path is still cache-first. Fundamentals are read from Supabase/file cache, refreshed under lock only on miss, and can serve stale values during provider errors.

## Sources Reviewed

- yfinance: exposes `Ticker.info`, financial statements, cash flow, balance sheet, estimates, valuation, and sector/industry interfaces.
- OpenDART: official DART Open API exposes original disclosures, periodic-report financial information, and high-volume quarterly financial statement downloads.
- Microsoft Qlib: MIT-licensed quant research platform; useful pattern is keeping alpha/factor datasets separate from model/scoring workflows.
- FinRL: MIT-licensed research framework; useful pattern is decoupling data processors, strategy/scoring logic, and evaluation/backtest layers.

No external code was copied.

## Implemented Now

- Score model version bumped to `score-v5-dual-quality-opportunity-2026-06-05`.
- Domestic collector maps Korean symbols to `.KS`/`.KQ` yfinance symbols.
- Domestic score now uses available margins, ROE fallback, revenue/earnings growth, operating cash flow margin, debt/equity, current/quick ratios, Forward PER, EV/Revenue, and Price/Sales.
- V4 valuation guardrails reduce confidence and cap valuation for names with no Forward PER, weak profitability or cash flow, and expensive sales multiples.
- V5 adds a separate opportunity score using target price, analyst count, recommendation mean, beta, momentum, liquidity, and risk caps without changing the meaning of the quality score.
- Domestic payload exposes `financial_statement.yfinance_fundamentals` with source symbol, cache state, and raw cached fields.
- Rust score engine now applies the same domestic enriched-factor weights when those inputs are supplied.
- Rule-based judgment now explains Forward PER against industry benchmarks before trailing PER/PBR when benchmark rows are available.
- Smoke set now includes major US and domestic names: `NVDA`, `TSLA`, `IONQ`, `MRVL`, `005930`, `000660`, `253590`.

## Next Accuracy Upgrades

1. Add OpenDART as the authoritative domestic financial-statement batch source once an API key is available.
2. Build a quarterly domestic fundamentals batch job that stores audited revenue, operating income, net income, equity, assets, debt, cash, operating cash flow, and free cash flow by stock code.
3. Keep yfinance as a fallback and cross-check source, not as the only long-term domestic accounting source.
4. Add score calibration reports by market and industry: distribution, ties, missing-field rate, factor correlations, and representative ticker snapshots.
5. Add benchmark comparison fields from industry medians, but keep them as factor context and rule-based judgment inputs until enough history exists to calibrate core score impact.

## Ownership And Exit Criteria

- Owner: data/score maintainer.
- Review cadence: revisit after each score model version bump and at least quarterly after industry classification maintenance.
- OpenDART exit criteria: API key available, quarterly batch job writes audited domestic fundamentals to Supabase, yfinance fallback path remains covered by tests, and `npm run score:smoke` passes for the domestic smoke set.
- Calibration exit criteria: report by market/industry includes score distribution, tie rate, missing-field rate, confidence distribution, and representative ticker diffs before any score threshold or weight change ships.
- Rust parity exit criteria: TypeScript/Python/Rust score payloads share the same `SCORE_MODEL_VERSION`, golden guardrails pass, and market-data `/readyz` reports durable score refresh only after score snapshot writes are owned outside the legacy Python worker.
