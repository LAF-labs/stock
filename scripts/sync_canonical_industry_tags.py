from __future__ import annotations

import argparse
import json
from typing import Any

import requests

try:
    from backfill_symbol_profiles import TAG_TABLE, clean_text, env_value, slug, upsert_rows
    from finviz_industry_taxonomy import (
        FinvizIndustry,
        canonical_industry_for_provider,
        canonical_industry_key_for,
        finviz_industry_by_name,
    )
except ModuleNotFoundError:
    from scripts.backfill_symbol_profiles import TAG_TABLE, clean_text, env_value, slug, upsert_rows
    from scripts.finviz_industry_taxonomy import (
        FinvizIndustry,
        canonical_industry_for_provider,
        canonical_industry_key_for,
        finviz_industry_by_name,
    )


CANONICAL_TAXONOMY = "finviz_canonical"
AUTO_SOURCE = "industry_taxonomy_map"
MANUAL_SOURCE = "manual_kr_product_review"
PRODUCT_SOURCE = "kr_product_keyword_review"
GENERATED_SOURCES = (AUTO_SOURCE, MANUAL_SOURCE, PRODUCT_SOURCE)

MANUAL_KR_PRODUCT_REVIEW_OVERRIDES: dict[str, tuple[str, float, str]] = {
    "054090": ("Electronic Components", 0.86, "LCD BLU/mold frame display parts"),
    "073570": ("Consumer Electronics", 0.82, "mobile phone accessories"),
    "188260": ("Diagnostics & Research", 0.86, "molecular diagnostics and testing products"),
    "192440": ("Consumer Electronics", 0.86, "mobile phone cases and screen protectors"),
    "263920": ("Packaging & Containers", 0.82, "glass containers and cosmetic applicators"),
    "285490": ("Electronic Components", 0.86, "magnets and shielding magnets"),
    "317870": ("Pollution & Treatment Controls", 0.82, "water purifier filter materials"),
    "373200": ("Consumer Electronics", 0.82, "mobile IT application products"),
    "376180": ("Pollution & Treatment Controls", 0.86, "water purifiers and filters"),
    "475580": ("Consumer Electronics", 0.82, "educational drones and robots"),
}

KR_PRODUCT_KEYWORD_RULES: tuple[tuple[str, float, tuple[str, ...]], ...] = (
    (
        "Semiconductor Equipment & Materials",
        0.86,
        (
            "반도체장비",
            "반도체 장비",
            "반도체검사장비",
            "반도체 테스트",
            "반도체테스트",
            "테스트핸들러",
            "drygasscrubber",
        ),
    ),
    ("Solar", 0.84, ("태양전지", "태양광모듈")),
    ("Utilities - Renewable", 0.8, ("풍력 및 태양광 발전", "태양광 발전업", "풍력 발전업")),
    (
        "Electronic Gaming & Multimedia",
        0.84,
        ("게임소프트웨어", "온라인게임", "온라인 게임", "모바일 게임", "인터넷머그게임", "게임("),
    ),
    (
        "Biotechnology",
        0.84,
        ("adc 기반", "항암제 및", "치료제 개발", "신약연구개발", "바이오 신약", "세포치료", "유전자치료"),
    ),
    ("Health Information Services", 0.82, ("의료정보시스템", "의료특화 인공지능", "의사랑", "유팜")),
    ("Insurance - Life", 0.86, ("생명보험",)),
    ("Insurance - Property & Casualty", 0.86, ("손해보험", "자동차보험", "화재보험", "해상보험")),
    ("Insurance - Specialty", 0.82, ("보증보험", "신용보험")),
    ("Financial Data & Stock Exchanges", 0.8, ("신용평가", "개인 및 기업정보", "기업정보", "채권추심")),
    (
        "Communication Equipment",
        0.82,
        (
            "네트워크 통신장비",
            "무선통신기기",
            "이동통신중계기",
            "중계기",
            "광 전송장비",
            "광통신장비",
            "통신장비",
            "rf 부품",
        ),
    ),
    ("Software - Infrastructure", 0.8, ("보안솔루션", "시스템 소프트웨어", "인증서비스", "스토리지s/w", "네트워크관리")),
)


def read_config() -> tuple[str, str]:
    url = (env_value("SUPABASE_URL") or "").rstrip("/")
    key = env_value("SUPABASE_SERVICE_ROLE_KEY") or ""
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.")
    return url, key


def supabase_headers(key: str) -> dict[str, str]:
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }


def postgrest_market_filter(markets: list[str] | None) -> str | None:
    if not markets:
        return None
    normalized = sorted({clean_text(market).upper() for market in markets if clean_text(market)})
    if not normalized:
        return None
    if len(normalized) == 1:
        return f"eq.{normalized[0]}"
    return f"in.({','.join(normalized)})"


def fetch_profiles(markets: list[str] | None = None) -> list[dict[str, Any]]:
    url, key = read_config()
    rows: list[dict[str, Any]] = []
    start = 0
    size = 1000
    params: dict[str, str] = {
        "select": "market,symbol,name,asset_class,primary_sector,primary_industry,metadata,listing_status",
        "listing_status": "eq.listed",
        "asset_class": "eq.stock",
        "order": "market.asc,symbol.asc",
    }
    market_filter = postgrest_market_filter(markets)
    if market_filter:
        params["market"] = market_filter

    while True:
        response = requests.get(
            f"{url}/rest/v1/stock_symbol_profiles",
            headers={**supabase_headers(key), "Range-Unit": "items", "Range": f"{start}-{start + size - 1}"},
            params=params,
            timeout=30,
        )
        response.raise_for_status()
        batch = response.json()
        rows.extend(batch)
        if len(batch) < size:
            break
        start += size
    return rows


def canonical_industry_for_profile(profile: dict[str, Any]) -> tuple[FinvizIndustry, float, str, dict[str, Any]]:
    market = clean_text(profile.get("market")).upper()
    symbol = clean_text(profile.get("symbol")).upper()
    sector = clean_text(profile.get("primary_sector"))
    industry = clean_text(profile.get("primary_industry"))
    metadata = profile.get("metadata") if isinstance(profile.get("metadata"), dict) else {}

    source = AUTO_SOURCE
    manual_reason = ""
    if market == "KR" and symbol in MANUAL_KR_PRODUCT_REVIEW_OVERRIDES:
        raw_name, confidence, manual_reason = MANUAL_KR_PRODUCT_REVIEW_OVERRIDES[symbol]
        item = finviz_industry_by_name(raw_name)
        if item is None:
            raise RuntimeError(f"Invalid manual Finviz industry override for {symbol}: {raw_name}")
        source = MANUAL_SOURCE
    elif market == "KR":
        product_match = match_kr_product_keywords(profile)
        if product_match:
            item, confidence, manual_reason = product_match
            source = PRODUCT_SOURCE
        else:
            item, confidence = canonical_industry_for_provider(market, sector, industry)
    else:
        item, confidence = canonical_industry_for_provider(market, sector, industry)

    raw = {
        "provider_sector": sector,
        "provider_industry": industry,
        "raw_finviz_sector": item.sector,
        "raw_finviz_industry": item.name,
    }
    if manual_reason:
        raw["manual_reason" if source == MANUAL_SOURCE else "product_keyword"] = manual_reason
        raw["kind_main_products"] = clean_text(metadata.get("kind_main_products"))
    return item, confidence, source, raw


def match_kr_product_keywords(profile: dict[str, Any]) -> tuple[FinvizIndustry, float, str] | None:
    metadata = profile.get("metadata") if isinstance(profile.get("metadata"), dict) else {}
    text = " ".join(
        clean_text(value).lower()
        for value in (
            profile.get("name"),
            profile.get("primary_sector"),
            profile.get("primary_industry"),
            metadata.get("kind_main_products"),
        )
    )
    compact_text = text.replace(" ", "")

    for raw_name, confidence, needles in KR_PRODUCT_KEYWORD_RULES:
        for needle in needles:
            normalized_needle = clean_text(needle).lower()
            if normalized_needle in text or normalized_needle.replace(" ", "") in compact_text:
                item = finviz_industry_by_name(raw_name)
                if item:
                    return item, confidence, normalized_needle
    return None


def canonical_tag_rows_for_profile(profile: dict[str, Any]) -> list[dict[str, Any]]:
    market = clean_text(profile.get("market")).upper()
    symbol = clean_text(profile.get("symbol")).upper()
    if not market or not symbol:
        return []

    item, confidence, source, raw = canonical_industry_for_profile(profile)
    return [
        {
            "market": market,
            "symbol": symbol,
            "taxonomy": CANONICAL_TAXONOMY,
            "code": slug(item.sector_ko),
            "name": item.sector_ko,
            "level": 1,
            "source": source,
            "confidence": confidence,
            "is_primary": True,
            "raw": raw,
        },
        {
            "market": market,
            "symbol": symbol,
            "taxonomy": CANONICAL_TAXONOMY,
            "code": canonical_industry_key_for(item),
            "name": item.industry_ko,
            "level": 2,
            "source": source,
            "confidence": confidence,
            "is_primary": True,
            "raw": raw,
        },
    ]


def delete_generated_tags(markets: list[str] | None = None) -> None:
    url, key = read_config()
    params = {
        "taxonomy": f"eq.{CANONICAL_TAXONOMY}",
        "source": f"in.({','.join(GENERATED_SOURCES)})",
    }
    market_filter = postgrest_market_filter(markets)
    if market_filter:
        params["market"] = market_filter

    response = requests.delete(f"{url}/rest/v1/{TAG_TABLE}", headers=supabase_headers(key), params=params, timeout=60)
    if not response.ok:
        raise RuntimeError(f"Supabase delete failed for {TAG_TABLE}: HTTP {response.status_code} {response.text[:1000]}")


def sync_canonical_tags(markets: list[str] | None, batch_size: int, dry_run: bool) -> dict[str, Any]:
    profiles = fetch_profiles(markets)
    rows = [row for profile in profiles for row in canonical_tag_rows_for_profile(profile)]
    manual_profile_count = len(
        {
            clean_text(row["symbol"]).upper()
            for row in rows
            if row["taxonomy"] == CANONICAL_TAXONOMY and row["source"] == MANUAL_SOURCE
        }
    )
    product_profile_count = len(
        {
            clean_text(row["symbol"]).upper()
            for row in rows
            if row["taxonomy"] == CANONICAL_TAXONOMY and row["source"] == PRODUCT_SOURCE
        }
    )

    upserted = 0
    if not dry_run:
        delete_generated_tags(markets)
        upserted = upsert_rows(
            TAG_TABLE,
            rows,
            "market,symbol,taxonomy,level,code,name,source",
            batch_size,
            False,
            "rest",
        )

    return {
        "dry_run": dry_run,
        "markets": sorted({clean_text(profile.get("market")).upper() for profile in profiles}),
        "listed_stock_profiles": len(profiles),
        "tag_rows_generated": len(rows),
        "upserted": upserted,
        "product_keyword_overrides": product_profile_count,
        "manual_overrides": manual_profile_count,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Regenerate Finviz canonical industry tags for listed stock profiles.")
    parser.add_argument("--market", action="append", choices=["KR", "US"], help="Limit sync to a market. Can be repeated.")
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    result = sync_canonical_tags(args.market, args.batch_size, args.dry_run)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
