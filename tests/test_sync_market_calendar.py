from datetime import date
import unittest

from scripts.sync_market_calendar import build_market_rows


class SyncMarketCalendarTests(unittest.TestCase):
    def test_build_market_rows_includes_open_and_closed_days(self):
        rows = build_market_rows("US", date(2026, 6, 5), date(2026, 6, 8))
        by_date = {row["trade_date"]: row for row in rows}

        self.assertEqual(len(rows), 4)
        self.assertEqual(by_date["2026-06-05"]["is_open"], True)
        self.assertEqual(by_date["2026-06-06"]["is_open"], False)
        self.assertEqual(by_date["2026-06-07"]["is_open"], False)
        self.assertEqual(by_date["2026-06-08"]["is_open"], True)
        self.assertIsNotNone(by_date["2026-06-06"]["next_open_at"])

    def test_build_kr_market_rows_uses_krx_calendar(self):
        rows = build_market_rows("KR", date(2026, 6, 5), date(2026, 6, 5))

        self.assertEqual(rows[0]["market"], "KR")
        self.assertEqual(rows[0]["timezone"], "Asia/Seoul")
        self.assertEqual(rows[0]["is_open"], True)
        self.assertIsNotNone(rows[0]["open_at"])
        self.assertIsNotNone(rows[0]["close_at"])


if __name__ == "__main__":
    unittest.main()
