import unittest

from scripts.finviz_industry_taxonomy import (
    FINVIZ_INDUSTRIES,
    canonical_industry_key_for,
    canonical_names_for_provider,
    finviz_industry_by_slug,
    finviz_industry_by_name,
)


class FinvizIndustryTaxonomyTests(unittest.TestCase):
    def test_master_contains_144_unique_finviz_industries(self):
        names = [item.name for item in FINVIZ_INDUSTRIES]

        self.assertEqual(len(names), 144)
        self.assertEqual(len(set(names)), 144)
        self.assertIsNotNone(finviz_industry_by_name("Aerospace & Defense"))
        self.assertIsNotNone(finviz_industry_by_name("Semiconductors"))
        self.assertIsNotNone(finviz_industry_by_name("Waste Management"))

    def test_slug_matches_existing_pipeline_keys(self):
        item = finviz_industry_by_name("Aerospace & Defense")

        self.assertIsNotNone(item)
        assert item is not None
        self.assertEqual(item.slug, "aerospace_defense")
        self.assertEqual(canonical_industry_key_for(item), "산업재_aerospace_defense")
        self.assertEqual(finviz_industry_by_slug("aerospace_defense"), item)

    def test_exact_us_industry_maps_to_korean_display_label(self):
        sector, industry, confidence = canonical_names_for_provider("US", "Technology", "Semiconductors")

        self.assertEqual(sector, "정보기술")
        self.assertEqual(industry, "반도체")
        self.assertEqual(confidence, 1.0)

    def test_korean_source_industry_maps_to_same_canonical_label(self):
        sector, industry, confidence = canonical_names_for_provider("KR", "전기전자", "반도체 제조업")

        self.assertEqual(sector, "정보기술")
        self.assertEqual(industry, "반도체")
        self.assertGreaterEqual(confidence, 0.8)

    def test_korean_exchange_industry_phrases_map_to_specific_finviz_industries(self):
        cases = (
            (("KR", "헬스케어", "의료용 기기 제조업"), "헬스케어", "의료기기"),
            (("KR", "기타", "도로 화물 운송업"), "산업재", "트럭 운송"),
            (("KR", "기타", "일차전지 및 이차전지 제조업"), "산업재", "전기장비·부품"),
            (("KR", "헬스케어", "기초 의약물질 제조업"), "헬스케어", "일반 제약"),
            (("KR", "정보기술", "컴퓨터 프로그래밍, 시스템 통합 및 관리업"), "정보기술", "IT 서비스"),
        )

        for provider_input, expected_sector, expected_industry in cases:
            with self.subTest(provider_input=provider_input):
                sector, industry, confidence = canonical_names_for_provider(*provider_input)

                self.assertEqual(sector, expected_sector)
                self.assertEqual(industry, expected_industry)
                self.assertGreaterEqual(confidence, 0.74)

    def test_nasdaq_source_industry_phrases_map_to_specific_finviz_industries(self):
        cases = (
            (("US", "Technology", "Computer Software: Prepackaged Software"), "정보기술", "응용 소프트웨어"),
            (("US", "Technology", "Computer Software: Programming, Data Processing"), "정보기술", "IT 서비스"),
            (("US", "Technology", "EDP Services"), "정보기술", "IT 서비스"),
            (("US", "Real Estate", "Real Estate Investment Trusts"), "부동산", "종합 리츠"),
            (("US", "Finance", "Property-Casualty Insurers"), "금융", "손해보험"),
            (("US", "Finance", "Savings Institutions"), "금융", "지역은행"),
            (("US", "Health Care", "Medical/Dental Instruments"), "헬스케어", "의료기기"),
            (("US", "Consumer Discretionary", "Clothing/Shoe/Accessory Stores"), "경기소비재", "의류 소매"),
            (("US", "Consumer Discretionary", "Package Goods/Cosmetics"), "필수소비재", "생활·개인용품"),
            (("US", "Consumer Discretionary", "Marine Transportation"), "산업재", "해운"),
            (("US", "Industrials", "Auto Manufacturing"), "경기소비재", "자동차 제조"),
            (("US", "Consumer Discretionary", "Air Freight/Delivery Services"), "산업재", "종합 물류"),
            (("US", "Technology", "Computer peripheral equipment"), "정보기술", "컴퓨터 하드웨어"),
            (("US", "Utilities", "Power Generation"), "유틸리티", "민자 발전"),
            (("US", "Consumer Staples", "Farming/Seeds/Milling"), "필수소비재", "농산물"),
            (("US", "Health Care", "Hospital/Nursing Management"), "헬스케어", "의료기관"),
            (("US", "Finance", "Finance/Investors Services"), "금융", "자산운용"),
            (("US", "Utilities", "Water Supply"), "유틸리티", "규제 수도"),
            (("US", "Energy", "Coal Mining"), "에너지", "발전용 석탄"),
            (("US", "Technology", "Computer Manufacturing"), "정보기술", "컴퓨터 하드웨어"),
            (("US", "Technology", "Retail: Computer Software & Peripheral Equipment"), "정보기술", "전자·컴퓨터 유통"),
            (("US", "Consumer Discretionary", "Food Distributors"), "필수소비재", "식품 유통"),
            (("US", "Miscellaneous", "Multi-Sector Companies"), "산업재", "복합기업"),
        )

        for provider_input, expected_sector, expected_industry in cases:
            with self.subTest(provider_input=provider_input):
                sector, industry, confidence = canonical_names_for_provider(*provider_input)

                self.assertEqual(sector, expected_sector)
                self.assertEqual(industry, expected_industry)
                self.assertGreaterEqual(confidence, 0.74)

    def test_manually_reviewed_korean_source_groups_use_closest_finviz_industry(self):
        cases = (
            (("KR", "금융", "기타 금융업"), "금융", "금융 복합기업"),
            (("KR", "금융", "금융 지원 서비스업"), "금융", "자본시장"),
            (("KR", "금융", "신탁업 및 집합투자업"), "금융", "자산운용"),
            (("KR", "기타", "자연과학 및 공학 연구개발업"), "헬스케어", "진단·연구"),
            (("KR", "소재", "플라스틱제품 제조업"), "경기소비재", "포장재·컨테이너"),
            (("KR", "산업재", "전동기, 발전기 및 전기 변환 · 공급 · 제어 장치 제조업"), "산업재", "전기장비·부품"),
            (("KR", "경기소비재", "기타 전문 도매업"), "산업재", "산업재 유통"),
            (("KR", "경기소비재", "상품 종합 도매업"), "산업재", "산업재 유통"),
            (("KR", "기타", "상품 중개업"), "산업재", "산업재 유통"),
            (("KR", "헬스케어", "의료용품 및 기타 의약 관련제품 제조업"), "헬스케어", "의료 장비·소모품"),
            (("KR", "기타", "측정, 시험, 항해, 제어 및 기타 정밀기기 제조업; 광학기기 제외"), "정보기술", "과학·기술 장비"),
            (("KR", "경기소비재", "봉제의복 제조업"), "경기소비재", "의류 제조"),
            (("KR", "경기소비재", "편조의복 제조업"), "경기소비재", "의류 제조"),
            (("KR", "소재", "1차 비철금속 제조업"), "소재", "기타 산업금속·광업"),
            (("KR", "소재", "구조용 금속제품, 탱크 및 증기발생기 제조업"), "산업재", "금속 가공"),
            (("KR", "정보기술", "기타 정보 서비스업"), "정보기술", "IT 서비스"),
            (("KR", "산업재", "건축기술, 엔지니어링 및 관련 기술 서비스업"), "산업재", "엔지니어링·건설"),
            (("KR", "소재", "시멘트, 석회, 플라스터 및 그 제품 제조업"), "소재", "건축자재"),
            (("KR", "커뮤니케이션", "영상 및 음향기기 제조업"), "정보기술", "소비자 전자제품"),
            (("KR", "경기소비재", "종합 소매업"), "경기소비재", "백화점"),
            (("KR", "기타", "전기 통신업"), "커뮤니케이션", "통신서비스"),
            (("KR", "기타", "선박 및 보트 건조업"), "산업재", "특수 산업기계"),
            (("KR", "산업재", "사진장비 및 광학기기 제조업"), "정보기술", "과학·기술 장비"),
            (("KR", "정보기술", "컴퓨터 및 주변장치 제조업"), "정보기술", "컴퓨터 하드웨어"),
            (("KR", "소재", "기타 비금속 광물제품 제조업"), "소재", "건축자재"),
            (("KR", "기타", "가정용 기기 제조업"), "경기소비재", "가구·비품·가전"),
            (("KR", "기타", "절연선 및 케이블 제조업"), "산업재", "전기장비·부품"),
            (("KR", "기타", "곡물가공품, 전분 및 전분제품 제조업"), "필수소비재", "가공식품"),
            (("KR", "기타", "기타 운송관련 서비스업"), "산업재", "종합 물류"),
            (("KR", "기타", "도축, 육류 가공 및 저장 처리업"), "필수소비재", "가공식품"),
            (("KR", "기타", "수산물 가공 및 저장 처리업"), "필수소비재", "가공식품"),
            (("KR", "기타", "해상 운송업"), "산업재", "해운"),
            (("KR", "기타", "항공 여객 운송업"), "산업재", "항공사"),
            (("KR", "기타", "일반 교습 학원"), "경기소비재", "교육·훈련 서비스"),
            (("KR", "기타", "전기업"), "유틸리티", "규제 전력"),
            (("KR", "기타", "무기 및 총포탄 제조업"), "산업재", "항공우주·방산"),
            (("KR", "경기소비재", "유원지 및 기타 오락관련 서비스업"), "경기소비재", "리조트·카지노"),
            (("KR", "커뮤니케이션", "영상·오디오물 제공 서비스업"), "커뮤니케이션", "엔터테인먼트"),
            (("KR", "기타", "나무제품 제조업"), "소재", "목재 생산"),
            (("KR", "기타", "경비, 경호 및 탐정업"), "산업재", "보안·방호 서비스"),
            (("KR", "기타", "음식점업"), "경기소비재", "외식"),
            (("KR", "기타", "해체, 선별 및 원료 재생업"), "산업재", "폐기물 관리"),
        )

        for provider_input, expected_sector, expected_industry in cases:
            with self.subTest(provider_input=provider_input):
                sector, industry, confidence = canonical_names_for_provider(*provider_input)

                self.assertEqual(sector, expected_sector)
                self.assertEqual(industry, expected_industry)
                self.assertGreaterEqual(confidence, 0.74)

    def test_spacex_industry_uses_korean_finviz_display_label(self):
        sector, industry, confidence = canonical_names_for_provider("US", "Industrials", "Aerospace & Defense")

        self.assertEqual(sector, "산업재")
        self.assertEqual(industry, "항공우주·방산")
        self.assertEqual(confidence, 1.0)


if __name__ == "__main__":
    unittest.main()
