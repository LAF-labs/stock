from __future__ import annotations

import argparse
from contextlib import contextmanager
import hashlib
from html.parser import HTMLParser
import json
import os
import re
import signal
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
NASDAQ_SCREENER_URL = "https://api.nasdaq.com/api/screener/stocks"
KIND_CORP_LIST_URL = "https://kind.krx.co.kr/corpgeneral/corpList.do"
KIND_MARKET_EXCHANGES = {
    "유가": "KOSPI",
    "코스피": "KOSPI",
    "코스닥": "KOSDAQ",
    "코넥스": "KONEX",
}


class ProviderTimeoutError(TimeoutError):
    pass


class HtmlTableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[list[str]] = []
        self._current_row: list[str] | None = None
        self._current_cell: list[str] | None = None

    def handle_starttag(self, tag: str, _attrs: list[tuple[str, str | None]]) -> None:
        if tag == "tr":
            self._current_row = []
        elif tag in {"td", "th"} and self._current_row is not None:
            self._current_cell = []

    def handle_data(self, data: str) -> None:
        if self._current_cell is not None:
            self._current_cell.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag in {"td", "th"} and self._current_cell is not None and self._current_row is not None:
            self._current_row.append(clean_text("".join(self._current_cell)))
            self._current_cell = None
        elif tag == "tr" and self._current_row is not None:
            if any(self._current_row):
                self.rows.append(self._current_row)
            self._current_row = None


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
    text = value.strip().lower()
    normalized = re.sub(r"_+", "_", re.sub(r"[^\w]+", "_", text, flags=re.UNICODE)).strip("_")
    if normalized:
        return normalized
    return f"u_{hashlib.sha1(text.encode('utf-8')).hexdigest()[:16]}"


def load_symbols(path: Path = SYMBOLS_PATH) -> list[dict[str, Any]]:
    return json.loads(path.read_text(encoding="utf-8"))


def asset_class(item: dict[str, Any]) -> str:
    instrument = clean_text(item.get("instrumentType")).upper()
    name = clean_text(f"{item.get('koreanName') or ''} {item.get('englishName') or ''}")
    name_upper = name.upper()
    compact_name = re.sub(r"\s+", "", name_upper)
    if "ETN" in name_upper or "상장지수증권" in name:
        return "etn"
    if "ELW" in name_upper or "워런트" in name:
        return "other"
    if "리츠" in name or "REIT" in name_upper:
        return "reit"
    if re.search(r"(?:[0-9]+)?우(?:B|C)?(?:\(전환\))?$", compact_name):
        return "preferred"
    etf_prefixes = (
        "1Q",
        "ACE",
        "ARIRANG",
        "FOCUS",
        "HANARO",
        "HK",
        "KBSTAR",
        "KIWOOM",
        "KOACT",
        "KODEX",
        "KOSEF",
        "PLUS",
        "RISE",
        "SOL",
        "TIME",
        "TIGER",
        "TREX",
        "마이티",
    )
    etf_terms = (
        "ETF",
        "TDF",
        "국채",
        "나스닥",
        "데일리",
        "레버리지",
        "미국채",
        "버퍼",
        "상장지수펀드",
        "선물",
        "액티브",
        "인버스",
        "채권",
        "커버드콜",
        "타겟",
        "혼합",
        "S&P500",
    )
    if instrument == "ETF" or name_upper.startswith(etf_prefixes) or any(term in name_upper for term in etf_terms):
        return "etf"
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
        "primary_sector": "",
        "primary_industry": "",
        "primary_sector_key": "",
        "primary_industry_key": "",
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


def tag_rows_for_profile(row: dict[str, Any], taxonomy: str, source: str, confidence: float, raw: dict[str, Any]) -> list[dict[str, Any]]:
    sector = clean_text(row.get("primary_sector"))
    industry = clean_text(row.get("primary_industry"))
    tags: list[dict[str, Any]] = []
    if sector:
        tags.append(
            {
                "market": row["market"],
                "symbol": row["symbol"],
                "taxonomy": taxonomy,
                "code": slug(sector),
                "name": sector,
                "level": 1,
                "source": source,
                "confidence": confidence,
                "is_primary": not industry,
                "raw": raw,
            }
        )
    if industry:
        tags.append(
            {
                "market": row["market"],
                "symbol": row["symbol"],
                "taxonomy": taxonomy,
                "code": slug(f"{sector}:{industry}" if sector else industry),
                "name": industry,
                "level": 2,
                "source": source,
                "confidence": min(confidence + 0.05, 1.0),
                "is_primary": True,
                "raw": {**raw, "sector": sector},
            }
        )
    return tags


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


@contextmanager
def provider_timeout(seconds: int):
    if seconds <= 0 or not hasattr(signal, "SIGALRM"):
        yield
        return

    previous_handler = signal.getsignal(signal.SIGALRM)

    def raise_timeout(_signum: int, _frame: Any) -> None:
        raise ProviderTimeoutError(f"provider timed out after {seconds}s")

    signal.signal(signal.SIGALRM, raise_timeout)
    signal.alarm(seconds)
    try:
        yield
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, previous_handler)


def profile_and_tags_from_yfinance(item: dict[str, Any], pause_seconds: float, provider_timeout_seconds: int = 20) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    yahoo_symbol = yahoo_symbol_for(item)
    if not yahoo_symbol or asset_class(item) != "stock":
        return None, []

    if pause_seconds > 0:
        time.sleep(pause_seconds)

    with provider_timeout(provider_timeout_seconds):
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

    return row, tag_rows_for_profile(row, "yfinance", "yfinance", 0.85, {"yahoo_symbol": yahoo_symbol})


def fetch_nasdaq_screener_rows() -> list[dict[str, Any]]:
    import requests

    response = requests.get(
        NASDAQ_SCREENER_URL,
        params={"tableonly": "true", "download": "true"},
        headers={
            "User-Agent": "Mozilla/5.0",
            "Accept": "application/json,text/plain,*/*",
            "Origin": "https://www.nasdaq.com",
            "Referer": "https://www.nasdaq.com/market-activity/stocks/screener",
        },
        timeout=30,
    )
    response.raise_for_status()
    data = response.json()
    rows = data.get("data", {}).get("rows", [])
    return rows if isinstance(rows, list) else []


def normalize_us_symbol(value: Any) -> str:
    return clean_text(value).upper().replace("/", "-")


def build_nasdaq_rows(items: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], int]:
    item_by_symbol = {
        normalize_us_symbol(item.get("ticker")): item
        for item in items
        if clean_text(item.get("market")).upper() == "US" and asset_class(item) not in {"etf", "etn", "other"}
    }
    profiles: list[dict[str, Any]] = []
    tags: list[dict[str, Any]] = []
    misses = 0

    for provider_row in fetch_nasdaq_screener_rows():
        symbol = normalize_us_symbol(provider_row.get("symbol"))
        item = item_by_symbol.get(symbol)
        sector = clean_text(provider_row.get("sector"))
        industry = clean_text(provider_row.get("industry"))
        if not item or not (sector or industry):
            misses += 1
            continue

        row = profile_row_from_master(item)
        row.update(
            {
                "primary_sector": sector,
                "primary_industry": industry,
                "primary_sector_key": slug(sector),
                "primary_industry_key": slug(f"{sector}:{industry}" if sector and industry else industry or sector),
                "classification_status": "verified" if sector and industry else "partial",
                "source_priority": 20,
                "source": "nasdaq_screener",
                "metadata": {
                    **row["metadata"],
                    "nasdaq_name": clean_text(provider_row.get("name")),
                    "nasdaq_country": clean_text(provider_row.get("country")),
                    "nasdaq_url": clean_text(provider_row.get("url")),
                },
            }
        )
        profiles.append(row)
        tags.extend(
            tag_rows_for_profile(
                row,
                "nasdaq_screener",
                "nasdaq_screener",
                0.9,
                {"provider_symbol": symbol, "country": clean_text(provider_row.get("country"))},
            )
        )

    return profiles, tags, misses


def fetch_kind_corp_list_rows() -> list[dict[str, Any]]:
    import requests

    response = requests.get(
        KIND_CORP_LIST_URL,
        params={"method": "download", "searchType": "13"},
        headers={
            "User-Agent": "Mozilla/5.0",
            "Accept": "application/vnd.ms-excel,text/html,*/*",
            "Referer": "https://kind.krx.co.kr/corpgeneral/corpList.do?method=loadInitPage",
        },
        timeout=30,
    )
    response.raise_for_status()
    parser = HtmlTableParser()
    parser.feed(response.content.decode(response.encoding or "euc-kr", errors="replace"))
    if not parser.rows:
        return []

    header = parser.rows[0]
    rows: list[dict[str, Any]] = []
    for cells in parser.rows[1:]:
        if len(cells) < len(header):
            cells = [*cells, *([""] * (len(header) - len(cells)))]
        rows.append(dict(zip(header, cells)))
    return rows


def normalize_kr_symbol(value: Any) -> str:
    return clean_text(value).upper()


def kind_exchange(value: Any) -> str:
    raw = clean_text(value)
    return KIND_MARKET_EXCHANGES.get(raw, raw.upper())


def kind_sector_from_industry(industry: str) -> str:
    text = industry.replace(" ", "")
    rules = (
        ("금융", ("금융", "은행", "보험", "증권", "신탁", "투자")),
        ("헬스케어", ("의약", "의료", "바이오", "생물", "보건")),
        ("정보기술", ("소프트웨어", "프로그래밍", "시스템통합", "정보서비스", "데이터베이스", "반도체", "전자부품", "컴퓨터", "통신및방송장비")),
        ("커뮤니케이션", ("방송업", "영상", "오디오", "출판", "광고", "뉴스", "음악")),
        ("필수소비재", ("식품", "음료", "담배", "농업", "어업", "축산")),
        ("경기소비재", ("소매", "도매", "숙박", "음식점", "오락", "스포츠", "교육", "의복")),
        ("산업재", ("기계", "자동차", "운송장비", "건설", "엔지니어링", "전동기", "발전기", "금속가공", "장비", "부품")),
        ("소재", ("화학", "철강", "금속", "비금속", "플라스틱", "고무", "유리", "시멘트", "종이", "목재", "섬유", "가죽")),
        ("에너지", ("석유", "가스", "석탄", "에너지")),
        ("유틸리티", ("전기공급", "가스공급", "수도", "폐기물", "하수")),
        ("부동산", ("부동산",)),
    )
    for sector, keywords in rules:
        if any(keyword in text for keyword in keywords):
            return sector
    return "기타"


def kind_tag_rows_for_profile(row: dict[str, Any], raw: dict[str, Any]) -> list[dict[str, Any]]:
    sector = clean_text(row.get("primary_sector"))
    industry = clean_text(row.get("primary_industry"))
    tags: list[dict[str, Any]] = []
    if sector:
        tags.append(
            {
                "market": row["market"],
                "symbol": row["symbol"],
                "taxonomy": "kind_krx_industry",
                "code": slug(sector),
                "name": sector,
                "level": 1,
                "source": "kind_krx_corp_list",
                "confidence": 0.75,
                "is_primary": not industry,
                "raw": {**raw, "sector_derivation": "keyword_rule"},
            }
        )
    if industry:
        tags.append(
            {
                "market": row["market"],
                "symbol": row["symbol"],
                "taxonomy": "kind_krx_industry",
                "code": slug(f"{sector}:{industry}" if sector else industry),
                "name": industry,
                "level": 2,
                "source": "kind_krx_corp_list",
                "confidence": 0.95,
                "is_primary": True,
                "raw": {**raw, "sector": sector},
            }
        )
    return tags


def build_kind_rows(items: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], int]:
    item_by_symbol = {
        normalize_kr_symbol(item.get("ticker")): item
        for item in items
        if clean_text(item.get("market")).upper() == "KR"
    }
    profiles: list[dict[str, Any]] = []
    tags: list[dict[str, Any]] = []
    misses = 0

    for provider_row in fetch_kind_corp_list_rows():
        symbol = normalize_kr_symbol(provider_row.get("종목코드"))
        industry = clean_text(provider_row.get("업종"))
        item = item_by_symbol.get(symbol)
        if not item or not industry:
            misses += 1
            continue

        sector = kind_sector_from_industry(industry)
        row = profile_row_from_master(item)
        row.update(
            {
                "primary_sector": sector,
                "primary_industry": industry,
                "primary_sector_key": slug(sector),
                "primary_industry_key": slug(f"{sector}:{industry}"),
                "classification_status": "verified",
                "source_priority": 15,
                "source": "kind_krx_corp_list",
                "metadata": {
                    **row["metadata"],
                    "kind_company_name": clean_text(provider_row.get("회사명")),
                    "kind_market_name": clean_text(provider_row.get("시장구분")),
                    "kind_exchange": kind_exchange(provider_row.get("시장구분")),
                    "kind_main_products": clean_text(provider_row.get("주요제품")),
                    "kind_listing_date": clean_text(provider_row.get("상장일")),
                    "kind_fiscal_month": clean_text(provider_row.get("결산월")),
                    "kind_ceo": clean_text(provider_row.get("대표자명")),
                    "kind_homepage": clean_text(provider_row.get("홈페이지")),
                    "kind_region": clean_text(provider_row.get("지역")),
                    "sector_derivation": "keyword_rule",
                },
            }
        )
        profiles.append(row)
        tags.extend(kind_tag_rows_for_profile(row, {"provider_symbol": symbol, "kind_market": clean_text(provider_row.get("시장구분"))}))

    return profiles, tags, misses


def build_source_rows(source: str, items: list[dict[str, Any]], pause_seconds: float, provider_timeout_seconds: int) -> tuple[list[dict[str, Any]], list[dict[str, Any]], int]:
    if source == "master":
        profiles, tags = build_master_rows(items)
        return profiles, tags, 0
    if source == "kind":
        return build_kind_rows(items)
    if source == "yfinance":
        return build_yfinance_rows(items, pause_seconds, provider_timeout_seconds)
    if source == "nasdaq":
        return build_nasdaq_rows(items)
    raise ValueError(f"Unsupported source: {source}")


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
        if table == PROFILE_TABLE:
            batch = merge_profile_batch_for_rest(url, key, batch)
        response = requests.post(
            f"{url}/rest/v1/{table}",
            params={"on_conflict": conflict},
            headers=supabase_headers(key),
            json=batch,
            timeout=SUPABASE_TIMEOUT_SECONDS,
        )
        if not response.ok:
            raise RuntimeError(f"Supabase upsert failed for {table}: HTTP {response.status_code} {response.text[:1000]}")
        total += len(batch)
    return total


def merge_profile_batch_for_rest(url: str, key: str, batch: list[dict[str, Any]]) -> list[dict[str, Any]]:
    existing = fetch_existing_profile_rows(url, key, batch)
    return [merge_profile_row_for_rest(row, existing.get((row["market"], row["symbol"]))) for row in batch]


def fetch_existing_profile_rows(url: str, key: str, batch: list[dict[str, Any]]) -> dict[tuple[str, str], dict[str, Any]]:
    import requests

    symbols_by_market: dict[str, set[str]] = {}
    for row in batch:
        symbols_by_market.setdefault(row["market"], set()).add(row["symbol"])

    existing: dict[tuple[str, str], dict[str, Any]] = {}
    for market, symbols in symbols_by_market.items():
        for symbol_batch in chunks(sorted(symbols), 200):
            response = requests.get(
                f"{url}/rest/v1/{PROFILE_TABLE}",
                params={
                    "select": ",".join(
                        [
                            "market",
                            "symbol",
                            "name",
                            "exchange",
                            "asset_class",
                            "primary_sector",
                            "primary_industry",
                            "primary_sector_key",
                            "primary_industry_key",
                            "classification_status",
                            "source_priority",
                            "source",
                            "metadata",
                        ]
                    ),
                    "market": f"eq.{market}",
                    "symbol": f"in.({','.join(postgrest_in_value(symbol) for symbol in symbol_batch)})",
                },
                headers=supabase_headers(key),
                timeout=SUPABASE_TIMEOUT_SECONDS,
            )
            response.raise_for_status()
            for row in response.json():
                existing[(clean_text(row.get("market")).upper(), clean_text(row.get("symbol")).upper())] = row
    return existing


def postgrest_in_value(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def merge_profile_row_for_rest(incoming: dict[str, Any], existing: dict[str, Any] | None) -> dict[str, Any]:
    if not existing:
        return incoming

    merged = dict(incoming)
    existing_metadata = existing.get("metadata") if isinstance(existing.get("metadata"), dict) else {}
    incoming_metadata = incoming.get("metadata") if isinstance(incoming.get("metadata"), dict) else {}
    merged["metadata"] = {**existing_metadata, **incoming_metadata}

    incoming_priority = int(incoming.get("source_priority") or 100)
    existing_priority = int(existing.get("source_priority") or 100)
    if incoming_priority <= existing_priority:
        merged["source_priority"] = min(incoming_priority, existing_priority)
        return merged

    for field in (
        "primary_sector",
        "primary_industry",
        "primary_sector_key",
        "primary_industry_key",
        "classification_status",
        "source_priority",
        "source",
    ):
        merged[field] = existing.get(field) if existing.get(field) is not None else incoming.get(field)
    return merged


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


def build_yfinance_rows(items: list[dict[str, Any]], pause_seconds: float, provider_timeout_seconds: int = 20) -> tuple[list[dict[str, Any]], list[dict[str, Any]], int]:
    profiles: list[dict[str, Any]] = []
    tags: list[dict[str, Any]] = []
    misses = 0
    for index, item in enumerate(items, start=1):
        if index == 1 or index % 25 == 0 or index == len(items):
            print(f"fetching yfinance {index}/{len(items)}", file=sys.stderr)
        try:
            profile, tag_rows = profile_and_tags_from_yfinance(item, pause_seconds, provider_timeout_seconds)
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
    parser.add_argument("--source", choices=["master", "kind", "nasdaq", "yfinance"], default="master")
    parser.add_argument("--market", choices=["ALL", "US", "KR"], default="ALL")
    parser.add_argument("--exchange", help="Filter by exchange code, e.g. KOSPI, KOSDAQ, NAS, NYS, AMS.")
    parser.add_argument("--symbols", help="Comma-separated symbols or MARKET:SYMBOL values.")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--pause-seconds", type=float, default=0.25)
    parser.add_argument("--provider-timeout-seconds", type=int, default=20)
    parser.add_argument("--transport", choices=["auto", "rest", "supabase-cli"], default="auto")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    items = filter_symbols(load_symbols(), args.market, args.exchange, args.symbols, args.limit, args.offset)
    profiles, tags, misses = build_source_rows(args.source, items, args.pause_seconds, args.provider_timeout_seconds)

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
