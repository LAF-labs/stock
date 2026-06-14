import unittest

import scripts.sync_symbol_master as sync_symbol_master


class SyncSymbolMasterTests(unittest.TestCase):
    def test_us_etf_detection_uses_provider_codes_not_name_text(self):
        row = {
            "securityType": "1",
            "typeCode": "000",
            "englishName": "Example ETF-Like Common Stock",
            "koreanName": "예시 ETF 보통주",
        }

        self.assertFalse(sync_symbol_master.is_us_etf(row))

    def test_us_etf_detection_accepts_provider_etf_codes(self):
        self.assertTrue(sync_symbol_master.is_us_etf({"securityType": "3", "typeCode": "000"}))
        self.assertTrue(sync_symbol_master.is_us_etf({"securityType": "1", "typeCode": "001"}))

    def test_kr_instrument_type_uses_security_group_not_name_text(self):
        meta = {"exchange": "KOSPI", "exchangeName": "코스피"}
        line = kr_standard_line("123456", "KR7123456789", "TIGER 나스닥 보통주", "ST", 228)

        item = sync_symbol_master.parse_kr_standard_line(line, 228, "koreanName", meta)

        self.assertEqual(item["instrumentType"], "STOCK")

    def test_kr_instrument_type_does_not_treat_brand_substrings_as_etf(self):
        meta = {"exchange": "KOSPI", "exchangeName": "코스피"}
        for name in ["파워넷", "파워로직스", "HK이노엔"]:
            line = kr_standard_line("123456", "KR7123456789", name, "ST", 228)

            item = sync_symbol_master.parse_kr_standard_line(line, 228, "koreanName", meta)

            self.assertEqual(item["instrumentType"], "STOCK")

    def test_kr_instrument_type_detects_domestic_etf_product_names(self):
        meta = {"exchange": "KOSPI", "exchangeName": "코스피"}
        line = kr_standard_line("069500", "KR7069500007", "KODEX 200", "ST", 228)

        item = sync_symbol_master.parse_kr_standard_line(line, 228, "koreanName", meta)

        self.assertEqual(item["instrumentType"], "ETF")

    def test_kr_instrument_type_accepts_security_group_etf_codes(self):
        meta = {"exchange": "KOSPI", "exchangeName": "코스피"}
        line = kr_standard_line("123456", "KR7123456789", "임의상품", "EF", 228)

        item = sync_symbol_master.parse_kr_standard_line(line, 228, "koreanName", meta)

        self.assertEqual(item["instrumentType"], "ETF")


def kr_standard_line(ticker, standard_code, name, security_group, tail_size):
    tail = security_group + (" " * (tail_size - len(security_group)))
    return f"{ticker:<9}{standard_code:<12}{name}{tail}"


if __name__ == "__main__":
    unittest.main()
