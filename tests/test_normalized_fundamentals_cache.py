import unittest
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


if __name__ == "__main__":
    unittest.main()
