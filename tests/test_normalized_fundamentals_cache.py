import unittest
import os
from pathlib import Path
from unittest.mock import patch

import scripts.stock_score.provider_cache as provider_cache


class FakeResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code
        self.ok = 200 <= status_code < 300

    def json(self):
        return self._payload


class NormalizedFundamentalCacheTests(unittest.TestCase):
    def test_reads_latest_normalized_fundamental_cache_from_supabase(self):
        calls = []

        def fake_get(url, params, headers, timeout):
            calls.append({"url": url, "params": params, "headers": headers, "timeout": timeout})
            return FakeResponse(
                [
                    {
                        "market": "US",
                        "symbol": "ASM",
                        "provider": "sec",
                        "source": "sec_companyfacts",
                        "period_end": "2025-12-31",
                        "fiscal_year": 2025,
                        "fiscal_period": "FY",
                        "currency": "USD",
                        "normalized_facts": {
                            "totalRevenue": "1000000",
                            "profitMargins": 0.21,
                            "forwardPE": 18.4,
                            "badField": "not-a-number",
                        },
                        "coverage": {"profitability": ["totalRevenue", "profitMargins"]},
                        "payload": {"legacy": True},
                        "fetched_at": "2026-06-14T00:00:00+00:00",
                        "expires_at": "2026-06-21T00:00:00+00:00",
                        "stale_expires_at": "2026-12-11T00:00:00+00:00",
                    }
                ]
            )

        with (
            patch.object(provider_cache, "supabase_read_config", return_value=("https://example.supabase.co", "publishable-key")),
            patch.object(provider_cache.requests, "get", side_effect=fake_get),
        ):
            facts, state, meta, payload = provider_cache.normalized_fundamentals("asm", market="US")

        self.assertEqual(facts["totalRevenue"], 1_000_000.0)
        self.assertEqual(facts["profitMargins"], 0.21)
        self.assertEqual(facts["forwardPE"], 18.4)
        self.assertNotIn("badField", facts)
        self.assertEqual(state, "fresh")
        self.assertEqual(meta["source"], "sec_companyfacts")
        self.assertEqual(meta["provider"], "sec")
        self.assertEqual(meta["period_end"], "2025-12-31")
        self.assertEqual(payload["coverage"], {"profitability": ["totalRevenue", "profitMargins"]})
        self.assertEqual(calls[0]["params"]["symbol"], "eq.ASM")
        self.assertIn("normalized_facts", calls[0]["params"]["select"])

    def test_merge_fundamental_values_prefers_official_facts_and_keeps_provider_ratios(self):
        merged = provider_cache.merge_fundamental_values(
            {
                "totalRevenue": 900_000,
                "profitMargins": 0.18,
                "forwardPE": None,
            },
            {
                "totalRevenue": 1,
                "profitMargins": 0.01,
                "forwardPE": 24.5,
                "beta": 1.15,
                "invalid": float("nan"),
            },
        )

        self.assertEqual(
            merged,
            {
                "totalRevenue": 900_000.0,
                "profitMargins": 0.18,
                "forwardPE": 24.5,
                "beta": 1.15,
            },
        )

    def test_schema_migration_adds_serving_columns_without_replacing_existing_payload_cache(self):
        migration = Path("supabase/migrations/20260614183000_normalized_fundamental_cache.sql").read_text(encoding="utf-8")

        self.assertIn("alter table if exists public.stock_fundamental_snapshots", migration)
        self.assertIn("add column if not exists normalized_facts jsonb", migration)
        self.assertIn("create table if not exists public.stock_fundamental_latest", migration)
        self.assertIn("payload jsonb not null", migration)
        self.assertIn("grant select on table public.stock_fundamental_latest to anon, authenticated", migration)

    def test_yfinance_supabase_write_also_publishes_normalized_latest_snapshot(self):
        calls = []

        def fake_post(url, params, headers, json, timeout):
            calls.append({"url": url, "params": params, "json": json})
            return FakeResponse({}, status_code=204)

        with (
            patch.object(provider_cache, "supabase_write_config", return_value=("https://example.supabase.co", "service-key")),
            patch.object(provider_cache, "read_supabase_normalized_fundamental_cache", return_value=(None, None, None, None)),
            patch.object(provider_cache.requests, "post", side_effect=fake_post),
            patch.object(provider_cache.time, "time", return_value=1_700_000_000),
        ):
            written = provider_cache.write_supabase_yfinance_fundamental_cache(
                "asm",
                {"totalRevenue": "1000", "forwardPE": 18.5, "ignored": "not-a-score-input"},
                market="US",
            )

        self.assertTrue(written)
        self.assertEqual(len(calls), 2)
        self.assertIn("/rest/v1/stock_fundamental_snapshots", calls[0]["url"])
        self.assertIn("/rest/v1/stock_fundamental_latest", calls[1]["url"])
        self.assertEqual(calls[1]["params"], {"on_conflict": "market,symbol"})
        self.assertEqual(calls[1]["json"]["provider"], "yfinance")
        self.assertEqual(calls[1]["json"]["source"], "yfinance")
        self.assertEqual(calls[1]["json"]["normalized_facts"], {"totalRevenue": 1000.0, "forwardPE": 18.5})
        self.assertEqual(calls[1]["json"]["coverage"]["valuation"], ["forwardPE"])

    def test_yfinance_supabase_write_does_not_replace_existing_official_latest_snapshot(self):
        calls = []

        def fake_post(url, params, headers, json, timeout):
            calls.append({"url": url, "params": params, "json": json})
            return FakeResponse({}, status_code=204)

        with (
            patch.object(provider_cache, "supabase_write_config", return_value=("https://example.supabase.co", "service-key")),
            patch.object(provider_cache, "read_supabase_normalized_fundamental_cache", return_value=({"totalRevenue": 2000.0}, "fresh", {"provider": "sec"}, {"provider": "sec"})),
            patch.object(provider_cache.requests, "post", side_effect=fake_post),
            patch.object(provider_cache.time, "time", return_value=1_700_000_000),
        ):
            written = provider_cache.write_supabase_yfinance_fundamental_cache(
                "asm",
                {"targetMeanPrice": 25.5},
                market="US",
                provider_mode="yahoo_quote_summary",
            )

        self.assertTrue(written)
        self.assertEqual(len(calls), 1)
        self.assertIn("/rest/v1/stock_fundamental_snapshots", calls[0]["url"])

    def test_sec_companyfacts_normalizer_maps_latest_annual_fields(self):
        payload = {
            "entityName": "Example Inc.",
            "facts": {
                "us-gaap": {
                    "RevenueFromContractWithCustomerExcludingAssessedTax": {
                        "units": {
                            "USD": [
                                {"form": "10-K", "fp": "FY", "fy": 2024, "end": "2024-12-31", "filed": "2025-02-01", "val": 900},
                                {"form": "10-K", "fp": "FY", "fy": 2025, "end": "2025-12-31", "filed": "2026-02-01", "val": 1000},
                            ]
                        }
                    },
                    "NetIncomeLoss": {"units": {"USD": [{"form": "10-K", "fp": "FY", "fy": 2025, "end": "2025-12-31", "filed": "2026-02-01", "val": 210}]}},
                    "OperatingIncomeLoss": {"units": {"USD": [{"form": "10-K", "fp": "FY", "fy": 2025, "end": "2025-12-31", "filed": "2026-02-01", "val": 260}]}},
                    "Assets": {"units": {"USD": [{"form": "10-K", "fp": "FY", "fy": 2025, "end": "2025-12-31", "filed": "2026-02-01", "val": 2000}]}},
                    "Liabilities": {"units": {"USD": [{"form": "10-K", "fp": "FY", "fy": 2025, "end": "2025-12-31", "filed": "2026-02-01", "val": 800}]}},
                    "StockholdersEquity": {"units": {"USD": [{"form": "10-K", "fp": "FY", "fy": 2025, "end": "2025-12-31", "filed": "2026-02-01", "val": 1200}]}},
                    "EarningsPerShareDiluted": {"units": {"USD/shares": [{"form": "10-K", "fp": "FY", "fy": 2025, "end": "2025-12-31", "filed": "2026-02-01", "val": 4.2}]}},
                }
            },
        }

        normalized, meta, compact = provider_cache.normalize_sec_companyfacts(payload)

        self.assertEqual(normalized["totalRevenue"], 1000.0)
        self.assertEqual(normalized["netIncome"], 210.0)
        self.assertEqual(normalized["operatingMargins"], 0.26)
        self.assertEqual(normalized["profitMargins"], 0.21)
        self.assertEqual(normalized["returnOnEquity"], 0.175)
        self.assertEqual(normalized["debtToEquity"], 66.666667)
        self.assertEqual(normalized["eps"], 4.2)
        self.assertEqual(meta["period_end"], "2025-12-31")
        self.assertEqual(meta["fiscal_year"], 2025)
        self.assertEqual(compact["entity_name"], "Example Inc.")

    def test_normalized_fundamentals_fetches_sec_on_us_miss_when_enabled(self):
        with (
            patch.dict(os.environ, {"STOCK_SEC_EDGAR_REQUEST_FETCH": "1"}, clear=False),
            patch.object(provider_cache, "read_supabase_normalized_fundamental_cache", return_value=(None, None, provider_cache.normalized_fundamental_cache_meta("supabase", "miss"), None)),
            patch.object(provider_cache, "sec_edgar_fundamentals", return_value=({"totalRevenue": 1000.0}, {"source": "sec_companyfacts", "cache": "refreshed"}, {"provider": "sec"})) as sec,
        ):
            facts, state, meta, payload = provider_cache.normalized_fundamentals("aapl", market="US")

        self.assertEqual(facts, {"totalRevenue": 1000.0})
        self.assertEqual(state, "fresh")
        self.assertEqual(meta["source"], "sec_companyfacts")
        self.assertEqual(payload, {"provider": "sec"})
        sec.assert_called_once_with("AAPL")

    def test_yahoo_quote_summary_normalizer_extracts_raw_values(self):
        values = provider_cache.normalize_yahoo_quote_summary_fundamentals(
            {
                "financialData": {
                    "targetMeanPrice": {"raw": 300.25},
                    "numberOfAnalystOpinions": {"raw": 42},
                    "recommendationMean": {"raw": 1.8},
                    "totalRevenue": {"raw": 1000},
                    "profitMargins": {"raw": 0.21},
                },
                "defaultKeyStatistics": {
                    "forwardPE": {"raw": 24.5},
                    "priceToBook": {"raw": 12.3},
                    "beta": {"raw": 1.15},
                },
                "summaryDetail": {
                    "trailingPE": {"raw": 28.1},
                    "averageVolume": {"raw": 123456},
                    "averageVolume10days": {"raw": 234567},
                },
            }
        )

        self.assertEqual(values["targetMeanPrice"], 300.25)
        self.assertEqual(values["numberOfAnalystOpinions"], 42.0)
        self.assertEqual(values["forwardPE"], 24.5)
        self.assertEqual(values["trailingPE"], 28.1)
        self.assertEqual(values["beta"], 1.15)
        self.assertEqual(values["averageVolume10days"], 234567.0)

    def test_yfinance_fundamentals_prefers_yahoo_quote_summary_before_yfinance_info(self):
        with (
            patch.dict(os.environ, {"STOCK_YFINANCE_REQUEST_FETCH": "1"}, clear=False),
            patch.object(provider_cache, "read_supabase_yfinance_fundamental_cache", return_value=(None, None, None)),
            patch.object(provider_cache, "read_yfinance_fundamental_cache", return_value=(None, None)),
            patch.object(provider_cache, "yahoo_quote_summary_fundamentals", return_value={"targetMeanPrice": 300, "forwardPE": 24.5}) as yahoo,
            patch.object(provider_cache, "write_yfinance_fundamental_cache") as local_write,
            patch.object(provider_cache, "write_supabase_yfinance_fundamental_cache", return_value=True) as supabase_write,
            patch.object(provider_cache, "safe_info") as safe_info,
            patch.object(provider_cache, "one_byte_file_lock"),
        ):
            values, meta = provider_cache.yfinance_fundamentals("aapl")

        self.assertEqual(values, {"targetMeanPrice": 300, "forwardPE": 24.5})
        self.assertEqual(meta["provider_mode"], "yahoo_quote_summary")
        yahoo.assert_called_once_with("AAPL")
        local_write.assert_called_once()
        supabase_write.assert_called_once()
        safe_info.assert_not_called()


if __name__ == "__main__":
    unittest.main()
