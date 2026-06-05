from __future__ import annotations

import argparse
import json
import os
import re
import time
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
SYMBOLS_PATH = ROOT / "src" / "data" / "symbols.generated.json"
PROFILE_TABLE = "stock_symbol_profiles"
TAG_TABLE = "stock_symbol_industry_tags"
SUPABASE_TIMEOUT_SECONDS = 10


def env_value(name: str) -> str | None:
    value = os.environ.get(name)
    if value:
        return value.strip()

    for env_name in (".env.local", ".env"):
        env_path = ROOT / env_name
        if not env_path.exists():
            continue
        try:
            for line in env_path.read_text(encoding="utf-8").splitlines():
                if not line or line.lstrip().startswith("#") or "=" not in line:
                    continue
                key, raw_value = line.split("=", 1)
                if key.strip() == name:
                    return raw_value.strip().strip('"').strip("'")
        except Exception:
            return None
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
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }


def clean_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip())


def slug(value: str) -> str:
    return re.sub(r"_+", "_", re.sub(r"[^0-9a-zA-Z]+", "_", value.strip().lower())).strip("_")


def load_symbols(path: Path = SYMBOLS_PATH) -> list[dict[str, Any]]:
    return json.loads(path.read_text(encoding="utf-8"))


def asset_class(item: dict[str, Any]) -> str:
    instrument = clean_text(item.get("instrumentType")).upper()
    name = f"{item.get('koreanName') or ''} {item.get('englishName') or ''}".upper()
    if instrument == "ETF" or "ETF" in name:
        return "etf"
    if "ETN" in name:
        return "etn"
    return "stock"


def profile_row_from_master(item: dict[str, Any]) -> dict[str, Any]:
    market = clean_text(item.get("market")).upper()
    symbol = clean_text(item.get("ticker")).upper()
    klass = asset_class(item)
    return {
        "market": market,
        "symbol": symbol,
        "name": clean_text(item.get("koreanName") or item.get("englishName")),
        "exchange": clean_text(item.get("exchange")),
        "asset_class": klass,
        "classification_status": "pending" if klass == "stock" else "missing",
        "source_priority": 100,
        "source": "symbol_master",
        "metadata": {
            "exchange_name": clean_text(item.get("exchangeName")),
            "english_name": clean_text(item.get("englishName")),
            "instrument_type": clean_text(item.get("instrumentType")),
            "standard_code": clean_text(item.get("standardCode")),
            "provider_sector_code": clean_text(item.get("providerSectorCode")),
            "currency": clean_text(item.get("currency")),
        },
    }


def master_tag_rows(item: dict[str, Any]) -> list[dict[str, Any]]:
    sector_code = clean_text(item.get("providerSectorCode"))
    if not sector_code:
        return []
    return [
        {
            "market": clean_text(item.get("market")).upper(),
            "symbol": clean_text(item.get("ticker")).upper(),
            "taxonomy": "kis_us_sector_code",
            "code": sector_code,
            "name": "",
            "level": 1,
            "source": "symbol_master",
            "confidence": 0.4,
            "is_primary": False,
            "raw": {"provider_sector_code": sector_code},
        }
    ]


def yahoo_symbol_for(item: dict[str, Any]) -> str | None:
    market = clean_text(item.get("market")).upper()
    symbol = clean_text(item.get("ticker")).upper()
    exchange = clean_text(item.get("exchange")).upper()
    if not symbol:
        return None
    if market == "US":
        return symbol
    if market == "KR" and exchange == "KOSPI" and re.fullmatch(r"\d{6}", symbol):
        return f"{symbol}.KS"
    if market == "KR" and exchange == "KOSDAQ" and re.fullmatch(r"\d{6}", symbol):
        return f"{symbol}.KQ"
    return None


def yfinance_info(symbol: str) -> dict[str, Any]:
    import yfinance as yf

    ticker = yf.Ticker(symbol)
    getter = getattr(ticker, "get_info", None)
    info = getter() if callable(getter) else ticker.info
    return info if isinstance(info, dict) else {}


def profile_and_tags_from_yfinance(item: dict[str, Any], pause_seconds: float) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    yahoo_symbol = yahoo_symbol_for(item)
    if not yahoo_symbol or asset_class(item) != "stock":
        return None, []

    if pause_seconds > 0:
        time.sleep(pause_seconds)

    info = yfinance_info(yahoo_symbol)
    sector = clean_text(info.get("sector"))
    industry = clean_text(info.get("industry"))
    if not sector and not industry:
        return None, []

    row = profile_row_from_master(item)
    row.update(
        {
            "primary_sector": sector,
            "primary_industry": industry,
            "primary_sector_key": slug(sector),
            "primary_industry_key": slug(f"{sector}:{industry}" if sector and industry else industry or sector),
            "classification_status": "verified" if sector and industry else "partial",
            "source_priority": 30,
            "source": "yfinance",
            "metadata": {
                **row["metadata"],
                "yahoo_symbol": yahoo_symbol,
                "yfinance_quote_type": clean_text(info.get("quoteType")),
            },
        }
    )

    tags: list[dict[str, Any]] = []
    if sector:
        tags.append(
            {
                "market": row["market"],
                "symbol": row["symbol"],
                "taxonomy": "yfinance",
                "code": slug(sector),
                "name": sector,
                "level": 1,
                "source": "yfinance",
                "confidence": 0.85,
                "is_primary": not industry,
                "raw": {"yahoo_symbol": yahoo_symbol},
            }
        )
    if industry:
        tags.append(
            {
                "market": row["market"],
                "symbol": row["symbol"],
                "taxonomy": "yfinance",
                "code": slug(f"{sector}:{industry}" if sector else industry),
                "name": industry,
                "level": 2,
                "source": "yfinance",
                "confidence": 0.9,
                "is_primary": True,
                "raw": {"yahoo_symbol": yahoo_symbol, "sector": sector},
            }
        )
    return row, tags


def chunks(items: list[dict[str, Any]], size: int) -> Iterable[list[dict[str, Any]]]:
    for index in range(0, len(items), size):
        yield items[index : index + size]


def upsert_rows(table: str, rows: list[dict[str, Any]], conflict: str, batch_size: int, dry_run: bool) -> int:
    if not rows:
        return 0
    if dry_run:
        print(json.dumps({"table": table, "count": len(rows), "sample": rows[:2]}, ensure_ascii=False, indent=2))
        return len(rows)

    import requests

    url, key = supabase_write_config()
    total = 0
    for batch in chunks(rows, batch_size):
        response = requests.post(
            f"{url}/rest/v1/{table}",
            params={"on_conflict": conflict},
            headers=supabase_headers(key),
            json=batch,
            timeout=SUPABASE_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        total += len(batch)
    return total


def filter_symbols(items: list[dict[str, Any]], market: str, symbols: str | None, limit: int | None, offset: int) -> list[dict[str, Any]]:
    wanted = {token.strip().upper() for token in (symbols or "").split(",") if token.strip()}
    filtered: list[dict[str, Any]] = []
    for item in items:
        item_market = clean_text(item.get("market")).upper()
        item_symbol = clean_text(item.get("ticker")).upper()
        if market != "ALL" and item_market != market:
            continue
        if wanted and item_symbol not in wanted and f"{item_market}:{item_symbol}" not in wanted:
            continue
        filtered.append(item)
    sliced = filtered[offset:]
    return sliced[:limit] if limit is not None else sliced


def build_master_rows(items: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    profiles = [profile_row_from_master(item) for item in items]
    tags = [tag for item in items for tag in master_tag_rows(item)]
    return profiles, tags


def build_yfinance_rows(items: list[dict[str, Any]], pause_seconds: float) -> tuple[list[dict[str, Any]], list[dict[str, Any]], int]:
    profiles: list[dict[str, Any]] = []
    tags: list[dict[str, Any]] = []
    misses = 0
    for item in items:
        try:
            profile, tag_rows = profile_and_tags_from_yfinance(item, pause_seconds)
        except Exception as exc:
            misses += 1
            print(f"skip {item.get('market')}:{item.get('ticker')}: {exc}")
            continue
        if not profile:
            misses += 1
            continue
        profiles.append(profile)
        tags.extend(tag_rows)
    return profiles, tags, misses


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill stock symbol industry profiles into Supabase.")
    parser.add_argument("--source", choices=["master", "yfinance"], default="master")
    parser.add_argument("--market", choices=["ALL", "US", "KR"], default="ALL")
    parser.add_argument("--symbols", help="Comma-separated symbols or MARKET:SYMBOL values.")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--pause-seconds", type=float, default=0.25)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    items = filter_symbols(load_symbols(), args.market, args.symbols, args.limit, args.offset)
    if args.source == "master":
        profiles, tags = build_master_rows(items)
        misses = 0
    else:
        profiles, tags, misses = build_yfinance_rows(items, args.pause_seconds)

    profile_count = upsert_rows(PROFILE_TABLE, profiles, "market,symbol", args.batch_size, args.dry_run)
    tag_count = upsert_rows(TAG_TABLE, tags, "market,symbol,taxonomy,level,code,name,source", args.batch_size, args.dry_run)
    print(
        json.dumps(
            {
                "source": args.source,
                "input_symbols": len(items),
                "profiles_upserted": profile_count,
                "tags_upserted": tag_count,
                "misses": misses,
                "dry_run": args.dry_run,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
