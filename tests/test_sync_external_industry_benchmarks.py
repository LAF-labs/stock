from datetime import datetime, timezone
from pathlib import Path
import os
import tempfile
import unittest
from unittest.mock import patch

from scripts.sync_external_industry_benchmarks import (
    benchmark_expires_at,
    build_finviz_benchmark_rows,
    delete_expired_finviz_benchmark_rows,
    finviz_rows_from_existing_benchmarks,
    fetch_text_with_cache,
    parse_finviz_group_rows,
)


class FinvizIndustryBenchmarkTests(unittest.TestCase):
    def test_parse_finviz_group_rows_extracts_valuation_columns(self):
        html = """
        <table class="styled-table-new groups_table">
          <tr><th>No.</th><th>Name</th><th>Market Cap</th><th>P/E</th><th>Fwd P/E</th><th>PEG</th><th>P/S</th><th>P/B</th></tr>
          <tr>
            <td>1</td><td><a>Semiconductors</a></td><td>14490.51B</td>
            <td><span>46.62</span></td><td>36.22</td><td>1.40</td><td>12.1</td><td>8.4</td>
          </tr>
        </table>
        """

        rows = parse_finviz_group_rows(html)

        self.assertEqual(rows[0]["name"], "Semiconductors")
        self.assertEqual(rows[0]["pe"], 46.62)
        self.assertEqual(rows[0]["forward_per"], 36.22)
        self.assertEqual(rows[0]["market_cap"], "14490.51B")

    def test_parse_finviz_group_rows_keeps_first_data_row_without_header(self):
        html = """
        <table class="styled-table-new groups_table">
          <tr>
            <td>1</td><td><a>Aerospace & Defense</a></td><td>1862.33B</td>
            <td>43.09</td><td>31.68</td><td>1.83</td><td>3.34</td><td>7.49</td>
          </tr>
          <tr>
            <td>2</td><td><a>Airlines</a></td><td>191.93B</td>
            <td>13.07</td><td>9.32</td><td>0.47</td><td>0.66</td><td>2.78</td>
          </tr>
        </table>
        """

        rows = parse_finviz_group_rows(html)

        self.assertEqual([row["name"] for row in rows], ["Aerospace & Defense", "Airlines"])
        self.assertEqual(rows[0]["pe"], 43.09)
        self.assertEqual(rows[0]["forward_per"], 31.68)

    def test_build_finviz_benchmark_rows_maps_to_overseas_canonical_industry(self):
        rows = build_finviz_benchmark_rows(
            [
                {
                    "sector": "Technology",
                    "name": "Semiconductors",
                    "market_cap": "14490.51B",
                    "pe": 46.62,
                    "forward_per": 36.22,
                }
            ],
            as_of_date="2026-06-05",
            generated_at=datetime(2026, 6, 6, 15, 0, tzinfo=timezone.utc),
        )

        self.assertEqual(len(rows), 2)
        per = next(row for row in rows if row["metric"] == "per")
        forward = next(row for row in rows if row["metric"] == "forward_per")
        self.assertEqual(per["scope"], "OVERSEAS")
        self.assertEqual(per["market"], "US")
        self.assertEqual(per["sector"], "정보기술")
        self.assertEqual(per["industry"], "반도체")
        self.assertEqual(per["period"], "quarter")
        self.assertEqual(per["median"], 46.62)
        self.assertEqual(per["source"], "finviz_industry")
        self.assertEqual(per["provider_group_name"], "Semiconductors")
        self.assertEqual(per["expires_at"], "2026-06-09T08:00:00+00:00")
        self.assertEqual(forward["median"], 36.22)

    def test_build_finviz_benchmark_rows_preserves_raw_group_name(self):
        rows = build_finviz_benchmark_rows(
            [
                {
                    "sector": "Industrials",
                    "name": "Aerospace & Defense",
                    "pe": 43.09,
                    "forward_per": 31.68,
                    "psr": 3.34,
                    "pbr": 7.49,
                }
            ],
            as_of_date="2026-06-05",
            generated_at=datetime(2026, 6, 6, 15, 0, tzinfo=timezone.utc),
        )

        per = next(row for row in rows if row["metric"] == "per")

        self.assertEqual(per["sector"], "산업재")
        self.assertEqual(per["industry"], "항공우주·방산")
        self.assertEqual(per["provider_group_name"], "Aerospace & Defense")
        self.assertEqual(per["provider_group_key"], "finviz_industrials_aerospace_defense")
        self.assertEqual(per["confidence"], 1.0)

    def test_benchmark_expiry_crosses_weekends_and_us_holidays(self):
        saturday_after_friday_close = datetime(2026, 6, 6, 15, 0, tzinfo=timezone.utc)
        juneteenth_holiday = datetime(2026, 6, 19, 15, 0, tzinfo=timezone.utc)
        thanksgiving_early_close = datetime(2026, 11, 27, 15, 0, tzinfo=timezone.utc)

        self.assertEqual(benchmark_expires_at("US", saturday_after_friday_close), "2026-06-09T08:00:00+00:00")
        self.assertEqual(benchmark_expires_at("US", juneteenth_holiday), "2026-06-23T08:00:00+00:00")
        self.assertEqual(benchmark_expires_at("US", thanksgiving_early_close), "2026-11-28T06:00:00+00:00")

    def test_fetch_text_with_cache_uses_fresh_cache_without_network(self):
        with tempfile.TemporaryDirectory() as tmp:
            cache_path = Path(tmp) / "finviz.html"
            cache_path.write_text("<html>cached</html>", encoding="utf-8")

            def fail_fetcher(url: str, timeout_seconds: int) -> str:
                raise AssertionError("network should not be called for fresh cache")

            text = fetch_text_with_cache(
                "https://finviz.com/groups.ashx?g=industry&v=120",
                10,
                cache_path,
                cache_max_age_hours=24,
                fetcher=fail_fetcher,
            )

            self.assertEqual(text, "<html>cached</html>")

    def test_fetch_text_with_cache_falls_back_to_stale_cache_on_rate_limit(self):
        with tempfile.TemporaryDirectory() as tmp:
            cache_path = Path(tmp) / "finviz.html"
            cache_path.write_text("<html>stale</html>", encoding="utf-8")
            old_timestamp = 1_700_000_000
            os.utime(cache_path, (old_timestamp, old_timestamp))

            def rate_limited_fetcher(url: str, timeout_seconds: int) -> str:
                raise RuntimeError("curl: (56) The requested URL returned error: 429")

            text = fetch_text_with_cache(
                "https://finviz.com/groups.ashx?g=industry&v=120",
                10,
                cache_path,
                cache_max_age_hours=1,
                fetcher=rate_limited_fetcher,
            )

            self.assertEqual(text, "<html>stale</html>")

    def test_fetch_text_with_cache_refreshes_stale_cache_after_success(self):
        with tempfile.TemporaryDirectory() as tmp:
            cache_path = Path(tmp) / "finviz.html"
            cache_path.write_text("<html>stale</html>", encoding="utf-8")
            old_timestamp = 1_700_000_000
            os.utime(cache_path, (old_timestamp, old_timestamp))

            def successful_fetcher(url: str, timeout_seconds: int) -> str:
                return "<html>fresh</html>"

            text = fetch_text_with_cache(
                "https://finviz.com/groups.ashx?g=industry&v=120",
                10,
                cache_path,
                cache_max_age_hours=1,
                fetcher=successful_fetcher,
            )

            self.assertEqual(text, "<html>fresh</html>")
            self.assertEqual(cache_path.read_text(encoding="utf-8"), "<html>fresh</html>")

    def test_finviz_rows_from_existing_benchmarks_reconstructs_raw_groups(self):
        rows = finviz_rows_from_existing_benchmarks(
            [
                {
                    "provider_group_name": "Semiconductors",
                    "metric": "per",
                    "median": 46.62,
                    "sample_count": 8,
                },
                {
                    "provider_group_name": "Semiconductors",
                    "metric": "forward_per",
                    "median": 36.22,
                    "sample_count": 8,
                },
                {
                    "provider_group_name": "Semiconductors",
                    "metric": "psr",
                    "median": 12.1,
                    "sample_count": 8,
                },
                {
                    "provider_group_name": "Semiconductors",
                    "metric": "pbr",
                    "median": 8.4,
                    "sample_count": 8,
                },
            ]
        )

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["name"], "Semiconductors")
        self.assertEqual(rows[0]["sector"], "Technology")
        self.assertEqual(rows[0]["pe"], 46.62)
        self.assertEqual(rows[0]["forward_per"], 36.22)
        self.assertEqual(rows[0]["psr"], 12.1)
        self.assertEqual(rows[0]["pbr"], 8.4)

    def test_finviz_rows_from_existing_benchmarks_uses_latest_as_of_date(self):
        rows = finviz_rows_from_existing_benchmarks(
            [
                {
                    "provider_group_name": "Semiconductors",
                    "metric": "per",
                    "median": 46.62,
                    "sample_count": 8,
                    "as_of_date": "2026-06-12",
                },
                {
                    "provider_group_name": "Semiconductors",
                    "metric": "per",
                    "median": 99.0,
                    "sample_count": 8,
                    "as_of_date": "2026-06-11",
                },
            ]
        )

        self.assertEqual(rows[0]["pe"], 46.62)

    def test_delete_expired_finviz_benchmark_rows_prunes_only_expired_finviz_rows(self):
        class Response:
            status_code = 204
            text = ""
            headers = {"Content-Range": "*/42"}

        with patch.dict(os.environ, {"SUPABASE_URL": "https://example.supabase.co", "SUPABASE_SERVICE_ROLE_KEY": "service-role-key"}):
            with patch("requests.delete", return_value=Response()) as delete:
                count = delete_expired_finviz_benchmark_rows(
                    False,
                    now=datetime(2026, 7, 2, 0, 0, tzinfo=timezone.utc),
                    timeout_seconds=12,
                )

        self.assertEqual(count, 42)
        _args, kwargs = delete.call_args
        self.assertEqual(kwargs["params"], {
            "source": "eq.finviz_industry",
            "expires_at": "lte.2026-07-02T00:00:00+00:00",
        })
        self.assertEqual(kwargs["timeout"], 12)
        self.assertEqual(kwargs["headers"]["Prefer"], "return=minimal,count=exact")


if __name__ == "__main__":
    unittest.main()
