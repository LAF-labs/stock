import unittest

import scripts.fetch_yfinance_score as legacy_score_module
import scripts.stock_score.scoring as scoring
import scripts.stock_score.symbols as symbols
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


if __name__ == "__main__":
    unittest.main()
