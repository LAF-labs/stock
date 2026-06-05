from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
import os
import subprocess
from pathlib import Path
from typing import Any

import requests

from backfill_symbol_profiles import (
    PROFILE_TABLE,
    TAG_TABLE,
    ROOT,
    build_kind_rows,
    build_master_rows,
    build_nasdaq_rows,
    build_yfinance_rows,
    clean_text,
    env_value,
    env_with_local_files,
    load_symbols,
    supabase_headers,
    upsert_rows,
    yahoo_symbol_for,
)


DEFAULT_LANES = (
    "KR:KOSPI:75",
    "KR:KOSDAQ:50",
)


@dataclass(frozen=True)
class Lane:
    market: str
    exchange: str
    limit: int


def parse_lane(value: str) -> Lane:
    parts = [part.strip().upper() for part in value.split(":")]
    if len(parts) != 3:
        raise argparse.ArgumentTypeError("lane must use MARKET:EXCHANGE:LIMIT, e.g. KR:KOSPI:75")
    market, exchange, raw_limit = parts
    if market not in {"KR", "US"}:
        raise argparse.ArgumentTypeError("lane market must be KR or US")
    try:
        limit = int(raw_limit)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("lane limit must be an integer") from exc
    if limit <= 0:
        raise argparse.ArgumentTypeError("lane limit must be positive")
    return Lane(market=market, exchange=exchange, limit=limit)


def supabase_read_config() -> tuple[str, str]:
    url = (env_value("SUPABASE_URL") or "").rstrip("/")
    key = env_value("SUPABASE_PUBLISHABLE_KEY") or env_value("SUPABASE_SERVICE_ROLE_KEY") or ""
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY or SUPABASE_SERVICE_ROLE_KEY are required.")
    return url, key


def hydrate_service_role_from_cli() -> bool:
    if env_value("SUPABASE_SERVICE_ROLE_KEY"):
        return False

    project_ref_path = ROOT / "supabase" / ".temp" / "project-ref"
    if not project_ref_path.exists() or not env_value("SUPABASE_ACCESS_TOKEN"):
        return False

    result = subprocess.run(
        [
            "supabase",
            "projects",
            "api-keys",
            "--project-ref",
            project_ref_path.read_text(encoding="utf-8").strip(),
            "--output-format",
            "json",
        ],
        cwd=ROOT,
        env=env_with_local_files(),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=30,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout).strip())

    rows = json.loads(result.stdout)
    for row in rows if isinstance(rows, list) else []:
        if row.get("name") == "service_role" or row.get("type") == "service_role":
            key = row.get("api_key") or row.get("key")
            if key:
                os.environ["SUPABASE_SERVICE_ROLE_KEY"] = key
                return True
    return False


def symbol_index(items: list[dict[str, Any]]) -> dict[tuple[str, str], dict[str, Any]]:
    return {(clean_text(item.get("market")).upper(), clean_text(item.get("ticker")).upper()): item for item in items}


def fetch_pending_profiles(lane: Lane, remote_limit: int) -> list[dict[str, Any]]:
    url, key = supabase_read_config()
    response = requests.get(
        f"{url}/rest/v1/{PROFILE_TABLE}",
        params={
            "select": "market,symbol,exchange,classification_status,asset_class,updated_at",
            "market": f"eq.{lane.market}",
            "exchange": f"eq.{lane.exchange}",
            "asset_class": "eq.stock",
            "classification_status": "in.(pending,partial)",
            "order": "updated_at.asc,symbol.asc",
            "limit": str(remote_limit),
        },
        headers=supabase_headers(key),
        timeout=15,
    )
    response.raise_for_status()
    return response.json()


def select_lane_items(lane: Lane, items_by_key: dict[tuple[str, str], dict[str, Any]]) -> list[dict[str, Any]]:
    candidates = fetch_pending_profiles(lane, lane.limit * 4)
    selected: list[dict[str, Any]] = []
    for candidate in candidates:
        key = (clean_text(candidate.get("market")).upper(), clean_text(candidate.get("symbol")).upper())
        item = items_by_key.get(key)
        if not item or not yahoo_symbol_for(item):
            continue
        selected.append(item)
        if len(selected) >= lane.limit:
            break
    return selected


def upsert_profile_batches(profiles: list[dict[str, Any]], tags: list[dict[str, Any]], batch_size: int, dry_run: bool, transport: str) -> tuple[int, int]:
    profile_count = upsert_rows(PROFILE_TABLE, profiles, "market,symbol", batch_size, dry_run, transport)
    tag_count = upsert_rows(TAG_TABLE, tags, "market,symbol,taxonomy,level,code,name,source", batch_size, dry_run, transport)
    return profile_count, tag_count


def refresh_benchmarks(min_sample_count: int, dry_run: bool) -> int | None:
    if dry_run:
        return None
    url = (env_value("SUPABASE_URL") or "").rstrip("/")
    key = env_value("SUPABASE_SERVICE_ROLE_KEY") or ""
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to refresh benchmarks.")
    response = requests.post(
        f"{url}/rest/v1/rpc/refresh_stock_industry_benchmarks",
        headers=supabase_headers(key),
        json={"p_min_sample_count": min_sample_count},
        timeout=60,
    )
    response.raise_for_status()
    return int(response.text or "0")


def run_master_seed(batch_size: int, dry_run: bool, transport: str) -> dict[str, Any]:
    profiles, tags = build_master_rows(load_symbols())
    profile_count, tag_count = upsert_profile_batches(profiles, tags, batch_size, dry_run, transport)
    return {
        "source": "master",
        "profiles_upserted": profile_count,
        "tags_upserted": tag_count,
    }


def run_nasdaq_seed(batch_size: int, dry_run: bool, transport: str) -> dict[str, Any]:
    items = [item for item in load_symbols() if clean_text(item.get("market")).upper() == "US"]
    profiles, tags, misses = build_nasdaq_rows(items)
    profile_count, tag_count = upsert_profile_batches(profiles, tags, batch_size, dry_run, transport)
    return {
        "source": "nasdaq_screener",
        "input_symbols": len(items),
        "profiles_upserted": profile_count,
        "tags_upserted": tag_count,
        "misses": misses,
    }


def run_kind_seed(batch_size: int, dry_run: bool, transport: str) -> dict[str, Any]:
    items = [item for item in load_symbols() if clean_text(item.get("market")).upper() == "KR"]
    profiles, tags, misses = build_kind_rows(items)
    profile_count, tag_count = upsert_profile_batches(profiles, tags, batch_size, dry_run, transport)
    return {
        "source": "kind_krx_corp_list",
        "input_symbols": len(items),
        "profiles_upserted": profile_count,
        "tags_upserted": tag_count,
        "misses": misses,
    }


def run_yfinance_lanes(args: argparse.Namespace) -> list[dict[str, Any]]:
    items_by_key = symbol_index(load_symbols())
    results: list[dict[str, Any]] = []
    for lane in args.lane:
        items = select_lane_items(lane, items_by_key)
        if args.dry_run:
            results.append(
                {
                    "market": lane.market,
                    "exchange": lane.exchange,
                    "requested_limit": lane.limit,
                    "selected": len(items),
                    "symbols": [f"{item['market']}:{item['ticker']}" for item in items[:20]],
                }
            )
            continue

        profiles, tags, misses = build_yfinance_rows(items, args.pause_seconds, args.provider_timeout_seconds)
        profile_count, tag_count = upsert_profile_batches(profiles, tags, args.batch_size, args.dry_run, args.transport)
        results.append(
            {
                "market": lane.market,
                "exchange": lane.exchange,
                "requested_limit": lane.limit,
                "selected": len(items),
                "profiles_upserted": profile_count,
                "tags_upserted": tag_count,
                "misses": misses,
            }
        )
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description="Run industry benchmark refreshes and occasional classification backfills.")
    parser.add_argument("--lane", action="append", type=parse_lane)
    parser.add_argument("--batch-size", type=int, default=250)
    parser.add_argument("--pause-seconds", type=float, default=0.1)
    parser.add_argument("--provider-timeout-seconds", type=int, default=20)
    parser.add_argument("--transport", choices=["rest", "supabase-cli", "auto"], default="rest")
    parser.add_argument("--seed-master", action="store_true")
    parser.add_argument("--refresh-classifications", action="store_true")
    parser.add_argument("--skip-kind", action="store_true")
    parser.add_argument("--skip-nasdaq", action="store_true")
    parser.add_argument("--run-yfinance-fallback", action="store_true")
    parser.add_argument("--refresh-benchmarks", action="store_true")
    parser.add_argument("--benchmark-min-sample-count", type=int, default=8)
    parser.add_argument("--no-cli-service-role", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    run_yfinance = args.run_yfinance_fallback or args.lane is not None
    if args.lane is None and run_yfinance:
        args.lane = [parse_lane(value) for value in DEFAULT_LANES]
    elif args.lane is None:
        args.lane = []

    hydrated_service_role = False
    if not args.no_cli_service_role and not args.dry_run:
        hydrated_service_role = hydrate_service_role_from_cli()

    summary: dict[str, Any] = {
        "dry_run": args.dry_run,
        "transport": args.transport,
        "hydrated_service_role_from_cli": hydrated_service_role,
    }
    if args.seed_master:
        summary["master"] = run_master_seed(args.batch_size, args.dry_run, args.transport)
    if args.refresh_classifications:
        if not args.skip_kind:
            summary["kind"] = run_kind_seed(args.batch_size, args.dry_run, args.transport)
        if not args.skip_nasdaq:
            summary["nasdaq"] = run_nasdaq_seed(args.batch_size, args.dry_run, args.transport)
    if run_yfinance:
        summary["lanes"] = run_yfinance_lanes(args)
    if args.refresh_benchmarks:
        summary["benchmarks_refreshed"] = refresh_benchmarks(args.benchmark_min_sample_count, args.dry_run)

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
