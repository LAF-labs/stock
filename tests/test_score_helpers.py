import unittest

from scripts.fetch_yfinance_score import (
    FactorScore,
    composite_score,
    domestic_yfinance_symbol,
    guardrailed_valuation,
    quality_adjusted_valuation,
    weighted_factor_score,
)


class ScoreHelperTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
