#!/usr/bin/env python3
from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta, timezone
import json
import os
from pathlib import Path
from typing import Any
import warnings

import pandas as pd
import pandas_market_calendars as mcal
import requests

warnings.filterwarnings("ignore", category=UserWarning, module=r"pandas_market_calendars\.market_calendar")

ROOT = Path(__file__).resolve().parents[1]
TABLE = "market_calendar"
SOURCE_REVISION = "pandas-market-calendars-5.2.0"
MARKETS = {
    "US": {"calendar": "XNYS", "timezone": "America/New_York"},
    "KR": {"calendar": "XKRX", "timezone": "Asia/Seoul"},
}


def load_local_env_files() -> None:
    for name in (".env.local", ".env.supabase.local", ".env.vercel.local"):
        path = ROOT / name
        if not path.exists():
            continue
        for raw_line in path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip("'\"")
            if key and key not in os.environ:
                os.environ[key] = value


def parse_date(value: str) -> date:
    return datetime.strptime(value, "%Y-%m-%d").date()


def iso(value: Any) -> str | None:
    if value is None or pd.isna(value):
        return None
    timestamp = pd.Timestamp(value)
    if timestamp.tzinfo is None:
        timestamp = timestamp.tz_localize(timezone.utc)
    return timestamp.tz_convert(timezone.utc).isoformat()


def build_market_rows(market: str, start: date, end: date) -> list[dict[str, Any]]:
    config = MARKETS[market]
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        calendar = mcal.get_calendar(config["calendar"])
        schedule = calendar.schedule(start_date=start.isoformat(), end_date=end.isoformat())
    early_dates = set()
    try:
        early_dates = {pd.Timestamp(index).date() for index in calendar.early_closes(schedule).index}
    except Exception:
        early_dates = set()

    schedule_by_date = {pd.Timestamp(index).date(): row for index, row in schedule.iterrows()}
    open_dates = sorted(schedule_by_date)
    rows: list[dict[str, Any]] = []
    cursor = start
    while cursor <= end:
        session = schedule_by_date.get(cursor)
        next_open_at = next_open_after(open_dates, schedule_by_date, cursor)
        is_open = session is not None
        is_early_close = cursor in early_dates
        rows.append(
            {
                "market": market,
                "trade_date": cursor.isoformat(),
                "is_open": is_open,
                "open_at": iso(session.get("market_open")) if is_open else None,
                "close_at": iso(session.get("market_close")) if is_open else None,
                "next_open_at": next_open_at,
                "is_early_close": is_early_close,
                "status": "early_close" if is_early_close else "regular" if is_open else "closed",
                "holiday_name": None,
                "reason": "exchange_calendar" if is_open else "exchange_closed",
                "timezone": config["timezone"],
                "source_revision": SOURCE_REVISION,
            }
        )
        cursor += timedelta(days=1)
    return rows


def next_open_after(open_dates: list[date], schedule_by_date: dict[date, Any], current: date) -> str | None:
    for open_date in open_dates:
        if open_date > current:
            return iso(schedule_by_date[open_date].get("market_open"))
    return None


def supabase_headers(key: str) -> dict[str, str]:
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }


def upsert_rows(rows: list[dict[str, Any]], batch_size: int, dry_run: bool) -> int:
    if dry_run:
        print(json.dumps({"rows": len(rows), "sample": rows[:5]}, ensure_ascii=False, indent=2))
        return len(rows)

    url = (os.environ.get("SUPABASE_URL") or "").strip().rstrip("/")
    key = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.")

    count = 0
    for index in range(0, len(rows), batch_size):
        batch = rows[index : index + batch_size]
        response = requests.post(
            f"{url}/rest/v1/{TABLE}?on_conflict=market,trade_date",
            headers=supabase_headers(key),
            data=json.dumps(batch, ensure_ascii=False, allow_nan=False),
            timeout=30,
        )
        if response.status_code >= 400:
            raise RuntimeError(f"Supabase market calendar upsert failed: HTTP {response.status_code} {response.text[:500]}")
        count += len(batch)
    return count


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed and refresh exchange market calendars in Supabase.")
    parser.add_argument("--start-date", default=(datetime.now(timezone.utc).date() - timedelta(days=7)).isoformat())
    parser.add_argument("--days", type=int, default=550)
    parser.add_argument("--market", action="append", choices=sorted(MARKETS), help="Market to sync. Defaults to US and KR.")
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    load_local_env_files()
    start = parse_date(args.start_date)
    end = start + timedelta(days=max(1, args.days) - 1)
    markets = args.market or sorted(MARKETS)
    rows: list[dict[str, Any]] = []
    for market in markets:
        rows.extend(build_market_rows(market, start, end))
    upserted = upsert_rows(rows, args.batch_size, args.dry_run)
    print(
        json.dumps(
            {
                "ok": True,
                "markets": markets,
                "start_date": start.isoformat(),
                "end_date": end.isoformat(),
                "rows": len(rows),
                "upserted": upserted,
                "dry_run": args.dry_run,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
