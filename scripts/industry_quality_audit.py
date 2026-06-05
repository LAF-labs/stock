from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import os
import re
import sys
from typing import Any
from urllib.parse import urlencode

import requests


@dataclass(frozen=True)
class SupabaseAuditConfig:
    url: str
    key: str
    timeout_seconds: float


def audit_profiles(
    profiles: list[dict[str, Any]],
    mappings: list[dict[str, Any]],
    min_sample_count: int = 8,
) -> dict[str, Any]:
    mapping_by_source = {
        clean_text(row.get("source_key")): row
        for row in mappings
        if clean_text(row.get("taxonomy")) in {"", "profile_primary"} and clean_text(row.get("source_key"))
    }
    groups: dict[tuple[str, str], dict[str, Any]] = {}
    unmapped: dict[str, dict[str, Any]] = {}
    missing_primary = 0
    missing_primary_actionable = 0
    missing_primary_exempt = 0
    missing_primary_by_asset_class: dict[str, int] = {}
    missing_primary_by_status: dict[str, int] = {}

    for profile in profiles:
        if clean_text(profile.get("listing_status")) == "delisted":
            continue
        market = clean_text(profile.get("market")).upper()
        asset_class = clean_text(profile.get("asset_class")) or "stock"
        classification_status = clean_text(profile.get("classification_status")) or "unknown"
        sector_key = clean_text(profile.get("primary_sector_key"))
        industry_key = clean_text(profile.get("primary_industry_key"))
        raw_sector = clean_text(profile.get("primary_sector"))
        raw_industry = clean_text(profile.get("primary_industry"))
        if not market or not sector_key or not industry_key:
            missing_primary += 1
            missing_primary_by_asset_class[asset_class] = missing_primary_by_asset_class.get(asset_class, 0) + 1
            missing_primary_by_status[classification_status] = missing_primary_by_status.get(classification_status, 0) + 1
            if industry_required(profile):
                missing_primary_actionable += 1
            else:
                missing_primary_exempt += 1
            continue
        source_key = f"{market}:{sector_key}:{industry_key}"
        mapping = mapping_by_source.get(source_key)
        if not mapping:
            item = unmapped.setdefault(
                source_key,
                {
                    "source_key": source_key,
                    "market": market,
                    "raw_sector": raw_sector,
                    "raw_industry": raw_industry,
                    "sample_count": 0,
                },
            )
            item["sample_count"] += 1
        canonical_sector = clean_text(mapping.get("canonical_sector_name")) if mapping else raw_sector
        canonical_industry = clean_text(mapping.get("canonical_industry_name")) if mapping else raw_industry
        group_key = (canonical_sector or "미분류", canonical_industry or "미분류")
        group = groups.setdefault(
            group_key,
            {
                "canonical_sector": group_key[0],
                "canonical_industry": group_key[1],
                "sample_count": 0,
                "markets": {},
                "source_keys": set(),
            },
        )
        group["sample_count"] += 1
        group["markets"][market] = group["markets"].get(market, 0) + 1
        group["source_keys"].add(source_key)

    canonical_groups = [
        {
            "canonical_sector": group["canonical_sector"],
            "canonical_industry": group["canonical_industry"],
            "sample_count": group["sample_count"],
            "markets": dict(sorted(group["markets"].items())),
            "source_key_count": len(group["source_keys"]),
        }
        for group in groups.values()
    ]
    canonical_groups.sort(key=lambda row: (-int(row["sample_count"]), str(row["canonical_sector"]), str(row["canonical_industry"])))
    small_groups = [row for row in canonical_groups if int(row["sample_count"]) < min_sample_count]
    similar_groups = similar_industry_groups(canonical_groups)
    unmapped_rows = sorted(unmapped.values(), key=lambda row: (-int(row["sample_count"]), str(row["source_key"])))

    return {
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "total_profiles": len([row for row in profiles if clean_text(row.get("listing_status")) != "delisted"]),
        "missing_primary_count": missing_primary,
        "missing_primary_actionable_count": missing_primary_actionable,
        "missing_primary_exempt_count": missing_primary_exempt,
        "missing_primary_by_asset_class": dict(sorted(missing_primary_by_asset_class.items())),
        "missing_primary_by_status": dict(sorted(missing_primary_by_status.items())),
        "unmapped_source_key_count": len(unmapped_rows),
        "unmapped_source_keys": unmapped_rows[:50],
        "canonical_group_count": len(canonical_groups),
        "canonical_groups": canonical_groups[:100],
        "small_group_count": len(small_groups),
        "small_groups": small_groups[:50],
        "similar_group_count": len(similar_groups),
        "similar_groups": similar_groups[:50],
    }


def industry_required(profile: dict[str, Any]) -> bool:
    return (clean_text(profile.get("asset_class")) or "stock") == "stock"


def similar_industry_groups(groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_key: dict[str, dict[str, Any]] = {}
    for group in groups:
        industry = clean_text(group.get("canonical_industry"))
        key = industry_similarity_key(industry)
        if not key:
            continue
        item = by_key.setdefault(key, {"normalized_key": key, "industries": set(), "sample_count": 0})
        item["industries"].add(industry)
        item["sample_count"] += int_value(group.get("sample_count"))
    results = [
        {
            "normalized_key": key,
            "industries": sorted(item["industries"]),
            "sample_count": item["sample_count"],
        }
        for key, item in by_key.items()
        if len(item["industries"]) > 1
    ]
    results.sort(key=lambda row: (-int(row["sample_count"]), str(row["normalized_key"])))
    return results


def industry_similarity_key(value: str) -> str:
    text = clean_text(value)
    text = re.sub(r"[\s·/,_()&-]+", "", text)
    for suffix in ("제조업", "제조", "업", "서비스업", "서비스"):
        if text.endswith(suffix):
            text = text[: -len(suffix)]
    text = text.replace("및", "")
    return text


def fetch_supabase_audit(config: SupabaseAuditConfig, min_sample_count: int = 8, limit: int = 50000) -> dict[str, Any]:
    profiles = fetch_table(
        config,
        "stock_symbol_profiles",
        {
            "select": "market,symbol,asset_class,primary_sector,primary_industry,primary_sector_key,primary_industry_key,classification_status,listing_status",
            "listing_status": "neq.delisted",
            "order": "market.asc,symbol.asc",
            "limit": str(limit),
        },
    )
    mappings = fetch_table(
        config,
        "industry_taxonomy_map",
        {
            "select": "taxonomy,source_key,canonical_sector_name,canonical_industry_name,confidence",
            "taxonomy": "eq.profile_primary",
            "order": "source_key.asc",
            "limit": str(limit),
        },
    )
    return audit_profiles(profiles, mappings, min_sample_count=min_sample_count)


def fetch_table(config: SupabaseAuditConfig, table: str, params: dict[str, str]) -> list[dict[str, Any]]:
    requested_limit = int_value(params.get("limit")) or 50000
    page_size = min(1000, requested_limit)
    rows: list[dict[str, Any]] = []

    while len(rows) < requested_limit:
        current_limit = min(page_size, requested_limit - len(rows))
        page_params = {
            **params,
            "limit": str(current_limit),
            "offset": str(len(rows)),
        }
        response = requests.get(
            f"{config.url}/rest/v1/{table}?{urlencode(page_params)}",
            headers=supabase_headers(config.key),
            timeout=config.timeout_seconds,
        )
        if response.status_code >= 400:
            raise RuntimeError(f"Supabase {table} query failed: HTTP {response.status_code} {response.text[:500]}")
        payload = response.json()
        page = payload if isinstance(payload, list) else []
        rows.extend(page)
        if len(page) < current_limit:
            break

    return rows


def supabase_headers(key: str) -> dict[str, str]:
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }


def supabase_audit_config(args: argparse.Namespace) -> SupabaseAuditConfig:
    url = (args.supabase_url or os.environ.get("SUPABASE_URL") or "").strip().rstrip("/")
    key = (args.supabase_key or os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_PUBLISHABLE_KEY") or "").strip()
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or SUPABASE_PUBLISHABLE_KEY are required.")
    return SupabaseAuditConfig(url=url, key=key, timeout_seconds=args.timeout_seconds)


def clean_text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def int_value(value: Any) -> int:
    if isinstance(value, bool):
        return 0
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Audit industry taxonomy mapping quality and canonical group health.")
    parser.add_argument("--supabase-url", help="Overrides SUPABASE_URL.")
    parser.add_argument("--supabase-key", help="Overrides SUPABASE_SERVICE_ROLE_KEY or SUPABASE_PUBLISHABLE_KEY.")
    parser.add_argument("--timeout-seconds", type=float, default=20.0)
    parser.add_argument("--min-sample-count", type=int, default=8)
    parser.add_argument("--limit", type=int, default=50000)
    parser.add_argument("--json", action="store_true")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        payload = fetch_supabase_audit(supabase_audit_config(args), min_sample_count=args.min_sample_count, limit=args.limit)
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 2

    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print_human_report(payload)
    return 0


def print_human_report(payload: dict[str, Any]) -> None:
    print(f"generated_at={payload.get('generated_at')}")
    print(
        "profiles={total_profiles} canonical_groups={canonical_group_count} "
        "small_groups={small_group_count} unmapped={unmapped_source_key_count} "
        "similar_groups={similar_group_count} missing_actionable={missing_primary_actionable_count} "
        "missing_exempt={missing_primary_exempt_count}".format(**payload)
    )
    for row in payload.get("small_groups", [])[:10]:
        print(f"small_group {row['canonical_sector']} / {row['canonical_industry']} sample={row['sample_count']}")
    for row in payload.get("similar_groups", [])[:10]:
        print(f"similar_group {row['normalized_key']} industries={', '.join(row['industries'])}")


if __name__ == "__main__":
    raise SystemExit(main())
