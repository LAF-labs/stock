import unittest
from datetime import date, timedelta
from unittest.mock import patch

import scripts.fetch_stock_score as score_module
import scripts.stock_score.kis_client as kis_client


def kr_daily_rows(count=260):
    rows = []
    start = date(2025, 1, 1)
    for index in range(count):
        current = start + timedelta(days=index)
        close = 70000 + index
        rows.append(
            {
                "stck_bsop_date": current.strftime("%Y%m%d"),
                "stck_oprc": str(close - 100),
                "stck_hgpr": str(close + 200),
                "stck_lwpr": str(close - 200),
                "stck_clpr": str(close),
                "acml_vol": "1000000",
            }
        )
    return rows


class KisDomesticFundamentalTests(unittest.TestCase):
    def test_normalizes_kis_domestic_financial_rows_into_score_fields(self):
        from scripts.stock_score.kis_domestic_fundamentals import normalize_kis_domestic_fundamentals

        normalized = normalize_kis_domestic_fundamentals(
            {
                "balance_sheet": [
                    {
                        "stac_yymm": "202312",
                        "cras": "250000",
                        "total_aset": "1000000",
                        "flow_lblt": "100000",
                        "total_lblt": "400000",
                        "total_cptl": "600000",
                    }
                ],
                "income_statement": [
                    {
                        "stac_yymm": "202312",
                        "sale_account": "800000",
                        "bsop_prti": "120000",
                        "thtr_ntin": "90000",
                    }
                ],
                "financial_ratio": [
                    {
                        "stac_yymm": "202312",
                        "grs": "8.0",
                        "bsop_prfi_inrt": "12.5",
                        "ntin_inrt": "11.0",
                        "roe_val": "15.2",
                        "eps": "7200",
                        "bps": "48000",
                        "lblt_rate": "66.7",
                    }
                ],
                "profit_ratio": [{"stac_yymm": "202312", "sale_ntin_rate": "11.25", "sale_totl_rate": "42.5"}],
                "stability_ratio": [{"stac_yymm": "202312", "crnt_rate": "250.0", "quck_rate": "180.0", "lblt_rate": "66.7"}],
                "growth_ratio": [{"stac_yymm": "202312", "grs": "8.0", "bsop_prfi_inrt": "12.5"}],
                "other_major_ratios": [{"stac_yymm": "202312", "ebitda": "150000", "ev_ebitda": "7.3"}],
            }
        )

        self.assertEqual(normalized["period"], "202312")
        self.assertEqual(normalized["totalRevenue"], 800000.0)
        self.assertEqual(normalized["totalAssets"], 1000000.0)
        self.assertEqual(normalized["totalLiabilities"], 400000.0)
        self.assertEqual(normalized["totalEquity"], 600000.0)
        self.assertAlmostEqual(normalized["operatingMargins"], 0.15)
        self.assertAlmostEqual(normalized["profitMargins"], 0.1125)
        self.assertAlmostEqual(normalized["returnOnEquity"], 0.152)
        self.assertAlmostEqual(normalized["revenueGrowth"], 0.08)
        self.assertAlmostEqual(normalized["earningsGrowth"], 0.11)
        self.assertEqual(normalized["debtToEquity"], 66.7)
        self.assertAlmostEqual(normalized["currentRatio"], 2.5)
        self.assertAlmostEqual(normalized["quickRatio"], 1.8)
        self.assertEqual(normalized["eps"], 7200.0)
        self.assertEqual(normalized["bps"], 48000.0)
        self.assertEqual(normalized["ebitda"], 150000.0)
        self.assertEqual(normalized["evToEbitda"], 7.3)

    def test_kis_domestic_finance_bundle_calls_statement_and_ratio_endpoints(self):
        calls = []

        def fake_kis_get(path, tr_id, params):
            calls.append((path, tr_id, params))
            return {"output": [{"stac_yymm": "202312"}]}

        with patch.object(kis_client, "kis_get", side_effect=fake_kis_get):
            bundle = kis_client.kis_domestic_finance_bundle("005930", period="0")

        self.assertEqual(bundle["symbol"], "005930")
        self.assertEqual(bundle["period_type"], "annual")
        self.assertIn("balance_sheet", bundle["raw"])
        self.assertIn("income_statement", bundle["raw"])
        self.assertIn("financial_ratio", bundle["raw"])
        self.assertIn("profit_ratio", bundle["raw"])
        self.assertIn("stability_ratio", bundle["raw"])
        self.assertIn("growth_ratio", bundle["raw"])
        self.assertIn("other_major_ratios", bundle["raw"])
        self.assertIn(("/uapi/domestic-stock/v1/finance/balance-sheet", "FHKST66430100"), [(path, tr_id) for path, tr_id, _ in calls])
        self.assertIn(("/uapi/domestic-stock/v1/finance/growth-ratio", "FHKST66430800"), [(path, tr_id) for path, tr_id, _ in calls])
        for _path, _tr_id, params in calls:
            self.assertEqual(params["FID_DIV_CLS_CODE"], "0")
            self.assertEqual(params["FID_COND_MRKT_DIV_CODE"], "J")
            self.assertEqual(params["FID_INPUT_ISCD"], "005930")

    def test_domestic_score_prefers_kis_domestic_financials_over_yfinance(self):
        with (
            patch.object(
                score_module,
                "kis_domestic_price",
                return_value={
                    "stck_prpr": "72000",
                    "stck_sdpr": "71000",
                    "prdy_ctrt": "1.41",
                    "lstn_stcn": "5969782550",
                    "hts_avls": "4300000",
                    "w52_hgpr": "90000",
                    "w52_lwpr": "60000",
                    "per": "20",
                    "pbr": "1.2",
                    "eps": "3600",
                    "bps": "60000",
                    "acml_vol": "1000000",
                },
            ),
            patch.object(score_module, "kis_domestic_daily_rows", return_value=kr_daily_rows()),
            patch.object(score_module, "kis_domestic_stock_info", return_value={"prdt_abrv_name": "삼성전자", "scts_mket_lstg_dt": "19750611"}),
            patch.object(score_module, "kis_domestic_search_info") as search_info,
            patch.object(
                score_module,
                "kis_domestic_fundamentals",
                return_value=(
                    {
                        "totalRevenue": 800000.0,
                        "operatingMargins": 0.15,
                        "profitMargins": 0.1125,
                        "returnOnEquity": 0.152,
                        "revenueGrowth": 0.08,
                        "earningsGrowth": 0.11,
                        "debtToEquity": 66.7,
                        "currentRatio": 2.5,
                        "quickRatio": 1.8,
                    },
                    {"source": "kis_domestic_financials", "cache": "fresh"},
                    {"raw": {"income_statement": [{"sale_account": "800000"}]}, "normalized": {"totalRevenue": 800000.0}},
                ),
            ),
            patch.object(
                score_module,
                "yfinance_fundamentals",
                return_value=(
                    {
                        "totalRevenue": 1.0,
                        "operatingCashflow": 20_000_000_000_000.0,
                        "freeCashflow": 8_000_000_000_000.0,
                        "operatingMargins": 0.01,
                        "profitMargins": 0.01,
                        "returnOnEquity": 0.01,
                        "revenueGrowth": -0.5,
                        "earningsGrowth": -0.5,
                        "debtToEquity": 500.0,
                        "currentRatio": 0.4,
                        "quickRatio": 0.3,
                    },
                    {"source": "yfinance", "cache": "fresh"},
                ),
            ),
            patch.object(score_module, "kis_domestic_news", return_value=[]),
        ):
            payload = score_module.fetch_score_kis_domestic("005930", view="detail")

        search_info.assert_not_called()
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["financials"]["totalRevenue"], 800000.0)
        self.assertEqual(payload["financials"]["debtToEquity"], 66.7)
        self.assertAlmostEqual(payload["financials"]["currentRatio"], 2.5)
        self.assertIn("kis_domestic_financials", payload["financial_statement"])
        self.assertEqual(payload["financial_statement"]["kis_domestic_financials"]["normalized"]["totalRevenue"], 800000.0)
        self.assertEqual(payload["fetch"]["fundamentals_source"], "kis_domestic_financials+yfinance")
        metrics_by_label = {
            metric["label"]: metric["value"]
            for component in payload["components"]
            for metric in component.get("metrics", [])
        }
        self.assertEqual(metrics_by_label["OCF 마진"], "-")
        self.assertEqual(metrics_by_label["FCF 마진"], "-")


if __name__ == "__main__":
    unittest.main()
