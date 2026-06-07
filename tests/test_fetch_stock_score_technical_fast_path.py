import unittest
from unittest.mock import patch

import scripts.fetch_stock_score as score_module


def us_daily_rows():
    return [
        {"xymd": "20260601", "open": 100, "high": 103, "low": 99, "clos": 101, "tvol": 100000},
        {"xymd": "20260602", "open": 101, "high": 105, "low": 100, "clos": 104, "tvol": 120000},
        {"xymd": "20260603", "open": 104, "high": 106, "low": 102, "clos": 105, "tvol": 130000},
    ]


def kr_daily_rows():
    return [
        {"stck_bsop_date": "20260601", "stck_oprc": 10000, "stck_hgpr": 10300, "stck_lwpr": 9900, "stck_clpr": 10100, "acml_vol": 100000},
        {"stck_bsop_date": "20260602", "stck_oprc": 10100, "stck_hgpr": 10500, "stck_lwpr": 10000, "stck_clpr": 10400, "acml_vol": 120000},
        {"stck_bsop_date": "20260603", "stck_oprc": 10400, "stck_hgpr": 10600, "stck_lwpr": 10200, "stck_clpr": 10500, "acml_vol": 130000},
    ]


class TechnicalFastPathTests(unittest.TestCase):
    def test_us_technical_view_skips_yfinance_fundamentals(self):
        with (
            patch.object(score_module, "read_kis_discovery_cache", return_value={"market": {"excd": "NAS", "label": "Nasdaq"}, "search": {"prdt_eng_name": "NVIDIA"}}),
            patch.object(score_module, "kis_daily_rows", return_value=us_daily_rows()),
            patch.object(score_module, "discover_kis_stock") as discover,
            patch.object(score_module, "yfinance_fundamentals") as fundamentals,
        ):
            payload = score_module.fetch_score_kis_us("NVDA", view="technical")

        self.assertTrue(payload["ok"])
        self.assertEqual(payload["fetch"]["view"], "technical")
        self.assertEqual(payload["fetch"]["provider_mode"], "technical_fast_path")
        self.assertEqual(payload["latest_price"], 105)
        self.assertEqual(payload["latest_bar_date"], "2026-06-03")
        self.assertGreaterEqual(len(payload["chart_series"]), 3)
        fundamentals.assert_not_called()
        discover.assert_not_called()

    def test_kr_technical_view_skips_yfinance_and_history_fallback(self):
        with (
            patch.object(score_module, "kis_domestic_daily_rows", return_value=kr_daily_rows()),
            patch.object(score_module, "kis_domestic_price") as price,
            patch.object(score_module, "kis_domestic_search_info") as search,
            patch.object(score_module, "kis_domestic_stock_info") as stock_info,
            patch.object(score_module, "yfinance_fundamentals") as fundamentals,
            patch.object(score_module, "safe_history_for_symbol") as history,
        ):
            payload = score_module.fetch_score_kis_domestic("005930", view="technical")

        self.assertTrue(payload["ok"])
        self.assertEqual(payload["fetch"]["view"], "technical")
        self.assertEqual(payload["fetch"]["provider_mode"], "technical_fast_path")
        self.assertEqual(payload["latest_price"], 10500)
        self.assertEqual(payload["latest_bar_date"], "2026-06-03")
        self.assertGreaterEqual(len(payload["chart_series"]), 3)
        price.assert_not_called()
        search.assert_not_called()
        stock_info.assert_not_called()
        fundamentals.assert_not_called()
        history.assert_not_called()


if __name__ == "__main__":
    unittest.main()
