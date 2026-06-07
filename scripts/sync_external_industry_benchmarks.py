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

ROOT = Path(__file__).resolve().parents[1]
BENCHMARK_TABLE = "stock_industry_benchmarks"
ENV_FILES = (".env.local", ".env.supabase.local")
BENCHMARK_EXPIRY_GRACE_HOURS = 12

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

SECTOR_KO = {
    "Basic Materials": "소재",
    "Communication Services": "커뮤니케이션",
    "Consumer Cyclical": "경기소비재",
    "Consumer Defensive": "필수소비재",
    "Energy": "에너지",
    "Financial": "금융",
    "Healthcare": "헬스케어",
    "Industrials": "산업재",
    "Real Estate": "부동산",
    "Technology": "정보기술",
    "Utilities": "유틸리티",
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
    ("금융서비스", ("investment managers", "finance companies", "investment bankers", "brokerage", "asset management")),
    ("리츠", ("real estate investment trusts", "reit")),
    ("부동산", ("real estate",)),
    ("석유·가스", ("oil", "gas", "coal", "integrated oil")),
    ("전력·유틸리티", ("electric utilities", "water supply", "power generation", "natural gas distribution")),
    ("금속·광업", ("metal mining", "precious metals", "aluminum", "steel", "mining", "gold", "silver")),
    ("종이·목재", ("forest products", "paper")),
    ("화학", ("chemicals",)),
    ("자동차", ("auto manufacturing", "auto parts", "automotive", "motor vehicles", "auto manufacturers")),
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

    headers = [normalize_header(value) for value in parser.rows[0]]
    rows: list[dict[str, Any]] = []
    for cells in parser.rows[1:]:
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
    rows: list[dict[str, Any]] = []
    selected = sectors or list(FINVIZ_SECTORS.keys())
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
    total = 0
    for batch in chunks(rows, batch_size):
        body = json.dumps(batch, ensure_ascii=False).encode("utf-8")
        endpoint = f"{url}/rest/v1/{BENCHMARK_TABLE}?on_conflict=scope,sector,industry,metric,period,as_of_date"
        req = request.Request(
            endpoint,
            data=body,
            method="POST",
            headers={
                **supabase_headers(key),
                "Prefer": "resolution=merge-duplicates,return=minimal",
            },
        )
        try:
            with request.urlopen(req, timeout=30) as response:
                if response.status >= 400:
                    raise RuntimeError(response.read().decode("utf-8", errors="replace")[:1000])
        except Exception as exc:
            raise RuntimeError(f"Supabase benchmark upsert failed: {exc}") from exc
        total += len(batch)
    return total


def canonical_names(provider_sector: str, provider_group: str) -> tuple[str, str, float]:
    canonical_sector = SECTOR_KO.get(provider_sector, provider_sector or "기타")
    lowered = provider_group.lower()
    for canonical_industry, needles in US_INDUSTRY_RULES:
        if any(needle in lowered for needle in needles):
            return canonical_sector, canonical_industry, 0.86
    return canonical_sector, provider_group, 0.68


def fetch_text(url: str, timeout_seconds: int) -> str:
    req = request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with request.urlopen(req, timeout=timeout_seconds) as response:
            return response.read().decode("utf-8", errors="replace")
    except error.URLError as exc:
        if "CERTIFICATE_VERIFY_FAILED" not in str(exc):
            raise
        return fetch_text_with_curl(url, timeout_seconds)


def fetch_text_with_curl(url: str, timeout_seconds: int) -> str:
    last_error = ""
    for attempt in range(3):
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
        time.sleep(2 * (attempt + 1))
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
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    finviz_rows = fetch_finviz_industry_rows(
        args.finviz_timeout_seconds,
        args.finviz_pause_seconds,
        args.finviz_sector,
    )
    benchmark_rows = build_finviz_benchmark_rows(finviz_rows, args.as_of_date)
    upserted = upsert_rows(benchmark_rows, args.batch_size, args.dry_run)
    print(
        json.dumps(
            {
                "source": FINVIZ_SOURCE,
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
