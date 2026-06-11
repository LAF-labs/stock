import unittest

import scripts.backfill_symbol_profiles as profiles


class BackfillSymbolProfilesTests(unittest.TestCase):
    def test_asset_class_detects_abbreviated_investment_corp_spac(self):
        item = symbol_item("US", "NHIC", "NEWHOLD INVT CORP III", "NAS")

        self.assertEqual(profiles.asset_class(item), "spac")

    def test_curated_rows_fill_provider_miss_profiles(self):
        items = [
            symbol_item("US", "ALPS", "ALPS GROUP INC", "NAS"),
            symbol_item("US", "FGO", "FG HOLDINGS LTD", "NAS"),
            symbol_item("US", "NWGL", "CL WORKSHOP GROUP LIMITED", "NAS"),
            symbol_item("US", "SVA", "SINOVAC BIOTECH LTD", "NAS"),
            symbol_item("KR", "257990", "나우코스", "KONEX"),
        ]

        rows, tags, misses = profiles.build_curated_rows(items)
        by_symbol = {row["symbol"]: row for row in rows}

        self.assertEqual(misses, 0)
        self.assertEqual(by_symbol["ALPS"]["primary_industry"], "Biotechnology")
        self.assertEqual(by_symbol["FGO"]["primary_industry"], "Mortgage Finance")
        self.assertEqual(by_symbol["NWGL"]["primary_sector"], "Basic Materials")
        self.assertEqual(by_symbol["NWGL"]["primary_industry"], "Paper & Forest Products")
        self.assertEqual(by_symbol["SVA"]["primary_industry"], "Biotechnology")
        self.assertEqual(by_symbol["257990"]["primary_sector"], "소재")
        self.assertEqual(by_symbol["257990"]["primary_industry"], "기타 화학제품 제조업")
        self.assertTrue(all(row["classification_status"] == "verified" for row in rows))
        self.assertGreaterEqual(len(tags), len(rows) * 2)


def symbol_item(market, ticker, english_name, exchange):
    return {
        "market": market,
        "ticker": ticker,
        "englishName": english_name,
        "koreanName": "나우코스" if ticker == "257990" else "",
        "exchange": exchange,
        "exchangeName": exchange,
        "instrumentType": "STOCK",
        "currency": "KRW" if market == "KR" else "USD",
    }


if __name__ == "__main__":
    unittest.main()
