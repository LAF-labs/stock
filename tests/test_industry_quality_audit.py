import unittest
from urllib.parse import parse_qs, urlparse

import scripts.industry_quality_audit as audit


class IndustryQualityAuditTests(unittest.TestCase):
    def test_audit_profiles_finds_unmapped_and_small_canonical_groups(self):
        profiles = [
            profile("KR", "005930", "정보기술", "정보기술_반도체"),
            profile("KR", "000660", "정보기술", "정보기술_반도체"),
            profile("KR", "111111", "정보기술", "정보기술_통신장비"),
            profile("US", "NVDA", "technology", "technology_semiconductors"),
            profile("US", "SMALL", "technology", "technology_nanocaps"),
            profile("US", "MISS", "technology", "technology_missing"),
        ]
        mappings = [
            mapping("KR:정보기술:정보기술_반도체", "정보기술", "반도체"),
            mapping("KR:정보기술:정보기술_통신장비", "정보기술", "통신장비"),
            mapping("US:technology:technology_semiconductors", "정보기술", "반도체"),
            mapping("US:technology:technology_nanocaps", "정보기술", "반도체 장비"),
        ]

        result = audit.audit_profiles(profiles, mappings, min_sample_count=2)

        self.assertEqual(result["total_profiles"], 6)
        self.assertEqual(result["unmapped_source_key_count"], 1)
        self.assertEqual(result["unmapped_source_keys"][0]["source_key"], "US:technology:technology_missing")
        self.assertEqual(result["small_group_count"], 3)
        self.assertEqual(result["canonical_groups"][0]["canonical_industry"], "반도체")
        self.assertEqual(result["canonical_groups"][0]["sample_count"], 3)

    def test_audit_profiles_splits_missing_primary_into_actionable_and_exempt(self):
        profiles = [
            profile("US", "MISS", "", "", asset_class="stock", classification_status="pending"),
            profile("US", "ETF", "", "", asset_class="etf", classification_status="missing"),
            profile("US", "SPAC", "", "", asset_class="spac", classification_status="missing"),
            profile("KR", "005930", "정보기술", "정보기술_반도체"),
        ]
        mappings = [mapping("KR:정보기술:정보기술_반도체", "정보기술", "반도체")]

        result = audit.audit_profiles(profiles, mappings, min_sample_count=2)

        self.assertEqual(result["missing_primary_count"], 3)
        self.assertEqual(result["missing_primary_actionable_count"], 1)
        self.assertEqual(result["missing_primary_exempt_count"], 2)
        self.assertEqual(result["missing_primary_by_asset_class"], {"etf": 1, "spac": 1, "stock": 1})
        self.assertEqual(result["missing_primary_by_status"], {"missing": 2, "pending": 1})

    def test_similar_industry_names_collapse_manufacturing_noise(self):
        groups = audit.similar_industry_groups(
            [
                {"canonical_industry": "통신 및 방송 장비 제조업", "sample_count": 4},
                {"canonical_industry": "통신·방송장비 제조", "sample_count": 3},
                {"canonical_industry": "반도체", "sample_count": 20},
            ]
        )

        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0]["normalized_key"], "통신방송장비")
        self.assertEqual(sorted(groups[0]["industries"]), ["통신 및 방송 장비 제조업", "통신·방송장비 제조"])

    def test_fetch_table_paginates_supabase_rest_rows(self):
        calls = []

        class FakeResponse:
            status_code = 200
            text = "[]"

            def __init__(self, rows):
                self._rows = rows

            def json(self):
                return self._rows

        def fake_get(url, headers=None, timeout=None):
            query = parse_qs(urlparse(url).query)
            offset = int(query.get("offset", ["0"])[0])
            limit = int(query.get("limit", ["1000"])[0])
            calls.append({"offset": offset, "limit": limit, "headers": headers, "timeout": timeout})
            remaining = max(0, 2505 - offset)
            size = min(limit, remaining)
            return FakeResponse([{"row": offset + index} for index in range(size)])

        original_get = audit.requests.get
        audit.requests.get = fake_get
        try:
            config = audit.SupabaseAuditConfig(url="https://example.supabase.co", key="anon-key", timeout_seconds=7)
            rows = audit.fetch_table(config, "stock_symbol_profiles", {"select": "row", "limit": "2505"})
        finally:
            audit.requests.get = original_get

        self.assertEqual(len(rows), 2505)
        self.assertEqual([call["offset"] for call in calls], [0, 1000, 2000])
        self.assertEqual([call["limit"] for call in calls], [1000, 1000, 505])


def profile(market, symbol, sector_key, industry_key, asset_class="stock", classification_status="verified"):
    return {
        "market": market,
        "symbol": symbol,
        "asset_class": asset_class,
        "primary_sector": sector_key,
        "primary_industry": industry_key,
        "primary_sector_key": sector_key,
        "primary_industry_key": industry_key,
        "classification_status": classification_status,
        "listing_status": "listed",
    }


def mapping(source_key, canonical_sector, canonical_industry):
    return {
        "taxonomy": "profile_primary",
        "source_key": source_key,
        "canonical_sector_name": canonical_sector,
        "canonical_industry_name": canonical_industry,
    }


if __name__ == "__main__":
    unittest.main()
