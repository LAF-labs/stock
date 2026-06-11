import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import scripts.seed_industry_taxonomy_map as taxonomy


class SeedIndustryTaxonomyMapTests(unittest.TestCase):
    def test_mortgage_finance_maps_to_financial_services(self):
        sector, industry, confidence = taxonomy.canonical_names("US", "Financial Services", "Mortgage Finance")

        self.assertEqual(sector, "금융")
        self.assertEqual(industry, "금융서비스")
        self.assertGreaterEqual(confidence, 0.8)


if __name__ == "__main__":
    unittest.main()
