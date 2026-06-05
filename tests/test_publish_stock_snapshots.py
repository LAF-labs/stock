from datetime import datetime, timezone
import unittest

from scripts.publish_stock_snapshots import (
    build_quote_snapshot_row,
    build_score_snapshot_row,
    normalize_ticker_ref,
    parse_ticker_args,
    ttl_expires_at,
)


class PublishStockSnapshotsTests(unittest.TestCase):
    def test_normalize_ticker_ref_preserves_market_scope(self):
        self.assertEqual(normalize_ticker_ref("ko"), "US:KO")
        self.assertEqual(normalize_ticker_ref("US:nvda"), "US:NVDA")
        self.assertEqual(normalize_ticker_ref("005930"), "KR:005930")

    def test_parse_ticker_args_deduplicates_ordered_values(self):
        tickers = parse_ticker_args(["KO,NVDA", "005930", "US:KO"])

        self.assertEqual(tickers, ["US:KO", "US:NVDA", "KR:005930"])

    def test_ttl_expires_at_uses_utc_iso_seconds(self):
        now = datetime(2026, 6, 5, 12, 0, 0, tzinfo=timezone.utc)

        self.assertEqual(ttl_expires_at(now, 300), "2026-06-05T12:05:00+00:00")

    def test_build_snapshot_rows_match_supabase_schema(self):
        now = datetime(2026, 6, 5, 12, 0, 0, tzinfo=timezone.utc)
        payload = {"ok": True, "requested_ticker": "KO", "score": 70.3}

        score_row = build_score_snapshot_row("US:KO", "detail", payload, now, 3600)
        quote_row = build_quote_snapshot_row("US:KO", payload, now, 180, 86400)

        self.assertEqual(score_row["ticker"], "US:KO")
        self.assertEqual(score_row["view_mode"], "detail")
        self.assertEqual(score_row["payload"], payload)
        self.assertEqual(score_row["fetched_at"], "2026-06-05T12:00:00+00:00")
        self.assertEqual(score_row["expires_at"], "2026-06-05T13:00:00+00:00")
        self.assertEqual(quote_row["ticker"], "US:KO")
        self.assertEqual(quote_row["market"], "US")
        self.assertEqual(quote_row["symbol"], "KO")
        self.assertEqual(quote_row["source"], "kis")
        self.assertNotIn("view_mode", quote_row)
        self.assertEqual(quote_row["expires_at"], "2026-06-05T12:03:00+00:00")
        self.assertEqual(quote_row["stale_expires_at"], "2026-06-06T12:00:00+00:00")


if __name__ == "__main__":
    unittest.main()
