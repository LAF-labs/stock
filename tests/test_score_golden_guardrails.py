import json
import unittest
from pathlib import Path

from scripts.stock_score.scoring import FactorScore, composite_score, opportunity_factor_score


FIXTURE_PATH = Path(__file__).parent / "fixtures" / "golden-score-guardrails.json"


class GoldenScoreGuardrailTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cases = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))

    def test_quality_scores_stay_in_expected_ranges(self):
        for case in self.cases:
            with self.subTest(ticker=case["ticker"], score="quality"):
                components = {
                    key: FactorScore(score=float(value[0]), confidence=float(value[1]))
                    for key, value in case["quality_components"].items()
                }

                score, confidence = composite_score(components)
                expected = case["expected_quality"]

                self.assertGreaterEqual(score, expected["min"], case["description"])
                self.assertLessEqual(score, expected["max"], case["description"])
                self.assertGreaterEqual(confidence, 0.45, f"{case['ticker']} quality confidence unexpectedly low")

    def test_opportunity_scores_stay_in_expected_ranges(self):
        for case in self.cases:
            with self.subTest(ticker=case["ticker"], score="opportunity"):
                result = opportunity_factor_score(**case["opportunity_inputs"])
                expected = case["expected_opportunity"]

                self.assertGreaterEqual(result.score, expected["min"], case["description"])
                self.assertLessEqual(result.score, expected["max"], case["description"])
                self.assertGreaterEqual(result.confidence, 0.45, f"{case['ticker']} opportunity confidence unexpectedly low")

    def test_premium_growth_leader_guardrail(self):
        nvda = next(case for case in self.cases if case["ticker"] == "NVDA")
        quality_score, _confidence = composite_score(
            {
                key: FactorScore(score=float(value[0]), confidence=float(value[1]))
                for key, value in nvda["quality_components"].items()
            }
        )

        self.assertGreaterEqual(quality_score, 80.0)


if __name__ == "__main__":
    unittest.main()
