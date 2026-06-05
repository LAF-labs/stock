from __future__ import annotations

import json
import re
import shutil
import tempfile
import urllib.request
import zipfile
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
OUT_PATH = ROOT / "src" / "data" / "symbols.generated.json"
BASE_URL = "https://new.real.download.dws.co.kr/common/master"

US_MARKETS = {
    "nas": {"exchange": "NAS", "exchangeName": "나스닥"},
    "nys": {"exchange": "NYS", "exchangeName": "뉴욕"},
    "ams": {"exchange": "AMS", "exchangeName": "아멕스"},
}

KR_MARKETS = {
    "kospi": {"exchange": "KOSPI", "exchangeName": "코스피", "suffix": "code"},
    "kosdaq": {"exchange": "KOSDAQ", "exchangeName": "코스닥", "suffix": "code"},
    "konex": {"exchange": "KONEX", "exchangeName": "코넥스", "suffix": "code"},
}

US_COLUMNS = [
    "nationalCode",
    "exchangeId",
    "exchange",
    "exchangeName",
    "ticker",
    "realtimeTicker",
    "koreanName",
    "englishName",
    "securityType",
    "currency",
    "floatPosition",
    "dataType",
    "basePrice",
    "bidOrderSize",
    "askOrderSize",
    "marketStartTime",
    "marketEndTime",
    "isDr",
    "drCountryCode",
    "sectorCode",
    "hasIndexConstituent",
    "tickSizeType",
    "typeCode",
    "tickSizeTypeDetail",
]


def download_and_extract(url: str, work_dir: Path) -> Path:
    zip_path = work_dir / url.rsplit("/", 1)[-1]
    with urllib.request.urlopen(url, timeout=30) as response:
        zip_path.write_bytes(response.read())
    with zipfile.ZipFile(zip_path) as archive:
        names = [name for name in archive.namelist() if not name.endswith("/")]
        for name in names:
            member_path = Path(name)
            if member_path.is_absolute() or ".." in member_path.parts:
                raise RuntimeError(f"Unsafe zip member in {url}: {name}")
        for name in names:
            archive.extract(name, work_dir)
    if not names:
        raise RuntimeError(f"{url} did not contain a file")
    return work_dir / names[0]


def clean_text(value: str | None) -> str:
    return re.sub(r"\s+", " ", (value or "").strip())


def is_us_etf(row: dict[str, str]) -> bool:
    security_type = clean_text(row.get("securityType"))
    type_code = clean_text(row.get("typeCode"))
    english = clean_text(row.get("englishName")).upper()
    korean = clean_text(row.get("koreanName")).upper()
    return security_type == "3" or type_code in {"001", "002", "003", "005", "006"} or " ETF" in english or "ETN" in english or "ETF" in korean


def parse_us_market(code: str, work_dir: Path) -> list[dict[str, Any]]:
    meta = US_MARKETS[code]
    file_path = download_and_extract(f"{BASE_URL}/{code}mst.cod.zip", work_dir)
    items: list[dict[str, Any]] = []
    with file_path.open("r", encoding="cp949", errors="ignore") as handle:
        for line in handle:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 8:
                continue
            row = {key: clean_text(parts[index] if index < len(parts) else "") for index, key in enumerate(US_COLUMNS)}
            ticker = row["ticker"].upper()
            korean_name = row["koreanName"]
            english_name = row["englishName"]
            if not ticker or not (korean_name or english_name):
                continue
            items.append(
                {
                    "market": "US",
                    "ticker": ticker,
                    "exchange": meta["exchange"],
                    "exchangeName": meta["exchangeName"],
                    "koreanName": korean_name,
                    "englishName": english_name,
                    "instrumentType": "ETF" if is_us_etf(row) else "STOCK",
                    "currency": row.get("currency") or "USD",
                }
            )
    return items


def parse_kr_standard_line(line: str, tail_size: int, name_key: str, meta: dict[str, str]) -> dict[str, Any] | None:
    head = line[: len(line) - tail_size]
    ticker = clean_text(head[0:9])
    standard_code = clean_text(head[9:21])
    korean_name = clean_text(head[21:])
    tail = line[-tail_size:]
    security_group = clean_text(tail[0:2])
    if not ticker or not korean_name:
        return None
    instrument_type = "ETF" if security_group in {"EF", "EN", "MF"} or "ETF" in korean_name.upper() or "ETN" in korean_name.upper() else "STOCK"
    return {
        "market": "KR",
        "ticker": ticker,
        "exchange": meta["exchange"],
        "exchangeName": meta["exchangeName"],
        "koreanName": korean_name,
        "englishName": "",
        "instrumentType": instrument_type,
        "standardCode": standard_code,
    }


def parse_konex_line(line: str, meta: dict[str, str]) -> dict[str, Any] | None:
    ticker = clean_text(line[0:9])
    standard_code = clean_text(line[9:21])
    korean_name = clean_text(line[21:-184])
    security_group = clean_text(line[-184:-182])
    if not ticker or not korean_name:
        return None
    instrument_type = "ETF" if security_group in {"EF", "EN", "MF"} or "ETF" in korean_name.upper() or "ETN" in korean_name.upper() else "STOCK"
    return {
        "market": "KR",
        "ticker": ticker,
        "exchange": meta["exchange"],
        "exchangeName": meta["exchangeName"],
        "koreanName": korean_name,
        "englishName": "",
        "instrumentType": instrument_type,
        "standardCode": standard_code,
    }


def parse_kr_market(code: str, work_dir: Path) -> list[dict[str, Any]]:
    meta = KR_MARKETS[code]
    file_path = download_and_extract(f"{BASE_URL}/{code}_{meta['suffix']}.mst.zip", work_dir)
    items: list[dict[str, Any]] = []
    tail_size = 228 if code == "kospi" else 222
    with file_path.open("r", encoding="cp949", errors="ignore") as handle:
        for line in handle:
            raw = line.rstrip("\n")
            item = parse_konex_line(raw, meta) if code == "konex" else parse_kr_standard_line(raw, tail_size, "koreanName", meta)
            if item:
                items.append(item)
    return items


def dedupe(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[tuple[str, str]] = set()
    unique: list[dict[str, Any]] = []
    for item in items:
        key = (str(item["market"]), str(item["ticker"]))
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    return unique


def main() -> int:
    temp_dir = Path(tempfile.mkdtemp(prefix="kis-symbol-master-"))
    try:
        items: list[dict[str, Any]] = []
        for market in US_MARKETS:
            items.extend(parse_us_market(market, temp_dir))
        for market in KR_MARKETS:
            items.extend(parse_kr_market(market, temp_dir))

        items = dedupe(items)
        items.sort(key=lambda item: (item["market"], item["exchange"], item["ticker"]))
        OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        OUT_PATH.write_text(json.dumps(items, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"Wrote {len(items):,} symbols to {OUT_PATH}")
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
