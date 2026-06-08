from __future__ import annotations

import hashlib
import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
import yfinance as yf

from .formatting import as_float, finite_or_none
from .io_utils import env_value, int_env, one_byte_file_lock
from .symbols import clean_ticker
from .yfinance_provider import safe_info


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


def delete_supabase_kis_access_token(cache_key: str) -> bool:
    config = supabase_write_config()
    if not config:
        return False

    url, key = config
    try:
        response = requests.delete(
            f"{url}/rest/v1/{KIS_TOKEN_CACHE_TABLE}",
            params={"cache_key": f"eq.{cache_key}"},
            headers=supabase_headers(key),
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


def yfinance_request_fetch_enabled() -> bool:
    raw = (env_value("STOCK_YFINANCE_REQUEST_FETCH") or "").strip().lower()
    if raw:
        return raw in {"1", "true", "yes", "on", "enabled"}

    runtime = ((env_value("STOCK_DATA_RUNTIME") or env_value("STOCK_DATA_BACKEND") or "")).strip().lower()
    if runtime == "snapshot" or env_value("VERCEL"):
        return False
    return True


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
    if not yfinance_request_fetch_enabled():
        if stale_values:
            return stale_values, {**(stale_meta or yfinance_cache_meta("unknown", "stale")), "provider_fetch": "disabled"}
        return {}, yfinance_cache_meta("provider", "miss", provider_fetch="disabled")

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
