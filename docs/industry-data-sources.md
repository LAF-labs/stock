# Industry Classification Sources

## Goal

Industry classifications are seed data for rule-based valuation comparisons such as PER/PBR versus industry averages. They are not request-time data and should not be refreshed during a user request. The shared canonical taxonomy is Finviz's 144 industry groups with Korean display labels; both Korean and US raw provider industries map into this same taxonomy.

Daily jobs refresh valuation benchmarks. The Finviz canonical industry master can also be re-seeded safely because it is deterministic, while raw symbol classifications are still refreshed quarterly or when listing/delisting changes need to be absorbed. External provider benchmarks are preferred for overseas valuation comparisons; cached stock detail snapshots remain the domestic fallback and audit signal.

## Current Baseline

1. Korea: KIND listed-company bulk download
   - URL: `https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13`
   - Covers KOSPI, KOSDAQ, and KONEX listed companies in one EUC-KR HTML table labeled as Excel.
   - Useful columns: company name, market, symbol, industry, main products, listing date, fiscal month, CEO, homepage, region.
   - Current role: canonical KR industry source.

2. United States canonical taxonomy and external benchmarks: Finviz industry groups
   - URL: `https://finviz.com/groups.ashx?g=industry&v=120&o=name&st=d1`
   - Provides the 144 shared industry groups and valuation columns such as P/E, Fwd P/E, P/S, and P/B.
   - Current role: canonical US/KR comparison taxonomy and overseas external benchmark source.
   - Raw Finviz names stay in `name` / `provider_group_name`; Korean display labels stay in `canonical_industry_name` / benchmark `industry`.
   - Caveat: public website endpoint, not a formal redistributable data license. The workflow treats failures as non-blocking because snapshot-derived benchmark rows remain available.

3. United States symbol profile prefill: Nasdaq stock screener bulk endpoint
   - URL: `https://api.nasdaq.com/api/screener/stocks?tableonly=true&download=true`
   - Provides symbol, name, country, sector, industry, market cap fields, and Nasdaq URL.
   - Current role: practical US raw sector/industry prefill before mapping into the Finviz canonical taxonomy.
   - Caveat: public website endpoint, not a formal redistributable data license.

4. Symbol master
   - Local generated universe: `src/data/symbols.generated.json`.
   - Current role: universe seed and asset-class filtering. It should not be treated as an industry source.

## Operating Cadence

Quarterly or event-driven:

```bash
python scripts/sync_symbol_master.py
python scripts/run_industry_maintenance.py --seed-master --refresh-classifications
python scripts/seed_industry_taxonomy_map.py
python scripts/sync_canonical_industry_tags.py
```

Daily:

```bash
python scripts/run_industry_maintenance.py --refresh-benchmarks
python scripts/sync_external_industry_benchmarks.py
python scripts/industry_quality_audit.py --json
```

`sync_external_industry_benchmarks.py` fetches the all-industry Finviz page once, caches the HTML under `tmp/finviz-industry-groups-v120.html`, and reuses a fresh cache by default. If Finviz returns HTTP 429 and a cache exists, it uses the stale cache instead of retrying aggressively. If no usable cache exists but Supabase already has `source = finviz_industry` benchmark rows, the script falls back to those existing rows; use `--finviz-existing-benchmark-fallback-only` to skip Finviz entirely during a rate-limit window.

The benchmark lookup key is now scope-aware:

- `scope = KR` for domestic comparisons
- `scope = OVERSEAS` for overseas comparisons
- `period = quarter` by default, matching the current product comparison mode
- `canonical_industry_name` remains the user-facing comparison group and must be one of the Korean Finviz 144 display labels

Application requests read by `scope + canonical industry + metric + period` first, then fall back to legacy `market + industry + metric` rows during migrations or provider outages. KR and US stocks can share the same canonical industry label, but benchmark rows stay separated by `scope = KR` and `scope = OVERSEAS`.

User-facing valuation rows should describe these rows as averages, not as `기준`: use `업종 평균 PER` when the industry row is available, `섹터 평균 PER` when the lookup falls back to a sector aggregate, and `시장 평균 PER` when only the market aggregate is available. Existing cached rows with the old `업종 기준` label are normalized by the display enrichment step so duplicate benchmark rows are not shown during rollout.

## Benchmark Eligibility Rules

Industry-average PER/PBR is intended for single operating-company stocks. Do not attach industry-average rows to derivative-like or non-common-stock products:

- blocked `asset_class`: `etf`, `etn`, `etp`, `fund`, `mutual_fund`, `derivative`, `warrant`, `structured_product`, `preferred`, `spac`, `reit`, `other`
- blocked `instrument_type`: `ETF`, `ETN`, `ETP`, `ELW`, `FUND`, `MUTUAL_FUND`, `WARRANT`, `DERIVATIVE`, `STRUCTURED_PRODUCT`, `PREFERRED`, `PREF`, `SPAC`, `REIT`
- blocked name hints: `ETF`, `ETN`, `ETP`, `ELW`, `WARRANT`, `COVERED CALL`, `LEVERAGED`, `INVERSE`, `FUTURES`, `워런트`, `펀드`, `상장지수`, `레버리지`, `인버스`, `선물`, `파생`, `커버드콜`, `채권혼합`, `원자재`, `단일종목`

If a product is excluded by these rules, the app should omit industry-average valuation rows rather than falling back to a market average, because that would make a derivative or pass-through product look comparable to operating companies.

Run the audit report after taxonomy or profile updates. Treat these as review queues:

- `missing_primary_actionable_count`: listed `asset_class = stock` rows that still need a primary sector/industry.
- `missing_primary_exempt_count`: ETF/ETN/preferred/SPAC/REIT/other rows without a primary industry. These are excluded from single-stock industry PER/PBR comparison work.
- `unmapped_source_keys`: add or correct `industry_taxonomy_map` rows.
- `small_groups`: decide whether the group is genuinely narrow or should be merged into a broader canonical industry before using it for PER/PBR judgment.
- `similar_groups`: inspect names that normalize to the same key, such as manufacturing suffix variants.

Latest preview audit after pagination and taxonomy cleanup:

- recorded_at: 2026-06-12
- environment: preview Supabase data after Finviz canonical taxonomy cleanup
- owner: data/operations maintainer
- cadence: refresh this snapshot after quarterly classification maintenance or after a material taxonomy migration

- active profiles: 16,862
- missing primary industry: 8,378 total, 0 actionable stock rows, 8,378 exempt non-stock rows
- unmapped source keys: 0
- canonical groups: 111
- small groups below 8 samples: refresh from the full JSON audit when reviewing benchmark sample quality
- similar groups: 0

Manual fallback only:

```bash
python scripts/run_industry_maintenance.py --run-yfinance-fallback --lane KR:KOSPI:50 --lane KR:KOSDAQ:50
python scripts/seed_industry_taxonomy_map.py
python scripts/sync_canonical_industry_tags.py
```

## Korean Display And Canonical Groups

Raw provider classifications stay in `stock_symbol_profiles.primary_sector` and `primary_industry`. Korean display names and shared Finviz comparison groups live in `industry_taxonomy_map` with:

- `taxonomy = profile_primary`
- `source_key = MARKET:primary_sector_key:primary_industry_key`
- `canonical_sector_name` and `canonical_industry_name` as the display/comparison labels

The application and benchmark refresh RPC prefer symbol-level `stock_symbol_industry_tags` rows with `taxonomy = finviz_canonical`, then fall back to this source-key map. This lets coarse Korean source industries such as `소프트웨어 개발 및 공급업` split into product-specific Finviz groups such as `게임·멀티미디어` when `kind_main_products` is clear. For example, US `Semiconductors` and Korean `반도체 제조업` both map to `정보기술 / 반도체`; their benchmark medians remain separate because KR rows use `scope = KR` and Finviz rows use `scope = OVERSEAS`.

## Future Source Candidates

- FnGuide/TICS: best domestic match for Toss-like category comparisons, but requires a licensed feed or approved redistribution path.
- SEC EDGAR company tickers plus submissions bulk ZIP: legally safer US SIC foundation, but maps to SIC rather than market-friendly sectors.
- NasdaqTrader symbol directory: authoritative active US universe, but no industry classification.
- KRX Data Marketplace industry classification status: official trade-date data, but direct OTP access currently needs more session handling.
- TradingView Korea scanner: convenient English sector/industry JSON, but high license/redistribution risk.
- WiseIndex/FnGuide WICS: useful portfolio taxonomy, but redistribution risk is high.
- Open PermID: strong global taxonomy candidate, but registration, RDF parsing, and license constraints make it a later integration.
