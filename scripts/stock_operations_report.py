from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import math
import os
from statistics import mean
import sys
from typing import Any
from urllib.parse import urlencode

import requests


DEFAULT_SCORE_MODEL_VERSION = "score-v5-dual-quality-opportunity-2026-06-05"


@dataclass(frozen=True)
class SupabaseReportConfig:
    url: str
    key: str
    timeout_seconds: float


def summarize_queue_rows(rows: list[dict[str, Any]]) -> dict[str, Any]:
    by_status: dict[str, int] = {}
    by_kind: dict[str, int] = {}
    oldest_run_after: str | None = None
    total = 0
    stale_running = 0

    for row in rows:
        jobs = int_value(row.get("jobs"))
        status = str(row.get("status") or "unknown").strip().lower() or "unknown"
        kind = str(row.get("kind") or "unknown").strip().lower() or "unknown"
        total += jobs
        by_status[status] = by_status.get(status, 0) + jobs
        by_kind[kind] = by_kind.get(kind, 0) + jobs
        stale_running += int_value(row.get("stale_running_jobs"))
        run_after = string_value(row.get("oldest_run_after"))
        if run_after and (oldest_run_after is None or run_after < oldest_run_after):
            oldest_run_after = run_after

    return {
        "total_jobs": total,
        "queued_jobs": by_status.get("queued", 0),
        "running_jobs": by_status.get("running", 0),
        "dead_jobs": by_status.get("dead", 0),
        "succeeded_jobs": by_status.get("succeeded", 0),
        "failed_jobs": by_status.get("failed", 0),
        "stale_running_jobs": stale_running,
        "oldest_run_after": oldest_run_after,
        "by_status": by_status,
        "by_kind": by_kind,
    }


def summarize_score_snapshots(
    rows: list[dict[str, Any]],
    expected_model_version: str = DEFAULT_SCORE_MODEL_VERSION,
    now: datetime | None = None,
    stale_after_hours: int = 24,
) -> dict[str, Any]:
    current_now = now or datetime.now(timezone.utc)
    scores: list[float] = []
    quality_scores: list[float] = []
    opportunity_scores: list[float] = []
    confidences: list[float] = []
    duplicate_buckets: dict[float, int] = {}
    missing_model = 0
    current_model = 0
    stale = 0
    low_conf_high_score = 0

    for row in rows:
        payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
        score = finite_number(payload.get("score"))
        quality = finite_number(payload.get("quality_score"))
        opportunity = finite_number(payload.get("opportunity_score"))
        confidence = payload_confidence(payload)
        model = score_model_version(row, payload)

        if model is None:
            missing_model += 1
        elif model == expected_model_version:
            current_model += 1

        if is_stale_snapshot(row, current_now, stale_after_hours):
            stale += 1

        if score is not None:
            scores.append(score)
            bucket = round(score, 1)
            duplicate_buckets[bucket] = duplicate_buckets.get(bucket, 0) + 1
            if confidence is not None and confidence < 0.5 and score > 60.0:
                low_conf_high_score += 1
        if quality is not None:
            quality_scores.append(quality)
        if opportunity is not None:
            opportunity_scores.append(opportunity)
        if confidence is not None:
            confidences.append(confidence)

    duplicate_items = [
        {"score": score, "count": count}
        for score, count in sorted(duplicate_buckets.items(), key=lambda item: (-item[1], item[0]))
        if count > 1
    ]
    duplicate_members = sum(item["count"] for item in duplicate_items)

    return {
        "total_snapshots": len(rows),
        "current_model_snapshots": current_model,
        "missing_model_count": missing_model,
        "stale_snapshots": stale,
        "score_min": rounded(min(scores)) if scores else None,
        "score_max": rounded(max(scores)) if scores else None,
        "score_mean": rounded(mean(scores)) if scores else None,
        "quality_mean": rounded(mean(quality_scores)) if quality_scores else None,
        "opportunity_mean": rounded(mean(opportunity_scores)) if opportunity_scores else None,
        "confidence_mean": rounded(mean(confidences), 3) if confidences else None,
        "low_confidence_high_score_count": low_conf_high_score,
        "duplicate_score_bucket_count": len(duplicate_items),
        "duplicate_score_rate": rounded(duplicate_members / len(rows), 3) if rows else 0.0,
        "max_duplicate_bucket_size": duplicate_items[0]["count"] if duplicate_items else 0,
        "top_duplicate_scores": duplicate_items[:10],
    }


def fetch_supabase_report(
    config: SupabaseReportConfig,
    sample_limit: int = 500,
    stale_after_hours: int = 24,
    expected_model_version: str = DEFAULT_SCORE_MODEL_VERSION,
) -> dict[str, Any]:
    raw_operations = post_supabase_rpc(
        config,
        "stock_operations_report",
        {"p_score_stale_hours": stale_after_hours},
    )
    refresh_queue_rows = raw_operations.get("refresh_queue") if isinstance(raw_operations, dict) else []
    if not isinstance(refresh_queue_rows, list):
        refresh_queue_rows = []
    score_rows = fetch_score_snapshot_rows(config, sample_limit)
    return {
        "ok": True,
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "refresh_queue": summarize_queue_rows(refresh_queue_rows),
        "score_snapshots": raw_operations.get("score_snapshots", {}) if isinstance(raw_operations, dict) else {},
        "score_calibration": summarize_score_snapshots(
            score_rows,
            expected_model_version=expected_model_version,
            stale_after_hours=stale_after_hours,
        ),
    }


def fetch_score_snapshot_rows(config: SupabaseReportConfig, sample_limit: int) -> list[dict[str, Any]]:
    query = urlencode(
        {
            "view_mode": "eq.detail",
            "select": "ticker,view_mode,payload,fetched_at,expires_at,score_model_version",
            "order": "fetched_at.desc",
            "limit": str(max(1, min(sample_limit, 5000))),
        }
    )
    response = requests.get(
        f"{config.url}/rest/v1/stock_score_snapshots?{query}",
        headers=supabase_headers(config.key),
        timeout=config.timeout_seconds,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"Supabase score snapshot query failed: HTTP {response.status_code} {response.text[:500]}")
    payload = response.json()
    return payload if isinstance(payload, list) else []


def post_supabase_rpc(config: SupabaseReportConfig, name: str, body: dict[str, Any]) -> Any:
    response = requests.post(
        f"{config.url}/rest/v1/rpc/{name}",
        headers=supabase_headers(config.key),
        data=json.dumps(body, ensure_ascii=False, allow_nan=False),
        timeout=config.timeout_seconds,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"Supabase RPC {name} failed: HTTP {response.status_code} {response.text[:500]}")
    return response.json() if response.text else {}


def supabase_headers(key: str) -> dict[str, str]:
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }


def supabase_report_config(args: argparse.Namespace) -> SupabaseReportConfig:
    url = (args.supabase_url or os.environ.get("SUPABASE_URL") or "").strip().rstrip("/")
    key = (args.supabase_key or os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.")
    return SupabaseReportConfig(url=url, key=key, timeout_seconds=args.timeout_seconds)


def score_model_version(row: dict[str, Any], payload: dict[str, Any]) -> str | None:
    direct = string_value(row.get("score_model_version")) or string_value(payload.get("score_model_version"))
    if direct:
        return direct
    snapshot = payload.get("sia_snapshot")
    if isinstance(snapshot, dict):
        return string_value(snapshot.get("score_model_version"))
    return None


def payload_confidence(payload: dict[str, Any]) -> float | None:
    snapshot = payload.get("sia_snapshot")
    if not isinstance(snapshot, dict):
        return None
    return finite_number(snapshot.get("confidence"))


def is_stale_snapshot(row: dict[str, Any], now: datetime, stale_after_hours: int) -> bool:
    expires_at = parse_datetime(string_value(row.get("expires_at")))
    fetched_at = parse_datetime(string_value(row.get("fetched_at")))
    if expires_at and expires_at <= now:
        return True
    if fetched_at:
        age_seconds = (now - fetched_at).total_seconds()
        return age_seconds > max(1, stale_after_hours) * 3600
    return False


def parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def finite_number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return float(value)
    return None


def int_value(value: Any) -> int:
    if isinstance(value, bool):
        return 0
    try:
        parsed = int(value)
        return parsed if parsed > 0 else 0
    except (TypeError, ValueError):
        return 0


def string_value(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def rounded(value: float, digits: int = 2) -> float:
    return round(float(value), digits)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Report stock service queue health and score calibration metrics.")
    parser.add_argument("--supabase-url", help="Overrides SUPABASE_URL.")
    parser.add_argument("--supabase-key", help="Overrides SUPABASE_SERVICE_ROLE_KEY.")
    parser.add_argument("--timeout-seconds", type=float, default=15.0)
    parser.add_argument("--sample-limit", type=int, default=500, help="Recent detail score snapshots to sample for calibration.")
    parser.add_argument("--score-stale-hours", type=int, default=24)
    parser.add_argument("--expected-score-model-version", default=os.environ.get("EXPECTED_SCORE_MODEL_VERSION", DEFAULT_SCORE_MODEL_VERSION))
    parser.add_argument("--json", action="store_true")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        payload = fetch_supabase_report(
            supabase_report_config(args),
            sample_limit=args.sample_limit,
            stale_after_hours=args.score_stale_hours,
            expected_model_version=args.expected_score_model_version,
        )
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 2

    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print_human_report(payload)
    return 0


def print_human_report(payload: dict[str, Any]) -> None:
    queue = payload.get("refresh_queue") if isinstance(payload.get("refresh_queue"), dict) else {}
    calibration = payload.get("score_calibration") if isinstance(payload.get("score_calibration"), dict) else {}
    print(f"generated_at={payload.get('generated_at')}")
    print(
        "queue total={total_jobs} queued={queued_jobs} running={running_jobs} "
        "dead={dead_jobs} stale_running={stale_running_jobs}".format(**queue)
    )
    print(
        "scores total={total_snapshots} current_model={current_model_snapshots} stale={stale_snapshots} "
        "mean={score_mean} min={score_min} max={score_max} duplicates={duplicate_score_rate}".format(**calibration)
    )
    if calibration.get("top_duplicate_scores"):
        print(f"top_duplicate_scores={calibration['top_duplicate_scores'][:5]}")
    if calibration.get("low_confidence_high_score_count"):
        print(f"low_confidence_high_score_count={calibration['low_confidence_high_score_count']}")


if __name__ == "__main__":
    raise SystemExit(main())
