from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
import tempfile
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
SYMBOLS_PATH = ROOT / "src" / "data" / "symbols.generated.json"
PROFILE_TABLE = "stock_symbol_profiles"
TAG_TABLE = "stock_symbol_industry_tags"
SUPABASE_TIMEOUT_SECONDS = 10
ENV_FILES = (".env.local", ".env.supabase.local", ".env")


def env_value(name: str) -> str | None:
    value = os.environ.get(name)
    if value:
        return value.strip()

    for env_name in ENV_FILES:
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


def env_with_local_files() -> dict[str, str]:
    env = dict(os.environ)
    for env_name in ENV_FILES:
        env_path = ROOT / env_name
        if not env_path.exists():
            continue
        try:
            for line in env_path.read_text(encoding="utf-8").splitlines():
                if not line or line.lstrip().startswith("#") or "=" not in line:
                    continue
                key, raw_value = line.split("=", 1)
                env.setdefault(key.strip(), raw_value.strip().strip('"').strip("'"))
        except Exception:
            continue
    return env


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


def upsert_rows(table: str, rows: list[dict[str, Any]], conflict: str, batch_size: int, dry_run: bool, transport: str) -> int:
    if not rows:
        return 0
    if dry_run:
        print(json.dumps({"table": table, "count": len(rows), "sample": rows[:2]}, ensure_ascii=False, indent=2))
        return len(rows)

    if transport == "auto":
        transport = "rest" if supabase_write_config_optional() else "supabase-cli"
    if transport == "supabase-cli":
        return upsert_rows_with_supabase_cli(table, rows, batch_size)

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


def supabase_write_config_optional() -> tuple[str, str] | None:
    try:
        return supabase_write_config()
    except RuntimeError:
        return None


def upsert_rows_with_supabase_cli(table: str, rows: list[dict[str, Any]], batch_size: int) -> int:
    total = 0
    total_batches = (len(rows) + batch_size - 1) // batch_size
    for batch_index, batch in enumerate(chunks(rows, batch_size), start=1):
        print(f"upserting {table} batch {batch_index}/{total_batches} ({len(batch)} rows)", file=sys.stderr)
        sql = upsert_sql(table, batch)
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".sql", delete=False) as handle:
            handle.write(sql)
            sql_path = handle.name
        try:
            command = ["supabase", "db", "query", "--linked", "--file", sql_path]
            result = subprocess.run(
                command,
                cwd=ROOT,
                env=env_with_local_files(),
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=120,
                check=False,
            )
            if result.returncode != 0:
                raise RuntimeError((result.stderr or result.stdout).strip())
        finally:
            try:
                Path(sql_path).unlink()
            except FileNotFoundError:
                pass
        total += len(batch)
    return total


def upsert_sql(table: str, rows: list[dict[str, Any]]) -> str:
    payload = json_sql_literal(rows)
    if table == PROFILE_TABLE:
        return f"""
with input as (
  select *
  from jsonb_to_recordset({payload}::jsonb) as row(
    market text,
    symbol text,
    name text,
    exchange text,
    asset_class text,
    primary_sector text,
    primary_industry text,
    primary_sector_key text,
    primary_industry_key text,
    classification_status text,
    source_priority integer,
    source text,
    metadata jsonb
  )
),
upserted as (
  insert into public.stock_symbol_profiles (
    market,
    symbol,
    name,
    exchange,
    asset_class,
    primary_sector,
    primary_industry,
    primary_sector_key,
    primary_industry_key,
    classification_status,
    source_priority,
    source,
    metadata
  )
  select
    market,
    symbol,
    coalesce(name, ''),
    coalesce(exchange, ''),
    coalesce(asset_class, 'stock'),
    coalesce(primary_sector, ''),
    coalesce(primary_industry, ''),
    coalesce(primary_sector_key, ''),
    coalesce(primary_industry_key, ''),
    coalesce(classification_status, 'pending'),
    coalesce(source_priority, 100),
    coalesce(source, 'unknown'),
    coalesce(metadata, '{{}}'::jsonb)
  from input
  on conflict (market, symbol) do update
    set name = coalesce(nullif(excluded.name, ''), public.stock_symbol_profiles.name),
        exchange = coalesce(nullif(excluded.exchange, ''), public.stock_symbol_profiles.exchange),
        asset_class = excluded.asset_class,
        primary_sector = case
          when excluded.source_priority <= public.stock_symbol_profiles.source_priority then excluded.primary_sector
          else public.stock_symbol_profiles.primary_sector
        end,
        primary_industry = case
          when excluded.source_priority <= public.stock_symbol_profiles.source_priority then excluded.primary_industry
          else public.stock_symbol_profiles.primary_industry
        end,
        primary_sector_key = case
          when excluded.source_priority <= public.stock_symbol_profiles.source_priority then excluded.primary_sector_key
          else public.stock_symbol_profiles.primary_sector_key
        end,
        primary_industry_key = case
          when excluded.source_priority <= public.stock_symbol_profiles.source_priority then excluded.primary_industry_key
          else public.stock_symbol_profiles.primary_industry_key
        end,
        classification_status = case
          when excluded.source_priority <= public.stock_symbol_profiles.source_priority then excluded.classification_status
          else public.stock_symbol_profiles.classification_status
        end,
        source_priority = least(excluded.source_priority, public.stock_symbol_profiles.source_priority),
        source = case
          when excluded.source_priority <= public.stock_symbol_profiles.source_priority then excluded.source
          else public.stock_symbol_profiles.source
        end,
        metadata = public.stock_symbol_profiles.metadata || excluded.metadata,
        updated_at = now()
  returning 1
)
select count(*) as upserted from upserted;
"""
    if table == TAG_TABLE:
        return f"""
with input as (
  select *
  from jsonb_to_recordset({payload}::jsonb) as row(
    market text,
    symbol text,
    taxonomy text,
    code text,
    name text,
    level integer,
    source text,
    confidence numeric,
    is_primary boolean,
    raw jsonb
  )
),
upserted as (
  insert into public.stock_symbol_industry_tags (
    market,
    symbol,
    taxonomy,
    code,
    name,
    level,
    source,
    confidence,
    is_primary,
    raw
  )
  select
    market,
    symbol,
    coalesce(taxonomy, 'provider'),
    coalesce(code, ''),
    coalesce(name, ''),
    coalesce(level, 0),
    coalesce(source, 'unknown'),
    coalesce(confidence, 0.5),
    coalesce(is_primary, false),
    coalesce(raw, '{{}}'::jsonb)
  from input
  on conflict (market, symbol, taxonomy, level, code, name, source) do update
    set confidence = greatest(excluded.confidence, public.stock_symbol_industry_tags.confidence),
        is_primary = excluded.is_primary or public.stock_symbol_industry_tags.is_primary,
        raw = public.stock_symbol_industry_tags.raw || excluded.raw,
        updated_at = now()
  returning 1
)
select count(*) as upserted from upserted;
"""
    raise ValueError(f"Unsupported table for CLI upsert: {table}")


def json_sql_literal(rows: list[dict[str, Any]]) -> str:
    raw = json.dumps(rows, ensure_ascii=False, separators=(",", ":"))
    for tag in ("stockjson", "stockjson1", "stockjson2"):
        delimiter = f"${tag}$"
        if delimiter not in raw:
            return f"{delimiter}{raw}{delimiter}"
    return "'" + raw.replace("'", "''") + "'"


def filter_symbols(items: list[dict[str, Any]], market: str, exchange: str | None, symbols: str | None, limit: int | None, offset: int) -> list[dict[str, Any]]:
    wanted = {token.strip().upper() for token in (symbols or "").split(",") if token.strip()}
    wanted_exchange = clean_text(exchange).upper()
    filtered: list[dict[str, Any]] = []
    for item in items:
        item_market = clean_text(item.get("market")).upper()
        item_exchange = clean_text(item.get("exchange")).upper()
        item_symbol = clean_text(item.get("ticker")).upper()
        if market != "ALL" and item_market != market:
            continue
        if wanted_exchange and item_exchange != wanted_exchange:
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
    for index, item in enumerate(items, start=1):
        if index == 1 or index % 25 == 0 or index == len(items):
            print(f"fetching yfinance {index}/{len(items)}", file=sys.stderr)
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
    parser.add_argument("--exchange", help="Filter by exchange code, e.g. KOSPI, KOSDAQ, NAS, NYS, AMS.")
    parser.add_argument("--symbols", help="Comma-separated symbols or MARKET:SYMBOL values.")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--pause-seconds", type=float, default=0.25)
    parser.add_argument("--transport", choices=["auto", "rest", "supabase-cli"], default="auto")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    items = filter_symbols(load_symbols(), args.market, args.exchange, args.symbols, args.limit, args.offset)
    if args.source == "master":
        profiles, tags = build_master_rows(items)
        misses = 0
    else:
        profiles, tags, misses = build_yfinance_rows(items, args.pause_seconds)

    profile_count = upsert_rows(PROFILE_TABLE, profiles, "market,symbol", args.batch_size, args.dry_run, args.transport)
    tag_count = upsert_rows(TAG_TABLE, tags, "market,symbol,taxonomy,level,code,name,source", args.batch_size, args.dry_run, args.transport)
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
