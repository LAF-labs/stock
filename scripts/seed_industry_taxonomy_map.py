from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any

import requests

from backfill_symbol_profiles import ROOT, clean_text, env_value, slug, upsert_rows
try:
    from finviz_industry_taxonomy import (
        FINVIZ_INDUSTRIES,
        canonical_industry_for_provider,
        canonical_industry_key_for,
        canonical_names_for_provider,
        finviz_slug,
    )
except ModuleNotFoundError:
    from scripts.finviz_industry_taxonomy import (
        FINVIZ_INDUSTRIES,
        canonical_industry_for_provider,
        canonical_industry_key_for,
        canonical_names_for_provider,
        finviz_slug,
    )
from run_industry_maintenance import hydrate_service_role_from_cli


TAXONOMY_TABLE = "industry_taxonomy_map"
PROFILE_TAXONOMY = "profile_primary"

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
    for row in finviz_master_rows():
        by_source_key[f"{row['taxonomy']}:{row['source_key']}"] = row
    for profile in profiles:
        market = clean_text(profile.get("market")).upper()
        sector = clean_text(profile.get("primary_sector"))
        industry = clean_text(profile.get("primary_industry"))
        sector_key = clean_text(profile.get("primary_sector_key")) or slug(sector)
        industry_key = clean_text(profile.get("primary_industry_key")) or slug(f"{sector}:{industry}" if sector else industry)
        if not market or not industry or not industry_key:
            continue

        source_key = f"{market}:{sector_key}:{industry_key}"
        canonical_item, confidence = canonical_industry_for_provider(market, sector, industry)
        canonical_sector = canonical_item.sector_ko
        canonical_industry = canonical_item.industry_ko
        by_source_key[f"{PROFILE_TAXONOMY}:{source_key}"] = {
            "taxonomy": PROFILE_TAXONOMY,
            "source_key": source_key,
            "code": industry_key,
            "name": industry,
            "canonical_sector_key": slug(canonical_sector),
            "canonical_sector_name": canonical_sector,
            "canonical_industry_key": canonical_industry_key_for(canonical_item),
            "canonical_industry_name": canonical_industry,
            "confidence": confidence,
        }
    return sorted(by_source_key.values(), key=lambda row: row["source_key"])


def finviz_master_rows() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for item in FINVIZ_INDUSTRIES:
        base = {
            "code": item.slug,
            "name": item.name,
            "canonical_sector_key": slug(item.sector_ko),
            "canonical_sector_name": item.sector_ko,
            "canonical_industry_key": canonical_industry_key_for(item),
            "canonical_industry_name": item.industry_ko,
            "confidence": 1,
        }
        rows.append({"taxonomy": "finviz_industry", "source_key": f"US:finviz:{finviz_slug(item.sector)}:{item.slug}", **base})
        for sector_key in profile_sector_key_aliases(item.sector):
            rows.append({"taxonomy": PROFILE_TAXONOMY, "source_key": f"US:{sector_key}:{item.slug}", **base})
            rows.append({"taxonomy": PROFILE_TAXONOMY, "source_key": f"US:{sector_key}:{sector_key}_{item.slug}", **base})
    return rows


def profile_sector_key_aliases(provider_sector: str) -> tuple[str, ...]:
    aliases = {
        "Consumer Cyclical": ("consumer_cyclical", "consumer_discretionary"),
        "Consumer Defensive": ("consumer_defensive", "consumer_staples"),
        "Financial": ("financial", "finance", "financial_services"),
        "Healthcare": ("healthcare", "health_care"),
    }
    return aliases.get(provider_sector, (finviz_slug(provider_sector),))


def canonical_names(market: str, sector: str, industry: str) -> tuple[str, str, float]:
    return canonical_names_for_provider(market, sector, industry)


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
