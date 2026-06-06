from __future__ import annotations

import argparse
from contextlib import contextmanager
import hashlib
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pandas as pd
import requests
import yfinance as yf

try:
    from scripts.stock_score.formatting import (
        as_float,
        as_int,
        average,
        finite_or_none,
        first_float,
        is_number,
        krw_approx,
        labeled_money,
        money,
        num_label,
        pct,
        price_label,
        score_negative,
        score_positive,
    )
except ModuleNotFoundError:
    from stock_score.formatting import (
        as_float,
        as_int,
        average,
        finite_or_none,
        first_float,
        is_number,
        krw_approx,
        labeled_money,
        money,
        num_label,
        pct,
        price_label,
        score_negative,
        score_positive,
    )

try:
    from scripts.stock_score.timeseries import (
        atr_percent,
        build_chart_series,
        kis_chart_series,
        kis_domestic_chart_series,
        return_between,
        simple_rsi,
    )
except ModuleNotFoundError:
    from stock_score.timeseries import (
        atr_percent,
        build_chart_series,
        kis_chart_series,
        kis_domestic_chart_series,
        return_between,
        simple_rsi,
    )

try:
    from scripts.stock_score.symbols import (
        KR_TICKER_RE,
        TICKER_RE,
        clean_ticker,
        domestic_yfinance_symbol,
        parse_symbol_ref,
    )
except ModuleNotFoundError:
    from stock_score.symbols import (
        KR_TICKER_RE,
        TICKER_RE,
        clean_ticker,
        domestic_yfinance_symbol,
        parse_symbol_ref,
    )

try:
    from scripts.stock_score.scoring import (
        SCORE_MODEL_VERSION,
        FactorScore,
        analyst_count_confidence,
        clamp_score,
        composite_score,
        eps_factor_score,
        guardrailed_valuation,
        liquidity_floor_score,
        momentum_factor_score,
        moving_average_spread_score,
        opportunity_factor_score,
        positive_or,
        positive_value,
        quality_adjusted_valuation,
        recommendation_score,
        risk_control_score,
        rsi_factor_score,
        score_negative_opt,
        score_positive_opt,
        target_upside_score,
        volume_acceleration_score,
        weighted_factor_score,
    )
except ModuleNotFoundError:
    from stock_score.scoring import (
        SCORE_MODEL_VERSION,
        FactorScore,
        analyst_count_confidence,
        clamp_score,
        composite_score,
        eps_factor_score,
        guardrailed_valuation,
        liquidity_floor_score,
        momentum_factor_score,
        moving_average_spread_score,
        opportunity_factor_score,
        positive_or,
        positive_value,
        quality_adjusted_valuation,
        recommendation_score,
        risk_control_score,
        rsi_factor_score,
        score_negative_opt,
        score_positive_opt,
        target_upside_score,
        volume_acceleration_score,
        weighted_factor_score,
    )

try:
    from scripts.stock_score.presentation import (
        grade_for,
        opportunity_components_for,
        signal_for,
        top_like_current,
    )
except ModuleNotFoundError:
    from stock_score.presentation import (
        grade_for,
        opportunity_components_for,
        signal_for,
        top_like_current,
    )

try:
    from scripts.stock_score.yfinance_provider import (
        latest_statement,
        safe_fast_info,
        safe_history,
        safe_info,
        safe_intraday,
        safe_news,
        usd_krw_rate,
    )
except ModuleNotFoundError:
    from stock_score.yfinance_provider import (
        latest_statement,
        safe_fast_info,
        safe_history,
        safe_info,
        safe_intraday,
        safe_news,
        usd_krw_rate,
    )


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")


US_EQUITY_EXCHANGES = {"NMS", "NGM", "NCM", "NASDAQ", "NAS", "NYQ", "NYSE", "ASE", "AMEX", "PCX", "BATS", "IEX"}
US_EXCHANGE_NAME_MARKERS = ("NASDAQ", "NYSE", "AMEX", "BATS", "IEX")


class KisApiError(Exception):
    pass


def kis_error_payload(exc: KisApiError) -> dict[str, Any]:
    message = str(exc)
    if "초당" in message or "거래건수" in message:
        return {"ok": False, "status": 429, "error": "kis_rate_limited", "message": "KIS API 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요."}
    if "토큰" in message or "API 키" in message:
        return {"ok": False, "status": 502, "error": "kis_auth_failed", "message": "KIS API 인증을 확인해주세요."}
    return {"ok": False, "status": 404, "error": "kis_not_found", "message": message}


KIS_US_MARKETS = [
    {"excd": "NAS", "product_type": "512", "label": "Nasdaq"},
    {"excd": "NYS", "product_type": "513", "label": "NYSE"},
    {"excd": "AMS", "product_type": "529", "label": "AMEX"},
]
KIS_LAST_REQUEST_AT = 0.0
KIS_REQUEST_INTERVAL = 1.05
KIS_DISCOVERY_CACHE_VERSION = 1
KIS_DISCOVERY_CACHE_TTL_SECONDS = 60 * 60 * 24 * 30
KIS_DOMESTIC_SCORE_MARKET_DIV_CODE = "J"
KIS_DOMESTIC_QUOTE_MARKET_DIV_CODE = "UN"


def env_value(name: str) -> str | None:
    value = os.environ.get(name)
    if value:
        return value.strip()

    for env_filename in (".env.local", ".env.supabase.local"):
        env_path = Path.cwd() / env_filename
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
            continue
    return None


def kis_discovery_cache_path() -> Path:
    return Path.cwd() / ".kis_discovery_cache.json"


def read_kis_discovery_cache(symbol: str) -> dict[str, Any] | None:
    path = kis_discovery_cache_path()
    try:
        cache = json.loads(path.read_text(encoding="utf-8"))
        item = cache.get(clean_ticker(symbol)) if isinstance(cache, dict) else None
        if not isinstance(item, dict) or item.get("version") != KIS_DISCOVERY_CACHE_VERSION:
            return None
        fetched_at = as_float(item.get("fetched_at"))
        if not fetched_at or fetched_at + KIS_DISCOVERY_CACHE_TTL_SECONDS <= time.time():
            return None
        market = item.get("market")
        if not isinstance(market, dict) or not market.get("excd") or not market.get("product_type"):
            return None
        return item
    except Exception:
        return None


def write_kis_discovery_cache(symbol: str, market: dict[str, Any], search: dict[str, Any]) -> None:
    path = kis_discovery_cache_path()
    lock_path = path.with_suffix(".lock")
    with one_byte_file_lock(lock_path):
        try:
            cache = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(cache, dict):
                cache = {}
        except Exception:
            cache = {}
        cache[clean_ticker(symbol)] = {
            "version": KIS_DISCOVERY_CACHE_VERSION,
            "fetched_at": time.time(),
            "market": market,
            "search": search,
        }
        try:
            tmp_path = path.with_suffix(".tmp")
            tmp_path.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
            tmp_path.replace(path)
        except Exception:
            pass


def int_env(name: str, default: int) -> int:
    try:
        value = int(env_value(name) or "")
        return value if value > 0 else default
    except (TypeError, ValueError):
        return default


@contextmanager
def one_byte_file_lock(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        import msvcrt
        lock = path.open("a+b")
    except Exception:
        pass
    else:
        with lock:
            lock.seek(0, os.SEEK_END)
            if lock.tell() == 0:
                lock.write(b"0")
                lock.flush()
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_LOCK, 1)
            try:
                yield
            finally:
                lock.seek(0)
                msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
        return

    try:
        import fcntl
        lock = path.open("a+b")
    except Exception:
        yield
        return

    with lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


YFINANCE_FUNDAMENTAL_CACHE_VERSION = 2
YFINANCE_FUNDAMENTAL_SOURCE = "yfinance"
SUPABASE_FUNDAMENTAL_TABLE = "stock_fundamental_snapshots"
SUPABASE_TIMEOUT_SECONDS = 8
KIS_TOKEN_CACHE_TABLE = "kis_access_tokens"
KIS_TOKEN_LOCK_RPC = "acquire_kis_token_issue_lock"
KIS_TOKEN_REFRESH_BUFFER_SECONDS = 300
YFINANCE_FUNDAMENTAL_FIELDS = (
    "profitMargins",
    "operatingMargins",
    "returnOnEquity",
    "revenueGrowth",
    "earningsGrowth",
    "totalRevenue",
    "operatingCashflow",
    "freeCashflow",
    "totalCash",
    "totalDebt",
    "debtToEquity",
    "currentRatio",
    "quickRatio",
    "trailingPE",
    "forwardPE",
    "priceToBook",
    "enterpriseToRevenue",
    "priceToSalesTrailing12Months",
    "grossMargins",
    "ebitdaMargins",
    "targetMeanPrice",
    "targetMedianPrice",
    "numberOfAnalystOpinions",
    "recommendationMean",
    "beta",
    "averageVolume",
    "averageVolume10days",
)


def yfinance_fundamental_cache_dir() -> Path:
    configured = env_value("STOCK_FUNDAMENTALS_CACHE_DIR")
    return Path(configured) if configured else Path.cwd() / ".stock_fundamentals_cache"


def yfinance_fundamental_cache_path(symbol: str) -> Path:
    safe_symbol = re.sub(r"[^A-Z0-9.-]", "_", clean_ticker(symbol))
    return yfinance_fundamental_cache_dir() / f"{safe_symbol}.json"


def yfinance_cache_fresh_seconds() -> int:
    return int_env("STOCK_FUNDAMENTALS_CACHE_SECONDS", 43_200)


def yfinance_cache_stale_seconds() -> int:
    return int_env("STOCK_FUNDAMENTALS_STALE_SECONDS", 604_800)


def supabase_read_config() -> tuple[str, str] | None:
    url = (env_value("SUPABASE_URL") or "").rstrip("/")
    key = env_value("SUPABASE_SERVICE_ROLE_KEY") or env_value("SUPABASE_PUBLISHABLE_KEY")
    if not url or not key:
        return None
    return url, key


def supabase_write_config() -> tuple[str, str] | None:
    url = (env_value("SUPABASE_URL") or "").rstrip("/")
    key = env_value("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        return None
    return url, key


def supabase_headers(key: str) -> dict[str, str]:
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }


def parse_iso_datetime(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def supabase_cache_state(row: dict[str, Any], now: datetime) -> str | None:
    expires_at = parse_iso_datetime(row.get("expires_at"))
    stale_expires_at = parse_iso_datetime(row.get("stale_expires_at"))
    if expires_at and now <= expires_at:
        return "fresh"
    if stale_expires_at and now <= stale_expires_at:
        return "stale"
    return None


def fundamental_cache_payload(symbol: str, values: dict[str, Any], now: float | None = None) -> dict[str, Any]:
    timestamp = time.time() if now is None else now
    fetched_at = datetime.fromtimestamp(timestamp, timezone.utc)
    fresh_expires_at = datetime.fromtimestamp(timestamp + yfinance_cache_fresh_seconds(), timezone.utc)
    stale_expires_at = datetime.fromtimestamp(timestamp + yfinance_cache_stale_seconds(), timezone.utc)
    return {
        "version": YFINANCE_FUNDAMENTAL_CACHE_VERSION,
        "symbol": clean_ticker(symbol),
        "source": YFINANCE_FUNDAMENTAL_SOURCE,
        "fetched_at": timestamp,
        "fetched_at_iso": fetched_at.isoformat(),
        "expires_at": timestamp + yfinance_cache_fresh_seconds(),
        "expires_at_iso": fresh_expires_at.isoformat(),
        "stale_expires_at": timestamp + yfinance_cache_stale_seconds(),
        "stale_expires_at_iso": stale_expires_at.isoformat(),
        "values": values,
    }


def read_supabase_yfinance_fundamental_cache(symbol: str, market: str = "US") -> tuple[dict[str, Any] | None, str | None, dict[str, Any] | None]:
    config = supabase_read_config()
    if not config:
        return None, None, None

    url, key = config
    clean_symbol = clean_ticker(symbol)
    try:
        response = requests.get(
            f"{url}/rest/v1/{SUPABASE_FUNDAMENTAL_TABLE}",
            params={
                "market": f"eq.{clean_ticker(market) or 'US'}",
                "symbol": f"eq.{clean_symbol}",
                "source": f"eq.{YFINANCE_FUNDAMENTAL_SOURCE}",
                "select": "payload,fetched_at,expires_at,stale_expires_at",
                "limit": "1",
            },
            headers=supabase_headers(key),
            timeout=SUPABASE_TIMEOUT_SECONDS,
        )
        if response.status_code == 404:
            return None, None, {"source": YFINANCE_FUNDAMENTAL_SOURCE, "store": "supabase", "cache": "miss", "error": "table_missing"}
        if not response.ok:
            return None, None, {
                "source": YFINANCE_FUNDAMENTAL_SOURCE,
                "store": "supabase",
                "cache": "miss",
                "error": f"HTTP {response.status_code}",
            }
        rows = response.json()
    except Exception as exc:
        return None, None, {"source": YFINANCE_FUNDAMENTAL_SOURCE, "store": "supabase", "cache": "miss", "error": str(exc)}

    if not isinstance(rows, list) or not rows:
        return None, None, {"source": YFINANCE_FUNDAMENTAL_SOURCE, "store": "supabase", "cache": "miss"}

    row = rows[0] if isinstance(rows[0], dict) else {}
    payload = row.get("payload")
    if not isinstance(payload, dict) or payload.get("version") != YFINANCE_FUNDAMENTAL_CACHE_VERSION:
        return None, None, {"source": YFINANCE_FUNDAMENTAL_SOURCE, "store": "supabase", "cache": "miss", "error": "version_mismatch"}

    values = payload.get("values")
    state = supabase_cache_state(row, datetime.now(timezone.utc))
    if not isinstance(values, dict) or state is None:
        return None, None, {"source": YFINANCE_FUNDAMENTAL_SOURCE, "store": "supabase", "cache": "expired"}

    return values, state, {
        "source": YFINANCE_FUNDAMENTAL_SOURCE,
        "store": "supabase",
        "cache": state,
        "fetched_at": row.get("fetched_at"),
        "expires_at": row.get("expires_at"),
        "stale_expires_at": row.get("stale_expires_at"),
    }


def write_supabase_yfinance_fundamental_cache(symbol: str, values: dict[str, Any], market: str = "US") -> bool:
    config = supabase_write_config()
    if not config:
        return False

    url, key = config
    timestamp = time.time()
    payload = fundamental_cache_payload(symbol, values, timestamp)
    row = {
        "market": clean_ticker(market) or "US",
        "symbol": clean_ticker(symbol),
        "source": YFINANCE_FUNDAMENTAL_SOURCE,
        "payload": payload,
        "fetched_at": payload["fetched_at_iso"],
        "expires_at": payload["expires_at_iso"],
        "stale_expires_at": payload["stale_expires_at_iso"],
    }
    try:
        response = requests.post(
            f"{url}/rest/v1/{SUPABASE_FUNDAMENTAL_TABLE}",
            params={"on_conflict": "market,symbol,source"},
            headers={
                **supabase_headers(key),
                "Prefer": "resolution=merge-duplicates,return=minimal",
            },
            json=row,
            timeout=SUPABASE_TIMEOUT_SECONDS,
        )
        return response.ok
    except Exception:
        return False


def kis_token_cache_key(config: dict[str, str]) -> str:
    return hashlib.sha256(f"{config['base_url']}:{config['app_key']}".encode("utf-8")).hexdigest()[:16]


def fresh_kis_token_payload(payload: dict[str, Any] | None) -> tuple[str, float] | None:
    if not isinstance(payload, dict):
        return None
    token = payload.get("access_token")
    expires_at = as_float(payload.get("expires_at"))
    if token and expires_at and expires_at > time.time() + KIS_TOKEN_REFRESH_BUFFER_SECONDS:
        return str(token), float(expires_at)
    return None


def read_local_kis_token_cache(cache_path: Path) -> tuple[str, float] | None:
    try:
        return fresh_kis_token_payload(json.loads(cache_path.read_text(encoding="utf-8")))
    except Exception:
        return None


def write_local_kis_token_cache(cache_path: Path, token: str, expires_at: float) -> None:
    try:
        tmp_path = cache_path.with_suffix(".tmp")
        tmp_path.write_text(json.dumps({"access_token": token, "expires_at": expires_at}), encoding="utf-8")
        tmp_path.replace(cache_path)
    except Exception:
        pass


def read_supabase_kis_access_token(cache_key: str) -> tuple[str, float] | None:
    config = supabase_write_config()
    if not config:
        return None

    url, key = config
    try:
        response = requests.get(
            f"{url}/rest/v1/{KIS_TOKEN_CACHE_TABLE}",
            params={
                "cache_key": f"eq.{cache_key}",
                "select": "access_token,expires_at",
                "limit": "1",
            },
            headers=supabase_headers(key),
            timeout=SUPABASE_TIMEOUT_SECONDS,
        )
        if not response.ok:
            return None
        rows = response.json()
    except Exception:
        return None

    if not isinstance(rows, list) or not rows or not isinstance(rows[0], dict):
        return None
    token = rows[0].get("access_token")
    expires_at = parse_iso_datetime(rows[0].get("expires_at"))
    if isinstance(token, str) and expires_at and expires_at.timestamp() > time.time() + KIS_TOKEN_REFRESH_BUFFER_SECONDS:
        return token, expires_at.timestamp()
    return None


def acquire_supabase_kis_token_issue_lock(cache_key: str, lock_seconds: int = 30) -> bool | None:
    config = supabase_write_config()
    if not config:
        return None

    url, key = config
    try:
        response = requests.post(
            f"{url}/rest/v1/rpc/{KIS_TOKEN_LOCK_RPC}",
            headers=supabase_headers(key),
            json={
                "p_cache_key": cache_key,
                "p_lock_seconds": lock_seconds,
                "p_locked_by": f"python-{os.getpid()}",
            },
            timeout=SUPABASE_TIMEOUT_SECONDS,
        )
        if not response.ok:
            return None
        payload = response.json()
    except Exception:
        return None

    if isinstance(payload, bool):
        return payload
    row = payload[0] if isinstance(payload, list) and payload else payload
    if isinstance(row, dict) and isinstance(row.get("acquired"), bool):
        return bool(row["acquired"])
    return None


def wait_for_supabase_kis_access_token(cache_key: str, attempts: int = 3, delay_seconds: float = 0.75) -> tuple[str, float] | None:
    for _ in range(attempts):
        time.sleep(delay_seconds)
        token = read_supabase_kis_access_token(cache_key)
        if token:
            return token
    return None


def write_supabase_kis_access_token(cache_key: str, token: str, expires_at: float) -> bool:
    config = supabase_write_config()
    if not config or not token or expires_at <= time.time():
        return False

    url, key = config
    try:
        response = requests.post(
            f"{url}/rest/v1/{KIS_TOKEN_CACHE_TABLE}",
            params={"on_conflict": "cache_key"},
            headers={
                **supabase_headers(key),
                "Prefer": "resolution=merge-duplicates,return=minimal",
            },
            json={
                "cache_key": cache_key,
                "access_token": token,
                "expires_at": datetime.fromtimestamp(expires_at, timezone.utc).isoformat(),
                "issued_at": datetime.now(timezone.utc).isoformat(),
                "locked_until": None,
                "locked_by": None,
            },
            timeout=SUPABASE_TIMEOUT_SECONDS,
        )
        return response.ok
    except Exception:
        return False


def yfinance_cache_meta(store: str, state: str, **extra: Any) -> dict[str, Any]:
    return {
        "source": YFINANCE_FUNDAMENTAL_SOURCE,
        "store": store,
        "cache": state,
        **{key: value for key, value in extra.items() if value is not None},
    }


def cached_payload_state(cached: dict[str, Any], now: float) -> str | None:
    if cached.get("version") != YFINANCE_FUNDAMENTAL_CACHE_VERSION:
        return None
    fetched_at = as_float(cached.get("fetched_at"))
    if fetched_at is None:
        return None
    age = now - fetched_at
    if age <= yfinance_cache_fresh_seconds():
        return "fresh"
    if age <= yfinance_cache_stale_seconds():
        return "stale"
    return None


def read_yfinance_fundamental_cache(symbol: str) -> tuple[dict[str, Any] | None, str | None]:
    path = yfinance_fundamental_cache_path(symbol)
    now = time.time()
    try:
        cached = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None, None
    if not isinstance(cached, dict):
        return None, None
    state = cached_payload_state(cached, now)
    values = cached.get("values")
    return (values if isinstance(values, dict) else None), state


def write_yfinance_fundamental_cache(symbol: str, values: dict[str, Any]) -> None:
    path = yfinance_fundamental_cache_path(symbol)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = fundamental_cache_payload(symbol, values)
    temp_path = path.with_suffix(".tmp")
    temp_path.write_text(json.dumps(payload, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    temp_path.replace(path)


def yfinance_fundamentals(symbol: str, market: str = "US") -> tuple[dict[str, Any], dict[str, Any]]:
    market = clean_ticker(market) or "US"
    supabase_values, supabase_state, supabase_meta = read_supabase_yfinance_fundamental_cache(symbol, market)
    if supabase_values and supabase_state == "fresh":
        return supabase_values, supabase_meta or yfinance_cache_meta("supabase", "fresh")

    local_values, local_state = read_yfinance_fundamental_cache(symbol)
    if local_values and local_state == "fresh":
        if not supabase_values:
            write_supabase_yfinance_fundamental_cache(symbol, local_values, market)
        return local_values, yfinance_cache_meta("file", "fresh")

    stale_values = supabase_values if supabase_values and supabase_state == "stale" else local_values if local_values and local_state == "stale" else None
    stale_meta = (
        supabase_meta
        if supabase_values and supabase_state == "stale" and supabase_meta
        else yfinance_cache_meta("file", "stale")
        if local_values and local_state == "stale"
        else None
    )

    lock_path = yfinance_fundamental_cache_path(symbol).with_suffix(".lock")
    with one_byte_file_lock(lock_path):
        supabase_values, supabase_state, supabase_meta = read_supabase_yfinance_fundamental_cache(symbol, market)
        if supabase_values and supabase_state == "fresh":
            return supabase_values, supabase_meta or yfinance_cache_meta("supabase", "fresh")

        local_values, local_state = read_yfinance_fundamental_cache(symbol)
        if local_values and local_state == "fresh":
            if not supabase_values:
                write_supabase_yfinance_fundamental_cache(symbol, local_values, market)
            return local_values, yfinance_cache_meta("file", "fresh")

        if supabase_values and supabase_state == "stale":
            stale_values = supabase_values
            stale_meta = supabase_meta or yfinance_cache_meta("supabase", "stale")
        elif local_values and local_state == "stale":
            stale_values = local_values
            stale_meta = yfinance_cache_meta("file", "stale")

        try:
            info = safe_info(yf.Ticker(symbol))
            values = {field: finite_or_none(info.get(field)) for field in YFINANCE_FUNDAMENTAL_FIELDS if info.get(field) is not None}
            if values:
                write_yfinance_fundamental_cache(symbol, values)
                supabase_written = write_supabase_yfinance_fundamental_cache(symbol, values, market)
                return values, yfinance_cache_meta("provider", "refreshed", persisted="supabase" if supabase_written else "file")
        except Exception as exc:
            if stale_values:
                return stale_values, {**(stale_meta or yfinance_cache_meta("unknown", "stale")), "refresh_error": str(exc)}
            return {}, yfinance_cache_meta("provider", "miss", refresh_error=str(exc))

    if stale_values:
        return stale_values, stale_meta or yfinance_cache_meta("unknown", "stale")
    return {}, yfinance_cache_meta("provider", "miss")


def kis_config() -> dict[str, str]:
    app_key = env_value("STOCK_API_APP_KEY") or env_value("KIS_APP_KEY")
    app_secret = env_value("STOCK_API_APP_SECRET") or env_value("KIS_APP_SECRET")
    base_url = (env_value("STOCK_API_BASE") or env_value("KIS_API_BASE") or "https://openapi.koreainvestment.com:9443").rstrip("/")
    if not app_key or not app_secret:
        raise KisApiError("시세 조회 API 키 설정이 필요합니다.")
    return {"app_key": app_key, "app_secret": app_secret, "base_url": base_url}


def parse_kis_token_expiry(value: Any) -> float | None:
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y%m%d%H%M%S"):
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=timezone.utc).timestamp()
        except ValueError:
            pass
    return None


def kis_access_token() -> str:
    config = kis_config()
    cache_key = kis_token_cache_key(config)
    cache_path = Path.cwd() / f".kis_token_cache_{cache_key}.json"
    lock_path = cache_path.with_suffix(".lock")

    with one_byte_file_lock(lock_path):
        cached = read_local_kis_token_cache(cache_path)
        if cached:
            return cached[0]

        shared = read_supabase_kis_access_token(cache_key)
        if shared:
            write_local_kis_token_cache(cache_path, shared[0], shared[1])
            return shared[0]

        lock_acquired = acquire_supabase_kis_token_issue_lock(cache_key)
        if lock_acquired is False:
            waited = wait_for_supabase_kis_access_token(cache_key)
            if waited:
                write_local_kis_token_cache(cache_path, waited[0], waited[1])
                return waited[0]

        response = requests.post(
            f"{config['base_url']}/oauth2/tokenP",
            headers={"content-type": "application/json; charset=utf-8"},
            json={
                "grant_type": "client_credentials",
                "appkey": config["app_key"],
                "appsecret": config["app_secret"],
            },
            timeout=12,
        )
        try:
            payload = response.json()
        except ValueError as exc:
            raise KisApiError(f"토큰 응답을 읽지 못했습니다. HTTP {response.status_code}") from exc
        if not response.ok or not payload.get("access_token"):
            message = payload.get("error_description") or payload.get("msg1") or payload.get("message") or response.text
            raise KisApiError(f"토큰 발급 실패: {message}")

        expires_at = parse_kis_token_expiry(payload.get("access_token_token_expired"))
        if expires_at is None:
            expires_at = time.time() + float(payload.get("expires_in") or 60 * 60 * 23)
        token = str(payload["access_token"])
        write_local_kis_token_cache(cache_path, token, expires_at)
        write_supabase_kis_access_token(cache_key, token, expires_at)
        return token


def kis_throttle() -> None:
    lock_path = Path.cwd() / ".kis_request_lock"
    clock_path = Path.cwd() / ".kis_request_clock"

    try:
        with one_byte_file_lock(lock_path):
            try:
                last = float(clock_path.read_text(encoding="utf-8").strip() or "0")
            except Exception:
                last = 0.0
            elapsed = time.time() - last
            if elapsed < KIS_REQUEST_INTERVAL:
                time.sleep(KIS_REQUEST_INTERVAL - elapsed)
            clock_path.write_text(str(time.time()), encoding="utf-8")
    except Exception:
        global KIS_LAST_REQUEST_AT
        elapsed = time.time() - KIS_LAST_REQUEST_AT
        if elapsed < KIS_REQUEST_INTERVAL:
            time.sleep(KIS_REQUEST_INTERVAL - elapsed)
        KIS_LAST_REQUEST_AT = time.time()


def kis_get(path: str, tr_id: str, params: dict[str, Any]) -> dict[str, Any]:
    config = kis_config()
    kis_throttle()
    response = requests.get(
        f"{config['base_url']}{path}",
        headers={
            "content-type": "application/json; charset=utf-8",
            "authorization": f"Bearer {kis_access_token()}",
            "appkey": config["app_key"],
            "appsecret": config["app_secret"],
            "tr_id": tr_id,
            "custtype": "P",
        },
        params=params,
        timeout=12,
    )
    try:
        payload = response.json()
    except ValueError as exc:
        raise KisApiError(f"시세 응답을 읽지 못했습니다. HTTP {response.status_code}") from exc
    if not response.ok or str(payload.get("rt_cd", "0")) != "0":
        message = payload.get("msg1") or payload.get("msg_cd") or response.text
        raise KisApiError(str(message))
    return payload


def output_object(payload: dict[str, Any], key: str = "output") -> dict[str, Any]:
    value = payload.get(key)
    if isinstance(value, list):
        return value[0] if value and isinstance(value[0], dict) else {}
    return value if isinstance(value, dict) else {}


def output_list(payload: dict[str, Any], key: str = "output") -> list[dict[str, Any]]:
    value = payload.get(key)
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    if isinstance(value, dict):
        return [value]
    return []


def kis_percent(value: Any) -> float | None:
    parsed = as_float(value)
    if parsed is None:
        return None
    return parsed / 100.0


def kis_date(value: Any) -> str | None:
    text = str(value or "").strip()
    if len(text) == 8 and text.isdigit():
        return f"{text[:4]}-{text[4:6]}-{text[6:8]}"
    return None


def news_epoch(date_value: Any, time_value: Any) -> int | None:
    date_text = str(date_value or "").strip()
    time_text = str(time_value or "").strip().ljust(6, "0")[:6]
    if len(date_text) != 8 or not date_text.isdigit():
        return None
    try:
        parsed = datetime.strptime(f"{date_text}{time_text}", "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
        return int(parsed.timestamp())
    except ValueError:
        return None


def kis_price(excd: str, symbol: str) -> dict[str, Any]:
    return output_object(
        kis_get(
            "/uapi/overseas-price/v1/quotations/price",
            "HHDFS00000300",
            {"AUTH": "", "EXCD": excd, "SYMB": symbol},
        )
    )


def kis_price_detail(excd: str, symbol: str) -> dict[str, Any]:
    return output_object(
        kis_get(
            "/uapi/overseas-price/v1/quotations/price-detail",
            "HHDFS76200200",
            {"AUTH": "", "EXCD": excd, "SYMB": symbol},
        )
    )


def kis_search_info(product_type: str, symbol: str) -> dict[str, Any]:
    return output_object(
        kis_get(
            "/uapi/overseas-price/v1/quotations/search-info",
            "CTPF1702R",
            {"PRDT_TYPE_CD": product_type, "PDNO": symbol},
        )
    )


def kis_daily_rows(excd: str, symbol: str) -> list[dict[str, Any]]:
    payload = kis_get(
        "/uapi/overseas-price/v1/quotations/dailyprice",
        "HHDFS76240000",
        {"AUTH": "", "EXCD": excd, "SYMB": symbol, "GUBN": "0", "BYMD": "", "MODP": "1"},
    )
    rows = output_list(payload, "output2") or output_list(payload, "output")
    rows = [row for row in rows if kis_date(row.get("xymd")) and as_float(row.get("clos")) is not None]
    rows.sort(key=lambda row: str(row.get("xymd") or ""))
    return rows


def kis_news(symbol: str, excd: str) -> list[dict[str, Any]]:
    try:
        payload = kis_get(
            "/uapi/overseas-price/v1/quotations/news-title",
            "HHPSTH60100C1",
            {
                "INFO_GB": "",
                "CLASS_CD": "",
                "NATION_CD": "US",
                "EXCHANGE_CD": excd,
                "SYMB": symbol,
                "DATA_DT": "",
                "DATA_TM": "",
                "CTS": "",
            },
        )
    except Exception:
        return []
    rows = payload.get("outblock1")
    if isinstance(rows, dict):
        rows = [rows]
    if not isinstance(rows, list):
        rows = []
    news: list[dict[str, Any]] = []
    for row in rows[:8]:
        if not isinstance(row, dict):
            continue
        title = row.get("title")
        if not title:
            continue
        news.append(
            {
                "title": title,
                "publisher": row.get("source") or "News",
                "link": "",
                "provider_publish_time": news_epoch(row.get("data_dt"), row.get("data_tm")),
            }
        )
    return news


def kis_domestic_price(symbol: str, market_div_code: str = KIS_DOMESTIC_SCORE_MARKET_DIV_CODE) -> dict[str, Any]:
    return output_object(
        kis_get(
            "/uapi/domestic-stock/v1/quotations/inquire-price",
            "FHKST01010100",
            {"FID_COND_MRKT_DIV_CODE": market_div_code, "FID_INPUT_ISCD": symbol},
        )
    )


def kis_domestic_daily_rows(symbol: str) -> list[dict[str, Any]]:
    end = datetime.now(timezone.utc).date()
    start = end - timedelta(days=540)
    payload = kis_get(
        "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice",
        "FHKST03010100",
        {
            "FID_COND_MRKT_DIV_CODE": "J",
            "FID_INPUT_ISCD": symbol,
            "FID_INPUT_DATE_1": start.strftime("%Y%m%d"),
            "FID_INPUT_DATE_2": end.strftime("%Y%m%d"),
            "FID_PERIOD_DIV_CODE": "D",
            "FID_ORG_ADJ_PRC": "0",
        },
    )
    rows = output_list(payload, "output2")
    rows = [row for row in rows if kis_date(row.get("stck_bsop_date")) and as_float(row.get("stck_clpr")) is not None]
    rows.sort(key=lambda row: str(row.get("stck_bsop_date") or ""))
    return rows


def kis_domestic_search_info(symbol: str) -> dict[str, Any]:
    return output_object(
        kis_get(
            "/uapi/domestic-stock/v1/quotations/search-info",
            "CTPF1604R",
            {"PDNO": symbol, "PRDT_TYPE_CD": "300"},
        )
    )


def kis_domestic_stock_info(symbol: str) -> dict[str, Any]:
    return output_object(
        kis_get(
            "/uapi/domestic-stock/v1/quotations/search-stock-info",
            "CTPF1002R",
            {"PDNO": symbol, "PRDT_TYPE_CD": "300"},
        )
    )


def kis_domestic_news(symbol: str) -> list[dict[str, Any]]:
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    try:
        payload = kis_get(
            "/uapi/domestic-stock/v1/quotations/news-title",
            "FHKST01011800",
            {
                "FID_NEWS_OFER_ENTP_CODE": "",
                "FID_COND_MRKT_CLS_CODE": "00",
                "FID_INPUT_ISCD": symbol,
                "FID_TITL_CNTT": "",
                "FID_INPUT_DATE_1": today,
                "FID_INPUT_HOUR_1": "000000",
                "FID_RANK_SORT_CLS_CODE": "01",
                "FID_INPUT_SRNO": "1",
            },
        )
    except Exception:
        return []
    news: list[dict[str, Any]] = []
    for row in output_list(payload, "output")[:8]:
        title = row.get("hts_pbnt_titl_cntt")
        if not title:
            continue
        news.append(
            {
                "title": str(title),
                "publisher": row.get("dorg") or "News",
                "link": "",
                "provider_publish_time": news_epoch(row.get("data_dt"), row.get("data_tm")),
            }
        )
    return news


def discover_kis_stock(symbol: str) -> dict[str, Any]:
    errors: list[str] = []
    cached = read_kis_discovery_cache(symbol)
    if cached:
        market = cached["market"]
        excd = str(market["excd"])
        try:
            detail = kis_price_detail(excd, symbol)
            if as_float(detail.get("last")) is not None:
                return {
                    "market": market,
                    "search": cached.get("search") if isinstance(cached.get("search"), dict) else {},
                    "detail": detail,
                    "price": {},
                }
        except Exception as exc:
            errors.append(f"{excd} cached detail: {exc}")

    for market in KIS_US_MARKETS:
        excd = str(market["excd"])
        product_type = str(market["product_type"])
        search: dict[str, Any] = {}
        try:
            search = kis_search_info(product_type, symbol)
        except Exception as exc:
            errors.append(f"{excd} search: {exc}")
            if "초당" in str(exc):
                raise KisApiError(str(exc)) from exc
            continue
        if not search:
            errors.append(f"{excd} search: empty")
            continue

        try:
            detail = kis_price_detail(excd, symbol)
        except Exception as exc:
            errors.append(f"{excd} detail: {exc}")
            if "초당" in str(exc):
                raise KisApiError(str(exc)) from exc
            continue

        if as_float(detail.get("last")) is not None:
            write_kis_discovery_cache(symbol, market, search)
            return {
                "market": market,
                "search": search,
                "detail": detail,
                "price": {},
            }
    raise KisApiError("; ".join(errors[-3:]) or f"{symbol}을 미국주식에서 찾지 못했습니다.")


def domestic_exchange_name(stock_info: dict[str, Any]) -> str:
    if stock_info.get("kosdaq_mket_lstg_dt"):
        return "KOSDAQ"
    if stock_info.get("scts_mket_lstg_dt"):
        return "KOSPI"
    if stock_info.get("frbd_mket_lstg_dt"):
        return "KONEX"
    market_id = str(stock_info.get("mket_id_cd") or "").upper()
    return market_id or "KRX"


def fetch_score_kis_us(raw_ticker: str, view: str = "detail", usd_krw_override: float | None = None, use_rate_override: bool = False) -> dict[str, Any]:
    symbol = clean_ticker(raw_ticker)
    if not symbol or not TICKER_RE.match(symbol):
        return {"ok": False, "status": 400, "error": "invalid_ticker", "message": "정확한 미국 주식 티커만 입력하세요."}

    try:
        discovered = discover_kis_stock(symbol)
    except KisApiError as exc:
        return kis_error_payload(exc)

    is_compare_view = view == "compare"
    market = discovered["market"]
    excd = str(market["excd"])
    detail = discovered["detail"]
    price = discovered["price"]
    search = discovered["search"]

    try:
        daily_rows = kis_daily_rows(excd, symbol)
    except Exception:
        daily_rows = []

    fundamentals, fundamentals_cache = yfinance_fundamentals(symbol)

    currency = str(detail.get("curr") or search.get("tr_crcy_cd") or "USD")
    usd_krw = (usd_krw_override if use_rate_override else as_float(detail.get("t_rate"))) if currency == "USD" else None
    closes = [float(row["clos"]) for row in daily_rows if as_float(row.get("clos")) is not None]
    latest_history_close = closes[-1] if closes else None
    latest_price = as_float(detail.get("last")) or as_float(price.get("last")) or as_float(search.get("ovrs_now_pric1")) or latest_history_close
    previous_close = as_float(detail.get("base")) or as_float(price.get("base"))
    latest_change = kis_percent(price.get("rate")) or (((latest_price / previous_close) - 1.0) if latest_price and previous_close else None)

    name = str(search.get("prdt_eng_name") or search.get("ovrs_item_name") or search.get("prdt_name") or symbol)
    exchange = str(search.get("ovrs_excg_name") or market["label"])
    latest_date = kis_date(daily_rows[-1].get("xymd")) if daily_rows else datetime.now(timezone.utc).date().isoformat()
    market_cap = as_float(detail.get("tomv")) or as_float(detail.get("mcap"))
    volume = as_int(detail.get("tvol")) or as_int(price.get("tvol"))
    avg_volume_20 = average([as_float(row.get("tvol")) for row in daily_rows[-20:]]) if daily_rows else None
    avg_volume_60 = average([as_float(row.get("tvol")) for row in daily_rows[-60:]]) if daily_rows else None
    year_high = as_float(detail.get("h52p")) or (max(closes[-252:]) if closes else None)
    year_low = as_float(detail.get("l52p")) or (min(closes[-252:]) if closes else None)
    ma50 = sum(closes[-50:]) / 50 if len(closes) >= 50 else None
    ma200 = sum(closes[-200:]) / 200 if len(closes) >= 200 else None
    ret_1m = return_between(closes, 21)
    ret_3m = return_between(closes, 63)
    ret_6m = return_between(closes, 126)
    ret_52w = return_between(closes, min(251, len(closes) - 1)) if len(closes) > 2 else None
    rsi14 = simple_rsi(closes, 14)
    history_df = pd.DataFrame(
        [{"High": as_float(row.get("high")), "Low": as_float(row.get("low")), "Close": as_float(row.get("clos"))} for row in daily_rows]
    )
    atr14, atr14_pct = atr_percent(history_df.dropna(subset=["Close"]) if not history_df.empty else history_df, 14)
    distance_52w_high = ((latest_price / year_high) - 1.0) if latest_price and year_high else None

    eps = as_float(detail.get("epsx"))
    bps = as_float(detail.get("bpsx"))
    trailing_pe = first_float(detail.get("perx"), fundamentals.get("trailingPE"))
    price_to_book = first_float(detail.get("pbrx"), fundamentals.get("priceToBook"))
    profit_margin = as_float(fundamentals.get("profitMargins"))
    operating_margin = as_float(fundamentals.get("operatingMargins"))
    revenue_growth = as_float(fundamentals.get("revenueGrowth"))
    earnings_growth = as_float(fundamentals.get("earningsGrowth"))
    debt_to_equity = as_float(fundamentals.get("debtToEquity"))
    current_ratio = as_float(fundamentals.get("currentRatio"))
    quick_ratio = as_float(fundamentals.get("quickRatio"))
    operating_cashflow = as_float(fundamentals.get("operatingCashflow"))
    free_cashflow = as_float(fundamentals.get("freeCashflow"))
    total_revenue = as_float(fundamentals.get("totalRevenue"))
    ocf_margin = (operating_cashflow / total_revenue) if operating_cashflow is not None and total_revenue else None
    fcf_margin = (free_cashflow / total_revenue) if free_cashflow is not None and total_revenue else None
    forward_pe = as_float(fundamentals.get("forwardPE"))
    ev_to_revenue = as_float(fundamentals.get("enterpriseToRevenue"))
    price_to_sales = as_float(fundamentals.get("priceToSalesTrailing12Months"))
    target_mean_price = first_float(fundamentals.get("targetMeanPrice"), fundamentals.get("targetMedianPrice"))
    analyst_count = as_float(fundamentals.get("numberOfAnalystOpinions"))
    recommendation_mean = as_float(fundamentals.get("recommendationMean"))
    beta = as_float(fundamentals.get("beta"))
    listed_shares = as_int(detail.get("shar")) or as_int(search.get("lstg_stck_num"))
    trade_enabled_raw = str(detail.get("e_ordyn") or search.get("lstg_yn") or "")
    trade_enabled = trade_enabled_raw.upper()
    is_trade_enabled = trade_enabled in {"Y", "YES", "1"} or "가능" in trade_enabled_raw
    roe = (eps / bps) if eps is not None and bps not in (None, 0) else None

    profitability = weighted_factor_score(
        [
            (eps_factor_score(eps), 0.6),
            (score_positive_opt(roe, -0.10, 0.25), 1.2),
            (score_positive_opt(profit_margin, -0.05, 0.25), 1.2),
            (score_positive_opt(operating_margin, -0.05, 0.25), 1.0),
            (score_positive_opt(ocf_margin, -0.05, 0.25), 1.0),
        ]
    )
    growth = weighted_factor_score(
        [
            (score_positive_opt(revenue_growth, -0.10, 0.35), 1.3),
            (score_positive_opt(earnings_growth, -0.20, 0.50), 1.2),
            (score_positive_opt(ret_1m, -0.10, 0.15), 0.4),
            (score_positive_opt(ret_6m, -0.25, 0.50), 0.7),
            (score_positive_opt(ret_52w, -0.35, 0.80), 0.7),
        ]
    )
    health = weighted_factor_score(
        [
            (70.0 if is_trade_enabled else 45.0 if not trade_enabled else 25.0, 0.8),
            (score_positive_opt(avg_volume_20, 50_000, 5_000_000), 0.8),
            (score_positive_opt(market_cap, 1_000_000_000, 200_000_000_000), 1.0),
            (score_negative_opt(debt_to_equity, 25.0, 220.0), 0.9),
            (score_positive_opt(current_ratio, 0.8, 2.0), 0.7),
            (score_positive_opt(quick_ratio, 0.7, 1.6), 0.5),
            (score_positive_opt(ocf_margin, -0.05, 0.18), 0.6),
        ]
    )
    momentum = momentum_factor_score(ret_1m, ret_3m, ret_6m, distance_52w_high, latest_price, ma50, ma200, rsi14)
    valuation_base = weighted_factor_score(
        [
            (score_negative_opt(positive_value(trailing_pe), 12.0, 85.0), 0.9),
            (score_negative_opt(positive_value(forward_pe), 10.0, 70.0), 1.2),
            (score_negative_opt(positive_value(price_to_book), 1.5, 25.0), 0.6),
            (score_negative_opt(positive_or(ev_to_revenue, price_to_sales), 2.0, 25.0), 0.8),
        ]
    )
    valuation = guardrailed_valuation(
        quality_adjusted_valuation(valuation_base, profitability, growth),
        profitability=profitability,
        growth=growth,
        forward_pe=forward_pe,
        trailing_pe=trailing_pe,
        ev_to_revenue=ev_to_revenue,
        price_to_sales=price_to_sales,
        operating_margin=operating_margin,
        fcf_margin=fcf_margin,
    )
    score_factors = {
        "profitability": profitability,
        "growth": growth,
        "health": health,
        "momentum": momentum,
        "valuation": valuation,
    }
    total_score, score_confidence = composite_score(score_factors)
    opportunity = opportunity_factor_score(
        market="US",
        latest_price=latest_price,
        ret_1m=ret_1m,
        ret_3m=ret_3m,
        ret_6m=ret_6m,
        ret_52w=ret_52w,
        distance_52w_high=distance_52w_high,
        ma50=ma50,
        ma200=ma200,
        rsi14=rsi14,
        atr14_pct=atr14_pct,
        avg_volume_20=avg_volume_20,
        avg_volume_60=avg_volume_60,
        market_cap=market_cap,
        revenue_growth=revenue_growth,
        earnings_growth=earnings_growth,
        target_mean_price=target_mean_price,
        analyst_count=analyst_count,
        recommendation_mean=recommendation_mean,
        forward_pe=forward_pe,
        operating_margin=operating_margin,
        cashflow_margin=fcf_margin if fcf_margin is not None else ocf_margin,
        ev_to_revenue=ev_to_revenue,
        price_to_sales=price_to_sales,
        beta=beta,
    )
    opportunity_components = opportunity_components_for(
        opportunity,
        latest_price=latest_price,
        target_mean_price=target_mean_price,
        analyst_count=analyst_count,
        recommendation_mean=recommendation_mean,
        avg_volume_20=avg_volume_20,
        avg_volume_60=avg_volume_60,
        atr14_pct=atr14_pct,
        beta=beta,
    )
    profitability_score = profitability.score
    growth_score = growth.score
    health_score = health.score
    momentum_score = momentum.score
    valuation_score = valuation.score

    components = [
        {
            "key": "profitability",
            "label": "이익성",
            "short": "익",
            "score": round(profitability_score, 1),
            "summary": "EPS와 BPS 기준으로 이익이 실제로 남는지 봐요.",
            "metrics": [
                {"label": "EPS", "value": f"{eps:.2f}" if eps is not None else "-"},
                {"label": "BPS", "value": f"{bps:.2f}" if bps is not None else "-"},
                {"label": "ROE 추정", "value": pct(roe)},
                {"label": "순이익률", "value": pct(profit_margin)},
            ],
        },
        {
            "key": "growth",
            "label": "성장 흐름",
            "short": "성",
            "score": round(growth_score, 1),
            "summary": "최근 가격 흐름이 얼마나 좋아졌는지 봐요.",
            "metrics": [
                {"label": "1개월 수익률", "value": pct(ret_1m)},
                {"label": "매출 성장률", "value": pct(revenue_growth)},
                {"label": "6개월 수익률", "value": pct(ret_6m)},
                {"label": "52주 수익률", "value": pct(ret_52w)},
            ],
        },
        {
            "key": "health",
            "label": "거래 안정성",
            "short": "안",
            "score": round(health_score, 1),
            "summary": "거래 가능 여부, 거래량, 시가총액으로 거래 체력을 봐요.",
            "metrics": [
                {"label": "거래가능여부", "value": trade_enabled or "-"},
                {"label": "부채/자본", "value": f"{debt_to_equity:.1f}%" if debt_to_equity is not None else "-"},
                {"label": "유동비율", "value": f"{current_ratio:.2f}" if current_ratio is not None else "-"},
                {"label": "20일 평균 거래량", "value": num_label(as_int(avg_volume_20), "주")},
                {"label": "시가총액", "value": labeled_money(market_cap, currency, usd_krw)},
            ],
        },
        {
            "key": "momentum",
            "label": "모멘텀",
            "short": "모",
            "score": round(momentum_score, 1),
            "summary": "최근 수익률, 52주 고점 거리, 이동평균 위치를 함께 봐요.",
            "metrics": [
                {"label": "1개월 수익률", "value": pct(ret_1m)},
                {"label": "3개월 수익률", "value": pct(ret_3m)},
                {"label": "52주 고점 거리", "value": pct(distance_52w_high)},
            ],
        },
        {
            "key": "valuation",
            "label": "밸류에이션",
            "short": "밸",
            "score": round(valuation_score, 1),
            "summary": "PER과 PBR로 가격 부담을 보수적으로 봐요.",
            "metrics": [
                {"label": "PER", "value": f"{trailing_pe:.2f}" if trailing_pe is not None and trailing_pe > 0 else "-"},
                {"label": "Forward PER", "value": f"{forward_pe:.2f}" if forward_pe is not None and forward_pe > 0 else "-"},
                {"label": "PBR", "value": f"{price_to_book:.2f}" if price_to_book is not None else "-"},
                {"label": "시가총액", "value": labeled_money(market_cap, currency, usd_krw)},
            ],
        },
    ]

    grade = grade_for(total_score)
    signal = signal_for(total_score, rsi14, ret_3m)
    strongest = max(components, key=lambda item: item["score"])
    weakest = min(components, key=lambda item: item["score"])

    chart_patterns = [
        {
            "name": "추세 정렬",
            "status": "우호" if latest_price and ma50 and ma200 and latest_price > ma50 > ma200 else "확인 필요",
            "evidence": f"가격 {price_label(latest_price, currency)} · MA50 {price_label(ma50, currency)} · MA200 {price_label(ma200, currency)}",
            "interpretation": "현재가가 주요 이동평균 위에 있으면 중기 추세가 우호적으로 보여요.",
        },
        {
            "name": "52주 위치",
            "status": "고점 근접" if distance_52w_high is not None and distance_52w_high > -0.1 else "중간권",
            "evidence": f"52주 고점 거리 {pct(distance_52w_high)}",
            "interpretation": "0%에 가까울수록 신고가권에 가까워서 추세와 부담을 같이 봐야 해요.",
        },
        {
            "name": "단기 변동성",
            "status": "높음" if atr14_pct is not None and atr14_pct > 0.05 else "보통",
            "evidence": f"ATR14 {pct(atr14_pct)} · RSI14 {rsi14:.1f}" if rsi14 is not None else f"ATR14 {pct(atr14_pct)}",
            "interpretation": "ATR 비중이 높을수록 단기 가격 변동이 커서 보수적으로 봐야 해요.",
        },
    ]

    key_metrics = [
        {"label": "현재가", "value": labeled_money(latest_price, currency, usd_krw)},
        {"label": "전일 대비", "value": pct(latest_change)},
        {"label": "거래량", "value": num_label(volume, "주")},
        {"label": "20일 평균 거래량", "value": num_label(as_int(avg_volume_20), "주")},
        {"label": "시가총액", "value": labeled_money(market_cap, currency, usd_krw)},
        {"label": "1개월 수익률", "value": pct(ret_1m)},
        {"label": "3개월 수익률", "value": pct(ret_3m)},
        {"label": "6개월 수익률", "value": pct(ret_6m)},
        {"label": "52주 수익률", "value": pct(ret_52w)},
        {"label": "ATR14", "value": pct(atr14_pct)},
        {"label": "PER", "value": f"{trailing_pe:.2f}" if trailing_pe is not None and trailing_pe > 0 else "-"},
        {"label": "Forward PER", "value": f"{forward_pe:.2f}" if forward_pe is not None and forward_pe > 0 else "-"},
        {"label": "PBR", "value": f"{price_to_book:.2f}" if price_to_book is not None else "-"},
        {"label": "기회 점수", "value": f"{opportunity.score:.1f}점"},
        {"label": "점수 신호", "value": signal},
    ]

    stock_profile = [
        {"label": "회사명", "value": name},
        {"label": "티커", "value": symbol},
        {"label": "거래소", "value": exchange},
        {"label": "상품유형코드", "value": market["product_type"]},
        {"label": "통화", "value": currency},
        {"label": "환율 기준", "value": f"$1 = 약 {usd_krw:,.2f}원" if usd_krw else "-"},
        {"label": "최근 가격일", "value": latest_date},
        {"label": "52주 고가", "value": labeled_money(year_high, currency, usd_krw)},
        {"label": "52주 저가", "value": labeled_money(year_low, currency, usd_krw)},
        {"label": "상장주식수", "value": num_label(listed_shares, "주")},
        {"label": "상장일자", "value": kis_date(search.get("lstg_dt")) or "-"},
    ]

    valuation_rows = [
        {"label": "PER", "value": f"{trailing_pe:.2f}" if trailing_pe is not None and trailing_pe > 0 else "-"},
        {"label": "Forward PER", "value": f"{forward_pe:.2f}" if forward_pe is not None and forward_pe > 0 else "-", "note": "yfinance"},
        {"label": "PBR", "value": f"{price_to_book:.2f}" if price_to_book is not None else "-"},
        {"label": "EV/Revenue", "value": f"{ev_to_revenue:.2f}" if ev_to_revenue is not None else "-", "note": "yfinance"},
        {"label": "Price/Sales", "value": f"{price_to_sales:.2f}" if price_to_sales is not None else "-", "note": "yfinance"},
        {"label": "평균 목표가", "value": price_label(target_mean_price, currency), "note": "yfinance"},
        {"label": "EPS", "value": f"{eps:.2f}" if eps is not None else "-"},
        {"label": "BPS", "value": f"{bps:.2f}" if bps is not None else "-"},
        {"label": "시가총액", "value": labeled_money(market_cap, currency, usd_krw)},
    ]

    price_metrics = {
        "price": latest_price,
        "previous_close": previous_close,
        "latest_change": latest_change,
        "return_1m": ret_1m,
        "return_3m": ret_3m,
        "return_6m": ret_6m,
        "return_52w": ret_52w,
        "distance_from_52w_high": distance_52w_high,
        "high_52w": year_high,
        "low_52w": year_low,
        "sma50": ma50,
        "sma200": ma200,
        "rsi14": rsi14,
        "atr14": atr14,
        "atr14_pct": atr14_pct,
        "avg_volume_20": avg_volume_20,
        "avg_volume_60": avg_volume_60,
    }
    financials = {
        "profitMargins": profit_margin,
        "operatingMargins": operating_margin,
        "returnOnEquity": roe,
        "revenueGrowth": revenue_growth,
        "earningsGrowth": earnings_growth,
        "totalRevenue": total_revenue,
        "operatingCashflow": operating_cashflow,
        "debtToEquity": debt_to_equity,
        "currentRatio": current_ratio,
        "quickRatio": quick_ratio,
        "targetMeanPrice": target_mean_price,
        "numberOfAnalystOpinions": analyst_count,
        "recommendationMean": recommendation_mean,
        "beta": beta,
        "eps": eps,
        "bps": bps,
        "listedShares": listed_shares,
    }
    financial_statement: dict[str, Any] = {
        "price_detail": {key: finite_or_none(value) for key, value in detail.items()},
        "product_info": {key: finite_or_none(value) for key, value in search.items()},
        "yfinance_fundamentals": {
            "cache": fundamentals_cache,
            "fields": {key: finite_or_none(value) for key, value in fundamentals.items()},
        },
    }

    chart_series = kis_chart_series(daily_rows, currency, usd_krw)
    news = [] if is_compare_view else kis_news(symbol, excd)
    summary = (
        f"{symbol}은 품질 점수 {total_score:.1f}/100점, 기회 점수 {opportunity.score:.1f}/100점이에요. "
        f"가장 강한 항목은 {strongest['label']}({strongest['score']:.1f})이고, 먼저 확인할 항목은 {weakest['label']}({weakest['score']:.1f})이에요. "
        f"{exchange} 상장 주식 기준으로 현재가, 가격 흐름, 회사정보, 뉴스를 함께 봤어요."
    )

    now = datetime.now(timezone.utc)
    return {
        "ok": True,
        "app": "Stock Score Reader",
        "requested_ticker": raw_ticker,
        "market": "US",
        "symbol": symbol,
        "name": name,
        "exchange": exchange,
        "currency": currency,
        "score_model_version": SCORE_MODEL_VERSION,
        "score": total_score,
        "quality_score": total_score,
        "quality_grade": grade,
        "opportunity_score": opportunity.score,
        "opportunity_grade": grade_for(opportunity.score),
        "opportunity_confidence": round(opportunity.confidence, 3),
        "grade": grade,
        "summary": summary,
        "latest_price": latest_price,
        "latest_bar_date": latest_date,
        "evaluation_label": f"{now.astimezone().strftime('%Y-%m-%d %H:%M:%S')} 조회",
        "evaluation_ts": int(now.timestamp()),
        "data_quality": "정상",
        "usd_krw_rate": usd_krw,
        "usd_krw_label": f"$1 = 약 {usd_krw:,.2f}원" if usd_krw else None,
        "components": components,
        "opportunity_components": opportunity_components,
        "key_metrics": key_metrics,
        "stock_profile": [] if is_compare_view else stock_profile,
        "valuation_rows": valuation_rows,
        "chart_patterns": [] if is_compare_view else chart_patterns,
        "chart_series": chart_series,
        "intraday_series": [],
        "history": top_like_current(symbol, name, latest_price, currency, total_score, components),
        "top_scores": top_like_current(symbol, name, latest_price, currency, total_score, components),
        "news": news,
        "price_metrics": price_metrics,
        "financials": financials,
        "financial_statement": financial_statement,
        "sia_snapshot": {
            "symbol": symbol,
            "price": latest_price,
            "raw_signal": signal,
            "risk_level": "HIGH" if atr14_pct is not None and atr14_pct > 0.06 else "MEDIUM" if atr14_pct is not None and atr14_pct > 0.03 else "LOW",
            "score_model_version": SCORE_MODEL_VERSION,
            "confidence": round(score_confidence, 3),
            "quality_score": round(total_score / 100.0, 3),
            "opportunity_score": round(opportunity.score / 100.0, 3),
            "opportunity_confidence": round(opportunity.confidence, 3),
            "spot_score": round(total_score / 100.0, 3),
            "chart_score": round(momentum_score / 100.0, 3),
            "trend_score": round(score_positive(ret_3m, -0.20, 0.35) / 100.0, 3),
            "momentum_score": round(momentum_score / 100.0, 3),
            "momentum_label": "UP" if ret_3m is not None and ret_3m > 0 else "DOWN" if ret_3m is not None and ret_3m < 0 else "FLAT",
            "signal_source": "market-data:overseas-stock+yfinance-fundamentals",
            "bar_ts": latest_date,
            "indicators": {
                "sma50": ma50,
                "sma200": ma200,
                "rsi14": rsi14,
                "atr14": atr14,
                "atr14_pct": atr14_pct,
            },
            "reasons": {
                "profitability_score": round(profitability_score / 100.0, 3),
                "growth_score": round(growth_score / 100.0, 3),
                "health_score": round(health_score / 100.0, 3),
                "momentum_score": round(momentum_score / 100.0, 3),
                "valuation_score": round(valuation_score / 100.0, 3),
                "opportunity_score": round(opportunity.score / 100.0, 3),
            },
        },
        "fetch": {
            "source": "market_data+yfinance_fundamentals",
            "score_model_version": SCORE_MODEL_VERSION,
            "price_endpoint": "/uapi/overseas-price/v1/quotations/price",
            "price_detail_endpoint": "/uapi/overseas-price/v1/quotations/price-detail",
            "dailyprice_endpoint": "/uapi/overseas-price/v1/quotations/dailyprice",
            "search_info_endpoint": "/uapi/overseas-price/v1/quotations/search-info",
            "news_endpoint": "/uapi/overseas-price/v1/quotations/news-title",
            "fetched_at": now.isoformat(),
            "cache": "no-store",
            "fundamentals_cache": fundamentals_cache,
            "fundamentals_source": "yfinance",
            "input_mode": "exact_ticker_only",
            "market_scope": "US listed equity",
            "exchange_code": excd,
            "history_rows": len(daily_rows),
        },
    }


def fetch_quote_kis_domestic(raw_ticker: str) -> dict[str, Any]:
    symbol = clean_ticker(raw_ticker)
    if not symbol or not KR_TICKER_RE.match(symbol):
        return {"ok": False, "status": 400, "error": "invalid_ticker", "message": "Invalid KR ticker."}

    try:
        price = kis_domestic_price(symbol, KIS_DOMESTIC_QUOTE_MARKET_DIV_CODE)
    except KisApiError as exc:
        return kis_error_payload(exc)

    now = datetime.now(timezone.utc)
    latest_price = as_float(price.get("stck_prpr"))
    previous_close = as_float(price.get("stck_sdpr")) or as_float(price.get("stck_prdy_clpr"))
    latest_change = kis_percent(price.get("prdy_ctrt")) or (((latest_price / previous_close) - 1.0) if latest_price and previous_close else None)
    volume = as_int(price.get("acml_vol"))
    name = str(price.get("hts_kor_isnm") or price.get("prdt_abrv_name") or symbol)
    latest_date = kis_date(price.get("stck_bsop_date")) or datetime.now(timezone(timedelta(hours=9))).date().isoformat()

    return {
        "ok": True,
        "type": "quote",
        "requested_ticker": f"KR:{symbol}",
        "market": "KR",
        "symbol": symbol,
        "name": name,
        "exchange": "KRX/NXT",
        "currency": "KRW",
        "latest_price": latest_price,
        "latest_price_label": price_label(latest_price, "KRW"),
        "latest_bar_date": latest_date,
        "previous_close": previous_close,
        "latest_change": latest_change,
        "latest_change_label": pct(latest_change),
        "volume": volume,
        "volume_label": num_label(volume),
        "price_metrics": {
            "price": latest_price,
            "previous_close": previous_close,
            "latest_change": latest_change,
            "volume": volume,
        },
        "fetch": {
            "source": "market_data",
            "price_endpoint": "/uapi/domestic-stock/v1/quotations/inquire-price",
            "market_div_code": KIS_DOMESTIC_QUOTE_MARKET_DIV_CODE,
            "fetched_at": now.isoformat(),
            "cache": "server",
        },
    }


def fetch_quote_kis_us(raw_ticker: str) -> dict[str, Any]:
    symbol = clean_ticker(raw_ticker)
    if not symbol or not TICKER_RE.match(symbol):
        return {"ok": False, "status": 400, "error": "invalid_ticker", "message": "Invalid US ticker."}

    try:
        discovered = discover_kis_stock(symbol)
    except KisApiError as exc:
        return kis_error_payload(exc)

    now = datetime.now(timezone.utc)
    market = discovered["market"]
    detail = discovered["detail"]
    search = discovered["search"]
    currency = str(detail.get("curr") or search.get("tr_crcy_cd") or "USD")
    usd_krw = as_float(detail.get("t_rate")) if currency == "USD" else None
    latest_price = as_float(detail.get("last")) or as_float(search.get("ovrs_now_pric1"))
    previous_close = as_float(detail.get("base"))
    latest_change = kis_percent(detail.get("rate")) or (((latest_price / previous_close) - 1.0) if latest_price and previous_close else None)
    volume = as_int(detail.get("tvol"))
    name = str(search.get("prdt_eng_name") or search.get("ovrs_item_name") or search.get("prdt_name") or symbol)
    exchange = str(search.get("ovrs_excg_name") or market["label"])
    latest_date = kis_date(detail.get("xymd")) or now.date().isoformat()

    return {
        "ok": True,
        "type": "quote",
        "requested_ticker": f"US:{symbol}",
        "market": "US",
        "symbol": symbol,
        "name": name,
        "exchange": exchange,
        "exchange_code": market["excd"],
        "currency": currency,
        "usd_krw_rate": usd_krw,
        "usd_krw_label": f"$1 = {price_label(usd_krw, 'KRW')}" if usd_krw else None,
        "latest_price": latest_price,
        "latest_price_label": labeled_money(latest_price, currency, usd_krw),
        "latest_bar_date": latest_date,
        "previous_close": previous_close,
        "latest_change": latest_change,
        "latest_change_label": pct(latest_change),
        "volume": volume,
        "volume_label": num_label(volume),
        "price_metrics": {
            "price": latest_price,
            "previous_close": previous_close,
            "latest_change": latest_change,
            "volume": volume,
        },
        "fetch": {
            "source": "market_data",
            "price_detail_endpoint": "/uapi/overseas-price/v1/quotations/price-detail",
            "search_info_endpoint": "/uapi/overseas-price/v1/quotations/search-info",
            "exchange_code": market["excd"],
            "fetched_at": now.isoformat(),
            "cache": "server",
        },
    }


def fetch_quote(raw_ticker: str) -> dict[str, Any]:
    market, symbol = parse_symbol_ref(raw_ticker)
    if market == "KR":
        return fetch_quote_kis_domestic(symbol)
    return fetch_quote_kis_us(symbol)


def fetch_score_kis_domestic(raw_ticker: str, view: str = "detail", usd_krw_override: float | None = None, use_rate_override: bool = False) -> dict[str, Any]:
    symbol = clean_ticker(raw_ticker)
    if not symbol or not KR_TICKER_RE.match(symbol):
        return {"ok": False, "status": 400, "error": "invalid_ticker", "message": "정확한 국내 주식 종목코드만 입력하세요."}

    try:
        price = kis_domestic_price(symbol, KIS_DOMESTIC_SCORE_MARKET_DIV_CODE)
    except KisApiError as exc:
        return kis_error_payload(exc)

    is_compare_view = view == "compare"
    try:
        daily_rows = kis_domestic_daily_rows(symbol)
    except Exception:
        daily_rows = []
    try:
        search = kis_domestic_search_info(symbol)
    except Exception:
        search = {}
    try:
        stock_info = kis_domestic_stock_info(symbol)
    except Exception:
        stock_info = {}

    currency = "KRW"
    closes = [float(row["stck_clpr"]) for row in daily_rows if as_float(row.get("stck_clpr")) is not None]
    latest_history_close = closes[-1] if closes else None
    latest_price = as_float(price.get("stck_prpr")) or latest_history_close
    previous_close = as_float(price.get("stck_sdpr")) or (closes[-2] if len(closes) >= 2 else None)
    latest_change = kis_percent(price.get("prdy_ctrt")) or (((latest_price / previous_close) - 1.0) if latest_price and previous_close else None)

    name = str(
        stock_info.get("prdt_abrv_name")
        or search.get("prdt_abrv_name")
        or stock_info.get("prdt_name")
        or search.get("prdt_name")
        or symbol
    )
    english_name = str(stock_info.get("prdt_eng_name") or search.get("prdt_eng_name") or "")
    exchange = domestic_exchange_name(stock_info)
    yahoo_symbol = domestic_yfinance_symbol(symbol, exchange)
    fundamentals, fundamentals_cache = yfinance_fundamentals(yahoo_symbol, market="KR")
    latest_date = kis_date(daily_rows[-1].get("stck_bsop_date")) if daily_rows else datetime.now(timezone.utc).date().isoformat()
    listed_shares = as_int(price.get("lstn_stcn")) or as_int(stock_info.get("lstg_stqt"))
    market_cap_raw = as_float(price.get("hts_avls"))
    market_cap = market_cap_raw * 100_000_000 if market_cap_raw is not None else (latest_price * listed_shares if latest_price and listed_shares else None)
    volume = as_int(price.get("acml_vol"))
    avg_volume_20 = average([as_float(row.get("acml_vol")) for row in daily_rows[-20:]]) if daily_rows else None
    avg_volume_60 = average([as_float(row.get("acml_vol")) for row in daily_rows[-60:]]) if daily_rows else None
    year_high = as_float(price.get("w52_hgpr")) or (max(closes[-252:]) if closes else None)
    year_low = as_float(price.get("w52_lwpr")) or (min(closes[-252:]) if closes else None)
    ma50 = sum(closes[-50:]) / 50 if len(closes) >= 50 else None
    ma200 = sum(closes[-200:]) / 200 if len(closes) >= 200 else None
    ret_1m = return_between(closes, 21)
    ret_3m = return_between(closes, 63)
    ret_6m = return_between(closes, 126)
    ret_52w = return_between(closes, min(251, len(closes) - 1)) if len(closes) > 2 else None
    rsi14 = simple_rsi(closes, 14)
    history_df = pd.DataFrame(
        [{"High": as_float(row.get("stck_hgpr")), "Low": as_float(row.get("stck_lwpr")), "Close": as_float(row.get("stck_clpr"))} for row in daily_rows]
    )
    atr14, atr14_pct = atr_percent(history_df.dropna(subset=["Close"]) if not history_df.empty else history_df, 14)
    distance_52w_high = ((latest_price / year_high) - 1.0) if latest_price and year_high else None

    eps = as_float(price.get("eps"))
    bps = as_float(price.get("bps"))
    trailing_pe = first_float(price.get("per"), fundamentals.get("trailingPE"))
    price_to_book = first_float(price.get("pbr"), fundamentals.get("priceToBook"))
    forward_pe = as_float(fundamentals.get("forwardPE"))
    ev_to_revenue = as_float(fundamentals.get("enterpriseToRevenue"))
    price_to_sales = as_float(fundamentals.get("priceToSalesTrailing12Months"))
    target_mean_price = first_float(fundamentals.get("targetMeanPrice"), fundamentals.get("targetMedianPrice"))
    analyst_count = as_float(fundamentals.get("numberOfAnalystOpinions"))
    recommendation_mean = as_float(fundamentals.get("recommendationMean"))
    beta = as_float(fundamentals.get("beta"))
    profit_margin = as_float(fundamentals.get("profitMargins"))
    operating_margin = as_float(fundamentals.get("operatingMargins"))
    revenue_growth = as_float(fundamentals.get("revenueGrowth"))
    earnings_growth = as_float(fundamentals.get("earningsGrowth"))
    total_revenue = as_float(fundamentals.get("totalRevenue"))
    operating_cashflow = as_float(fundamentals.get("operatingCashflow"))
    free_cashflow = as_float(fundamentals.get("freeCashflow"))
    total_cash = as_float(fundamentals.get("totalCash"))
    total_debt = as_float(fundamentals.get("totalDebt"))
    debt_to_equity = as_float(fundamentals.get("debtToEquity"))
    current_ratio = as_float(fundamentals.get("currentRatio"))
    quick_ratio = as_float(fundamentals.get("quickRatio"))
    ocf_margin = operating_cashflow / total_revenue if operating_cashflow is not None and total_revenue else None
    fcf_margin = free_cashflow / total_revenue if free_cashflow is not None and total_revenue else None
    roe_raw = as_float(stock_info.get("roe"))
    if roe_raw is not None and abs(roe_raw) > 1:
        roe_raw = roe_raw / 100.0
    yfinance_roe = as_float(fundamentals.get("returnOnEquity"))
    roe = (eps / bps) if eps is not None and bps not in (None, 0) else roe_raw if roe_raw is not None else yfinance_roe
    ev_or_sales = positive_or(ev_to_revenue, price_to_sales)
    halted = str(price.get("temp_stop_yn") or stock_info.get("tr_stop_yn") or "").upper() == "Y"
    managed = str(price.get("mang_issu_cls_code") or stock_info.get("admn_item_yn") or "").upper() == "Y"
    is_trade_enabled = not halted and not managed

    profitability = weighted_factor_score(
        [
            (eps_factor_score(eps), 0.6),
            (score_positive_opt(roe, -0.10, 0.25), 1.2),
            (score_positive_opt(profit_margin, -0.05, 0.25), 0.9),
            (score_positive_opt(operating_margin, -0.05, 0.25), 0.8),
            (score_positive_opt(ocf_margin, -0.05, 0.25), 0.8),
        ]
    )
    growth = weighted_factor_score(
        [
            (score_positive_opt(revenue_growth, -0.10, 0.35), 1.1),
            (score_positive_opt(earnings_growth, -0.20, 0.50), 1.0),
            (score_positive_opt(ret_1m, -0.10, 0.15), 0.5),
            (score_positive_opt(ret_6m, -0.25, 0.50), 0.8),
            (score_positive_opt(ret_52w, -0.35, 0.80), 0.8),
        ]
    )
    health = weighted_factor_score(
        [
            (72.0 if is_trade_enabled else 25.0, 0.8),
            (score_positive_opt(avg_volume_20, 20_000, 5_000_000), 0.8),
            (score_positive_opt(market_cap, 50_000_000_000, 50_000_000_000_000), 1.0),
            (score_negative_opt(debt_to_equity, 25.0, 220.0), 0.7),
            (score_positive_opt(current_ratio, 0.8, 2.0), 0.5),
            (score_positive_opt(quick_ratio, 0.7, 1.6), 0.4),
            (score_positive_opt(ocf_margin, -0.05, 0.18), 0.5),
            (score_positive_opt(fcf_margin, -0.08, 0.12), 0.4),
        ]
    )
    momentum = momentum_factor_score(ret_1m, ret_3m, ret_6m, distance_52w_high, latest_price, ma50, ma200, rsi14)
    valuation_base = weighted_factor_score(
        [
            (score_negative_opt(positive_value(trailing_pe), 8.0, 60.0), 1.0),
            (score_negative_opt(positive_value(forward_pe), 8.0, 50.0), 0.9),
            (score_negative_opt(positive_value(price_to_book), 0.8, 8.0), 0.8),
            (score_negative_opt(positive_value(ev_or_sales), 1.5, 15.0), 0.6),
        ]
    )
    valuation = guardrailed_valuation(
        quality_adjusted_valuation(valuation_base, profitability, growth),
        profitability=profitability,
        growth=growth,
        forward_pe=forward_pe,
        trailing_pe=trailing_pe,
        ev_to_revenue=ev_to_revenue,
        price_to_sales=price_to_sales,
        operating_margin=operating_margin,
        fcf_margin=fcf_margin,
    )
    score_factors = {
        "profitability": profitability,
        "growth": growth,
        "health": health,
        "momentum": momentum,
        "valuation": valuation,
    }
    total_score, score_confidence = composite_score(score_factors)
    opportunity = opportunity_factor_score(
        market="KR",
        latest_price=latest_price,
        ret_1m=ret_1m,
        ret_3m=ret_3m,
        ret_6m=ret_6m,
        ret_52w=ret_52w,
        distance_52w_high=distance_52w_high,
        ma50=ma50,
        ma200=ma200,
        rsi14=rsi14,
        atr14_pct=atr14_pct,
        avg_volume_20=avg_volume_20,
        avg_volume_60=avg_volume_60,
        market_cap=market_cap,
        revenue_growth=revenue_growth,
        earnings_growth=earnings_growth,
        target_mean_price=target_mean_price,
        analyst_count=analyst_count,
        recommendation_mean=recommendation_mean,
        forward_pe=forward_pe,
        operating_margin=operating_margin,
        cashflow_margin=fcf_margin if fcf_margin is not None else ocf_margin,
        ev_to_revenue=ev_to_revenue,
        price_to_sales=price_to_sales,
        beta=beta,
    )
    opportunity_components = opportunity_components_for(
        opportunity,
        latest_price=latest_price,
        target_mean_price=target_mean_price,
        analyst_count=analyst_count,
        recommendation_mean=recommendation_mean,
        avg_volume_20=avg_volume_20,
        avg_volume_60=avg_volume_60,
        atr14_pct=atr14_pct,
        beta=beta,
    )
    profitability_score = profitability.score
    growth_score = growth.score
    health_score = health.score
    momentum_score = momentum.score
    valuation_score = valuation.score

    components = [
        {
            "key": "profitability",
            "label": "이익성",
            "short": "익",
            "score": round(profitability_score, 1),
            "summary": "EPS, ROE, 이익률, 영업현금흐름으로 이익의 질을 봐요.",
            "metrics": [
                {"label": "EPS", "value": f"{eps:.0f}" if eps is not None else "-"},
                {"label": "ROE 추정", "value": pct(roe)},
                {"label": "순이익률", "value": pct(profit_margin)},
                {"label": "영업이익률", "value": pct(operating_margin)},
                {"label": "OCF 마진", "value": pct(ocf_margin)},
            ],
        },
        {
            "key": "growth",
            "label": "성장 흐름",
            "short": "성",
            "score": round(growth_score, 1),
            "summary": "매출·이익 성장과 중기 가격 흐름을 함께 봐요.",
            "metrics": [
                {"label": "매출 성장률", "value": pct(revenue_growth)},
                {"label": "이익 성장률", "value": pct(earnings_growth)},
                {"label": "6개월 수익률", "value": pct(ret_6m)},
                {"label": "52주 수익률", "value": pct(ret_52w)},
            ],
        },
        {
            "key": "health",
            "label": "거래 안정성",
            "short": "안",
            "score": round(health_score, 1),
            "summary": "거래 상태, 유동성, 규모, 부채와 현금흐름 체력을 봐요.",
            "metrics": [
                {"label": "거래상태", "value": "정상" if is_trade_enabled else "확인 필요"},
                {"label": "20일 평균 거래량", "value": num_label(as_int(avg_volume_20), "주")},
                {"label": "시가총액", "value": labeled_money(market_cap, currency, None)},
                {"label": "부채/자본", "value": f"{debt_to_equity:.1f}" if debt_to_equity is not None else "-"},
                {"label": "유동비율", "value": f"{current_ratio:.2f}" if current_ratio is not None else "-"},
                {"label": "FCF 마진", "value": pct(fcf_margin)},
            ],
        },
        {
            "key": "momentum",
            "label": "모멘텀",
            "short": "모",
            "score": round(momentum_score, 1),
            "summary": "최근 수익률, 52주 고점 거리, 이동평균 위치를 함께 봐요.",
            "metrics": [
                {"label": "1개월 수익률", "value": pct(ret_1m)},
                {"label": "3개월 수익률", "value": pct(ret_3m)},
                {"label": "52주 고점 거리", "value": pct(distance_52w_high)},
            ],
        },
        {
            "key": "valuation",
            "label": "밸류에이션",
            "short": "밸",
            "score": round(valuation_score, 1),
            "summary": "PER, Forward PER, PBR, 매출 대비 기업가치로 가격 부담을 봐요.",
            "metrics": [
                {"label": "PER", "value": f"{trailing_pe:.2f}" if trailing_pe is not None and trailing_pe > 0 else "-"},
                {"label": "Forward PER", "value": f"{forward_pe:.2f}" if forward_pe is not None and forward_pe > 0 else "-"},
                {"label": "PBR", "value": f"{price_to_book:.2f}" if price_to_book is not None else "-"},
                {"label": "EV/Revenue", "value": f"{ev_to_revenue:.2f}" if ev_to_revenue is not None and ev_to_revenue > 0 else "-"},
                {"label": "P/S", "value": f"{price_to_sales:.2f}" if price_to_sales is not None and price_to_sales > 0 else "-"},
            ],
        },
    ]

    grade = grade_for(total_score)
    signal = signal_for(total_score, rsi14, ret_3m)
    strongest = max(components, key=lambda item: item["score"])
    weakest = min(components, key=lambda item: item["score"])

    chart_patterns = [
        {
            "name": "추세 정렬",
            "status": "우호" if latest_price and ma50 and ma200 and latest_price > ma50 > ma200 else "확인 필요",
            "evidence": f"가격 {price_label(latest_price, currency)} · MA50 {price_label(ma50, currency)} · MA200 {price_label(ma200, currency)}",
            "interpretation": "현재가가 주요 이동평균 위에 있으면 중기 추세가 우호적으로 보여요.",
        },
        {
            "name": "52주 위치",
            "status": "고점 근접" if distance_52w_high is not None and distance_52w_high > -0.1 else "중간권",
            "evidence": f"52주 고점 거리 {pct(distance_52w_high)}",
            "interpretation": "0%에 가까울수록 신고가권에 가까워서 추세와 부담을 같이 봐야 해요.",
        },
        {
            "name": "단기 변동성",
            "status": "높음" if atr14_pct is not None and atr14_pct > 0.05 else "보통",
            "evidence": f"ATR14 {pct(atr14_pct)} · RSI14 {rsi14:.1f}" if rsi14 is not None else f"ATR14 {pct(atr14_pct)}",
            "interpretation": "ATR 비중이 높을수록 단기 가격 변동이 커서 보수적으로 봐야 해요.",
        },
    ]

    key_metrics = [
        {"label": "현재가", "value": price_label(latest_price, currency)},
        {"label": "전일 대비", "value": pct(latest_change)},
        {"label": "거래량", "value": num_label(volume, "주")},
        {"label": "20일 평균 거래량", "value": num_label(as_int(avg_volume_20), "주")},
        {"label": "시가총액", "value": labeled_money(market_cap, currency, None)},
        {"label": "1개월 수익률", "value": pct(ret_1m)},
        {"label": "3개월 수익률", "value": pct(ret_3m)},
        {"label": "6개월 수익률", "value": pct(ret_6m)},
        {"label": "52주 수익률", "value": pct(ret_52w)},
        {"label": "ATR14", "value": pct(atr14_pct)},
        {"label": "PER", "value": f"{trailing_pe:.2f}" if trailing_pe is not None and trailing_pe > 0 else "-"},
        {"label": "Forward PER", "value": f"{forward_pe:.2f}" if forward_pe is not None and forward_pe > 0 else "-"},
        {"label": "PBR", "value": f"{price_to_book:.2f}" if price_to_book is not None else "-"},
        {"label": "순이익률", "value": pct(profit_margin)},
        {"label": "매출 성장률", "value": pct(revenue_growth)},
        {"label": "기회 점수", "value": f"{opportunity.score:.1f}점"},
        {"label": "점수 신호", "value": signal},
    ]

    stock_profile = [
        {"label": "회사명", "value": name},
        {"label": "영문명", "value": english_name or "-"},
        {"label": "종목코드", "value": symbol},
        {"label": "거래소", "value": exchange},
        {"label": "상품유형코드", "value": "300"},
        {"label": "통화", "value": currency},
        {"label": "최근 가격일", "value": latest_date},
        {"label": "52주 고가", "value": price_label(year_high, currency)},
        {"label": "52주 저가", "value": price_label(year_low, currency)},
        {"label": "상장주식수", "value": num_label(listed_shares, "주")},
        {"label": "상장일자", "value": kis_date(stock_info.get("scts_mket_lstg_dt") or stock_info.get("kosdaq_mket_lstg_dt") or stock_info.get("frbd_mket_lstg_dt")) or "-"},
    ]

    valuation_rows = [
        {"label": "PER", "value": f"{trailing_pe:.2f}" if trailing_pe is not None and trailing_pe > 0 else "-"},
        {"label": "Forward PER", "value": f"{forward_pe:.2f}" if forward_pe is not None and forward_pe > 0 else "-"},
        {"label": "PBR", "value": f"{price_to_book:.2f}" if price_to_book is not None else "-"},
        {"label": "EV/Revenue", "value": f"{ev_to_revenue:.2f}" if ev_to_revenue is not None and ev_to_revenue > 0 else "-"},
        {"label": "P/S", "value": f"{price_to_sales:.2f}" if price_to_sales is not None and price_to_sales > 0 else "-"},
        {"label": "평균 목표가", "value": price_label(target_mean_price, currency), "note": "yfinance"},
        {"label": "EPS", "value": f"{eps:.0f}" if eps is not None else "-"},
        {"label": "BPS", "value": f"{bps:.0f}" if bps is not None else "-"},
        {"label": "시가총액", "value": labeled_money(market_cap, currency, None)},
    ]

    price_metrics = {
        "price": latest_price,
        "previous_close": previous_close,
        "latest_change": latest_change,
        "return_1m": ret_1m,
        "return_3m": ret_3m,
        "return_6m": ret_6m,
        "return_52w": ret_52w,
        "distance_from_52w_high": distance_52w_high,
        "high_52w": year_high,
        "low_52w": year_low,
        "sma50": ma50,
        "sma200": ma200,
        "rsi14": rsi14,
        "atr14": atr14,
        "atr14_pct": atr14_pct,
        "avg_volume_20": avg_volume_20,
        "avg_volume_60": avg_volume_60,
    }
    financials = {
        "profitMargins": profit_margin,
        "operatingMargins": operating_margin,
        "returnOnEquity": roe,
        "revenueGrowth": revenue_growth,
        "earningsGrowth": earnings_growth,
        "totalRevenue": total_revenue,
        "operatingCashflow": operating_cashflow,
        "freeCashflow": free_cashflow,
        "totalCash": total_cash,
        "totalDebt": total_debt,
        "debtToEquity": debt_to_equity,
        "currentRatio": current_ratio,
        "quickRatio": quick_ratio,
        "forwardPE": forward_pe,
        "enterpriseToRevenue": ev_to_revenue,
        "priceToSalesTrailing12Months": price_to_sales,
        "targetMeanPrice": target_mean_price,
        "numberOfAnalystOpinions": analyst_count,
        "recommendationMean": recommendation_mean,
        "beta": beta,
        "ocfMargin": ocf_margin,
        "fcfMargin": fcf_margin,
        "eps": eps,
        "bps": bps,
        "listedShares": listed_shares,
    }
    financial_statement: dict[str, Any] = {
        "domestic_price": {key: finite_or_none(value) for key, value in price.items()},
        "product_info": {key: finite_or_none(value) for key, value in search.items()},
        "stock_info": {key: finite_or_none(value) for key, value in stock_info.items()},
        "yfinance_fundamentals": {
            "symbol": yahoo_symbol,
            "cache": fundamentals_cache,
            "fields": {key: finite_or_none(value) for key, value in fundamentals.items()},
        },
    }

    chart_series = kis_domestic_chart_series(daily_rows)
    news = [] if is_compare_view else kis_domestic_news(symbol)
    summary = (
        f"{name}은 품질 점수 {total_score:.1f}/100점, 기회 점수 {opportunity.score:.1f}/100점이에요. "
        f"가장 강한 항목은 {strongest['label']}({strongest['score']:.1f})이고, 먼저 확인할 항목은 {weakest['label']}({weakest['score']:.1f})이에요. "
        f"{exchange} 상장 주식 기준으로 현재가, 가격 흐름, 회사정보, 뉴스를 함께 봤어요."
    )

    now = datetime.now(timezone.utc)
    return {
        "ok": True,
        "app": "Stock Score Reader",
        "requested_ticker": raw_ticker,
        "market": "KR",
        "symbol": symbol,
        "name": name,
        "exchange": exchange,
        "currency": currency,
        "score_model_version": SCORE_MODEL_VERSION,
        "score": total_score,
        "quality_score": total_score,
        "quality_grade": grade,
        "opportunity_score": opportunity.score,
        "opportunity_grade": grade_for(opportunity.score),
        "opportunity_confidence": round(opportunity.confidence, 3),
        "grade": grade,
        "summary": summary,
        "latest_price": latest_price,
        "latest_bar_date": latest_date,
        "evaluation_label": f"{now.astimezone().strftime('%Y-%m-%d %H:%M:%S')} 조회",
        "evaluation_ts": int(now.timestamp()),
        "data_quality": "정상",
        "usd_krw_rate": None,
        "usd_krw_label": None,
        "components": components,
        "opportunity_components": opportunity_components,
        "key_metrics": key_metrics,
        "stock_profile": [] if is_compare_view else stock_profile,
        "valuation_rows": valuation_rows,
        "chart_patterns": [] if is_compare_view else chart_patterns,
        "chart_series": chart_series,
        "intraday_series": [],
        "history": top_like_current(symbol, name, latest_price, currency, total_score, components),
        "top_scores": top_like_current(symbol, name, latest_price, currency, total_score, components),
        "news": news,
        "price_metrics": price_metrics,
        "financials": financials,
        "financial_statement": financial_statement,
        "sia_snapshot": {
            "symbol": symbol,
            "price": latest_price,
            "raw_signal": signal,
            "risk_level": "HIGH" if atr14_pct is not None and atr14_pct > 0.06 else "MEDIUM" if atr14_pct is not None and atr14_pct > 0.03 else "LOW",
            "score_model_version": SCORE_MODEL_VERSION,
            "confidence": round(score_confidence, 3),
            "quality_score": round(total_score / 100.0, 3),
            "opportunity_score": round(opportunity.score / 100.0, 3),
            "opportunity_confidence": round(opportunity.confidence, 3),
            "spot_score": round(total_score / 100.0, 3),
            "chart_score": round(momentum_score / 100.0, 3),
            "trend_score": round(score_positive(ret_3m, -0.20, 0.35) / 100.0, 3),
            "momentum_score": round(momentum_score / 100.0, 3),
            "momentum_label": "UP" if ret_3m is not None and ret_3m > 0 else "DOWN" if ret_3m is not None and ret_3m < 0 else "FLAT",
            "signal_source": "market-data:domestic-stock",
            "bar_ts": latest_date,
            "indicators": {
                "sma50": ma50,
                "sma200": ma200,
                "rsi14": rsi14,
                "atr14": atr14,
                "atr14_pct": atr14_pct,
            },
            "reasons": {
                "profitability_score": round(profitability_score / 100.0, 3),
                "growth_score": round(growth_score / 100.0, 3),
                "health_score": round(health_score / 100.0, 3),
                "momentum_score": round(momentum_score / 100.0, 3),
                "valuation_score": round(valuation_score / 100.0, 3),
                "opportunity_score": round(opportunity.score / 100.0, 3),
            },
        },
        "fetch": {
            "source": "market_data+yfinance_fundamentals",
            "score_model_version": SCORE_MODEL_VERSION,
            "price_endpoint": "/uapi/domestic-stock/v1/quotations/inquire-price",
            "price_market_div_code": KIS_DOMESTIC_SCORE_MARKET_DIV_CODE,
            "dailyprice_endpoint": "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice",
            "search_info_endpoint": "/uapi/domestic-stock/v1/quotations/search-info",
            "search_stock_info_endpoint": "/uapi/domestic-stock/v1/quotations/search-stock-info",
            "news_endpoint": "/uapi/domestic-stock/v1/quotations/news-title",
            "fetched_at": now.isoformat(),
            "cache": "no-store",
            "fundamentals_cache": fundamentals_cache,
            "fundamentals_symbol": yahoo_symbol,
            "input_mode": "symbol_master_selection",
            "market_scope": "KR listed equity",
            "exchange_code": exchange,
            "history_rows": len(daily_rows),
        },
    }


def fetch_score(raw_ticker: str, view: str = "detail", usd_krw_override: float | None = None, use_rate_override: bool = False) -> dict[str, Any]:
    market, symbol = parse_symbol_ref(raw_ticker)
    if market == "KR":
        return fetch_score_kis_domestic(symbol, view=view, usd_krw_override=usd_krw_override, use_rate_override=use_rate_override)
    return fetch_score_kis_us(symbol, view=view, usd_krw_override=usd_krw_override, use_rate_override=use_rate_override)


def fetch_score_yfinance_legacy(raw_ticker: str, view: str = "detail", usd_krw_override: float | None = None, use_rate_override: bool = False) -> dict[str, Any]:
    symbol = clean_ticker(raw_ticker)
    if not symbol or not TICKER_RE.match(symbol):
        return {"ok": False, "status": 400, "error": "invalid_ticker", "message": "정확한 미국 주식 티커만 입력하세요."}

    ticker = yf.Ticker(symbol)
    info = safe_info(ticker)
    fast = safe_fast_info(ticker)
    history = safe_history(ticker)

    if history.empty:
        return {"ok": False, "status": 404, "error": "not_found", "message": f"{symbol} 가격 데이터를 찾지 못했습니다."}

    exchange = str(info.get("exchange") or fast.get("exchange") or "").upper()
    full_exchange = str(info.get("fullExchangeName") or "")
    quote_type = str(info.get("quoteType") or fast.get("quoteType") or "").upper()
    is_us_exchange = exchange in US_EQUITY_EXCHANGES or any(marker in full_exchange.upper() for marker in US_EXCHANGE_NAME_MARKERS)
    if quote_type and quote_type != "EQUITY":
        return {"ok": False, "status": 400, "error": "not_equity", "message": f"{symbol}은 주식(EQUITY)이 아닙니다."}
    if not is_us_exchange:
        return {
            "ok": False,
            "status": 400,
            "error": "not_us_listed",
            "message": f"{symbol}은 지원하는 미국 상장 주식으로 확인되지 않았습니다.",
            "exchange": exchange,
            "fullExchangeName": full_exchange,
        }

    is_compare_view = view == "compare"
    usd_krw = usd_krw_override if use_rate_override else usd_krw_rate()
    closes = [float(value) for value in history["Close"].tolist() if is_number(value)]
    latest_history_close = closes[-1] if closes else None
    latest_price = as_float(fast.get("lastPrice")) or as_float(info.get("currentPrice")) or as_float(info.get("regularMarketPrice")) or latest_history_close
    previous_close = as_float(fast.get("regularMarketPreviousClose")) or as_float(info.get("previousClose"))
    latest_change = ((latest_price / previous_close) - 1.0) if latest_price and previous_close else None

    currency = str(info.get("currency") or fast.get("currency") or "USD")
    name = str(info.get("longName") or info.get("shortName") or symbol)
    latest_date = history.index[-1].date().isoformat() if hasattr(history.index[-1], "date") else str(history.index[-1])
    market_cap = as_float(info.get("marketCap")) or as_float(fast.get("marketCap"))
    volume = as_int(info.get("regularMarketVolume")) or as_int(fast.get("lastVolume"))
    avg_volume_20 = as_float(history["Volume"].tail(20).mean()) if "Volume" in history else None
    avg_volume_60 = as_float(history["Volume"].tail(60).mean()) if "Volume" in history else None
    year_high = as_float(fast.get("yearHigh")) or (max(closes[-252:]) if closes else None)
    year_low = as_float(fast.get("yearLow")) or (min(closes[-252:]) if closes else None)
    ma50 = as_float(history["Close"].tail(50).mean()) if len(history) >= 50 else None
    ma200 = as_float(history["Close"].tail(200).mean()) if len(history) >= 200 else None
    ret_1m = return_between(closes, 21)
    ret_3m = return_between(closes, 63)
    ret_6m = return_between(closes, 126)
    ret_52w = return_between(closes, min(251, len(closes) - 1)) if len(closes) > 2 else None
    rsi14 = simple_rsi(closes, 14)
    atr14, atr14_pct = atr_percent(history, 14)
    distance_52w_high = ((latest_price / year_high) - 1.0) if latest_price and year_high else None

    profit_margin = as_float(info.get("profitMargins"))
    roe = as_float(info.get("returnOnEquity"))
    operating_margin = as_float(info.get("operatingMargins"))
    revenue_growth = as_float(info.get("revenueGrowth"))
    earnings_growth = as_float(info.get("earningsGrowth"))
    debt_to_equity = as_float(info.get("debtToEquity"))
    current_ratio = as_float(info.get("currentRatio"))
    quick_ratio = as_float(info.get("quickRatio"))
    operating_cashflow = as_float(info.get("operatingCashflow"))
    total_revenue = as_float(info.get("totalRevenue"))
    ocf_margin = (operating_cashflow / total_revenue) if operating_cashflow is not None and total_revenue else None
    trailing_pe = as_float(info.get("trailingPE"))
    forward_pe = as_float(info.get("forwardPE"))
    price_to_book = as_float(info.get("priceToBook"))
    ev_to_revenue = as_float(info.get("enterpriseToRevenue"))
    price_to_sales = as_float(info.get("priceToSalesTrailing12Months"))
    target_mean_price = first_float(info.get("targetMeanPrice"), info.get("targetMedianPrice"))
    analyst_count = as_float(info.get("numberOfAnalystOpinions"))
    recommendation_mean = as_float(info.get("recommendationMean"))
    beta = as_float(info.get("beta"))

    profitability_score = average(
        [
            score_positive(profit_margin, -0.05, 0.25),
            score_positive(roe, -0.05, 0.25),
            score_positive(ocf_margin, -0.05, 0.25),
            score_positive(operating_margin, -0.05, 0.25),
        ]
    )
    growth_score = average(
        [
            score_positive(revenue_growth, -0.10, 0.35),
            score_positive(earnings_growth, -0.20, 0.50),
            score_positive(ret_6m, -0.20, 0.40),
        ]
    )
    health_score = average(
        [
            score_negative(debt_to_equity, 25.0, 220.0),
            score_positive(current_ratio, 0.8, 2.0),
            score_positive(quick_ratio, 0.7, 1.6),
            score_positive(ocf_margin, -0.05, 0.18),
        ]
    )
    momentum_score = average(
        [
            score_positive(ret_1m, -0.10, 0.15),
            score_positive(ret_3m, -0.20, 0.35),
            score_positive(ret_6m, -0.25, 0.50),
            score_positive(distance_52w_high, -0.45, 0.0),
            80.0 if latest_price and ma50 and latest_price > ma50 else 35.0,
            80.0 if latest_price and ma200 and latest_price > ma200 else 35.0,
        ]
    )
    valuation_score = average(
        [
            score_negative(trailing_pe if trailing_pe and trailing_pe > 0 else None, 12.0, 85.0),
            score_negative(forward_pe if forward_pe and forward_pe > 0 else None, 10.0, 70.0),
            score_negative(price_to_book if price_to_book and price_to_book > 0 else None, 1.5, 25.0),
            score_negative(ev_to_revenue if ev_to_revenue and ev_to_revenue > 0 else price_to_sales, 2.0, 25.0),
        ]
    )

    components = [
        {
            "key": "profitability",
            "label": "수익성",
            "short": "수",
            "score": round(profitability_score, 1),
            "summary": "순이익률, ROE, 영업현금흐름 마진으로 이익의 질을 봅니다.",
            "metrics": [
                {"label": "순이익률", "value": pct(profit_margin)},
                {"label": "ROE", "value": pct(roe)},
                {"label": "OCF 마진", "value": pct(ocf_margin)},
            ],
        },
        {
            "key": "growth",
            "label": "성장성",
            "short": "성",
            "score": round(growth_score, 1),
            "summary": "매출/이익 성장과 최근 6개월 가격 흐름을 같이 봅니다.",
            "metrics": [
                {"label": "매출 성장률", "value": pct(revenue_growth)},
                {"label": "이익 성장률", "value": pct(earnings_growth)},
                {"label": "6개월 수익률", "value": pct(ret_6m)},
            ],
        },
        {
            "key": "health",
            "label": "재무건전성",
            "short": "건",
            "score": round(health_score, 1),
            "summary": "부채 부담, 유동성, 현금흐름으로 버틸 수 있는 체력을 봅니다.",
            "metrics": [
                {"label": "부채/자본", "value": f"{debt_to_equity:.1f}%" if debt_to_equity is not None else "-"},
                {"label": "유동비율", "value": f"{current_ratio:.2f}" if current_ratio is not None else "-"},
                {"label": "영업현금흐름", "value": labeled_money(operating_cashflow, currency, usd_krw)},
            ],
        },
        {
            "key": "momentum",
            "label": "모멘텀",
            "short": "모",
            "score": round(momentum_score, 1),
            "summary": "최근 수익률, 52주 고점 거리, 50/200일 평균선 위치를 합칩니다.",
            "metrics": [
                {"label": "1개월 수익률", "value": pct(ret_1m)},
                {"label": "3개월 수익률", "value": pct(ret_3m)},
                {"label": "52주 고점 거리", "value": pct(distance_52w_high)},
            ],
        },
        {
            "key": "valuation",
            "label": "밸류에이션",
            "short": "밸",
            "score": round(valuation_score, 1),
            "summary": "PER/PBR/EV 매출 배수를 보수적으로 점수화합니다.",
            "metrics": [
                {"label": "PER", "value": f"{trailing_pe:.2f}" if trailing_pe is not None and trailing_pe > 0 else "-"},
                {"label": "Forward PER", "value": f"{forward_pe:.2f}" if forward_pe is not None and forward_pe > 0 else "-"},
                {"label": "PBR", "value": f"{price_to_book:.2f}" if price_to_book is not None else "-"},
            ],
        },
    ]

    total_score = (
        profitability_score * 0.24
        + growth_score * 0.20
        + health_score * 0.20
        + momentum_score * 0.22
        + valuation_score * 0.14
    )
    total_score = round(max(0.0, min(100.0, total_score)), 1)
    opportunity = opportunity_factor_score(
        market="US",
        latest_price=latest_price,
        ret_1m=ret_1m,
        ret_3m=ret_3m,
        ret_6m=ret_6m,
        ret_52w=ret_52w,
        distance_52w_high=distance_52w_high,
        ma50=ma50,
        ma200=ma200,
        rsi14=rsi14,
        atr14_pct=atr14_pct,
        avg_volume_20=avg_volume_20,
        avg_volume_60=avg_volume_60,
        market_cap=market_cap,
        revenue_growth=revenue_growth,
        earnings_growth=earnings_growth,
        target_mean_price=target_mean_price,
        analyst_count=analyst_count,
        recommendation_mean=recommendation_mean,
        forward_pe=forward_pe,
        operating_margin=operating_margin,
        cashflow_margin=ocf_margin,
        ev_to_revenue=ev_to_revenue,
        price_to_sales=price_to_sales,
        beta=beta,
    )
    opportunity_components = opportunity_components_for(
        opportunity,
        latest_price=latest_price,
        target_mean_price=target_mean_price,
        analyst_count=analyst_count,
        recommendation_mean=recommendation_mean,
        avg_volume_20=avg_volume_20,
        avg_volume_60=avg_volume_60,
        atr14_pct=atr14_pct,
        beta=beta,
    )
    grade = grade_for(total_score)
    signal = signal_for(total_score, rsi14, ret_3m)
    strongest = max(components, key=lambda item: item["score"])
    weakest = min(components, key=lambda item: item["score"])

    chart_patterns = [
        {
            "name": "추세 정렬",
            "status": "우호" if latest_price and ma50 and ma200 and latest_price > ma50 > ma200 else "확인 필요",
            "evidence": f"가격 {price_label(latest_price, currency)} · MA50 {price_label(ma50, currency)} · MA200 {price_label(ma200, currency)}",
            "interpretation": "현재가가 주요 이동평균 위에 있으면 중기 추세가 우호적으로 해석됩니다.",
        },
        {
            "name": "52주 위치",
            "status": "고점 근접" if distance_52w_high is not None and distance_52w_high > -0.1 else "중간권",
            "evidence": f"52주 고점 거리 {pct(distance_52w_high)}",
            "interpretation": "0%에 가까울수록 신고가권에 가까우며, 너무 멀면 회복 확인이 필요합니다.",
        },
        {
            "name": "단기 변동성",
            "status": "높음" if atr14_pct is not None and atr14_pct > 0.05 else "보통",
            "evidence": f"ATR14 {pct(atr14_pct)} · RSI14 {rsi14:.1f}" if rsi14 is not None else f"ATR14 {pct(atr14_pct)}",
            "interpretation": "ATR 비중이 높을수록 단기 가격 변동 폭을 더 보수적으로 봐야 합니다.",
        },
    ]

    key_metrics = [
        {"label": "현재가", "value": labeled_money(latest_price, currency, usd_krw)},
        {"label": "전일 대비", "value": pct(latest_change)},
        {"label": "거래량", "value": num_label(volume, "주")},
        {"label": "20일 평균 거래량", "value": num_label(as_int(avg_volume_20), "주")},
        {"label": "시가총액", "value": labeled_money(market_cap, currency, usd_krw)},
        {"label": "1개월 수익률", "value": pct(ret_1m)},
        {"label": "3개월 수익률", "value": pct(ret_3m)},
        {"label": "6개월 수익률", "value": pct(ret_6m)},
        {"label": "52주 수익률", "value": pct(ret_52w)},
        {"label": "ATR14", "value": pct(atr14_pct)},
        {"label": "PER", "value": f"{trailing_pe:.2f}" if trailing_pe is not None and trailing_pe > 0 else "-"},
        {"label": "PBR", "value": f"{price_to_book:.2f}" if price_to_book is not None else "-"},
        {"label": "기회 점수", "value": f"{opportunity.score:.1f}점"},
        {"label": "점수 신호", "value": signal},
    ]

    stock_profile = [
        {"label": "회사명", "value": name},
        {"label": "티커", "value": symbol},
        {"label": "거래소", "value": full_exchange or exchange},
        {"label": "산업", "value": info.get("industry") or "-"},
        {"label": "섹터", "value": info.get("sector") or "-"},
        {"label": "통화", "value": currency},
        {"label": "환율 기준", "value": f"$1 = ₩{usd_krw:,.2f}" if usd_krw else "-"},
        {"label": "최근 가격일", "value": latest_date},
        {"label": "52주 고가", "value": labeled_money(year_high, currency, usd_krw)},
        {"label": "52주 저가", "value": labeled_money(year_low, currency, usd_krw)},
        {"label": "발행주식수", "value": num_label(as_int(fast.get("shares") or info.get("sharesOutstanding")), "주")},
        {"label": "웹사이트", "value": info.get("website") or "-"},
    ]

    valuation_rows = [
        {"label": "PER", "value": f"{trailing_pe:.2f}" if trailing_pe is not None and trailing_pe > 0 else "-", "note": "TTM 이익 대비 가격"},
        {"label": "Forward PER", "value": f"{forward_pe:.2f}" if forward_pe is not None and forward_pe > 0 else "-", "note": "예상 이익 대비 가격"},
        {"label": "PBR", "value": f"{price_to_book:.2f}" if price_to_book is not None else "-", "note": "자본 대비 시장가치"},
        {"label": "EV/Revenue", "value": f"{ev_to_revenue:.2f}" if ev_to_revenue is not None else "-", "note": "기업가치/매출"},
        {"label": "Price/Sales", "value": f"{price_to_sales:.2f}" if price_to_sales is not None else "-", "note": "시가총액/매출"},
        {"label": "평균 목표가", "value": labeled_money(target_mean_price, currency, usd_krw), "note": "Yahoo Finance 기준"},
        {"label": "시가총액", "value": labeled_money(market_cap, currency, usd_krw), "note": "Yahoo Finance 기준"},
    ]

    price_metrics = {
        "price": latest_price,
        "previous_close": previous_close,
        "latest_change": latest_change,
        "return_1m": ret_1m,
        "return_3m": ret_3m,
        "return_6m": ret_6m,
        "return_52w": ret_52w,
        "distance_from_52w_high": distance_52w_high,
        "high_52w": year_high,
        "low_52w": year_low,
        "sma50": ma50,
        "sma200": ma200,
        "rsi14": rsi14,
        "atr14": atr14,
        "atr14_pct": atr14_pct,
        "avg_volume_20": avg_volume_20,
        "avg_volume_60": avg_volume_60,
    }

    financials = {
        "profitMargins": profit_margin,
        "operatingMargins": operating_margin,
        "returnOnEquity": roe,
        "revenueGrowth": revenue_growth,
        "earningsGrowth": earnings_growth,
        "totalRevenue": total_revenue,
        "operatingCashflow": operating_cashflow,
        "debtToEquity": debt_to_equity,
        "currentRatio": current_ratio,
        "quickRatio": quick_ratio,
        "targetMeanPrice": target_mean_price,
        "numberOfAnalystOpinions": analyst_count,
        "recommendationMean": recommendation_mean,
        "beta": beta,
    }

    financial_statement: dict[str, Any] = {}
    if not is_compare_view:
        try:
            income = latest_statement(
                ticker.quarterly_income_stmt,
                {
                    "Total Revenue": "최근 분기 매출",
                    "Gross Profit": "최근 분기 매출총이익",
                    "Operating Income": "최근 분기 영업이익",
                    "Net Income": "최근 분기 순이익",
                },
            )
            if income:
                financial_statement["income_statement"] = income
        except Exception:
            pass
        try:
            balance = latest_statement(
                ticker.quarterly_balance_sheet,
                {
                    "Total Assets": "총자산",
                    "Total Debt": "총부채",
                    "Stockholders Equity": "자본총계",
                    "Cash And Cash Equivalents": "현금성자산",
                },
            )
            if balance:
                financial_statement["balance_sheet"] = balance
        except Exception:
            pass
        try:
            cashflow = latest_statement(
                ticker.quarterly_cashflow,
                {
                    "Operating Cash Flow": "영업현금흐름",
                    "Free Cash Flow": "잉여현금흐름",
                    "Capital Expenditure": "자본지출",
                },
            )
            if cashflow:
                financial_statement["cashflow"] = cashflow
        except Exception:
            pass

    summary = (
        f"{symbol}의 yfinance 최신 데이터 기준 품질 점수는 {total_score:.1f}/100, 기회 점수는 {opportunity.score:.1f}/100입니다. "
        f"가장 강한 항목은 {strongest['label']}({strongest['score']:.1f})이고, "
        f"현재 점수를 가장 제한하는 항목은 {weakest['label']}({weakest['score']:.1f})입니다. "
        f"미국 거래소({full_exchange or exchange}) 상장 주식 기준으로 조회합니다."
    )

    now = datetime.now(timezone.utc)
    return {
        "ok": True,
        "app": "US yfinance Stock Radar",
        "requested_ticker": raw_ticker,
        "symbol": symbol,
        "name": name,
        "exchange": full_exchange or exchange,
        "currency": currency,
        "score_model_version": SCORE_MODEL_VERSION,
        "score": total_score,
        "quality_score": total_score,
        "quality_grade": grade,
        "opportunity_score": opportunity.score,
        "opportunity_grade": grade_for(opportunity.score),
        "opportunity_confidence": round(opportunity.confidence, 3),
        "grade": grade,
        "summary": summary,
        "latest_price": latest_price,
        "latest_bar_date": latest_date,
        "evaluation_label": f"{now.astimezone().strftime('%Y-%m-%d %H:%M:%S')} 조회",
        "evaluation_ts": int(now.timestamp()),
        "data_quality": "정상",
        "usd_krw_rate": usd_krw,
        "usd_krw_label": f"$1 = ₩{usd_krw:,.2f}" if usd_krw else None,
        "components": components,
        "opportunity_components": opportunity_components,
        "key_metrics": key_metrics,
        "stock_profile": [] if is_compare_view else stock_profile,
        "valuation_rows": valuation_rows,
        "chart_patterns": [] if is_compare_view else chart_patterns,
        "chart_series": build_chart_series(history, currency, usd_krw),
        "intraday_series": [] if is_compare_view else safe_intraday(ticker),
        "history": top_like_current(symbol, name, latest_price, currency, total_score, components),
        "top_scores": top_like_current(symbol, name, latest_price, currency, total_score, components),
        "news": [] if is_compare_view else safe_news(ticker),
        "price_metrics": price_metrics,
        "financials": financials,
        "financial_statement": financial_statement,
        "sia_snapshot": {
            "symbol": symbol,
            "price": latest_price,
            "raw_signal": signal,
            "risk_level": "HIGH" if atr14_pct is not None and atr14_pct > 0.06 else "MEDIUM" if atr14_pct is not None and atr14_pct > 0.03 else "LOW",
            "score_model_version": SCORE_MODEL_VERSION,
            "confidence": round(min(1.0, len(history) / 252.0), 3),
            "quality_score": round(total_score / 100.0, 3),
            "opportunity_score": round(opportunity.score / 100.0, 3),
            "opportunity_confidence": round(opportunity.confidence, 3),
            "spot_score": round(total_score / 100.0, 3),
            "chart_score": round(momentum_score / 100.0, 3),
            "trend_score": round(score_positive(ret_3m, -0.20, 0.35) / 100.0, 3),
            "momentum_score": round(momentum_score / 100.0, 3),
            "momentum_label": "UP" if ret_3m is not None and ret_3m > 0 else "DOWN" if ret_3m is not None and ret_3m < 0 else "FLAT",
            "signal_source": "yfinance:us-equity",
            "bar_ts": latest_date,
            "indicators": {
                "sma50": ma50,
                "sma200": ma200,
                "rsi14": rsi14,
                "atr14": atr14,
                "atr14_pct": atr14_pct,
            },
            "reasons": {
                "profitability_score": round(profitability_score / 100.0, 3),
                "growth_score": round(growth_score / 100.0, 3),
                "health_score": round(health_score / 100.0, 3),
                "momentum_score": round(momentum_score / 100.0, 3),
                "valuation_score": round(valuation_score / 100.0, 3),
                "opportunity_score": round(opportunity.score / 100.0, 3),
            },
        },
        "fetch": {
            "source": "yfinance",
            "score_model_version": SCORE_MODEL_VERSION,
            "yfinance_version": yf.__version__,
            "fetched_at": now.isoformat(),
            "cache": "no-store",
            "input_mode": "exact_ticker_only",
            "market_scope": "US listed equity only",
            "history_rows": len(history),
        },
    }


def json_default(value: Any) -> Any:
    return finite_or_none(value)


def parse_batch_tickers(raw: str | None) -> list[str]:
    if not raw:
        return []
    unique: list[str] = []
    for value in raw.split(","):
        ticker = clean_ticker(value)
        if ticker and ticker not in unique:
            unique.append(ticker)
    return unique[:5]


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch latest stock score data.")
    parser.add_argument("ticker", nargs="?")
    parser.add_argument("--tickers")
    parser.add_argument("--view", choices=["detail", "compare", "quote"], default="detail")
    args = parser.parse_args()

    tickers = parse_batch_tickers(args.tickers)
    if tickers:
        results = [fetch_quote(ticker) if args.view == "quote" else fetch_score(ticker, view=args.view) for ticker in tickers]
        payload = {
            "ok": any(result.get("ok") is True for result in results),
            "results": results,
        }
    else:
        if not args.ticker:
            parser.error("ticker is required unless --tickers is provided")
        payload = fetch_quote(args.ticker) if args.view == "quote" else fetch_score(args.ticker, view=args.view)
    print(json.dumps(payload, ensure_ascii=False, allow_nan=False, default=json_default))
    return 0


if __name__ == "__main__":
    sys.exit(main())
