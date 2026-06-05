# Industry Classification Sources

## Goal

Industry classifications are seed data for rule-based valuation comparisons such as PER/PBR versus industry averages. They are not request-time data and should not be refreshed daily. Refresh the classification master on initial setup, then quarterly or when listing/delisting changes need to be absorbed.

Daily jobs should refresh valuation benchmarks, not the industry master. External provider benchmarks are preferred for valuation comparisons; cached stock detail snapshots remain a fallback and audit signal.

## Current Baseline

1. Korea: KIND listed-company bulk download
   - URL: `https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13`
   - Covers KOSPI, KOSDAQ, and KONEX listed companies in one EUC-KR HTML table labeled as Excel.
   - Useful columns: company name, market, symbol, industry, main products, listing date, fiscal month, CEO, homepage, region.
   - Current role: canonical KR industry source.

2. United States: Nasdaq stock screener bulk endpoint
   - URL: `https://api.nasdaq.com/api/screener/stocks?tableonly=true&download=true`
   - Provides symbol, name, country, sector, industry, market cap fields, and Nasdaq URL.
   - Current role: practical US sector/industry prefill.
   - Caveat: public website endpoint, not a formal redistributable data license.

3. Symbol master
   - Local generated universe: `src/data/symbols.generated.json`.
   - Current role: universe seed and asset-class filtering. It should not be treated as an industry source.

## Operating Cadence

Quarterly or event-driven:

```bash
python scripts/sync_symbol_master.py
python scripts/run_industry_maintenance.py --seed-master --refresh-classifications
python scripts/seed_industry_taxonomy_map.py
```

Daily:

```bash
python scripts/run_industry_maintenance.py --refresh-benchmarks
python scripts/sync_external_industry_benchmarks.py
python scripts/industry_quality_audit.py --json
```

The benchmark lookup key is now scope-aware:

- `scope = KR` for domestic comparisons
- `scope = OVERSEAS` for overseas comparisons
- `period = quarter` by default, matching the current product comparison mode
- `canonical_industry_name` remains the user-facing comparison group

Application requests should read by `scope + canonical industry + metric + period` first, then fall back to legacy `market + industry + metric` rows during migrations or provider outages.

Run the audit report after taxonomy or profile updates. Treat these as review queues:

- `missing_primary_actionable_count`: listed `asset_class = stock` rows that still need a primary sector/industry.
- `missing_primary_exempt_count`: ETF/ETN/preferred/SPAC/REIT/other rows without a primary industry. These are excluded from single-stock industry PER/PBR comparison work.
- `unmapped_source_keys`: add or correct `industry_taxonomy_map` rows.
- `small_groups`: decide whether the group is genuinely narrow or should be merged into a broader canonical industry before using it for PER/PBR judgment.
- `similar_groups`: inspect names that normalize to the same key, such as manufacturing suffix variants.

Latest preview audit after pagination and taxonomy cleanup:

- active profiles: 16,861
- missing primary industry: 8,384 total, 7 actionable stock rows, 8,377 exempt non-stock rows
- unmapped source keys: 1 (`US:energy:energy`)
- canonical groups: 317
- small groups below 8 samples: 163
- similar groups: 0

Manual fallback only:

```bash
python scripts/run_industry_maintenance.py --run-yfinance-fallback --lane KR:KOSPI:50 --lane KR:KOSDAQ:50
python scripts/seed_industry_taxonomy_map.py
```

## Korean Display And Canonical Groups

Raw provider classifications stay in `stock_symbol_profiles.primary_sector` and `primary_industry`. Korean display names and merged comparison groups live in `industry_taxonomy_map` with:

- `taxonomy = profile_primary`
- `source_key = MARKET:primary_sector_key:primary_industry_key`
- `canonical_sector_name` and `canonical_industry_name` as the display/comparison labels

The application uses this map to show Korean sector/industry labels and to build rule-based comparison payloads. The benchmark refresh RPC also uses the same map, so PER/PBR averages are grouped by canonical industry instead of every provider-specific raw label.

## Future Source Candidates

- FnGuide/TICS: best domestic match for Toss-like category comparisons, but requires a licensed feed or approved redistribution path.
- SEC EDGAR company tickers plus submissions bulk ZIP: legally safer US SIC foundation, but maps to SIC rather than market-friendly sectors.
- NasdaqTrader symbol directory: authoritative active US universe, but no industry classification.
- KRX Data Marketplace industry classification status: official trade-date data, but direct OTP access currently needs more session handling.
- TradingView Korea scanner: convenient English sector/industry JSON, but high license/redistribution risk.
- WiseIndex/FnGuide WICS: useful portfolio taxonomy, but redistribution risk is high.
- Open PermID: strong global taxonomy candidate, but registration, RDF parsing, and license constraints make it a later integration.
