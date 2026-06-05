from datetime import datetime, timezone
import json
import unittest

import scripts.stock_operations_report as report
from scripts.stock_operations_report import SupabaseReportConfig


class StockOperationsReportTests(unittest.TestCase):
    def test_summarize_queue_rows_groups_backlog_and_dead_jobs(self):
        summary = report.summarize_queue_rows(
            [
                {"kind": "score", "status": "queued", "jobs": 12, "oldest_run_after": "2026-06-05T11:00:00+00:00", "stale_running_jobs": 0},
                {"kind": "quote", "status": "running", "jobs": 3, "oldest_run_after": "2026-06-05T11:10:00+00:00", "stale_running_jobs": 2},
                {"kind": "score", "status": "dead", "jobs": 1, "oldest_run_after": "2026-06-05T10:30:00+00:00", "stale_running_jobs": 0},
            ]
        )

        self.assertEqual(summary["total_jobs"], 16)
        self.assertEqual(summary["queued_jobs"], 12)
        self.assertEqual(summary["running_jobs"], 3)
        self.assertEqual(summary["dead_jobs"], 1)
        self.assertEqual(summary["stale_running_jobs"], 2)
        self.assertEqual(summary["by_status"]["queued"], 12)
        self.assertEqual(summary["by_kind"]["score"], 13)

    def test_summarize_score_snapshots_reports_duplicate_score_and_low_confidence_risk(self):
        now = datetime(2026, 6, 6, 0, 0, 0, tzinfo=timezone.utc)
        rows = [
            score_row("US:NVDA", 87.14, 87.14, 72.0, 0.91, "2026-06-05T23:30:00+00:00"),
            score_row("US:MSFT", 87.12, 87.12, 61.0, 0.88, "2026-06-05T23:31:00+00:00"),
            score_row("KR:005930", 64.0, 64.0, 55.0, 0.72, "2026-06-05T23:35:00+00:00"),
            score_row("US:SPARSE", 67.0, 67.0, 58.0, 0.31, "2026-06-05T23:36:00+00:00"),
            score_row("US:OLD", 50.0, 50.0, 52.0, 0.60, "2026-06-04T20:00:00+00:00", version="old-model"),
        ]

        summary = report.summarize_score_snapshots(rows, expected_model_version=report.DEFAULT_SCORE_MODEL_VERSION, now=now, stale_after_hours=24)

        self.assertEqual(summary["total_snapshots"], 5)
        self.assertEqual(summary["current_model_snapshots"], 4)
        self.assertEqual(summary["stale_snapshots"], 1)
        self.assertEqual(summary["low_confidence_high_score_count"], 1)
        self.assertEqual(summary["duplicate_score_bucket_count"], 1)
        self.assertEqual(summary["max_duplicate_bucket_size"], 2)
        self.assertGreater(summary["duplicate_score_rate"], 0.0)
        self.assertEqual(summary["top_duplicate_scores"][0]["score"], 87.1)

    def test_summarize_quote_snapshots_reports_stale_and_missing_prices(self):
        now = datetime(2026, 6, 6, 0, 0, 0, tzinfo=timezone.utc)
        rows = [
            quote_row("US:NVDA", 120.0, "2026-06-05T23:59:00+00:00", "2026-06-06T00:04:00+00:00"),
            quote_row("KR:005930", None, "2026-06-05T20:00:00+00:00", "2026-06-05T20:05:00+00:00"),
        ]

        summary = report.summarize_quote_snapshots(rows, now=now, stale_after_hours=2)

        self.assertEqual(summary["total_snapshots"], 2)
        self.assertEqual(summary["stale_snapshots"], 1)
        self.assertEqual(summary["missing_price_count"], 1)
        self.assertEqual(summary["by_market"]["US"], 1)
        self.assertEqual(summary["by_market"]["KR"], 1)

    def test_summarize_industry_benchmarks_reports_expired_and_low_sample_rows(self):
        now = datetime(2026, 6, 6, 0, 0, 0, tzinfo=timezone.utc)
        rows = [
            {"metric": "forward_per", "source": "finviz_industry", "sample_count": 8, "as_of_date": "2026-06-05", "expires_at": "2026-06-07T00:00:00+00:00"},
            {"metric": "per", "source": "score_snapshot", "sample_count": 3, "as_of_date": "2026-06-04", "expires_at": "2026-06-05T00:00:00+00:00"},
        ]

        summary = report.summarize_industry_benchmarks(rows, now=now)

        self.assertEqual(summary["total_rows"], 2)
        self.assertEqual(summary["expired_rows"], 1)
        self.assertEqual(summary["low_sample_rows"], 1)
        self.assertEqual(summary["oldest_as_of_date"], "2026-06-04")
        self.assertEqual(summary["newest_as_of_date"], "2026-06-05")

    def test_fetch_supabase_report_calls_rpc_and_snapshot_query(self):
        calls = []

        class FakeResponse:
            def __init__(self, status_code, payload):
                self.status_code = status_code
                self.text = json.dumps(payload)
                self._payload = payload

            def json(self):
                return self._payload

        def fake_post(url, headers=None, data=None, timeout=None):
            calls.append(("post", url, data, timeout))
            return FakeResponse(200, {"refresh_queue": [{"kind": "score", "status": "queued", "jobs": 2}]})

        def fake_get(url, headers=None, timeout=None):
            calls.append(("get", url, None, timeout))
            if "/rest/v1/stock_score_snapshots?" in url:
                return FakeResponse(200, [score_row("US:NVDA", 88, 88, 70, 0.9, "2026-06-05T23:00:00+00:00")])
            if "/rest/v1/stock_quote_snapshots?" in url:
                return FakeResponse(200, [quote_row("US:NVDA", 120.0, "2026-06-05T23:58:00+00:00", "2026-06-06T00:03:00+00:00")])
            if "/rest/v1/stock_industry_benchmarks?" in url:
                return FakeResponse(200, [{"metric": "forward_per", "source": "finviz_industry", "sample_count": 8, "as_of_date": "2026-06-05", "expires_at": "2026-06-07T00:00:00+00:00"}])
            if "/rest/v1/market_calendar?" in url:
                return FakeResponse(200, [{"market": "US", "trade_date": "2026-06-08", "is_open": True}])
            return FakeResponse(404, {"error": "unexpected"})

        original_post = report.requests.post
        original_get = report.requests.get
        report.requests.post = fake_post
        report.requests.get = fake_get
        try:
            config = SupabaseReportConfig(url="https://example.supabase.co", key="service-role-key", timeout_seconds=9)
            payload = report.fetch_supabase_report(config, sample_limit=50, stale_after_hours=24)
        finally:
            report.requests.post = original_post
            report.requests.get = original_get

        self.assertEqual(payload["refresh_queue"]["queued_jobs"], 2)
        self.assertEqual(payload["score_calibration"]["total_snapshots"], 1)
        self.assertEqual(payload["quote_freshness"]["total_snapshots"], 1)
        self.assertEqual(payload["industry_benchmarks"]["total_rows"], 1)
        self.assertEqual(payload["market_calendar"]["total_rows"], 1)
        self.assertEqual(calls[0][0], "post")
        self.assertEqual(calls[0][1], "https://example.supabase.co/rest/v1/rpc/stock_operations_report")
        self.assertIn('"p_score_stale_hours": 24', calls[0][2])
        self.assertEqual(calls[1][0], "get")
        self.assertIn("/rest/v1/stock_score_snapshots?", calls[1][1])
        self.assertIn("limit=50", calls[1][1])
        self.assertEqual(calls[1][3], 9)
        self.assertIn("/rest/v1/stock_quote_snapshots?", calls[2][1])
        self.assertIn("/rest/v1/stock_industry_benchmarks?", calls[3][1])
        self.assertIn("/rest/v1/market_calendar?", calls[4][1])


def score_row(ticker, score, quality, opportunity, confidence, fetched_at, version=None):
    model = version or report.DEFAULT_SCORE_MODEL_VERSION
    return {
        "ticker": ticker,
        "view_mode": "detail",
        "fetched_at": fetched_at,
        "expires_at": "2026-06-06T02:00:00+00:00",
        "score_model_version": model,
        "payload": {
            "score": score,
            "quality_score": quality,
            "opportunity_score": opportunity,
            "opportunity_confidence": 0.7,
            "score_model_version": model,
            "sia_snapshot": {
                "confidence": confidence,
                "quality_score": quality,
                "opportunity_score": opportunity,
                "score_model_version": model,
            },
        },
    }


def quote_row(ticker, latest_price, fetched_at, expires_at):
    return {
        "ticker": ticker,
        "fetched_at": fetched_at,
        "expires_at": expires_at,
        "payload": {
            "market": "KR" if ticker.startswith("KR:") else "US",
            "latest_price": latest_price,
            "server_cache": {"state": "fresh"},
        },
    }


if __name__ == "__main__":
    unittest.main()
