from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta, timezone
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import subprocess
import time
from typing import Any
from urllib import error, parse, request
import warnings

import pandas as pd
import pandas_market_calendars as mcal

try:
    from finviz_industry_taxonomy import (
        FINVIZ_INDUSTRIES,
        canonical_names_for_provider,
        finviz_industry_by_name,
    )
except ModuleNotFoundError:
    from scripts.finviz_industry_taxonomy import (
        FINVIZ_INDUSTRIES,
        canonical_names_for_provider,
        finviz_industry_by_name,
    )

ROOT = Path(__file__).resolve().parents[1]
BENCHMARK_TABLE = "stock_industry_benchmarks"
ENV_FILES = (".env.local", ".env.supabase.local")
BENCHMARK_EXPIRY_GRACE_HOURS = 12
DEFAULT_FINVIZ_CACHE_PATH = ROOT / "tmp" / "finviz-industry-groups-v120.html"
DEFAULT_FINVIZ_CACHE_MAX_AGE_HOURS = 20.0

FINVIZ_SOURCE = "finviz_industry"
FINVIZ_BASE_URL = "https://finviz.com/groups.ashx"
MARKET_CALENDARS = {
    "US": "XNYS",
    "KR": "XKRX",
}
FINVIZ_SECTORS = {
    "basicmaterials": "Basic Materials",
    "communicationservices": "Communication Services",
    "consumercyclical": "Consumer Cyclical",
    "consumerdefensive": "Consumer Defensive",
    "energy": "Energy",
    "financial": "Financial",
    "healthcare": "Healthcare",
    "industrials": "Industrials",
    "realestate": "Real Estate",
    "technology": "Technology",
    "utilities": "Utilities",
}

class FinvizGroupTableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[list[str]] = []
        self._in_table = False
        self._table_depth = 0
        self._current_row: list[str] | None = None
        self._current_cell: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_map = {name: value or "" for name, value in attrs}
        if tag == "table" and "groups_table" in attrs_map.get("class", ""):
            self._in_table = True
            self._table_depth = 1
            return
        if not self._in_table:
            return
        if tag == "table":
            self._table_depth += 1
        elif tag == "tr":
            self._current_row = []
        elif tag in {"td", "th"} and self._current_row is not None:
            self._current_cell = []

    def handle_data(self, data: str) -> None:
        if self._current_cell is not None:
            self._current_cell.append(data)

    def handle_endtag(self, tag: str) -> None:
        if not self._in_table:
            return
        if tag in {"td", "th"} and self._current_cell is not None and self._current_row is not None:
            self._current_row.append(clean_text(" ".join(self._current_cell)))
            self._current_cell = None
        elif tag == "tr" and self._current_row is not None:
            if any(self._current_row):
                self.rows.append(self._current_row)
            self._current_row = None
        elif tag == "table":
            self._table_depth -= 1
            if self._table_depth <= 0:
                self._in_table = False


def parse_finviz_group_rows(html: str) -> list[dict[str, Any]]:
    parser = FinvizGroupTableParser()
    parser.feed(html)
    if not parser.rows:
        return []

    header_index = next(
        (
            index
            for index, values in enumerate(parser.rows)
            if "name" in [normalize_header(value) for value in values]
            and any(normalize_header(value) == "pe" for value in values)
        ),
        None,
    )
    if header_index is None:
        headers = [
            "no",
            "name",
            "market_cap",
            "pe",
            "fwd_pe",
            "peg",
            "ps",
            "pb",
            "pc",
            "pfcf",
            "eps_past_5y",
            "eps_next_5y",
            "sales_past_5y",
            "change",
            "volume",
        ]
        data_rows = parser.rows
    else:
        headers = [normalize_header(value) for value in parser.rows[header_index]]
        data_rows = parser.rows[header_index + 1 :]
    rows: list[dict[str, Any]] = []
    for cells in data_rows:
        if len(cells) < 5:
            continue
        row = row_by_headers(headers, cells)
        name = clean_text(row.get("name"))
        if not name or name.lower() == "name":
            continue
        rows.append(
            {
                "name": name,
                "market_cap": clean_text(row.get("market_cap")),
                "pe": parse_number(row.get("pe")),
                "forward_per": parse_number(row.get("fwd_pe")),
                "psr": parse_number(row.get("ps")),
                "pbr": parse_number(row.get("pb")),
            }
        )
    return rows


def build_finviz_benchmark_rows(
    raw_rows: list[dict[str, Any]],
    as_of_date: str | None = None,
    generated_at: datetime | None = None,
) -> list[dict[str, Any]]:
    benchmark_date = as_of_date or date.today().isoformat()
    expires_at = benchmark_expires_at("US", generated_at)
    rows: list[dict[str, Any]] = []
    for raw in raw_rows:
        provider_sector = clean_text(raw.get("sector"))
        provider_group = clean_text(raw.get("name"))
        if not provider_group:
            continue
        sector, industry, confidence = canonical_names(provider_sector, provider_group)
        for metric, value in (
            ("per", raw.get("pe")),
            ("forward_per", raw.get("forward_per")),
            ("pbr", raw.get("pbr")),
            ("psr", raw.get("psr")),
        ):
            if not isinstance(value, (int, float)) or value <= 0:
                continue
            rows.append(
                {
                    "scope": "OVERSEAS",
                    "market": "US",
                    "sector": sector,
                    "industry": industry,
                    "metric": metric,
                    "period": "quarter",
                    "median": round(float(value), 4),
                    "p25": None,
                    "p75": None,
                    "sample_count": int(raw.get("sample_count") or 8),
                    "source": FINVIZ_SOURCE,
                    "provider_group_key": slug(f"finviz:{provider_sector}:{provider_group}"),
                    "provider_group_name": provider_group,
                    "calculation_method": "provider_group_value",
                    "confidence": confidence,
                    "as_of_date": benchmark_date,
                    "expires_at": expires_at,
                }
            )
    return rows


def finviz_rows_from_existing_benchmarks(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    latest_as_of_date = max((clean_text(row.get("as_of_date")) for row in rows if clean_text(row.get("as_of_date"))), default="")
    if latest_as_of_date:
        rows = [row for row in rows if clean_text(row.get("as_of_date")) == latest_as_of_date]

    by_name: dict[str, dict[str, Any]] = {}
    metric_keys = {
        "per": "pe",
        "forward_per": "forward_per",
        "psr": "psr",
        "pbr": "pbr",
    }
    for row in rows:
        item = finviz_industry_by_name(row.get("provider_group_name"))
        if not item:
            continue
        group = by_name.setdefault(
            item.name,
            {
                "name": item.name,
                "sector": item.sector,
                "market_cap": "",
                "sample_count": int(row.get("sample_count") or 8),
                "source_url": "supabase:stock_industry_benchmarks",
            },
        )
        metric = clean_text(row.get("metric")).lower()
        key = metric_keys.get(metric)
        if key:
            group[key] = number_value(row.get("median"))
    return [by_name[item.name] for item in FINVIZ_INDUSTRIES if item.name in by_name]


def benchmark_expires_at(market: str, generated_at: datetime | None = None, grace_hours: int = BENCHMARK_EXPIRY_GRACE_HOURS) -> str:
    now_ts = generated_at or datetime.now(timezone.utc)
    if now_ts.tzinfo is None:
        now_ts = now_ts.replace(tzinfo=timezone.utc)
    now_ts = now_ts.astimezone(timezone.utc)
    calendar_name = MARKET_CALENDARS.get(clean_text(market).upper(), "XNYS")
    start = now_ts.date()
    end = start + timedelta(days=14)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        schedule = mcal.get_calendar(calendar_name).schedule(start_date=start.isoformat(), end_date=end.isoformat())
    for _, row in schedule.iterrows():
        close_at = pd.Timestamp(row["market_close"])
        if close_at.tzinfo is None:
            close_at = close_at.tz_localize(timezone.utc)
        close_at = close_at.tz_convert(timezone.utc)
        if close_at.to_pydatetime() > now_ts:
            return (close_at.to_pydatetime() + timedelta(hours=grace_hours)).isoformat()
    return (now_ts + timedelta(days=4)).isoformat()


def fetch_finviz_industry_rows(timeout_seconds: int, pause_seconds: float = 1.0, sectors: list[str] | None = None) -> list[dict[str, Any]]:
    return fetch_finviz_industry_rows_with_cache(
        timeout_seconds=timeout_seconds,
        pause_seconds=pause_seconds,
        sectors=sectors,
        cache_path=DEFAULT_FINVIZ_CACHE_PATH,
        cache_max_age_hours=DEFAULT_FINVIZ_CACHE_MAX_AGE_HOURS,
        refresh_cache=False,
    )


def fetch_finviz_industry_rows_with_cache(
    timeout_seconds: int,
    pause_seconds: float = 1.0,
    sectors: list[str] | None = None,
    cache_path: Path | None = DEFAULT_FINVIZ_CACHE_PATH,
    cache_max_age_hours: float = DEFAULT_FINVIZ_CACHE_MAX_AGE_HOURS,
    refresh_cache: bool = False,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    if not sectors:
        params = parse.urlencode({"g": "industry", "v": "120", "o": "name", "st": "d1"})
        source_url = f"{FINVIZ_BASE_URL}?{params}"
        html = fetch_text_with_cache(source_url, timeout_seconds, cache_path, cache_max_age_hours, refresh_cache)
        for row in parse_finviz_group_rows(html):
            item = finviz_industry_by_name(row.get("name"))
            row["sector"] = item.sector if item else ""
            row["source_url"] = source_url
            rows.append(row)
        if len(rows) != len(FINVIZ_INDUSTRIES):
            raise RuntimeError(f"Expected {len(FINVIZ_INDUSTRIES)} Finviz industry rows, got {len(rows)}.")
        return rows

    selected = sectors
    for index, sector_key in enumerate(selected):
        sector_name = FINVIZ_SECTORS[sector_key]
        params = parse.urlencode({"g": "industry", "sg": sector_key, "v": "120", "o": "name", "st": "d1"})
        if index > 0 and pause_seconds > 0:
            time.sleep(pause_seconds)
        html = fetch_text(f"{FINVIZ_BASE_URL}?{params}", timeout_seconds)
        for row in parse_finviz_group_rows(html):
            row["sector"] = sector_name
            row["source_url"] = f"{FINVIZ_BASE_URL}?{params}"
            rows.append(row)
    return rows


def upsert_rows(rows: list[dict[str, Any]], batch_size: int, dry_run: bool) -> int:
    if not rows:
        return 0
    if dry_run:
        print(json.dumps({"table": BENCHMARK_TABLE, "count": len(rows), "sample": rows[:3]}, ensure_ascii=False, indent=2))
        return len(rows)

    url, key = supabase_write_config()
    import requests

    total = 0
    for batch in chunks(rows, batch_size):
        response = requests.post(
            f"{url}/rest/v1/{BENCHMARK_TABLE}",
            params={"on_conflict": "scope,sector,industry,metric,period,as_of_date"},
            json=batch,
            timeout=30,
            headers={
                **supabase_headers(key),
                "Prefer": "resolution=merge-duplicates,return=minimal",
            },
        )
        if response.status_code >= 400:
            raise RuntimeError(f"Supabase benchmark upsert failed: HTTP {response.status_code} {response.text[:1000]}")
        total += len(batch)
    return total


def fetch_existing_finviz_benchmark_rows(timeout_seconds: int = 30) -> list[dict[str, Any]]:
    url, key = supabase_write_config()
    import requests

    response = requests.get(
        f"{url}/rest/v1/{BENCHMARK_TABLE}",
        params={
            "select": "provider_group_name,metric,median,sample_count,as_of_date",
            "source": f"eq.{FINVIZ_SOURCE}",
            "order": "as_of_date.desc,updated_at.desc",
            "limit": "1000",
        },
        headers=supabase_headers(key),
        timeout=timeout_seconds,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"Supabase benchmark fallback query failed: HTTP {response.status_code} {response.text[:1000]}")
    rows = response.json()
    return rows if isinstance(rows, list) else []


def canonical_names(provider_sector: str, provider_group: str) -> tuple[str, str, float]:
    return canonical_names_for_provider("US", provider_sector, provider_group)


def fetch_text(url: str, timeout_seconds: int) -> str:
    req = request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with request.urlopen(req, timeout=timeout_seconds) as response:
            return response.read().decode("utf-8", errors="replace")
    except error.URLError as exc:
        if "CERTIFICATE_VERIFY_FAILED" not in str(exc):
            raise
        return fetch_text_with_curl(url, timeout_seconds)


def fetch_text_with_cache(
    url: str,
    timeout_seconds: int,
    cache_path: Path | str | None,
    cache_max_age_hours: float = DEFAULT_FINVIZ_CACHE_MAX_AGE_HOURS,
    refresh_cache: bool = False,
    fetcher=None,
    allow_stale_on_error: bool = True,
) -> str:
    path = Path(cache_path) if cache_path else None
    if path and not refresh_cache:
        cached = read_cached_text(path, cache_max_age_hours)
        if cached is not None:
            return cached

    fetch = fetcher or fetch_text
    try:
        text = fetch(url, timeout_seconds)
    except Exception:
        if path and allow_stale_on_error:
            stale = read_cached_text(path, None)
            if stale is not None:
                return stale
        raise

    if path:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    return text


def read_cached_text(path: Path, max_age_hours: float | None) -> str | None:
    if not path.exists() or not path.is_file():
        return None
    if max_age_hours is not None and max_age_hours >= 0:
        age_seconds = max(0.0, time.time() - path.stat().st_mtime)
        if age_seconds > max_age_hours * 3600:
            return None
    text = path.read_text(encoding="utf-8")
    return text if text.strip() else None


def fetch_text_with_curl(url: str, timeout_seconds: int) -> str:
    last_error = ""
    retries = int_env("FINVIZ_CURL_RETRIES", 3)
    rate_limit_wait_seconds = float_env("FINVIZ_RATE_LIMIT_WAIT_SECONDS", 60.0)
    for attempt in range(max(1, retries)):
        result = subprocess.run(
            ["curl", "-fsSL", "--max-time", str(timeout_seconds), "-A", "Mozilla/5.0", url],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout_seconds + 5,
            check=False,
        )
        if result.returncode == 0:
            return result.stdout
        last_error = (result.stderr or result.stdout).strip()
        if "429" not in last_error:
            break
        if attempt < retries - 1:
            time.sleep(rate_limit_wait_seconds * (attempt + 1))
    raise RuntimeError(last_error[:1000])


def env_value(name: str) -> str | None:
    value = os.environ.get(name)
    if value:
        return value.strip()
    for env_file in ENV_FILES:
        env_path = ROOT / env_file
        if not env_path.exists():
            continue
        for line in env_path.read_text(encoding="utf-8").splitlines():
            if not line or line.lstrip().startswith("#") or "=" not in line:
                continue
            key, raw_value = line.split("=", 1)
            if key.strip() == name:
                return raw_value.strip().strip('"').strip("'")
    return None


def int_env(name: str, default: int) -> int:
    try:
        return int(env_value(name) or default)
    except (TypeError, ValueError):
        return default


def float_env(name: str, default: float) -> float:
    try:
        return float(env_value(name) or default)
    except (TypeError, ValueError):
        return default


def supabase_write_config() -> tuple[str, str]:
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
    }


def row_by_headers(headers: list[str], cells: list[str]) -> dict[str, str]:
    row: dict[str, str] = {}
    for index, header in enumerate(headers):
        if index < len(cells):
            row[header] = cells[index]
    return row


def normalize_header(value: str) -> str:
    normalized = clean_text(value).lower().replace("/", "_").replace(" ", "_")
    aliases = {
        "market_cap": "market_cap",
        "p_e": "pe",
        "fwd_p_e": "fwd_pe",
        "p_s": "ps",
        "p_b": "pb",
    }
    return aliases.get(normalized, normalized)


def parse_number(value: Any) -> float | None:
    text = clean_text(value)
    if not text or text in {"-", "N/A"}:
        return None
    match = re.search(r"-?\d+(?:\.\d+)?", text.replace(",", ""))
    if not match:
        return None
    parsed = float(match.group(0))
    return parsed if parsed > 0 else None


def number_value(value: Any) -> float | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        parsed = float(value)
        return parsed if parsed > 0 else None
    return parse_number(value)


def clean_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip())


def slug(value: str) -> str:
    return re.sub(r"_+", "_", re.sub(r"[^\w]+", "_", value.strip().lower(), flags=re.UNICODE)).strip("_")


def chunks(items: list[dict[str, Any]], size: int):
    for index in range(0, len(items), size):
        yield items[index : index + size]


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync external industry valuation benchmarks into Supabase.")
    parser.add_argument("--as-of-date", default=date.today().isoformat())
    parser.add_argument("--batch-size", type=int, default=250)
    parser.add_argument("--finviz-timeout-seconds", type=int, default=20)
    parser.add_argument("--finviz-pause-seconds", type=float, default=1.0)
    parser.add_argument("--finviz-sector", action="append", choices=sorted(FINVIZ_SECTORS.keys()))
    parser.add_argument("--finviz-cache-path", type=Path, default=DEFAULT_FINVIZ_CACHE_PATH)
    parser.add_argument("--finviz-cache-max-age-hours", type=float, default=DEFAULT_FINVIZ_CACHE_MAX_AGE_HOURS)
    parser.add_argument("--finviz-refresh-cache", action="store_true")
    parser.add_argument("--finviz-existing-benchmark-fallback-only", action="store_true")
    parser.add_argument("--no-finviz-existing-benchmark-fallback", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if args.finviz_existing_benchmark_fallback_only:
        finviz_rows = finviz_rows_from_existing_benchmarks(fetch_existing_finviz_benchmark_rows(args.finviz_timeout_seconds))
        if len(finviz_rows) != len(FINVIZ_INDUSTRIES):
            raise RuntimeError(f"Expected {len(FINVIZ_INDUSTRIES)} fallback Finviz industry rows, got {len(finviz_rows)}.")
        raw_source = "existing_finviz_benchmark_fallback"
    else:
        raw_source = "finviz_live_or_cache"
        try:
            finviz_rows = fetch_finviz_industry_rows_with_cache(
                timeout_seconds=args.finviz_timeout_seconds,
                pause_seconds=args.finviz_pause_seconds,
                sectors=args.finviz_sector,
                cache_path=args.finviz_cache_path,
                cache_max_age_hours=args.finviz_cache_max_age_hours,
                refresh_cache=args.finviz_refresh_cache,
            )
        except Exception:
            if args.finviz_sector or args.no_finviz_existing_benchmark_fallback:
                raise
            finviz_rows = finviz_rows_from_existing_benchmarks(fetch_existing_finviz_benchmark_rows(args.finviz_timeout_seconds))
            if len(finviz_rows) != len(FINVIZ_INDUSTRIES):
                raise RuntimeError(f"Expected {len(FINVIZ_INDUSTRIES)} fallback Finviz industry rows, got {len(finviz_rows)}.")
            raw_source = "existing_finviz_benchmark_fallback"
    benchmark_rows = build_finviz_benchmark_rows(finviz_rows, args.as_of_date)
    upserted = upsert_rows(benchmark_rows, args.batch_size, args.dry_run)
    print(
        json.dumps(
            {
                "source": FINVIZ_SOURCE,
                "raw_source": raw_source,
                "as_of_date": args.as_of_date,
                "raw_groups": len(finviz_rows),
                "benchmark_rows": len(benchmark_rows),
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
