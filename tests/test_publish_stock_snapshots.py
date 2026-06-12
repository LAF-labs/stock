from datetime import datetime, timezone
import os
from pathlib import Path
from types import SimpleNamespace
import unittest

import scripts.publish_stock_snapshots as publisher
from scripts.publish_stock_snapshots import (
    assert_refresh_worker_readiness,
    build_score_snapshot_row,
    claim_refresh_jobs,
    fail_refresh_job,
    market_aware_snapshot_expires_at,
    permanent_refresh_failure,
    job_retry_after_seconds,
    job_ticker_ref,
    normalize_ticker_ref,
    parse_ticker_args,
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

    def test_parse_views_accepts_technical_score_view(self):
        self.assertEqual(publisher.parse_views("detail,technical,compare,technical"), ["detail", "technical", "compare"])

    def test_ttl_expires_at_uses_utc_iso_seconds(self):
        now = datetime(2026, 6, 5, 12, 0, 0, tzinfo=timezone.utc)

        self.assertEqual(ttl_expires_at(now, 300), "2026-06-05T12:05:00+00:00")

    def test_build_score_snapshot_rows_match_supabase_schema(self):
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
        self.assertEqual(score_row["ticker"], "US:KO")
        self.assertEqual(score_row["view_mode"], "detail")
        self.assertEqual(score_row["payload"], payload)
        self.assertEqual(score_row["fetched_at"], "2026-06-05T12:00:00+00:00")
        self.assertEqual(score_row["expires_at"], "2026-06-05T13:00:00+00:00")
        self.assertEqual(holiday_score_row["expires_at"], "2026-06-08T13:30:00+00:00")

    def test_score_snapshot_expiry_extends_to_next_open_when_market_is_closed(self):
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
            expires_at = market_aware_snapshot_expires_at(config, "US:KO", fetched_at, 1800)
        finally:
            publisher.requests.get = original_get

        self.assertEqual(expires_at, "2026-06-08T13:30:00+00:00")
        self.assertIn("market=eq.US", calls[0])
        self.assertIn("trade_date=eq.2026-06-06", calls[0])

    def test_score_snapshot_expiry_uses_ttl_during_open_session(self):
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
            expires_at = market_aware_snapshot_expires_at(config, "US:KO", fetched_at, 1800)
        finally:
            publisher.requests.get = original_get

        self.assertEqual(expires_at, "2026-06-05T16:30:00+00:00")

    def test_job_ticker_ref_uses_market_and_symbol(self):
        self.assertEqual(job_ticker_ref({"market": "US", "symbol": "nvda"}), "US:NVDA")
        self.assertEqual(job_ticker_ref({"market": "KR", "symbol": "005930"}), "KR:005930")

    def test_job_retry_after_seconds_uses_capped_backoff(self):
        self.assertEqual(job_retry_after_seconds({"attempts": 1}), 120)
        self.assertEqual(job_retry_after_seconds({"attempts": 4}), 960)
        self.assertEqual(job_retry_after_seconds({"attempts": 20}), 3600)

    def test_claim_refresh_jobs_posts_score_worker_rpc(self):
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
        self.assertEqual(calls[0]["url"], "https://example.supabase.co/rest/v1/rpc/claim_stock_refresh_jobs_by_kind")
        self.assertEqual(calls[0]["timeout"], 7)
        self.assertIn("service-role-key", calls[0]["headers"]["Authorization"])
        self.assertEqual(
            calls[0]["data"],
            '{"p_worker_id": "worker-1", "p_kind": "score", "p_limit": 5, "p_lock_seconds": 600}',
        )

    def test_claim_refresh_jobs_can_filter_by_kind(self):
        calls = []

        class FakeResponse:
            status_code = 200
            text = "[]"

            def json(self):
                return [{"id": "job-1", "kind": "score", "market": "US", "symbol": "NVDA", "view_mode": "detail"}]

        def fake_post(url, headers=None, data=None, timeout=None):
            calls.append({"url": url, "headers": headers, "data": data, "timeout": timeout})
            return FakeResponse()

        original_post = publisher.requests.post
        publisher.requests.post = fake_post
        try:
            config = SupabasePublishConfig(url="https://example.supabase.co", key="service-role-key", timeout_seconds=7)
            jobs = claim_refresh_jobs(config, "worker-1", 5, 600, "score")
        finally:
            publisher.requests.post = original_post

        self.assertEqual(jobs[0]["kind"], "score")
        self.assertEqual(calls[0]["url"], "https://example.supabase.co/rest/v1/rpc/claim_stock_refresh_jobs_by_kind")
        self.assertEqual(
            calls[0]["data"],
            '{"p_worker_id": "worker-1", "p_kind": "score", "p_limit": 5, "p_lock_seconds": 600}',
        )

    def test_legacy_score_worker_preflights_runtime_readiness_before_claiming(self):
        calls = []

        class FakeResponse:
            status_code = 200
            text = "{}"

            def json(self):
                return {
                    "ok": True,
                    "required_tables": ["public.stock_score_snapshots"],
                    "required_rpcs": ["claim_stock_refresh_jobs_by_kind"],
                }

        def fake_post(url, headers=None, data=None, timeout=None):
            calls.append({"url": url, "data": data})
            return FakeResponse()

        original_post = publisher.requests.post
        publisher.requests.post = fake_post
        try:
            config = SupabasePublishConfig(url="https://example.supabase.co", key="service-role-key", timeout_seconds=7)
            with self.assertRaisesRegex(RuntimeError, "Supabase runtime readiness failed"):
                assert_refresh_worker_readiness(config)
        finally:
            publisher.requests.post = original_post

        self.assertEqual(calls[0]["url"], "https://example.supabase.co/rest/v1/rpc/stock_runtime_readiness")
        self.assertEqual(calls[0]["data"], "{}")

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

    def test_queue_row_errors_can_be_recorded_without_failing_worker_run(self):
        direct_rows = [{"ticker": "US:NVDA", "errors": []}]
        queue_rows = [
            {"ticker": "US:NVDA", "status": "succeeded", "errors": []},
            {"ticker": "US:APLT", "status": "failed", "errors": [{"error": "kis_not_found"}]},
        ]

        self.assertFalse(publisher.publish_payload_ok(direct_rows, queue_rows, allow_queue_row_errors=False))
        self.assertTrue(publisher.publish_payload_ok(direct_rows, queue_rows, allow_queue_row_errors=True))
        self.assertFalse(
            publisher.publish_payload_ok(
                [{"ticker": "US:NVDA", "errors": [{"error": "warm ticker failed"}]}],
                queue_rows,
                allow_queue_row_errors=True,
            )
        )
        self.assertTrue(
            publisher.publish_payload_ok(
                [{"ticker": "US:WARM", "errors": [{"error": "kis_not_found"}]}],
                queue_rows,
                allow_queue_row_errors=True,
                allow_warm_row_errors=True,
            )
        )

    def test_permanent_refresh_failure_classifies_invalid_symbols(self):
        self.assertEqual(permanent_refresh_failure("kis_not_found"), False)
        self.assertEqual(permanent_refresh_failure("KIS HTTP 404"), False)
        self.assertEqual(permanent_refresh_failure("invalid_ticker"), True)
        self.assertEqual(permanent_refresh_failure("unsupported score view: bogus"), True)
        self.assertEqual(permanent_refresh_failure("temporary rate limited"), False)

    def test_publish_queue_job_retries_provider_misses_without_permanent_failure(self):
        calls = []

        def fake_fetch_score(*_args, **_kwargs):
            return {"ok": False, "error": "kis_not_found"}

        def fake_complete(*_args, **_kwargs):
            raise AssertionError("provider miss should not complete the job")

        def fake_fail(_config, worker_id, job_id, error, retry_after_seconds, permanent=False):
            calls.append(
                {
                    "worker_id": worker_id,
                    "job_id": job_id,
                    "error": error,
                    "retry_after_seconds": retry_after_seconds,
                    "permanent": permanent,
                }
            )

        original_fetch_score = publisher.fetch_score
        original_complete = publisher.complete_refresh_job
        original_fail = publisher.fail_refresh_job
        publisher.fetch_score = fake_fetch_score
        publisher.complete_refresh_job = fake_complete
        publisher.fail_refresh_job = fake_fail
        try:
            row = publisher.publish_queue_job(
                {"id": "job-aplt", "kind": "score", "market": "US", "symbol": "APLT", "view_mode": "compare", "attempts": 1},
                SupabasePublishConfig(url="https://example.supabase.co", key="service-role-key", timeout_seconds=7),
                SimpleNamespace(score_ttl_seconds=1800),
                "worker-1",
            )
        finally:
            publisher.fetch_score = original_fetch_score
            publisher.complete_refresh_job = original_complete
            publisher.fail_refresh_job = original_fail

        self.assertEqual(row["status"], "failed")
        self.assertEqual(calls[0]["job_id"], "job-aplt")
        self.assertEqual(calls[0]["error"], "kis_not_found")
        self.assertEqual(calls[0]["retry_after_seconds"], 120)
        self.assertEqual(calls[0]["permanent"], False)

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

    def test_publish_queue_job_rejects_invalid_score_view_without_fetching(self):
        calls = []

        def fake_fetch_score(*_args, **_kwargs):
            raise AssertionError("invalid score view should fail before fetch_score")

        def fake_complete(*_args, **_kwargs):
            raise AssertionError("invalid score view should not complete the job")

        def fake_fail(_config, worker_id, job_id, error, retry_after_seconds, permanent=False):
            calls.append(
                {
                    "worker_id": worker_id,
                    "job_id": job_id,
                    "error": error,
                    "retry_after_seconds": retry_after_seconds,
                    "permanent": permanent,
                }
            )

        original_fetch_score = publisher.fetch_score
        original_complete = publisher.complete_refresh_job
        original_fail = publisher.fail_refresh_job
        publisher.fetch_score = fake_fetch_score
        publisher.complete_refresh_job = fake_complete
        publisher.fail_refresh_job = fake_fail
        try:
            row = publisher.publish_queue_job(
                {"id": "job-1", "kind": "score", "market": "US", "symbol": "NVDA", "view_mode": "bogus", "attempts": 1},
                SupabasePublishConfig(url="https://example.supabase.co", key="service-role-key", timeout_seconds=7),
                SimpleNamespace(score_ttl_seconds=1800),
                "worker-1",
            )
        finally:
            publisher.fetch_score = original_fetch_score
            publisher.complete_refresh_job = original_complete
            publisher.fail_refresh_job = original_fail

        self.assertEqual(row["status"], "failed")
        self.assertEqual(calls[0]["job_id"], "job-1")
        self.assertEqual(calls[0]["permanent"], True)
        self.assertIn("unsupported score view", calls[0]["error"])

    def test_publish_queue_job_accepts_technical_score_view(self):
        calls = {"fetch": [], "upsert": [], "complete": []}

        def fake_fetch_score(ticker, view="detail"):
            calls["fetch"].append({"ticker": ticker, "view": view})
            return {"ok": True, "requested_ticker": ticker, "technical_analysis": {"type": "technical_analysis"}}

        def fake_upsert(_config, table, row, on_conflict):
            calls["upsert"].append({"table": table, "row": row, "on_conflict": on_conflict})

        def fake_complete(_config, worker_id, job_id):
            calls["complete"].append({"worker_id": worker_id, "job_id": job_id})

        original_fetch_score = publisher.fetch_score
        original_upsert = publisher.upsert_snapshot
        original_complete = publisher.complete_refresh_job
        original_expiry = publisher.market_aware_snapshot_expires_at
        publisher.fetch_score = fake_fetch_score
        publisher.upsert_snapshot = fake_upsert
        publisher.complete_refresh_job = fake_complete
        publisher.market_aware_snapshot_expires_at = lambda *_args, **_kwargs: "2026-06-05T12:30:00+00:00"
        try:
            row = publisher.publish_queue_job(
                {"id": "job-1", "kind": "score", "market": "US", "symbol": "NVDA", "view_mode": "technical", "attempts": 1},
                SupabasePublishConfig(url="https://example.supabase.co", key="service-role-key", timeout_seconds=7),
                SimpleNamespace(score_ttl_seconds=1800),
                "worker-1",
            )
        finally:
            publisher.fetch_score = original_fetch_score
            publisher.upsert_snapshot = original_upsert
            publisher.complete_refresh_job = original_complete
            publisher.market_aware_snapshot_expires_at = original_expiry

        self.assertEqual(row["status"], "succeeded")
        self.assertEqual(calls["fetch"], [{"ticker": "US:NVDA", "view": "technical"}])
        self.assertEqual(calls["upsert"][0]["row"]["view_mode"], "technical")
        self.assertEqual(calls["complete"], [{"worker_id": "worker-1", "job_id": "job-1"}])


if __name__ == "__main__":
    unittest.main()
