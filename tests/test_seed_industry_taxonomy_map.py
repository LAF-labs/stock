import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import scripts.seed_industry_taxonomy_map as taxonomy


class SeedIndustryTaxonomyMapTests(unittest.TestCase):
    def test_mortgage_finance_maps_to_finviz_canonical_industry(self):
        sector, industry, confidence = taxonomy.canonical_names("US", "Financial Services", "Mortgage Finance")

        self.assertEqual(sector, "금융")
        self.assertEqual(industry, "모기지 금융")
        self.assertEqual(confidence, 1.0)

    def test_korean_semiconductor_profile_maps_to_finviz_canonical_industry(self):
        sector, industry, confidence = taxonomy.canonical_names("KR", "전기전자", "반도체 제조업")

        self.assertEqual(sector, "정보기술")
        self.assertEqual(industry, "반도체")
        self.assertGreaterEqual(confidence, 0.8)

    def test_finviz_master_rows_include_profile_aliases_with_korean_display(self):
        rows = taxonomy.finviz_master_rows()
        mapping = {
            (row["taxonomy"], row["source_key"]): row
            for row in rows
        }

        semiconductor = mapping[("profile_primary", "US:technology:semiconductors")]
        aerospace = mapping[("profile_primary", "US:industrials:aerospace_defense")]

        self.assertEqual(semiconductor["canonical_industry_name"], "반도체")
        self.assertEqual(semiconductor["canonical_industry_key"], "정보기술_semiconductors")
        self.assertEqual(aerospace["canonical_industry_name"], "항공우주·방산")
        self.assertEqual(aerospace["canonical_industry_key"], "산업재_aerospace_defense")


if __name__ == "__main__":
    unittest.main()
