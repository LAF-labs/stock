from datetime import datetime, timezone
import os
from pathlib import Path
import unittest

import scripts.publish_stock_snapshots as publisher
from scripts.publish_stock_snapshots import (
    build_quote_snapshot_row,
    build_score_snapshot_row,
    claim_refresh_jobs,
    fail_refresh_job,
    permanent_refresh_failure,
    job_retry_after_seconds,
    job_ticker_ref,
    normalize_ticker_ref,
    parse_ticker_args,
    quote_snapshot_expires_at,
    SupabasePublishConfig,
    ttl_expires_at,
)

ROOT = Path(__file__).resolve().parents[1]


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
        holiday_score_row = build_score_snapshot_row(
            "US:KO",
            "detail",
            payload,
            now,
            3600,
            expires_at="2026-06-08T13:30:00+00:00",
        )
        quote_row = build_quote_snapshot_row("US:KO", payload, now, 180, 86400)
        holiday_quote_row = build_quote_snapshot_row(
            "US:KO",
            payload,
            now,
            180,
            300,
            expires_at="2026-06-08T13:30:00+00:00",
        )

        self.assertEqual(score_row["ticker"], "US:KO")
        self.assertEqual(score_row["view_mode"], "detail")
        self.assertEqual(score_row["payload"], payload)
        self.assertEqual(score_row["fetched_at"], "2026-06-05T12:00:00+00:00")
        self.assertEqual(score_row["expires_at"], "2026-06-05T13:00:00+00:00")
        self.assertEqual(holiday_score_row["expires_at"], "2026-06-08T13:30:00+00:00")
        self.assertEqual(quote_row["ticker"], "US:KO")
        self.assertEqual(quote_row["market"], "US")
        self.assertEqual(quote_row["symbol"], "KO")
        self.assertEqual(quote_row["source"], "kis")
        self.assertNotIn("view_mode", quote_row)
        self.assertEqual(quote_row["expires_at"], "2026-06-05T12:03:00+00:00")
        self.assertEqual(quote_row["stale_expires_at"], "2026-06-06T12:00:00+00:00")
        self.assertEqual(holiday_quote_row["expires_at"], "2026-06-08T13:30:00+00:00")
        self.assertEqual(holiday_quote_row["stale_expires_at"], "2026-06-08T13:30:00+00:00")

    def test_quote_snapshot_expiry_extends_to_next_open_when_market_is_closed(self):
        calls = []

        class FakeResponse:
            status_code = 200
            text = "[]"

            def json(self):
                return [
                    {
                        "market": "US",
                        "trade_date": "2026-06-06",
                        "is_open": False,
                        "next_open_at": "2026-06-08T13:30:00+00:00",
                    }
                ]

        def fake_get(url, headers=None, timeout=None):
            calls.append(url)
            return FakeResponse()

        original_get = publisher.requests.get
        publisher.requests.get = fake_get
        try:
            config = SupabasePublishConfig(url="https://example.supabase.co", key="service-role-key", timeout_seconds=7)
            fetched_at = datetime(2026, 6, 6, 16, 0, 0, tzinfo=timezone.utc)
            expires_at = quote_snapshot_expires_at(config, "US:KO", fetched_at, 300)
        finally:
            publisher.requests.get = original_get

        self.assertEqual(expires_at, "2026-06-08T13:30:00+00:00")
        self.assertIn("market=eq.US", calls[0])
        self.assertIn("trade_date=eq.2026-06-06", calls[0])

    def test_quote_snapshot_expiry_uses_short_ttl_during_open_session(self):
        class FakeResponse:
            status_code = 200
            text = "[]"

            def json(self):
                return [
                    {
                        "market": "US",
                        "trade_date": "2026-06-05",
                        "is_open": True,
                        "open_at": "2026-06-05T13:30:00+00:00",
                        "close_at": "2026-06-05T20:00:00+00:00",
                        "next_open_at": "2026-06-08T13:30:00+00:00",
                    }
                ]

        original_get = publisher.requests.get
        publisher.requests.get = lambda *args, **kwargs: FakeResponse()
        try:
            config = SupabasePublishConfig(url="https://example.supabase.co", key="service-role-key", timeout_seconds=7)
            fetched_at = datetime(2026, 6, 5, 16, 0, 0, tzinfo=timezone.utc)
            expires_at = quote_snapshot_expires_at(config, "US:KO", fetched_at, 300)
        finally:
            publisher.requests.get = original_get

        self.assertEqual(expires_at, "2026-06-05T16:05:00+00:00")

    def test_job_ticker_ref_uses_market_and_symbol(self):
        self.assertEqual(job_ticker_ref({"market": "US", "symbol": "nvda"}), "US:NVDA")
        self.assertEqual(job_ticker_ref({"market": "KR", "symbol": "005930"}), "KR:005930")

    def test_job_retry_after_seconds_uses_capped_backoff(self):
        self.assertEqual(job_retry_after_seconds({"attempts": 1}), 120)
        self.assertEqual(job_retry_after_seconds({"attempts": 4}), 960)
        self.assertEqual(job_retry_after_seconds({"attempts": 20}), 3600)

    def test_claim_refresh_jobs_posts_worker_rpc(self):
        calls = []

        class FakeResponse:
            status_code = 200
            text = "[]"

            def json(self):
                return [{"id": "job-1", "kind": "score", "market": "US", "symbol": "NVDA", "view_mode": "compare"}]

        def fake_post(url, headers=None, data=None, timeout=None):
            calls.append({"url": url, "headers": headers, "data": data, "timeout": timeout})
            return FakeResponse()

        original_post = publisher.requests.post
        publisher.requests.post = fake_post
        try:
            config = SupabasePublishConfig(url="https://example.supabase.co", key="service-role-key", timeout_seconds=7)
            jobs = claim_refresh_jobs(config, "worker-1", 5, 600)
        finally:
            publisher.requests.post = original_post

        self.assertEqual(jobs[0]["id"], "job-1")
        self.assertEqual(calls[0]["url"], "https://example.supabase.co/rest/v1/rpc/claim_stock_refresh_jobs")
        self.assertEqual(calls[0]["timeout"], 7)
        self.assertIn("service-role-key", calls[0]["headers"]["Authorization"])
        self.assertEqual(
            calls[0]["data"],
            '{"p_worker_id": "worker-1", "p_limit": 5, "p_lock_seconds": 600}',
        )

    def test_queue_limit_default_is_high_enough_for_demand_driven_backlog(self):
        original = os.environ.get("STOCK_SNAPSHOT_QUEUE_LIMIT")
        os.environ.pop("STOCK_SNAPSHOT_QUEUE_LIMIT", None)
        try:
            args = publisher.build_parser().parse_args(["--drain-queue"])
        finally:
            if original is None:
                os.environ.pop("STOCK_SNAPSHOT_QUEUE_LIMIT", None)
            else:
                os.environ["STOCK_SNAPSHOT_QUEUE_LIMIT"] = original

        self.assertEqual(args.queue_limit, 50)

    def test_demand_queue_is_drained_before_optional_warm_tickers(self):
        source = (ROOT / "scripts" / "publish_stock_snapshots.py").read_text(encoding="utf-8")

        self.assertLess(
            source.index("queue_rows = drain_refresh_queue(config, args)"),
            source.index("for index, ticker in enumerate(tickers):"),
        )

    def test_score_snapshot_ttl_default_matches_thirty_minute_score_policy(self):
        original = os.environ.get("STOCK_SCORE_SNAPSHOT_EXPIRES_SECONDS")
        os.environ.pop("STOCK_SCORE_SNAPSHOT_EXPIRES_SECONDS", None)
        try:
            args = publisher.build_parser().parse_args(["--drain-queue"])
        finally:
            if original is None:
                os.environ.pop("STOCK_SCORE_SNAPSHOT_EXPIRES_SECONDS", None)
            else:
                os.environ["STOCK_SCORE_SNAPSHOT_EXPIRES_SECONDS"] = original

        self.assertEqual(args.score_ttl_seconds, 1800)

    def test_permanent_refresh_failure_classifies_invalid_symbols(self):
        self.assertEqual(permanent_refresh_failure("kis_not_found"), True)
        self.assertEqual(permanent_refresh_failure("invalid_ticker"), True)
        self.assertEqual(permanent_refresh_failure("temporary rate limited"), False)

    def test_fail_refresh_job_marks_permanent_failures(self):
        calls = []

        class FakeResponse:
            status_code = 200
            text = "{}"

            def json(self):
                return {}

        def fake_post(url, headers=None, data=None, timeout=None):
            calls.append({"url": url, "headers": headers, "data": data, "timeout": timeout})
            return FakeResponse()

        original_post = publisher.requests.post
        publisher.requests.post = fake_post
        try:
            config = SupabasePublishConfig(url="https://example.supabase.co", key="service-role-key", timeout_seconds=7)
            fail_refresh_job(config, "worker-1", "00000000-0000-0000-0000-000000000001", "kis_not_found", 120, permanent=True)
        finally:
            publisher.requests.post = original_post

        self.assertEqual(calls[0]["url"], "https://example.supabase.co/rest/v1/rpc/fail_stock_refresh_job")
        self.assertEqual(
            calls[0]["data"],
            '{"p_job_id": "00000000-0000-0000-0000-000000000001", "p_worker_id": "worker-1", "p_error": "kis_not_found", "p_retry_after_seconds": 120, "p_permanent": true}',
        )


if __name__ == "__main__":
    unittest.main()
