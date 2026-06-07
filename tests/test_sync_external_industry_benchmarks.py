from datetime import datetime, timezone
import unittest

from scripts.sync_external_industry_benchmarks import (
    benchmark_expires_at,
    build_finviz_benchmark_rows,
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

    def test_benchmark_expiry_crosses_weekends_and_us_holidays(self):
        saturday_after_friday_close = datetime(2026, 6, 6, 15, 0, tzinfo=timezone.utc)
        juneteenth_holiday = datetime(2026, 6, 19, 15, 0, tzinfo=timezone.utc)
        thanksgiving_early_close = datetime(2026, 11, 27, 15, 0, tzinfo=timezone.utc)

        self.assertEqual(benchmark_expires_at("US", saturday_after_friday_close), "2026-06-09T08:00:00+00:00")
        self.assertEqual(benchmark_expires_at("US", juneteenth_holiday), "2026-06-23T08:00:00+00:00")
        self.assertEqual(benchmark_expires_at("US", thanksgiving_early_close), "2026-11-28T06:00:00+00:00")


if __name__ == "__main__":
    unittest.main()
