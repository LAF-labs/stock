import unittest

from scripts.finviz_industry_taxonomy import canonical_industry_key_for
from scripts.sync_canonical_industry_tags import (
    canonical_industry_for_profile,
    canonical_tag_rows_for_profile,
)


class SyncCanonicalIndustryTagsTests(unittest.TestCase):
    def test_manual_kr_product_override_wins_for_ambiguous_source_industry(self):
        profile = {
            "market": "KR",
            "symbol": "054090",
            "primary_sector": "기타",
            "primary_industry": "그외 기타 제품 제조업",
            "metadata": {"kind_main_products": "몰드프레임, TFT-LCD BLU"},
        }

        item, confidence, source, raw = canonical_industry_for_profile(profile)

        self.assertEqual(item.industry_ko, "전자부품")
        self.assertEqual(source, "manual_kr_product_review")
        self.assertGreaterEqual(confidence, 0.85)
        self.assertIn("manual_reason", raw)

    def test_non_manual_profile_uses_taxonomy_mapping(self):
        profile = {
            "market": "KR",
            "symbol": "010120",
            "primary_sector": "산업재",
            "primary_industry": "전동기, 발전기 및 전기 변환 · 공급 · 제어 장치 제조업",
            "metadata": {},
        }

        item, confidence, source, _raw = canonical_industry_for_profile(profile)

        self.assertEqual(item.industry_ko, "전기장비·부품")
        self.assertEqual(source, "industry_taxonomy_map")
        self.assertGreaterEqual(confidence, 0.8)

    def test_korean_product_keywords_split_coarse_source_industries(self):
        cases = (
            (
                {
                    "market": "KR",
                    "symbol": "023770",
                    "primary_sector": "정보기술",
                    "primary_industry": "소프트웨어 개발 및 공급업",
                    "metadata": {"kind_main_products": "게임소프트웨어"},
                },
                "게임·멀티미디어",
            ),
            (
                {
                    "market": "KR",
                    "symbol": "003160",
                    "primary_sector": "기타",
                    "primary_industry": "측정, 시험, 항해, 제어 및 기타 정밀기기 제조업; 광학기기 제외",
                    "metadata": {"kind_main_products": "반도체검사장비,전자부품"},
                },
                "반도체 장비·소재",
            ),
            (
                {
                    "market": "KR",
                    "symbol": "039560",
                    "primary_sector": "정보기술",
                    "primary_industry": "통신 및 방송 장비 제조업",
                    "metadata": {"kind_main_products": "네트워크 통신장비"},
                },
                "통신장비",
            ),
            (
                {
                    "market": "KR",
                    "symbol": "0009K0",
                    "primary_sector": "기타",
                    "primary_industry": "자연과학 및 공학 연구개발업",
                    "metadata": {"kind_main_products": "ADC 기반 항암제"},
                },
                "바이오테크",
            ),
            (
                {
                    "market": "KR",
                    "symbol": "032830",
                    "primary_sector": "금융",
                    "primary_industry": "보험업",
                    "metadata": {"kind_main_products": "생명보험,부동산 임대"},
                },
                "생명보험",
            ),
            (
                {
                    "market": "KR",
                    "symbol": "000810",
                    "primary_sector": "금융",
                    "primary_industry": "보험업",
                    "metadata": {"kind_main_products": "손해보험의 원수,재보험,운용자산의 투자활동"},
                },
                "손해보험",
            ),
        )

        for profile, expected_industry in cases:
            with self.subTest(symbol=profile["symbol"]):
                item, confidence, source, raw = canonical_industry_for_profile(profile)

                self.assertEqual(item.industry_ko, expected_industry)
                self.assertEqual(source, "kr_product_keyword_review")
                self.assertGreaterEqual(confidence, 0.8)
                self.assertIn("product_keyword", raw)

    def test_profile_generates_sector_and_primary_industry_tag_rows(self):
        profile = {
            "market": "KR",
            "symbol": "010120",
            "primary_sector": "산업재",
            "primary_industry": "전동기, 발전기 및 전기 변환 · 공급 · 제어 장치 제조업",
            "metadata": {},
        }

        rows = canonical_tag_rows_for_profile(profile)

        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["level"], 1)
        self.assertFalse(rows[0]["is_primary"])
        self.assertEqual(rows[1]["level"], 2)
        self.assertTrue(rows[1]["is_primary"])
        self.assertEqual(rows[1]["name"], "전기장비·부품")
        self.assertEqual(rows[1]["code"], canonical_industry_key_for(canonical_industry_for_profile(profile)[0]))


if __name__ == "__main__":
    unittest.main()
