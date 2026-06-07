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

    def test_build_us_market_rows_matches_2026_official_holidays_and_early_closes(self):
        rows = build_market_rows("US", date(2026, 6, 18), date(2026, 12, 28))
        by_date = {row["trade_date"]: row for row in rows}

        self.assertEqual(by_date["2026-06-19"]["is_open"], False)
        self.assertEqual(by_date["2026-07-03"]["is_open"], False)
        self.assertEqual(by_date["2026-11-27"]["is_open"], True)
        self.assertEqual(by_date["2026-11-27"]["is_early_close"], True)
        self.assertEqual(by_date["2026-11-27"]["close_at"], "2026-11-27T18:00:00+00:00")
        self.assertEqual(by_date["2026-12-24"]["is_early_close"], True)
        self.assertEqual(by_date["2026-12-24"]["close_at"], "2026-12-24T18:00:00+00:00")

    def test_build_kr_market_rows_includes_2026_new_statutory_closures(self):
        rows = build_market_rows("KR", date(2026, 6, 1), date(2026, 7, 20))
        by_date = {row["trade_date"]: row for row in rows}

        self.assertEqual(by_date["2026-06-03"]["is_open"], False)
        self.assertEqual(by_date["2026-06-03"]["reason"], "exchange_closed")
        self.assertEqual(by_date["2026-07-17"]["is_open"], False)
        self.assertEqual(by_date["2026-07-17"]["reason"], "exchange_closed")
        self.assertEqual(by_date["2026-06-04"]["is_open"], True)
        self.assertEqual(by_date["2026-07-20"]["is_open"], True)


if __name__ == "__main__":
    unittest.main()
