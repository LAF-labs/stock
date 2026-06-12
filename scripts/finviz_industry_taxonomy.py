from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Any


@dataclass(frozen=True)
class FinvizIndustry:
    name: str
    sector: str
    sector_ko: str
    industry_ko: str
    slug: str


def finviz_slug(value: str) -> str:
    return re.sub(r"_+", "_", re.sub(r"[^a-z0-9]+", "_", value.lower())).strip("_")


def _industry(sector: str, sector_ko: str, name: str, industry_ko: str) -> FinvizIndustry:
    return FinvizIndustry(name=name, sector=sector, sector_ko=sector_ko, industry_ko=industry_ko, slug=finviz_slug(name))


FINVIZ_INDUSTRIES: tuple[FinvizIndustry, ...] = (
    _industry("Communication Services", "커뮤니케이션", "Advertising Agencies", "광고 대행"),
    _industry("Industrials", "산업재", "Aerospace & Defense", "항공우주·방산"),
    _industry("Basic Materials", "소재", "Agricultural Inputs", "농업 투입재"),
    _industry("Industrials", "산업재", "Airlines", "항공사"),
    _industry("Industrials", "산업재", "Airports & Air Services", "공항·항공 서비스"),
    _industry("Basic Materials", "소재", "Aluminum", "알루미늄"),
    _industry("Consumer Cyclical", "경기소비재", "Apparel Manufacturing", "의류 제조"),
    _industry("Consumer Cyclical", "경기소비재", "Apparel Retail", "의류 소매"),
    _industry("Financial", "금융", "Asset Management", "자산운용"),
    _industry("Consumer Cyclical", "경기소비재", "Auto & Truck Dealerships", "자동차 딜러"),
    _industry("Consumer Cyclical", "경기소비재", "Auto Manufacturers", "자동차 제조"),
    _industry("Consumer Cyclical", "경기소비재", "Auto Parts", "자동차 부품"),
    _industry("Financial", "금융", "Banks - Diversified", "종합은행"),
    _industry("Financial", "금융", "Banks - Regional", "지역은행"),
    _industry("Consumer Defensive", "필수소비재", "Beverages - Brewers", "맥주"),
    _industry("Consumer Defensive", "필수소비재", "Beverages - Non-Alcoholic", "비알코올 음료"),
    _industry("Consumer Defensive", "필수소비재", "Beverages - Wineries & Distilleries", "와인·증류주"),
    _industry("Healthcare", "헬스케어", "Biotechnology", "바이오테크"),
    _industry("Communication Services", "커뮤니케이션", "Broadcasting", "방송"),
    _industry("Basic Materials", "소재", "Building Materials", "건축자재"),
    _industry("Industrials", "산업재", "Building Products & Equipment", "건축 제품·장비"),
    _industry("Industrials", "산업재", "Business Equipment & Supplies", "업무 장비·소모품"),
    _industry("Financial", "금융", "Capital Markets", "자본시장"),
    _industry("Basic Materials", "소재", "Chemicals", "화학"),
    _industry("Basic Materials", "소재", "Coking Coal", "제철용 석탄"),
    _industry("Technology", "정보기술", "Communication Equipment", "통신장비"),
    _industry("Technology", "정보기술", "Computer Hardware", "컴퓨터 하드웨어"),
    _industry("Consumer Defensive", "필수소비재", "Confectioners", "제과"),
    _industry("Industrials", "산업재", "Conglomerates", "복합기업"),
    _industry("Industrials", "산업재", "Consulting Services", "컨설팅 서비스"),
    _industry("Technology", "정보기술", "Consumer Electronics", "소비자 전자제품"),
    _industry("Basic Materials", "소재", "Copper", "구리"),
    _industry("Financial", "금융", "Credit Services", "신용 서비스"),
    _industry("Consumer Cyclical", "경기소비재", "Department Stores", "백화점"),
    _industry("Healthcare", "헬스케어", "Diagnostics & Research", "진단·연구"),
    _industry("Consumer Defensive", "필수소비재", "Discount Stores", "할인점"),
    _industry("Healthcare", "헬스케어", "Drug Manufacturers - General", "일반 제약"),
    _industry("Healthcare", "헬스케어", "Drug Manufacturers - Specialty & Generic", "전문·제네릭 제약"),
    _industry("Consumer Cyclical", "경기소비재", "Education & Training Services", "교육·훈련 서비스"),
    _industry("Industrials", "산업재", "Electrical Equipment & Parts", "전기장비·부품"),
    _industry("Technology", "정보기술", "Electronic Components", "전자부품"),
    _industry("Communication Services", "커뮤니케이션", "Electronic Gaming & Multimedia", "게임·멀티미디어"),
    _industry("Technology", "정보기술", "Electronics & Computer Distribution", "전자·컴퓨터 유통"),
    _industry("Industrials", "산업재", "Engineering & Construction", "엔지니어링·건설"),
    _industry("Communication Services", "커뮤니케이션", "Entertainment", "엔터테인먼트"),
    _industry("Industrials", "산업재", "Farm & Heavy Construction Machinery", "농업·중장비"),
    _industry("Consumer Defensive", "필수소비재", "Farm Products", "농산물"),
    _industry("Financial", "금융", "Financial Conglomerates", "금융 복합기업"),
    _industry("Financial", "금융", "Financial Data & Stock Exchanges", "금융 데이터·거래소"),
    _industry("Consumer Defensive", "필수소비재", "Food Distribution", "식품 유통"),
    _industry("Consumer Cyclical", "경기소비재", "Footwear & Accessories", "신발·액세서리"),
    _industry("Consumer Cyclical", "경기소비재", "Furnishings, Fixtures & Appliances", "가구·비품·가전"),
    _industry("Consumer Cyclical", "경기소비재", "Gambling", "도박·베팅"),
    _industry("Basic Materials", "소재", "Gold", "금"),
    _industry("Consumer Defensive", "필수소비재", "Grocery Stores", "식료품점"),
    _industry("Healthcare", "헬스케어", "Health Information Services", "헬스케어 정보서비스"),
    _industry("Healthcare", "헬스케어", "Healthcare Plans", "건강보험"),
    _industry("Consumer Cyclical", "경기소비재", "Home Improvement Retail", "주택개선 소매"),
    _industry("Consumer Defensive", "필수소비재", "Household & Personal Products", "생활·개인용품"),
    _industry("Industrials", "산업재", "Industrial Distribution", "산업재 유통"),
    _industry("Technology", "정보기술", "Information Technology Services", "IT 서비스"),
    _industry("Financial", "금융", "Insurance - Diversified", "종합보험"),
    _industry("Financial", "금융", "Insurance - Life", "생명보험"),
    _industry("Financial", "금융", "Insurance - Property & Casualty", "손해보험"),
    _industry("Financial", "금융", "Insurance - Reinsurance", "재보험"),
    _industry("Financial", "금융", "Insurance - Specialty", "특수보험"),
    _industry("Financial", "금융", "Insurance Brokers", "보험중개"),
    _industry("Industrials", "산업재", "Integrated Freight & Logistics", "종합 물류"),
    _industry("Communication Services", "커뮤니케이션", "Internet Content & Information", "인터넷 콘텐츠·정보"),
    _industry("Consumer Cyclical", "경기소비재", "Internet Retail", "인터넷 소매"),
    _industry("Consumer Cyclical", "경기소비재", "Leisure", "레저"),
    _industry("Consumer Cyclical", "경기소비재", "Lodging", "숙박"),
    _industry("Basic Materials", "소재", "Lumber & Wood Production", "목재 생산"),
    _industry("Consumer Cyclical", "경기소비재", "Luxury Goods", "명품"),
    _industry("Industrials", "산업재", "Marine Shipping", "해운"),
    _industry("Healthcare", "헬스케어", "Medical Care Facilities", "의료기관"),
    _industry("Healthcare", "헬스케어", "Medical Devices", "의료기기"),
    _industry("Healthcare", "헬스케어", "Medical Distribution", "의료 유통"),
    _industry("Healthcare", "헬스케어", "Medical Instruments & Supplies", "의료 장비·소모품"),
    _industry("Industrials", "산업재", "Metal Fabrication", "금속 가공"),
    _industry("Financial", "금융", "Mortgage Finance", "모기지 금융"),
    _industry("Energy", "에너지", "Oil & Gas Drilling", "석유·가스 시추"),
    _industry("Energy", "에너지", "Oil & Gas E&P", "석유·가스 탐사·생산"),
    _industry("Energy", "에너지", "Oil & Gas Equipment & Services", "석유·가스 장비·서비스"),
    _industry("Energy", "에너지", "Oil & Gas Integrated", "종합 석유·가스"),
    _industry("Energy", "에너지", "Oil & Gas Midstream", "석유·가스 미드스트림"),
    _industry("Energy", "에너지", "Oil & Gas Refining & Marketing", "정유·마케팅"),
    _industry("Basic Materials", "소재", "Other Industrial Metals & Mining", "기타 산업금속·광업"),
    _industry("Basic Materials", "소재", "Other Precious Metals & Mining", "기타 귀금속·광업"),
    _industry("Consumer Defensive", "필수소비재", "Packaged Foods", "가공식품"),
    _industry("Consumer Cyclical", "경기소비재", "Packaging & Containers", "포장재·컨테이너"),
    _industry("Basic Materials", "소재", "Paper & Paper Products", "종이·제지"),
    _industry("Consumer Cyclical", "경기소비재", "Personal Services", "개인 서비스"),
    _industry("Healthcare", "헬스케어", "Pharmaceutical Retailers", "의약품 소매"),
    _industry("Industrials", "산업재", "Pollution & Treatment Controls", "오염·처리 제어"),
    _industry("Communication Services", "커뮤니케이션", "Publishing", "출판"),
    _industry("Industrials", "산업재", "Railroads", "철도"),
    _industry("Real Estate", "부동산", "Real Estate - Development", "부동산 개발"),
    _industry("Real Estate", "부동산", "Real Estate - Diversified", "종합 부동산"),
    _industry("Real Estate", "부동산", "Real Estate Services", "부동산 서비스"),
    _industry("Consumer Cyclical", "경기소비재", "Recreational Vehicles", "레저용 차량"),
    _industry("Real Estate", "부동산", "REIT - Diversified", "종합 리츠"),
    _industry("Real Estate", "부동산", "REIT - Healthcare Facilities", "헬스케어 리츠"),
    _industry("Real Estate", "부동산", "REIT - Hotel & Motel", "호텔·모텔 리츠"),
    _industry("Real Estate", "부동산", "REIT - Industrial", "산업 리츠"),
    _industry("Real Estate", "부동산", "REIT - Mortgage", "모기지 리츠"),
    _industry("Real Estate", "부동산", "REIT - Office", "오피스 리츠"),
    _industry("Real Estate", "부동산", "REIT - Residential", "주거 리츠"),
    _industry("Real Estate", "부동산", "REIT - Retail", "리테일 리츠"),
    _industry("Real Estate", "부동산", "REIT - Specialty", "특수 리츠"),
    _industry("Industrials", "산업재", "Rental & Leasing Services", "렌탈·리스 서비스"),
    _industry("Consumer Cyclical", "경기소비재", "Residential Construction", "주택 건설"),
    _industry("Consumer Cyclical", "경기소비재", "Resorts & Casinos", "리조트·카지노"),
    _industry("Consumer Cyclical", "경기소비재", "Restaurants", "외식"),
    _industry("Technology", "정보기술", "Scientific & Technical Instruments", "과학·기술 장비"),
    _industry("Industrials", "산업재", "Security & Protection Services", "보안·방호 서비스"),
    _industry("Technology", "정보기술", "Semiconductor Equipment & Materials", "반도체 장비·소재"),
    _industry("Technology", "정보기술", "Semiconductors", "반도체"),
    _industry("Financial", "금융", "Shell Companies", "스팩·페이퍼컴퍼니"),
    _industry("Basic Materials", "소재", "Silver", "은"),
    _industry("Technology", "정보기술", "Software - Application", "응용 소프트웨어"),
    _industry("Technology", "정보기술", "Software - Infrastructure", "인프라 소프트웨어"),
    _industry("Technology", "정보기술", "Solar", "태양광"),
    _industry("Industrials", "산업재", "Specialty Business Services", "전문 비즈니스 서비스"),
    _industry("Basic Materials", "소재", "Specialty Chemicals", "특수화학"),
    _industry("Industrials", "산업재", "Specialty Industrial Machinery", "특수 산업기계"),
    _industry("Consumer Cyclical", "경기소비재", "Specialty Retail", "전문 소매"),
    _industry("Industrials", "산업재", "Staffing & Employment Services", "인력·고용 서비스"),
    _industry("Basic Materials", "소재", "Steel", "철강"),
    _industry("Communication Services", "커뮤니케이션", "Telecom Services", "통신서비스"),
    _industry("Consumer Cyclical", "경기소비재", "Textile Manufacturing", "섬유 제조"),
    _industry("Energy", "에너지", "Thermal Coal", "발전용 석탄"),
    _industry("Consumer Defensive", "필수소비재", "Tobacco", "담배"),
    _industry("Industrials", "산업재", "Tools & Accessories", "공구·액세서리"),
    _industry("Consumer Cyclical", "경기소비재", "Travel Services", "여행 서비스"),
    _industry("Industrials", "산업재", "Trucking", "트럭 운송"),
    _industry("Energy", "에너지", "Uranium", "우라늄"),
    _industry("Utilities", "유틸리티", "Utilities - Diversified", "종합 유틸리티"),
    _industry("Utilities", "유틸리티", "Utilities - Independent Power Producers", "민자 발전"),
    _industry("Utilities", "유틸리티", "Utilities - Regulated Electric", "규제 전력"),
    _industry("Utilities", "유틸리티", "Utilities - Regulated Gas", "규제 가스"),
    _industry("Utilities", "유틸리티", "Utilities - Regulated Water", "규제 수도"),
    _industry("Utilities", "유틸리티", "Utilities - Renewable", "재생 유틸리티"),
    _industry("Industrials", "산업재", "Waste Management", "폐기물 관리"),
)

_BY_NORMALIZED_NAME = {re.sub(r"\s+", " ", item.name).strip().lower(): item for item in FINVIZ_INDUSTRIES}
_BY_SLUG = {item.slug: item for item in FINVIZ_INDUSTRIES}


def finviz_industry_by_name(name: str | None) -> FinvizIndustry | None:
    cleaned = clean_text(name).lower()
    if not cleaned:
        return None
    return _BY_NORMALIZED_NAME.get(cleaned) or _BY_SLUG.get(finviz_slug(cleaned))


def finviz_industry_by_slug(slug: str | None) -> FinvizIndustry | None:
    return _BY_SLUG.get(clean_text(slug))


def canonical_names_for_provider(market: str, provider_sector: str, provider_industry: str) -> tuple[str, str, float]:
    item, confidence = canonical_industry_for_provider(market, provider_sector, provider_industry)
    return item.sector_ko, item.industry_ko, confidence


def canonical_industry_for_provider(market: str, provider_sector: str, provider_industry: str) -> tuple[FinvizIndustry, float]:
    exact = finviz_industry_by_name(provider_industry)
    if exact:
        return exact, 1.0

    matched = match_provider_industry(provider_sector, provider_industry)
    if matched:
        return matched

    fallback = fallback_industry_for_sector(market, provider_sector, provider_industry)
    return fallback, 0.35


def canonical_industry_key_for(item: FinvizIndustry) -> str:
    return f"{item.sector_ko}_{item.slug}"


def clean_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip())


KR_EXACT_INDUSTRY_RULES: tuple[tuple[str, str, float], ...] = (
    ("기타 금융업", "Financial Conglomerates", 0.74),
    ("금융 지원 서비스업", "Capital Markets", 0.76),
    ("신탁업 및 집합투자업", "Asset Management", 0.8),
    ("재 보험업", "Insurance - Reinsurance", 0.82),
    ("보험업", "Insurance - Diversified", 0.78),
    ("보험 및 연금관련 서비스업", "Insurance Brokers", 0.74),
    ("자연과학 및 공학 연구개발업", "Diagnostics & Research", 0.74),
    ("기타 과학기술 서비스업", "Specialty Business Services", 0.74),
    ("그외 기타 전문, 과학 및 기술 서비스업", "Specialty Business Services", 0.74),
    ("측정, 시험, 항해, 제어 및 기타 정밀기기 제조업; 광학기기 제외", "Scientific & Technical Instruments", 0.8),
    ("사진장비 및 광학기기 제조업", "Scientific & Technical Instruments", 0.78),
    ("컴퓨터 및 주변장치 제조업", "Computer Hardware", 0.8),
    ("기타 정보 서비스업", "Information Technology Services", 0.76),
    ("컴퓨터 프로그래밍, 시스템 통합 및 관리업", "Information Technology Services", 0.78),
    ("전기 통신업", "Telecom Services", 0.82),
    ("영상 및 음향기기 제조업", "Consumer Electronics", 0.78),
    ("영상·오디오물 제공 서비스업", "Entertainment", 0.76),
    ("창작 및 예술관련 서비스업", "Entertainment", 0.74),
    ("전동기, 발전기 및 전기 변환 · 공급 · 제어 장치 제조업", "Electrical Equipment & Parts", 0.82),
    ("절연선 및 케이블 제조업", "Electrical Equipment & Parts", 0.8),
    ("전구 및 조명장치 제조업", "Electrical Equipment & Parts", 0.78),
    ("일차전지 및 이차전지 제조업", "Electrical Equipment & Parts", 0.8),
    ("전기 및 통신 공사업", "Engineering & Construction", 0.76),
    ("건축기술, 엔지니어링 및 관련 기술 서비스업", "Engineering & Construction", 0.8),
    ("건물설비 설치 공사업", "Engineering & Construction", 0.76),
    ("기반조성 및 시설물 축조관련 전문공사업", "Engineering & Construction", 0.76),
    ("실내건축 및 건축마무리 공사업", "Engineering & Construction", 0.76),
    ("선박 및 보트 건조업", "Specialty Industrial Machinery", 0.74),
    ("그외 기타 운송장비 제조업", "Specialty Industrial Machinery", 0.74),
    ("기타 운송관련 서비스업", "Integrated Freight & Logistics", 0.76),
    ("도로 화물 운송업", "Trucking", 0.82),
    ("해상 운송업", "Marine Shipping", 0.84),
    ("항공 여객 운송업", "Airlines", 0.84),
    ("육상 여객 운송업", "Travel Services", 0.74),
    ("운송장비 임대업", "Rental & Leasing Services", 0.78),
    ("시멘트, 석회, 플라스터 및 그 제품 제조업", "Building Materials", 0.82),
    ("기타 비금속 광물제품 제조업", "Building Materials", 0.76),
    ("내화, 비내화 요업제품 제조업", "Building Materials", 0.76),
    ("유리 및 유리제품 제조업", "Building Materials", 0.76),
    ("나무제품 제조업", "Lumber & Wood Production", 0.8),
    ("플라스틱제품 제조업", "Packaging & Containers", 0.74),
    ("합성고무 및 플라스틱 물질 제조업", "Specialty Chemicals", 0.8),
    ("고무제품 제조업", "Auto Parts", 0.74),
    ("1차 비철금속 제조업", "Other Industrial Metals & Mining", 0.76),
    ("구조용 금속제품, 탱크 및 증기발생기 제조업", "Metal Fabrication", 0.8),
    ("금속 주조업", "Metal Fabrication", 0.76),
    ("봉제의복 제조업", "Apparel Manufacturing", 0.82),
    ("편조의복 제조업", "Apparel Manufacturing", 0.82),
    ("의복 액세서리 제조업", "Apparel Manufacturing", 0.78),
    ("직물직조 및 직물제품 제조업", "Textile Manufacturing", 0.82),
    ("방적 및 가공사 제조업", "Textile Manufacturing", 0.8),
    ("편조원단 제조업", "Textile Manufacturing", 0.8),
    ("가죽, 가방 및 유사제품 제조업", "Footwear & Accessories", 0.76),
    ("가정용 기기 제조업", "Furnishings, Fixtures & Appliances", 0.76),
    ("기타 전문 도매업", "Industrial Distribution", 0.74),
    ("상품 종합 도매업", "Industrial Distribution", 0.74),
    ("상품 중개업", "Industrial Distribution", 0.74),
    ("종합 소매업", "Department Stores", 0.74),
    ("무점포 소매업", "Internet Retail", 0.8),
    ("연료 소매업", "Oil & Gas Refining & Marketing", 0.74),
    ("음식점업", "Restaurants", 0.82),
    ("일반 교습 학원", "Education & Training Services", 0.82),
    ("스포츠 서비스업", "Leisure", 0.74),
    ("유원지 및 기타 오락관련 서비스업", "Resorts & Casinos", 0.76),
    ("운동 및 경기용구 제조업", "Leisure", 0.74),
    ("악기 제조업", "Leisure", 0.74),
    ("곡물가공품, 전분 및 전분제품 제조업", "Packaged Foods", 0.82),
    ("도축, 육류 가공 및 저장 처리업", "Packaged Foods", 0.82),
    ("수산물 가공 및 저장 처리업", "Packaged Foods", 0.82),
    ("동·식물성 유지 및 낙농제품 제조업", "Packaged Foods", 0.82),
    ("과실, 채소 가공 및 저장 처리업", "Packaged Foods", 0.82),
    ("떡, 빵 및 과자류 제조업", "Confectioners", 0.78),
    ("어로 어업", "Farm Products", 0.74),
    ("작물 재배업", "Farm Products", 0.82),
    ("산업용 농·축산물 및 동·식물 도매업", "Food Distribution", 0.74),
    ("의료용 기기 제조업", "Medical Devices", 0.82),
    ("의료용품 및 기타 의약 관련제품 제조업", "Medical Instruments & Supplies", 0.8),
    ("기초 의약물질 제조업", "Drug Manufacturers - General", 0.78),
    ("전기업", "Utilities - Regulated Electric", 0.78),
    ("증기, 냉·온수 및 공기조절 공급업", "Utilities - Diversified", 0.74),
    ("무기 및 총포탄 제조업", "Aerospace & Defense", 0.84),
    ("경비, 경호 및 탐정업", "Security & Protection Services", 0.84),
    ("전문디자인업", "Specialty Business Services", 0.74),
    ("기타 사업지원 서비스업", "Specialty Business Services", 0.74),
    ("기타 전문 서비스업", "Specialty Business Services", 0.74),
    ("시장조사 및 여론조사업", "Specialty Business Services", 0.74),
    ("사업시설 유지·관리 서비스업", "Specialty Business Services", 0.74),
    ("회사 본부 및 경영 컨설팅 서비스업", "Consulting Services", 0.74),
    ("개인 및 가정용품 임대업", "Rental & Leasing Services", 0.76),
    ("개인 및 가정용품 수리업", "Personal Services", 0.74),
    ("그외 기타 개인 서비스업", "Personal Services", 0.74),
    ("해체, 선별 및 원료 재생업", "Waste Management", 0.8),
    ("인쇄 및 인쇄관련 산업", "Publishing", 0.74),
    ("기록매체 복제업", "Publishing", 0.74),
    ("마그네틱 및 광학 매체 제조업", "Computer Hardware", 0.74),
    ("부동산 임대 및 공급업", "Real Estate - Diversified", 0.76),
    ("부동산 관련 서비스업", "Real Estate Services", 0.78),
)


def match_kr_exact_industry(provider_industry: str) -> tuple[FinvizIndustry, float] | None:
    industry = clean_text(provider_industry)
    if not industry:
        return None
    for raw_industry, raw_finviz_name, confidence in KR_EXACT_INDUSTRY_RULES:
        if industry == raw_industry:
            item = finviz_industry_by_name(raw_finviz_name)
            if item:
                return item, confidence
    return None


PROVIDER_EXACT_INDUSTRY_RULES: tuple[tuple[str | None, str, str, float], ...] = (
    ("Technology", "Computer Software: Prepackaged Software", "Software - Application", 0.82),
    ("Technology", "Computer Software: Programming, Data Processing", "Information Technology Services", 0.8),
    ("Technology", "Computer Software: Programming Data Processing", "Information Technology Services", 0.8),
    ("Technology", "EDP Services", "Information Technology Services", 0.8),
    ("Technology", "Computer Manufacturing", "Computer Hardware", 0.78),
    ("Technology", "Computer peripheral equipment", "Computer Hardware", 0.78),
    ("Technology", "Retail: Computer Software & Peripheral Equipment", "Electronics & Computer Distribution", 0.76),
    ("Technology", "Electrical Products", "Electrical Equipment & Parts", 0.76),
    ("Real Estate", "Real Estate Investment Trusts", "REIT - Diversified", 0.76),
    ("Real Estate", "Other Consumer Services", "Education & Training Services", 0.74),
    ("Finance", "Finance: Consumer Services", "Credit Services", 0.74),
    ("Finance", "Finance/Investors Services", "Asset Management", 0.78),
    ("Finance", "Property-Casualty Insurers", "Insurance - Property & Casualty", 0.84),
    ("Finance", "Specialty Insurers", "Insurance - Specialty", 0.82),
    ("Finance", "Savings Institutions", "Banks - Regional", 0.8),
    ("Finance", "Real Estate", "Real Estate Services", 0.74),
    ("Health Care", "Medical/Dental Instruments", "Medical Devices", 0.82),
    ("Health Care", "Medical Specialities", "Medical Instruments & Supplies", 0.76),
    ("Health Care", "Industrial Specialties", "Medical Instruments & Supplies", 0.74),
    ("Health Care", "Medical/Nursing Services", "Medical Care Facilities", 0.82),
    ("Health Care", "Hospital/Nursing Management", "Medical Care Facilities", 0.82),
    ("Consumer Discretionary", "Business Services", "Specialty Business Services", 0.74),
    ("Consumer Discretionary", "Professional Services", "Consulting Services", 0.74),
    ("Consumer Discretionary", "Services-Misc. Amusement & Recreation", "Leisure", 0.74),
    ("Consumer Discretionary", "Recreational Games/Products/Toys", "Leisure", 0.74),
    ("Consumer Discretionary", "Other Specialty Stores", "Specialty Retail", 0.76),
    ("Consumer Discretionary", "Other Consumer Services", "Personal Services", 0.74),
    ("Consumer Discretionary", "Marine Transportation", "Marine Shipping", 0.82),
    ("Consumer Discretionary", "Diversified Commercial Services", "Specialty Business Services", 0.74),
    ("Consumer Discretionary", "Catalog/Specialty Distribution", "Specialty Retail", 0.74),
    ("Consumer Discretionary", "Clothing/Shoe/Accessory Stores", "Apparel Retail", 0.82),
    ("Consumer Discretionary", "Transportation Services", "Travel Services", 0.74),
    ("Consumer Discretionary", "Air Freight/Delivery Services", "Integrated Freight & Logistics", 0.82),
    ("Consumer Discretionary", "Industrial Specialties", "Specialty Industrial Machinery", 0.74),
    ("Consumer Discretionary", "Package Goods/Cosmetics", "Household & Personal Products", 0.8),
    ("Consumer Discretionary", "Food Distributors", "Food Distribution", 0.76),
    ("Consumer Staples", "Farming/Seeds/Milling", "Farm Products", 0.78),
    ("Consumer Staples", "Food Chains", "Grocery Stores", 0.76),
    ("Basic Materials", "Precious Metals", "Other Precious Metals & Mining", 0.78),
    ("Basic Materials", "Metal Mining", "Other Industrial Metals & Mining", 0.78),
    ("Basic Materials", "Other Metals and Minerals", "Other Industrial Metals & Mining", 0.78),
    ("Industrials", "Mining & Quarrying of Nonmetallic Minerals (No Fuels)", "Building Materials", 0.74),
    ("Industrials", "Electrical Products", "Electrical Equipment & Parts", 0.78),
    ("Industrials", "Industrial Specialties", "Specialty Industrial Machinery", 0.74),
    ("Industrials", "Auto Manufacturing", "Auto Manufacturers", 0.84),
    ("Industrials", "Military/Government/Technical", "Aerospace & Defense", 0.78),
    ("Consumer Discretionary", "Military/Government/Technical", "Aerospace & Defense", 0.76),
    ("Utilities", "Power Generation", "Utilities - Independent Power Producers", 0.78),
    ("Utilities", "Water Supply", "Utilities - Regulated Water", 0.82),
    ("Energy", "Coal Mining", "Thermal Coal", 0.78),
    ("Miscellaneous", "Multi-Sector Companies", "Conglomerates", 0.74),
)


def match_provider_exact_industry(provider_sector: str, provider_industry: str) -> tuple[FinvizIndustry, float] | None:
    sector = clean_text(provider_sector).lower()
    industry = clean_text(provider_industry).lower()
    if not industry:
        return None
    for raw_sector, raw_industry, raw_finviz_name, confidence in PROVIDER_EXACT_INDUSTRY_RULES:
        if industry != clean_text(raw_industry).lower():
            continue
        if raw_sector is not None and sector != clean_text(raw_sector).lower():
            continue
        item = finviz_industry_by_name(raw_finviz_name)
        if item:
            return item, confidence
    return None


def match_provider_industry(provider_sector: str, provider_industry: str) -> tuple[FinvizIndustry, float] | None:
    kr_exact = match_kr_exact_industry(provider_industry)
    if kr_exact:
        return kr_exact

    provider_exact = match_provider_exact_industry(provider_sector, provider_industry)
    if provider_exact:
        return provider_exact

    text = f"{provider_sector} {provider_industry}".lower()
    rules: tuple[tuple[str, float, tuple[str, ...]], ...] = (
        ("Semiconductor Equipment & Materials", 0.86, ("반도체 장비", "반도체 소재", "semiconductor equipment", "semiconductor materials")),
        ("Semiconductors", 0.86, ("반도체", "semiconductor")),
        ("Aerospace & Defense", 0.86, ("항공우주", "우주", "방산", "방위", "aerospace", "defense")),
        ("Biotechnology", 0.82, ("바이오", "생명공학", "biotechnology")),
        ("Drug Manufacturers - Specialty & Generic", 0.78, ("제네릭", "generic pharmaceutical", "specialty pharmaceutical")),
        ("Drug Manufacturers - General", 0.78, ("제약", "의약품 제조", "기초 의약물질", "pharmaceutical", "drug manufacturer")),
        ("Medical Devices", 0.78, ("의료기기", "의료용 기기", "medical device")),
        ("Medical Instruments & Supplies", 0.74, ("의료 장비", "의료 소모품", "medical instruments", "medical supplies")),
        ("Healthcare Plans", 0.74, ("건강보험", "managed health", "healthcare plans")),
        ("Banks - Regional", 0.82, ("지방은행", "regional bank")),
        ("Banks - Diversified", 0.82, ("은행", "bank")),
        ("Insurance - Life", 0.8, ("생명보험", "life insurance")),
        ("Insurance - Property & Casualty", 0.8, ("손해보험", "화재보험", "property casualty")),
        ("Insurance Brokers", 0.76, ("보험중개", "insurance broker")),
        ("Insurance - Diversified", 0.74, ("보험", "insurance")),
        ("Asset Management", 0.82, ("자산운용", "asset management", "investment manager")),
        ("Capital Markets", 0.78, ("증권", "투자은행", "capital markets", "brokerage")),
        ("Credit Services", 0.76, ("카드", "신용", "credit services")),
        ("Mortgage Finance", 0.76, ("모기지", "mortgage")),
        ("REIT - Diversified", 0.78, ("리츠", "reit")),
        ("Real Estate - Development", 0.76, ("부동산 개발", "real estate development")),
        ("Real Estate Services", 0.72, ("부동산 서비스", "real estate services")),
        ("Oil & Gas Refining & Marketing", 0.82, ("정유", "refining", "marketing")),
        ("Oil & Gas E&P", 0.82, ("석유 개발", "가스 개발", "exploration", "production", "e&p")),
        ("Oil & Gas Integrated", 0.78, ("석유", "가스", "oil", "gas")),
        ("Thermal Coal", 0.8, ("발전용 석탄", "thermal coal")),
        ("Coking Coal", 0.8, ("제철용 석탄", "coking coal")),
        ("Uranium", 0.82, ("우라늄", "uranium")),
        ("Solar", 0.82, ("태양광", "solar")),
        ("Utilities - Regulated Electric", 0.82, ("전력", "전기 유틸리티", "electric utilities")),
        ("Utilities - Regulated Gas", 0.78, ("가스 유틸리티", "natural gas distribution")),
        ("Utilities - Regulated Water", 0.78, ("수도", "water utility")),
        ("Utilities - Renewable", 0.76, ("재생에너지", "renewable utility")),
        ("Steel", 0.84, ("철강", "steel")),
        ("Aluminum", 0.84, ("알루미늄", "aluminum")),
        ("Copper", 0.84, ("구리", "copper")),
        ("Gold", 0.84, ("금광", "gold")),
        ("Silver", 0.84, ("은광", "silver")),
        ("Specialty Chemicals", 0.82, ("2차전지 소재", "배터리 소재", "특수화학", "specialty chemicals")),
        ("Chemicals", 0.78, ("화학", "chemicals")),
        ("Paper & Paper Products", 0.78, ("제지", "종이", "paper")),
        ("Lumber & Wood Production", 0.78, ("목재", "wood", "lumber")),
        ("Agricultural Inputs", 0.78, ("비료", "농약", "agricultural inputs")),
        ("Auto Parts", 0.84, ("자동차 부품", "auto parts")),
        ("Auto Manufacturers", 0.84, ("자동차", "완성차", "auto manufacturer", "motor vehicles")),
        ("Electrical Equipment & Parts", 0.8, ("전기장비", "배터리", "일차전지", "이차전지", "축전지", "battery", "electrical equipment")),
        ("Electronic Components", 0.78, ("전자부품", "electronic components")),
        ("Consumer Electronics", 0.76, ("가전", "consumer electronics")),
        ("Computer Hardware", 0.78, ("컴퓨터 하드웨어", "computer hardware")),
        ("Communication Equipment", 0.78, ("통신장비", "communication equipment", "telecommunications equipment")),
        (
            "Information Technology Services",
            0.78,
            (
                "it 서비스",
                "정보기술 서비스",
                "컴퓨터 프로그래밍",
                "시스템 통합",
                "시스템 관리",
                "system integration",
                "information technology services",
            ),
        ),
        ("Software - Infrastructure", 0.8, ("인프라 소프트웨어", "보안 소프트웨어", "cloud", "infrastructure software")),
        ("Software - Application", 0.78, ("소프트웨어", "응용 소프트웨어", "application software", "saas")),
        ("Electronic Gaming & Multimedia", 0.82, ("게임", "멀티미디어", "gaming", "multimedia")),
        ("Internet Content & Information", 0.78, ("인터넷", "플랫폼", "포털", "internet content", "information")),
        ("Internet Retail", 0.8, ("전자상거래", "온라인 쇼핑", "internet retail")),
        ("Telecom Services", 0.8, ("통신서비스", "무선통신", "telecom")),
        ("Broadcasting", 0.76, ("방송", "broadcasting")),
        ("Entertainment", 0.76, ("엔터", "음악", "영화", "entertainment")),
        ("Advertising Agencies", 0.76, ("광고", "advertising")),
        ("Publishing", 0.74, ("출판", "publishing")),
        ("Restaurants", 0.82, ("외식", "식당", "restaurants")),
        ("Packaged Foods", 0.8, ("가공식품", "식품 제조", "packaged foods")),
        ("Food Distribution", 0.76, ("식품 유통", "food distribution")),
        ("Beverages - Brewers", 0.8, ("맥주", "brewers")),
        ("Beverages - Non-Alcoholic", 0.78, ("음료", "non-alcoholic")),
        ("Beverages - Wineries & Distilleries", 0.78, ("주류", "wine", "distiller")),
        ("Tobacco", 0.82, ("담배", "tobacco")),
        ("Confectioners", 0.76, ("제과", "confectioners")),
        ("Household & Personal Products", 0.78, ("생활용품", "화장품", "personal products")),
        ("Farm Products", 0.74, ("농산물", "farm products")),
        ("Grocery Stores", 0.74, ("식료품점", "grocery")),
        ("Discount Stores", 0.74, ("할인점", "discount stores")),
        ("Pharmaceutical Retailers", 0.74, ("의약품 소매", "pharmaceutical retailers")),
        ("Apparel Retail", 0.78, ("의류 소매", "apparel retail")),
        ("Apparel Manufacturing", 0.78, ("의류", "섬유의복", "apparel")),
        ("Footwear & Accessories", 0.78, ("신발", "액세서리", "footwear")),
        ("Textile Manufacturing", 0.78, ("섬유", "textile")),
        ("Luxury Goods", 0.74, ("명품", "luxury")),
        ("Specialty Retail", 0.74, ("전문 소매", "specialty retail")),
        ("Department Stores", 0.74, ("백화점", "department stores")),
        ("Home Improvement Retail", 0.74, ("주택개선", "home improvement")),
        ("Furnishings, Fixtures & Appliances", 0.76, ("가구", "비품", "furnishings", "appliances")),
        ("Residential Construction", 0.78, ("주택 건설", "homebuilding", "residential construction")),
        ("Engineering & Construction", 0.78, ("건설", "engineering", "construction")),
        ("Building Materials", 0.76, ("건축자재", "building materials")),
        ("Building Products & Equipment", 0.76, ("건축 제품", "building products")),
        ("Specialty Industrial Machinery", 0.76, ("기계", "산업기계", "industrial machinery")),
        ("Farm & Heavy Construction Machinery", 0.76, ("중장비", "heavy construction machinery")),
        ("Metal Fabrication", 0.74, ("금속 가공", "metal fabrication")),
        ("Marine Shipping", 0.76, ("해운", "해상운송", "marine shipping")),
        ("Airlines", 0.76, ("항공사", "airlines")),
        ("Integrated Freight & Logistics", 0.76, ("물류", "택배", "logistics")),
        ("Railroads", 0.76, ("철도", "railroads")),
        ("Trucking", 0.76, ("트럭", "도로 화물", "화물 운송", "trucking")),
        ("Travel Services", 0.78, ("여행", "travel")),
        ("Lodging", 0.76, ("호텔", "숙박", "lodging")),
        ("Resorts & Casinos", 0.76, ("리조트", "카지노", "resorts", "casinos")),
        ("Leisure", 0.74, ("레저", "leisure")),
        ("Education & Training Services", 0.76, ("교육", "education")),
        ("Security & Protection Services", 0.74, ("보안", "security")),
        ("Waste Management", 0.76, ("폐기물", "waste management")),
        ("Pollution & Treatment Controls", 0.74, ("환경", "오염", "pollution", "treatment")),
        ("Specialty Business Services", 0.7, ("전문 서비스", "business services")),
        ("Staffing & Employment Services", 0.74, ("인력", "고용", "staffing", "employment")),
        ("Packaging & Containers", 0.76, ("포장", "containers", "packaging")),
        ("Shell Companies", 0.82, ("스팩", "기업인수목적", "blank checks", "shell companies")),
    )
    for raw_name, confidence, needles in rules:
        if any(needle in text for needle in needles):
            item = finviz_industry_by_name(raw_name)
            if item:
                return item, confidence
    return None


def fallback_industry_for_sector(market: str, provider_sector: str, provider_industry: str) -> FinvizIndustry:
    text = f"{market} {provider_sector} {provider_industry}".lower()
    fallback_by_sector: tuple[tuple[str, str], ...] = (
        ("금융", "Financial Conglomerates"),
        ("financial", "Financial Conglomerates"),
        ("보험", "Insurance - Diversified"),
        ("은행", "Banks - Diversified"),
        ("부동산", "Real Estate Services"),
        ("real estate", "Real Estate Services"),
        ("리츠", "REIT - Diversified"),
        ("헬스", "Medical Care Facilities"),
        ("health", "Medical Care Facilities"),
        ("의료", "Medical Care Facilities"),
        ("제약", "Drug Manufacturers - General"),
        ("정보", "Information Technology Services"),
        ("technology", "Information Technology Services"),
        ("전기전자", "Electronic Components"),
        ("커뮤니케이션", "Internet Content & Information"),
        ("communication", "Internet Content & Information"),
        ("통신", "Telecom Services"),
        ("에너지", "Oil & Gas Integrated"),
        ("energy", "Oil & Gas Integrated"),
        ("유틸", "Utilities - Diversified"),
        ("utilities", "Utilities - Diversified"),
        ("소재", "Specialty Chemicals"),
        ("materials", "Specialty Chemicals"),
        ("화학", "Chemicals"),
        ("산업", "Specialty Industrial Machinery"),
        ("industrial", "Specialty Industrial Machinery"),
        ("기계", "Specialty Industrial Machinery"),
        ("소비", "Specialty Retail"),
        ("consumer", "Specialty Retail"),
        ("서비스", "Specialty Business Services"),
        ("제조", "Specialty Industrial Machinery"),
    )
    for needle, raw_name in fallback_by_sector:
        if needle in text:
            item = finviz_industry_by_name(raw_name)
            if item:
                return item
    return finviz_industry_by_name("Specialty Business Services") or FINVIZ_INDUSTRIES[0]
