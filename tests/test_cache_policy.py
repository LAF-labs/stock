import unittest

from scripts.stock_score.cache_policy import cache_policy_for, fresh_seconds, stale_seconds


class CachePolicyTests(unittest.TestCase):
    def test_policy_exposes_long_lived_identity_and_chart_windows(self):
        self.assertGreaterEqual(fresh_seconds("identity"), 30 * 24 * 60 * 60)
        self.assertEqual(fresh_seconds("quote"), 300)
        self.assertGreaterEqual(stale_seconds("chart"), 30 * 24 * 60 * 60)

    def test_statement_fundamentals_outlive_market_ratios(self):
        self.assertGreater(stale_seconds("fundamentals_statement"), stale_seconds("fundamentals_market_ratio"))

    def test_unknown_policy_raises_clear_error(self):
        with self.assertRaisesRegex(ValueError, "Unknown stock cache policy: unknown_policy"):
            cache_policy_for("unknown_policy")


if __name__ == "__main__":
    unittest.main()
