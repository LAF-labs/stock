import unittest
import tempfile
import os
from pathlib import Path

import pandas as pd
import scripts.fetch_yfinance_score as legacy_score_module
import scripts.stock_score.formatting as formatting
import scripts.stock_score.io_utils as io_utils
import scripts.stock_score.kis_client as kis_client
import scripts.stock_score.kis_discovery_cache as kis_discovery_cache
import scripts.stock_score.presentation as presentation
import scripts.stock_score.provider_cache as provider_cache
import scripts.stock_score.scoring as scoring
import scripts.stock_score.symbols as symbols
import scripts.stock_score.timeseries as timeseries
import scripts.stock_score.yfinance_provider as yfinance_provider
from scripts.fetch_yfinance_score import (
    FactorScore,
    composite_score,
    domestic_yfinance_symbol,
    guardrailed_valuation,
    opportunity_factor_score,
    quality_adjusted_valuation,
    weighted_factor_score,
)


class ScoreHelperTests(unittest.TestCase):
    def test_scoring_helpers_are_extracted_without_breaking_legacy_imports(self):
        self.assertIs(legacy_score_module.FactorScore, scoring.FactorScore)
        self.assertIs(legacy_score_module.weighted_factor_score, scoring.weighted_factor_score)
        self.assertIs(legacy_score_module.opportunity_factor_score, scoring.opportunity_factor_score)

    def test_symbol_helpers_are_extracted_without_breaking_legacy_imports(self):
        self.assertIs(legacy_score_module.clean_ticker, symbols.clean_ticker)
        self.assertIs(legacy_score_module.parse_symbol_ref, symbols.parse_symbol_ref)
        self.assertIs(legacy_score_module.domestic_yfinance_symbol, symbols.domestic_yfinance_symbol)

    def test_formatting_helpers_are_extracted_without_breaking_legacy_imports(self):
        self.assertIs(legacy_score_module.as_float, formatting.as_float)
        self.assertIs(legacy_score_module.price_label, formatting.price_label)
        self.assertIs(legacy_score_module.labeled_money, formatting.labeled_money)

    def test_timeseries_helpers_are_extracted_without_breaking_legacy_imports(self):
        self.assertIs(legacy_score_module.return_between, timeseries.return_between)
        self.assertIs(legacy_score_module.simple_rsi, timeseries.simple_rsi)
        self.assertIs(legacy_score_module.kis_chart_series, timeseries.kis_chart_series)

    def test_presentation_helpers_are_extracted_without_breaking_legacy_imports(self):
        self.assertIs(legacy_score_module.grade_for, presentation.grade_for)
        self.assertIs(legacy_score_module.signal_for, presentation.signal_for)
        self.assertIs(legacy_score_module.top_like_current, presentation.top_like_current)
        self.assertIs(legacy_score_module.opportunity_components_for, presentation.opportunity_components_for)

    def test_yfinance_provider_helpers_are_extracted_without_breaking_legacy_imports(self):
        self.assertIs(legacy_score_module.safe_info, yfinance_provider.safe_info)
        self.assertIs(legacy_score_module.safe_history, yfinance_provider.safe_history)
        self.assertIs(legacy_score_module.safe_news, yfinance_provider.safe_news)

    def test_io_and_kis_cache_helpers_are_extracted_without_breaking_legacy_imports(self):
        self.assertIs(legacy_score_module.env_value, io_utils.env_value)
        self.assertIs(legacy_score_module.one_byte_file_lock, io_utils.one_byte_file_lock)
        self.assertIs(legacy_score_module.read_kis_discovery_cache, kis_discovery_cache.read_kis_discovery_cache)
        self.assertIs(legacy_score_module.write_kis_discovery_cache, kis_discovery_cache.write_kis_discovery_cache)

    def test_provider_cache_helpers_are_extracted_without_breaking_legacy_imports(self):
        self.assertIs(legacy_score_module.yfinance_fundamentals, provider_cache.yfinance_fundamentals)
        self.assertIs(legacy_score_module.kis_token_cache_key, provider_cache.kis_token_cache_key)
        self.assertIs(legacy_score_module.read_supabase_kis_access_token, provider_cache.read_supabase_kis_access_token)
        self.assertIs(legacy_score_module.write_supabase_kis_access_token, provider_cache.write_supabase_kis_access_token)

    def test_kis_client_helpers_are_extracted_without_breaking_legacy_imports(self):
        self.assertIs(legacy_score_module.KisApiError, kis_client.KisApiError)
        self.assertIs(legacy_score_module.discover_kis_stock, kis_client.discover_kis_stock)
        self.assertIs(legacy_score_module.domestic_exchange_name, kis_client.domestic_exchange_name)
        self.assertIs(legacy_score_module.kis_access_token, kis_client.kis_access_token)
        self.assertIs(legacy_score_module.kis_date, kis_client.kis_date)
        self.assertIs(legacy_score_module.kis_percent, kis_client.kis_percent)

    def test_env_value_reads_local_files_after_environment(self):
        original_cwd = Path.cwd()
        original_value = os.environ.get("STOCK_SCORE_TEST_ENV")
        with tempfile.TemporaryDirectory() as tmp:
            try:
                os.chdir(tmp)
                Path(".env.local").write_text(
                    "STOCK_SCORE_TEST_ENV='from-file'\nOTHER=value\n",
                    encoding="utf-8",
                )
                os.environ.pop("STOCK_SCORE_TEST_ENV", None)
                self.assertEqual(io_utils.env_value("STOCK_SCORE_TEST_ENV"), "from-file")

                os.environ["STOCK_SCORE_TEST_ENV"] = " from-env "
                self.assertEqual(io_utils.env_value("STOCK_SCORE_TEST_ENV"), "from-env")
            finally:
                os.chdir(original_cwd)
                if original_value is None:
                    os.environ.pop("STOCK_SCORE_TEST_ENV", None)
                else:
                    os.environ["STOCK_SCORE_TEST_ENV"] = original_value

    def test_kis_discovery_cache_roundtrips_valid_market_data(self):
        original_cwd = Path.cwd()
        with tempfile.TemporaryDirectory() as tmp:
            try:
                os.chdir(tmp)
                kis_discovery_cache.write_kis_discovery_cache(
                    "nvda",
                    {"excd": "NAS", "product_type": "512", "label": "Nasdaq"},
                    {"prdt_eng_name": "NVIDIA"},
                )

                cached = kis_discovery_cache.read_kis_discovery_cache("NVDA")

                self.assertIsNotNone(cached)
                assert cached is not None
                self.assertEqual(cached["market"]["excd"], "NAS")
                self.assertEqual(cached["search"]["prdt_eng_name"], "NVIDIA")
            finally:
                os.chdir(original_cwd)

    def test_provider_cache_roundtrips_yfinance_fundamental_file_cache(self):
        original_cwd = Path.cwd()
        with tempfile.TemporaryDirectory() as tmp:
            try:
                os.chdir(tmp)
                provider_cache.write_yfinance_fundamental_cache("nvda", {"forwardPE": 31.2, "beta": 1.1})

                values, state = provider_cache.read_yfinance_fundamental_cache("NVDA")

                self.assertEqual(values, {"forwardPE": 31.2, "beta": 1.1})
                self.assertEqual(state, "fresh")
                self.assertTrue(provider_cache.yfinance_fundamental_cache_path("NVDA").exists())
            finally:
                os.chdir(original_cwd)

    def test_yfinance_provider_helpers_normalize_fake_ticker_data(self):
        class FakeTicker:
            info = {"marketCap": 123}
            fast_info = {"lastPrice": "12.5"}
            news = [
                {
                    "content": {
                        "title": "Headline",
                        "canonicalUrl": {"url": "https://example.com/news"},
                        "provider": {"displayName": "Provider"},
                        "pubDate": "2026-06-06T00:00:00Z",
                    }
                }
            ]

            def history(self, *, period, interval, auto_adjust, actions):
                if interval == "5m":
                    return pd.DataFrame(
                        [{"Close": "12.5", "Volume": "1000"}, {"Close": None, "Volume": "5"}],
                        index=pd.to_datetime(["2026-06-06 09:30", "2026-06-06 09:35"]),
                    )
                return pd.DataFrame(
                    [{"Close": 10.0, "Volume": 100}, {"Close": None, "Volume": 200}],
                    index=pd.to_datetime(["2026-06-05", "2026-06-06"]),
                )

        ticker = FakeTicker()

        self.assertEqual(yfinance_provider.safe_info(ticker), {"marketCap": 123})
        self.assertEqual(yfinance_provider.safe_fast_info(ticker), {"lastPrice": "12.5"})
        self.assertEqual(len(yfinance_provider.safe_history(ticker)), 1)
        self.assertEqual(
            yfinance_provider.safe_intraday(ticker)[0],
            {
                "ts": "2026-06-06T09:30:00",
                "close": 12.5,
                "close_label": "$12.50",
                "volume": 1000,
                "volume_label": "1,000주",
            },
        )
        self.assertEqual(
            yfinance_provider.safe_news(ticker)[0],
            {
                "title": "Headline",
                "publisher": "Provider",
                "link": "https://example.com/news",
                "provider_publish_time": None,
                "published_at": "2026-06-06T00:00:00Z",
            },
        )

    def test_yfinance_provider_latest_statement_uses_latest_column(self):
        statement = pd.DataFrame(
            [[123.0], [float("nan")]],
            index=["Net Income", "Ignored"],
            columns=pd.to_datetime(["2026-03-31"]),
        )

        self.assertEqual(
            yfinance_provider.latest_statement(statement, {"Net Income": "net_income", "Missing": "missing"}),
            {"reported_date": "2026-03-31", "net_income": 123.0},
        )

    def test_presentation_helpers_build_stock_response_summary(self):
        self.assertEqual(presentation.grade_for(82.0), {"class": "excellent", "label": "우수"})
        self.assertEqual(presentation.signal_for(72.0, 62.0, 0.08), "BUY")
        self.assertEqual(presentation.signal_for(35.0, 45.0, 0.0), "WATCH")

        rows = presentation.top_like_current(
            "NVDA",
            "NVIDIA",
            120.25,
            "USD",
            82.36,
            [{"key": "growth", "score": 91.2}, {"key": "valuation", "score": 62.1}],
        )

        self.assertEqual(rows[0]["score"], 82.4)
        self.assertEqual(rows[0]["grade"], {"class": "excellent", "label": "우수"})
        self.assertEqual(rows[0]["components"], {"growth": 91.2, "valuation": 62.1})
        self.assertIsInstance(rows[0]["ts"], int)

    def test_opportunity_component_presentation_uses_factor_evidence(self):
        opportunity = scoring.OpportunityResult(
            score=68.4,
            confidence=0.82,
            components={
                "momentum": scoring.FactorScore(score=71.2, confidence=0.8),
                "estimate_growth": scoring.FactorScore(score=64.0, confidence=0.7),
                "analyst": scoring.FactorScore(score=60.0, confidence=0.6),
                "liquidity": scoring.FactorScore(score=77.0, confidence=0.9),
                "risk": scoring.FactorScore(score=58.0, confidence=0.75),
            },
            caps=("speculative_expensive_sales",),
        )

        components = presentation.opportunity_components_for(
            opportunity,
            latest_price=100.0,
            target_mean_price=125.0,
            analyst_count=7,
            recommendation_mean=1.83,
            avg_volume_20=123_456,
            avg_volume_60=99_000,
            atr14_pct=0.052,
            beta=1.28,
        )

        self.assertEqual([component["key"] for component in components], [
            "opportunity_momentum",
            "opportunity_growth",
            "opportunity_analyst",
            "opportunity_liquidity",
            "opportunity_risk",
        ])
        self.assertEqual(components[2]["metrics"][0], {"label": "목표가 여지", "value": "+25.0%"})
        self.assertEqual(components[2]["metrics"][1], {"label": "애널리스트 수", "value": "7명"})
        self.assertEqual(components[4]["metrics"][2], {"label": "적용 상한", "value": "speculative_expensive_sales"})

    def test_timeseries_helpers_build_chart_rows(self):
        history = pd.DataFrame(
            [
                {"Open": "10", "High": "12", "Low": "9", "Close": "11", "Volume": "1000"},
                {"Open": "11", "High": "13", "Low": "10", "Close": "12", "Volume": "1200"},
            ],
            index=pd.to_datetime(["2026-06-01", "2026-06-02"]),
        )

        rows = timeseries.build_chart_series(history, "USD", 1300)

        self.assertEqual(rows[0]["date"], "2026-06-01")
        self.assertEqual(rows[0]["close_label"], "$11.00 (약 1.4만원)")
        self.assertIsNone(rows[0]["change_pct"])
        self.assertAlmostEqual(rows[1]["change_pct"], 12 / 11 - 1)

    def test_kis_chart_helpers_preserve_provider_date_and_change_rules(self):
        rows = timeseries.kis_chart_series(
            [
                {"xymd": "20260601", "open": "10", "high": "12", "low": "9", "clos": "11", "tvol": "100", "rate": "2.5"},
                {"xymd": "20260602", "open": "11", "high": "13", "low": "10", "clos": "12", "tvol": "120"},
            ],
            "USD",
            None,
        )

        self.assertEqual(rows[0]["date"], "2026-06-01")
        self.assertEqual(rows[0]["change_pct"], 0.025)
        self.assertAlmostEqual(rows[1]["change_pct"], 12 / 11 - 1)

    def test_quality_adjusted_valuation_moderates_premium_growth_leaders(self):
        valuation = quality_adjusted_valuation(
            FactorScore(score=12.0, confidence=1.0),
            FactorScore(score=96.0, confidence=1.0),
            FactorScore(score=92.0, confidence=1.0),
        )

        self.assertGreaterEqual(valuation.score, 55.0)
        self.assertEqual(valuation.confidence, 1.0)

    def test_guardrailed_valuation_caps_weak_no_forward_growth_stories(self):
        valuation = guardrailed_valuation(
            FactorScore(score=72.0, confidence=0.9),
            profitability=FactorScore(score=38.0, confidence=0.9),
            growth=FactorScore(score=96.0, confidence=0.8),
            forward_pe=None,
            trailing_pe=24.0,
            ev_to_revenue=13.5,
            price_to_sales=14.2,
            operating_margin=-0.20,
            fcf_margin=-0.18,
        )

        self.assertLessEqual(valuation.score, 45.0)
        self.assertLess(valuation.confidence, 0.9)

    def test_guardrailed_valuation_preserves_profitable_forward_covered_leaders(self):
        valuation = guardrailed_valuation(
            FactorScore(score=78.0, confidence=1.0),
            profitability=FactorScore(score=96.0, confidence=1.0),
            growth=FactorScore(score=88.0, confidence=1.0),
            forward_pe=18.0,
            trailing_pe=35.0,
            ev_to_revenue=20.0,
            price_to_sales=None,
            operating_margin=0.55,
            fcf_margin=0.40,
        )

        self.assertEqual(valuation.score, 78.0)
        self.assertEqual(valuation.confidence, 1.0)

    def test_composite_score_anchors_sparse_data_toward_neutral(self):
        score, confidence = composite_score(
            {
                "profitability": FactorScore(score=50.0, confidence=0.0),
                "growth": FactorScore(score=50.0, confidence=0.0),
                "health": weighted_factor_score([(20.0, 0.8)]),
                "momentum": weighted_factor_score([(42.0, 0.8)]),
                "valuation": FactorScore(score=50.0, confidence=0.0),
            }
        )

        self.assertLessEqual(confidence, 0.4)
        self.assertGreaterEqual(score, 35.0)
        self.assertLessEqual(score, 55.0)

    def test_domestic_yfinance_symbol_uses_exchange_suffixes(self):
        self.assertEqual(domestic_yfinance_symbol("005930", "KOSPI"), "005930.KS")
        self.assertEqual(domestic_yfinance_symbol("253590", "KOSDAQ"), "253590.KQ")
        self.assertEqual(domestic_yfinance_symbol("Q123456", "KONEX"), "123456.KQ")

    def test_opportunity_score_lifts_speculative_growth_setup_but_caps_risk(self):
        opportunity = opportunity_factor_score(
            market="KR",
            latest_price=320_500,
            ret_1m=0.18,
            ret_3m=0.42,
            ret_6m=0.85,
            ret_52w=1.35,
            distance_52w_high=-0.03,
            ma50=280_000,
            ma200=155_000,
            rsi14=72.0,
            atr14_pct=0.055,
            avg_volume_20=1_200_000,
            avg_volume_60=520_000,
            market_cap=2_100_000_000_000,
            revenue_growth=1.0,
            earnings_growth=0.20,
            target_mean_price=340_000,
            analyst_count=1,
            recommendation_mean=1.7,
            forward_pe=176.0,
            operating_margin=-0.03,
            cashflow_margin=-0.02,
            ev_to_revenue=117.0,
            price_to_sales=103.0,
        )

        self.assertGreaterEqual(opportunity.score, 58.0)
        self.assertLessEqual(opportunity.score, 72.0)
        self.assertIn("speculative_expensive_sales", opportunity.caps)

    def test_opportunity_score_anchors_sparse_data_toward_neutral(self):
        opportunity = opportunity_factor_score(
            market="US",
            latest_price=10.0,
            ret_1m=0.20,
            ret_3m=0.55,
            ret_6m=None,
            ret_52w=None,
            distance_52w_high=None,
            ma50=None,
            ma200=None,
            rsi14=None,
            atr14_pct=None,
            avg_volume_20=None,
            avg_volume_60=None,
            market_cap=None,
            revenue_growth=None,
            earnings_growth=None,
            target_mean_price=None,
            analyst_count=None,
            recommendation_mean=None,
            forward_pe=None,
            operating_margin=None,
            cashflow_margin=None,
            ev_to_revenue=None,
            price_to_sales=None,
        )

        self.assertLessEqual(opportunity.confidence, 0.45)
        self.assertGreaterEqual(opportunity.score, 45.0)
        self.assertLessEqual(opportunity.score, 65.0)

    def test_kis_access_token_reuses_supabase_shared_cache(self):
        original_env = {
            key: os.environ.get(key)
            for key in (
                "STOCK_API_APP_KEY",
                "STOCK_API_APP_SECRET",
                "STOCK_API_BASE",
                "KIS_APP_KEY",
                "KIS_APP_SECRET",
                "KIS_API_BASE",
                "SUPABASE_URL",
                "SUPABASE_SERVICE_ROLE_KEY",
                "SUPABASE_PUBLISHABLE_KEY",
            )
        }
        original_cwd = Path.cwd()
        original_get = provider_cache.requests.get
        original_post = kis_client.requests.post

        class FakeResponse:
            def __init__(self, payload, ok=True, status_code=200, text=""):
                self._payload = payload
                self.ok = ok
                self.status_code = status_code
                self.text = text

            def json(self):
                return self._payload

        def fake_get(url, **kwargs):
            self.assertIn("/rest/v1/kis_access_tokens", url)
            self.assertEqual(kwargs["headers"]["apikey"], "service-role-key")
            return FakeResponse(
                [
                    {
                        "cache_key": "unused",
                        "access_token": "shared-token",
                        "expires_at": "2099-01-01T00:00:00+00:00",
                    }
                ]
            )

        def fake_post(url, **_kwargs):
            if "/oauth2/tokenP" in url:
                raise AssertionError("KIS token endpoint should not be called when shared cache is fresh")
            raise AssertionError(f"unexpected POST {url}")

        with tempfile.TemporaryDirectory() as tmp:
            try:
                os.chdir(tmp)
                os.environ["STOCK_API_APP_KEY"] = "app-key"
                os.environ["STOCK_API_APP_SECRET"] = "app-secret"
                os.environ["STOCK_API_BASE"] = "https://kis.example.com"
                os.environ["SUPABASE_URL"] = "https://example.supabase.co"
                os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "service-role-key"
                for key in ("KIS_APP_KEY", "KIS_APP_SECRET", "KIS_API_BASE", "SUPABASE_PUBLISHABLE_KEY"):
                    os.environ.pop(key, None)
                provider_cache.requests.get = fake_get
                kis_client.requests.post = fake_post

                self.assertEqual(legacy_score_module.kis_access_token(), "shared-token")
            finally:
                os.chdir(original_cwd)
                provider_cache.requests.get = original_get
                kis_client.requests.post = original_post
                for key, value in original_env.items():
                    if value is None:
                        os.environ.pop(key, None)
                    else:
                        os.environ[key] = value


if __name__ == "__main__":
    unittest.main()
