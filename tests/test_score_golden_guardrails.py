import json
import re
import unittest
from pathlib import Path

from scripts.stock_score.scoring import SCORE_MODEL_VERSION, FactorScore, composite_score, opportunity_factor_score


FIXTURE_PATH = Path(__file__).parent / "fixtures" / "golden-score-guardrails.json"
ROOT = Path(__file__).resolve().parents[1]


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

    def test_shared_fixture_declares_parity_targets(self):
        for case in self.cases:
            with self.subTest(ticker=case["ticker"]):
                parity = case.get("expected_parity")
                self.assertIsInstance(parity, dict)
                for key in ("quality_score", "quality_confidence", "opportunity_score", "opportunity_confidence"):
                    self.assertIn(key, parity)
                    self.assertIn("value", parity[key])
                    self.assertIn("tolerance", parity[key])

    def test_python_scores_match_shared_parity_targets(self):
        for case in self.cases:
            with self.subTest(ticker=case["ticker"]):
                quality_components = {
                    key: FactorScore(score=float(value[0]), confidence=float(value[1]))
                    for key, value in case["quality_components"].items()
                }
                quality_score, quality_confidence = composite_score(quality_components)
                opportunity = opportunity_factor_score(**case["opportunity_inputs"])

                actuals = {
                    "quality_score": quality_score,
                    "quality_confidence": quality_confidence,
                    "opportunity_score": opportunity.score,
                    "opportunity_confidence": opportunity.confidence,
                }
                for key, actual in actuals.items():
                    expected = case["expected_parity"][key]
                    self.assertAlmostEqual(
                        actual,
                        expected["value"],
                        delta=expected["tolerance"],
                        msg=f"{case['ticker']} {key} parity drift",
                    )

    def test_premium_growth_leader_guardrail(self):
        nvda = next(case for case in self.cases if case["ticker"] == "NVDA")
        quality_score, _confidence = composite_score(
            {
                key: FactorScore(score=float(value[0]), confidence=float(value[1]))
                for key, value in nvda["quality_components"].items()
            }
        )

        self.assertGreaterEqual(quality_score, 80.0)

    def test_score_model_version_matches_ts_and_rust(self):
        ts_source = (ROOT / "src" / "lib" / "scoreModel.ts").read_text(encoding="utf-8")
        rust_source = (ROOT / "services" / "market-data" / "src" / "score.rs").read_text(encoding="utf-8")
        ts_version = re.search(r'SCORE_MODEL_VERSION = "([^"]+)"', ts_source)
        rust_version = re.search(r'SCORE_MODEL_VERSION: &str = "([^"]+)"', rust_source)

        self.assertIsNotNone(ts_version)
        self.assertIsNotNone(rust_version)
        self.assertEqual(ts_version.group(1), SCORE_MODEL_VERSION)
        self.assertEqual(rust_version.group(1), SCORE_MODEL_VERSION)

    def test_shared_fixture_covers_opportunity_inputs_used_by_rust_and_python(self):
        required = {"avg_volume_20", "avg_volume_60", "atr14_pct", "cashflow_margin", "forward_pe"}
        for case in self.cases:
            with self.subTest(ticker=case["ticker"]):
                self.assertTrue(required.issubset(case["opportunity_inputs"]), case["description"])


if __name__ == "__main__":
    unittest.main()
