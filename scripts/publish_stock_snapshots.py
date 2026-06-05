from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import sys
import time
from typing import Any, Iterable

import requests

try:
    from scripts.fetch_yfinance_score import fetch_quote, fetch_score, parse_symbol_ref
except ModuleNotFoundError:
    from fetch_yfinance_score import fetch_quote, fetch_score, parse_symbol_ref


ScoreView = str


@dataclass(frozen=True)
class SupabasePublishConfig:
    url: str
    key: str
    timeout_seconds: float


def normalize_ticker_ref(raw: str) -> str:
    market, symbol = parse_symbol_ref(raw)
    return f"{market}:{symbol}"


def parse_ticker_args(values: Iterable[str] | None) -> list[str]:
    unique: list[str] = []
    for value in values or []:
        for part in value.split(","):
            candidate = part.strip()
            if not candidate or candidate.startswith("#"):
                continue
            ticker = normalize_ticker_ref(candidate)
            if ticker not in unique:
                unique.append(ticker)
    return unique


def parse_ticker_file(path: str | None) -> list[str]:
    if not path:
        return []
    values: list[str] = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        cleaned = line.split("#", 1)[0].strip()
        if cleaned:
            values.append(cleaned)
    return parse_ticker_args(values)


def ttl_expires_at(now: datetime, ttl_seconds: int) -> str:
    return (now + timedelta(seconds=max(60, ttl_seconds))).replace(microsecond=0).isoformat()


def build_score_snapshot_row(
    ticker: str,
    view: ScoreView,
    payload: dict[str, Any],
    fetched_at: datetime,
    ttl_seconds: int,
) -> dict[str, Any]:
    return {
        "ticker": ticker,
        "view_mode": view,
        "payload": payload,
        "fetched_at": fetched_at.replace(microsecond=0).isoformat(),
        "expires_at": ttl_expires_at(fetched_at, ttl_seconds),
    }


def build_quote_snapshot_row(
    ticker: str,
    payload: dict[str, Any],
    fetched_at: datetime,
    ttl_seconds: int,
    stale_ttl_seconds: int | None = None,
) -> dict[str, Any]:
    market, symbol = parse_symbol_ref(ticker)
    stale_seconds = stale_ttl_seconds or numeric_env("STOCK_QUOTE_SNAPSHOT_STALE_SECONDS", 86_400)
    return {
        "ticker": ticker,
        "market": market,
        "symbol": symbol,
        "source": "kis",
        "payload": payload,
        "fetched_at": fetched_at.replace(microsecond=0).isoformat(),
        "expires_at": ttl_expires_at(fetched_at, ttl_seconds),
        "stale_expires_at": ttl_expires_at(fetched_at, stale_seconds),
    }


def numeric_env(name: str, fallback: int) -> int:
    try:
        parsed = int(os.environ.get(name, ""))
        return parsed if parsed > 0 else fallback
    except ValueError:
        return fallback


def supabase_publish_config(args: argparse.Namespace) -> SupabasePublishConfig:
    url = (args.supabase_url or os.environ.get("SUPABASE_URL") or "").strip().rstrip("/")
    key = (args.supabase_key or os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required unless --dry-run is used.")
    return SupabasePublishConfig(url=url, key=key, timeout_seconds=args.timeout_seconds)


def supabase_headers(key: str) -> dict[str, str]:
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }


def upsert_snapshot(config: SupabasePublishConfig, table: str, row: dict[str, Any], on_conflict: str) -> None:
    response = requests.post(
        f"{config.url}/rest/v1/{table}?on_conflict={on_conflict}",
        headers=supabase_headers(config.key),
        data=json.dumps(row, ensure_ascii=False, allow_nan=False),
        timeout=config.timeout_seconds,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"Supabase upsert failed for {table}: HTTP {response.status_code} {response.text[:500]}")


def post_supabase_rpc(config: SupabasePublishConfig, name: str, body: dict[str, Any]) -> Any:
    response = requests.post(
        f"{config.url}/rest/v1/rpc/{name}",
        headers=supabase_headers(config.key),
        data=json.dumps(body, ensure_ascii=False, allow_nan=False),
        timeout=config.timeout_seconds,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"Supabase RPC {name} failed: HTTP {response.status_code} {response.text[:500]}")
    if not response.text:
        return None
    return response.json()


def claim_refresh_jobs(
    config: SupabasePublishConfig,
    worker_id: str,
    limit: int,
    lock_seconds: int,
) -> list[dict[str, Any]]:
    payload = post_supabase_rpc(
        config,
        "claim_stock_refresh_jobs",
        {
            "p_worker_id": worker_id,
            "p_limit": limit,
            "p_lock_seconds": lock_seconds,
        },
    )
    return payload if isinstance(payload, list) else []


def complete_refresh_job(config: SupabasePublishConfig, worker_id: str, job_id: str) -> None:
    post_supabase_rpc(
        config,
        "complete_stock_refresh_job",
        {
            "p_job_id": job_id,
            "p_worker_id": worker_id,
        },
    )


def fail_refresh_job(config: SupabasePublishConfig, worker_id: str, job_id: str, error: str, retry_after_seconds: int) -> None:
    post_supabase_rpc(
        config,
        "fail_stock_refresh_job",
        {
            "p_job_id": job_id,
            "p_worker_id": worker_id,
            "p_error": error[:1000],
            "p_retry_after_seconds": retry_after_seconds,
        },
    )


def job_ticker_ref(job: dict[str, Any]) -> str:
    market = str(job.get("market") or "US").strip().upper()
    symbol = str(job.get("symbol") or "").strip().upper()
    return normalize_ticker_ref(f"{market}:{symbol}")


def job_retry_after_seconds(job: dict[str, Any]) -> int:
    try:
        attempts = int(job.get("attempts") or 1)
    except (TypeError, ValueError):
        attempts = 1
    return min(3600, max(120, 60 * (2 ** max(1, attempts))))


def ok_payload(payload: dict[str, Any]) -> bool:
    return payload.get("ok") is True


def parse_views(raw: str) -> list[ScoreView]:
    unique: list[ScoreView] = []
    for part in raw.split(","):
        view = part.strip()
        if view not in {"detail", "compare"}:
            raise ValueError(f"Unsupported score view: {view}")
        if view not in unique:
            unique.append(view)
    return unique


def publish_ticker(
    ticker: str,
    views: list[ScoreView],
    config: SupabasePublishConfig | None,
    args: argparse.Namespace,
) -> dict[str, Any]:
    fetched_at = datetime.now(timezone.utc)
    summary: dict[str, Any] = {"ticker": ticker, "quote": None, "scores": {}, "errors": []}

    if not args.skip_quote:
        quote = fetch_quote(ticker)
        if ok_payload(quote):
            row = build_quote_snapshot_row(ticker, quote, fetched_at, args.quote_ttl_seconds, args.quote_stale_ttl_seconds)
            if config:
                upsert_snapshot(config, "stock_quote_snapshots", row, "ticker")
            summary["quote"] = "published" if config else "dry_run"
        else:
            summary["quote"] = "skipped"
            summary["errors"].append({"kind": "quote", "error": quote.get("error") or "fetch_failed"})

    if not args.skip_score:
        for view in views:
            score = fetch_score(ticker, view=view)
            if ok_payload(score):
                row = build_score_snapshot_row(ticker, view, score, fetched_at, args.score_ttl_seconds)
                if config:
                    upsert_snapshot(config, "stock_score_snapshots", row, "ticker,view_mode")
                summary["scores"][view] = "published" if config else "dry_run"
            else:
                summary["scores"][view] = "skipped"
                summary["errors"].append({"kind": "score", "view": view, "error": score.get("error") or "fetch_failed"})

    return summary


def publish_queue_job(
    job: dict[str, Any],
    config: SupabasePublishConfig,
    args: argparse.Namespace,
    worker_id: str,
) -> dict[str, Any]:
    job_id = str(job.get("id") or "")
    kind = str(job.get("kind") or "").strip().lower()
    view = str(job.get("view_mode") or "detail").strip().lower()
    ticker = job_ticker_ref(job)
    summary: dict[str, Any] = {"job_id": job_id, "kind": kind, "ticker": ticker, "view": view if kind == "score" else None, "status": None, "errors": []}
    fetched_at = datetime.now(timezone.utc)

    try:
        if not job_id:
            raise RuntimeError("claimed job is missing id")
        if kind == "quote":
            quote = fetch_quote(ticker)
            if not ok_payload(quote):
                raise RuntimeError(str(quote.get("error") or "quote_fetch_failed"))
            row = build_quote_snapshot_row(ticker, quote, fetched_at, args.quote_ttl_seconds, args.quote_stale_ttl_seconds)
            upsert_snapshot(config, "stock_quote_snapshots", row, "ticker")
        elif kind == "score":
            if view not in {"detail", "compare"}:
                view = "detail"
            score = fetch_score(ticker, view=view)
            if not ok_payload(score):
                raise RuntimeError(str(score.get("error") or "score_fetch_failed"))
            row = build_score_snapshot_row(ticker, view, score, fetched_at, args.score_ttl_seconds)
            upsert_snapshot(config, "stock_score_snapshots", row, "ticker,view_mode")
        else:
            raise RuntimeError(f"unsupported refresh job kind: {kind}")

        complete_refresh_job(config, worker_id, job_id)
        summary["status"] = "succeeded"
    except Exception as exc:
        message = str(exc)
        summary["status"] = "failed"
        summary["errors"].append({"error": message})
        if job_id:
            fail_refresh_job(config, worker_id, job_id, message, job_retry_after_seconds(job))

    return summary


def drain_refresh_queue(config: SupabasePublishConfig, args: argparse.Namespace) -> list[dict[str, Any]]:
    worker_id = args.worker_id or f"stock-snapshot-publisher-{os.getpid()}"
    jobs = claim_refresh_jobs(config, worker_id, args.queue_limit, args.queue_lock_seconds)
    rows: list[dict[str, Any]] = []
    for index, job in enumerate(jobs):
        if index and args.sleep_seconds > 0:
            time.sleep(args.sleep_seconds)
        rows.append(publish_queue_job(job, config, args, worker_id))
    return rows


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Publish stock quote and score snapshots into Supabase.")
    parser.add_argument("--ticker", action="append", help="Ticker to publish. Can be repeated or comma-separated.")
    parser.add_argument("--tickers", help="Comma-separated ticker list.")
    parser.add_argument("--tickers-file", help="Text file with one ticker per line. # comments are ignored.")
    parser.add_argument("--views", default="detail,compare", help="Score views to publish: detail,compare.")
    parser.add_argument("--skip-quote", action="store_true", help="Do not publish quote snapshots.")
    parser.add_argument("--skip-score", action="store_true", help="Do not publish score snapshots.")
    parser.add_argument("--dry-run", action="store_true", help="Fetch and build rows without writing to Supabase.")
    parser.add_argument("--sleep-seconds", type=float, default=0.0, help="Delay between tickers to avoid provider bursts.")
    parser.add_argument("--timeout-seconds", type=float, default=15.0, help="Supabase REST timeout.")
    parser.add_argument("--score-ttl-seconds", type=int, default=numeric_env("STOCK_SCORE_SNAPSHOT_EXPIRES_SECONDS", 21_600))
    parser.add_argument("--quote-ttl-seconds", type=int, default=numeric_env("STOCK_QUOTE_SNAPSHOT_EXPIRES_SECONDS", 300))
    parser.add_argument("--quote-stale-ttl-seconds", type=int, default=numeric_env("STOCK_QUOTE_SNAPSHOT_STALE_SECONDS", 86_400))
    parser.add_argument("--supabase-url", help="Overrides SUPABASE_URL.")
    parser.add_argument("--supabase-key", help="Overrides SUPABASE_SERVICE_ROLE_KEY.")
    parser.add_argument("--drain-queue", "--from-queue", dest="drain_queue", action="store_true", help="Claim and publish queued stock refresh jobs.")
    parser.add_argument("--queue-limit", type=int, default=numeric_env("STOCK_SNAPSHOT_QUEUE_LIMIT", 50), help="Maximum queued jobs to claim in this run.")
    parser.add_argument("--queue-lock-seconds", type=int, default=numeric_env("STOCK_SNAPSHOT_QUEUE_LOCK_SECONDS", 900), help="Queue job lock duration.")
    parser.add_argument("--worker-id", default=os.environ.get("STOCK_SNAPSHOT_WORKER_ID"), help="Stable worker id for queued job claims.")
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON.")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    tickers = parse_ticker_args([args.tickers] if args.tickers else [])
    tickers.extend(ticker for ticker in parse_ticker_args(args.ticker) if ticker not in tickers)
    tickers.extend(ticker for ticker in parse_ticker_file(args.tickers_file) if ticker not in tickers)
    if not tickers and not args.drain_queue:
        parser.error("At least one ticker is required unless --drain-queue is used.")
    if args.skip_quote and args.skip_score:
        parser.error("At least one of quote or score publishing must be enabled.")

    try:
        views = parse_views(args.views)
        config = None if args.dry_run else supabase_publish_config(args)
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 2

    rows: list[dict[str, Any]] = []
    for index, ticker in enumerate(tickers):
        if index and args.sleep_seconds > 0:
            time.sleep(args.sleep_seconds)
        try:
            rows.append(publish_ticker(ticker, views, config, args))
        except Exception as exc:
            rows.append({"ticker": ticker, "quote": "error", "scores": {}, "errors": [{"error": str(exc)}]})

    queue_rows: list[dict[str, Any]] = []
    if args.drain_queue and config:
        queue_rows = drain_refresh_queue(config, args)

    payload = {
        "ok": not any(row["errors"] for row in rows) and not any(row["errors"] for row in queue_rows),
        "dry_run": args.dry_run,
        "tickers": len(tickers),
        "rows": rows,
        "queue_jobs": len(queue_rows),
        "queue_rows": queue_rows,
    }
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        for row in rows:
            print(f"{row['ticker']} quote={row['quote']} scores={row['scores']} errors={len(row['errors'])}")
        print("OK" if payload["ok"] else "FAILED")
    return 0 if payload["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
