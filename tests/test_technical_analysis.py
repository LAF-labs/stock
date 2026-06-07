import unittest

from scripts.stock_score.technical_analysis import build_technical_analysis, coverage_tier_for_bars


def bar(day, open_price, high, low, close, volume=100000):
    return {
        "date": f"2026-06-{day:02d}",
        "open": open_price,
        "high": high,
        "low": low,
        "close": close,
        "volume": volume,
    }


class TechnicalAnalysisTests(unittest.TestCase):
    def test_coverage_tiers(self):
        self.assertEqual(coverage_tier_for_bars(0), "insufficient")
        self.assertEqual(coverage_tier_for_bars(15), "starter")
        self.assertEqual(coverage_tier_for_bars(25), "short")
        self.assertEqual(coverage_tier_for_bars(60), "standard")
        self.assertEqual(coverage_tier_for_bars(130), "full")
        self.assertEqual(coverage_tier_for_bars(220), "long_history")

    def test_newly_listed_payload_is_limited_but_available(self):
        rows = [bar(day, 100 + day, 102 + day, 99 + day, 101 + day, 100000 + day) for day in range(1, 16)]

        payload = build_technical_analysis(rows)

        self.assertEqual(payload["coverage_tier"], "starter")
        self.assertEqual(payload["status"], "limited")
        self.assertIn("상장 초기", " ".join(payload["warnings"]))
        self.assertGreaterEqual(len(payload["signals"]), 1)
        self.assertNotIn("confluence", payload)

    def test_fvg_signal_is_short_and_evidence_based(self):
        rows = [
            bar(1, 100, 101, 99, 100),
            bar(2, 100, 103, 100, 102, 180000),
            bar(3, 105, 108, 104, 107, 220000),
        ]

        payload = build_technical_analysis(rows)
        fvg = [signal for signal in payload["signals"] if signal["key"] == "fvg"]

        self.assertTrue(fvg)
        self.assertLessEqual(len(fvg[0]["plain"]), 80)
        self.assertIn("갭", fvg[0]["evidence"])

    def test_rule_copy_is_bounded_and_not_derivative_language(self):
        rows = [bar((index % 28) + 1, 100 + index, 102 + index, 99 + index, 101 + index, 100000 + index * 1000) for index in range(80)]

        payload = build_technical_analysis(rows)
        text = " ".join(signal["plain"] + " " + signal["evidence"] + " " + signal["rule"] for signal in payload["signals"])

        self.assertNotIn("파생", text)
        for signal in payload["signals"]:
            self.assertLessEqual(len(signal["plain"]), 100)
            self.assertLessEqual(len(signal["evidence"]), 100)

    def test_missing_ohlv_downgrades_without_throwing(self):
        payload = build_technical_analysis(
            [
                {"date": "2026-06-01", "close": 100},
                {"date": "2026-06-02", "close": "101"},
                {"date": "bad", "open": 100},
                {"date": "2026-06-03", "close": 102, "volume": None},
            ]
        )

        self.assertEqual(payload["bars"], 3)
        self.assertIn(payload["status"], {"limited", "ready"})


if __name__ == "__main__":
    unittest.main()
