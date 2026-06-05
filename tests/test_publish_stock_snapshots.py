from datetime import datetime, timezone
import os
import unittest

import scripts.publish_stock_snapshots as publisher
from scripts.publish_stock_snapshots import (
    build_quote_snapshot_row,
    build_score_snapshot_row,
    claim_refresh_jobs,
    job_retry_after_seconds,
    job_ticker_ref,
    normalize_ticker_ref,
    parse_ticker_args,
    SupabasePublishConfig,
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


if __name__ == "__main__":
    unittest.main()
