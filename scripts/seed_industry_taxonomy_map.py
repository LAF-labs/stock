from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any

import requests

from backfill_symbol_profiles import ROOT, clean_text, env_value, slug, upsert_rows
from run_industry_maintenance import hydrate_service_role_from_cli


TAXONOMY_TABLE = "industry_taxonomy_map"
PROFILE_TAXONOMY = "profile_primary"

SECTOR_KO = {
    "Basic Materials": "소재",
    "Consumer Discretionary": "경기소비재",
    "Consumer Staples": "필수소비재",
    "Energy": "에너지",
    "Finance": "금융",
    "Health Care": "헬스케어",
    "Industrials": "산업재",
    "Miscellaneous": "기타",
    "Real Estate": "부동산",
    "Technology": "정보기술",
    "Telecommunications": "통신서비스",
    "Utilities": "유틸리티",
    "Communication Services": "커뮤니케이션",
    "Consumer Cyclical": "경기소비재",
    "Consumer Defensive": "필수소비재",
    "Financial Services": "금융",
    "Healthcare": "헬스케어",
}

US_INDUSTRY_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("스팩", ("blank checks", "shell companies")),
    ("반도체", ("semiconductor",)),
    ("소프트웨어", ("software", "saas", "edp services", "computer services", "information technology services")),
    ("하드웨어·전자장비", ("computer manufacturing", "electronic components", "telecommunications equipment")),
    ("바이오·제약", ("biotechnology", "pharmaceutical", "medicinal chemicals")),
    ("의료기기·서비스", ("medical specialities", "medical/dental instruments", "hospital", "managed health care", "health care services")),
    ("은행", ("major banks", "commercial banks", "savings institutions", "banks", "banking")),
    ("보험", ("insurance",)),
    ("금융서비스", ("investment managers", "finance companies", "investment bankers", "brokerage", "asset management", "mortgage")),
    ("리츠", ("real estate investment trusts", "reit")),
    ("부동산", ("real estate",)),
    ("석유·가스", ("oil", "gas", "coal", "integrated oil")),
    ("전력·유틸리티", ("electric utilities", "water supply", "power generation", "natural gas distribution")),
    ("금속·광업", ("metal mining", "precious metals", "aluminum", "steel", "mining")),
    ("금속·광업", ("gold", "silver", "other metals and minerals")),
    ("종이·목재", ("forest products", "paper")),
    ("화학", ("chemicals",)),
    ("자동차", ("auto manufacturing", "auto parts", "automotive", "motor vehicles")),
    ("자동차", ("auto manufacturers", "auto & truck dealerships")),
    ("운송", ("air freight", "marine transportation", "railroads", "trucking", "transportation services")),
    ("항공·방산", ("aerospace", "military/government/technical")),
    ("기계·산업장비", ("industrial machinery", "industrial specialties", "construction/ag equipment", "building products")),
    ("건설·엔지니어링", ("homebuilding", "engineering", "construction")),
    ("소매", ("retail", "catalog/specialty distribution")),
    ("의류·소비재", ("apparel", "footwear", "household & personal products")),
    ("가구·가전", ("furnishings", "fixtures", "appliances")),
    ("포장재", ("packaging", "containers")),
    ("레저·여행", ("leisure", "travel services", "recreational vehicles")),
    ("음식료·외식", ("restaurants", "food", "beverages", "meat/poultry/fish")),
    ("미디어·엔터", ("broadcasting", "movies/entertainment", "advertising", "publishing")),
    ("인터넷·플랫폼", ("internet content", "information")),
    ("통신서비스", ("telecommunications", "cable", "wireless")),
    ("교육서비스", ("educational services",)),
    ("농업", ("farming", "agricultural")),
)


def read_config() -> tuple[str, str]:
    url = (env_value("SUPABASE_URL") or "").rstrip("/")
    key = env_value("SUPABASE_PUBLISHABLE_KEY") or env_value("SUPABASE_SERVICE_ROLE_KEY") or ""
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY or SUPABASE_SERVICE_ROLE_KEY are required.")
    return url, key


def supabase_headers(key: str) -> dict[str, str]:
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }


def fetch_profiles() -> list[dict[str, Any]]:
    url, key = read_config()
    rows: list[dict[str, Any]] = []
    start = 0
    size = 1000
    while True:
        response = requests.get(
            f"{url}/rest/v1/stock_symbol_profiles",
            headers={**supabase_headers(key), "Range-Unit": "items", "Range": f"{start}-{start + size - 1}"},
            params={
                "select": "market,primary_sector,primary_industry,primary_sector_key,primary_industry_key",
                "primary_industry": "neq.",
            },
            timeout=30,
        )
        response.raise_for_status()
        batch = response.json()
        rows.extend(batch)
        if len(batch) < size:
            break
        start += size
    return rows


def mapping_rows(profiles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_source_key: dict[str, dict[str, Any]] = {}
    for profile in profiles:
        market = clean_text(profile.get("market")).upper()
        sector = clean_text(profile.get("primary_sector"))
        industry = clean_text(profile.get("primary_industry"))
        sector_key = clean_text(profile.get("primary_sector_key")) or slug(sector)
        industry_key = clean_text(profile.get("primary_industry_key")) or slug(f"{sector}:{industry}" if sector else industry)
        if not market or not industry or not industry_key:
            continue

        source_key = f"{market}:{sector_key}:{industry_key}"
        canonical_sector, canonical_industry, confidence = canonical_names(market, sector, industry)
        by_source_key[source_key] = {
            "taxonomy": PROFILE_TAXONOMY,
            "source_key": source_key,
            "code": industry_key,
            "name": industry,
            "canonical_sector_key": slug(canonical_sector),
            "canonical_sector_name": canonical_sector,
            "canonical_industry_key": slug(f"{canonical_sector}:{canonical_industry}"),
            "canonical_industry_name": canonical_industry,
            "confidence": confidence,
        }
    return sorted(by_source_key.values(), key=lambda row: row["source_key"])


def canonical_names(market: str, sector: str, industry: str) -> tuple[str, str, float]:
    if market == "KR" and has_hangul(industry):
        return sector or "기타", industry, 0.95

    canonical_sector = SECTOR_KO.get(sector, sector or "기타")
    lowered = industry.lower()
    for canonical_industry, needles in US_INDUSTRY_RULES:
        if any(needle in lowered for needle in needles):
            return canonical_sector, canonical_industry, 0.82
    return canonical_sector, industry, 0.65


def has_hangul(value: str) -> bool:
    return any("가" <= char <= "힣" for char in value)


def write_audit(rows: list[dict[str, Any]], path: Path | None) -> None:
    if not path:
        return
    summary = {
        "total_mappings": len(rows),
        "canonical_industries": len({row["canonical_industry_key"] for row in rows}),
        "canonical_by_sector": dict(sorted(Counter(row["canonical_sector_name"] for row in rows).items())),
        "low_confidence_samples": [row for row in rows if row["confidence"] < 0.8][:80],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed canonical Korean display names for stock industry taxonomies.")
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--transport", choices=["rest", "auto"], default="rest")
    parser.add_argument("--no-cli-service-role", action="store_true")
    parser.add_argument("--audit-output", type=Path, default=ROOT / "tmp" / "industry-taxonomy-audit.json")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    hydrated = False
    if not args.no_cli_service_role and not args.dry_run:
        hydrated = hydrate_service_role_from_cli()

    rows = mapping_rows(fetch_profiles())
    write_audit(rows, args.audit_output)
    upserted = upsert_rows(
        TAXONOMY_TABLE,
        rows,
        "taxonomy,source_key",
        args.batch_size,
        args.dry_run,
        args.transport,
    )
    print(
        json.dumps(
            {
                "dry_run": args.dry_run,
                "hydrated_service_role_from_cli": hydrated,
                "mappings_upserted": upserted,
                "canonical_industries": len({row["canonical_industry_key"] for row in rows}),
                "audit_output": str(args.audit_output),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
