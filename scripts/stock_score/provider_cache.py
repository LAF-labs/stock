from __future__ import annotations

import hashlib
import json
import math
import os
import re
import time
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any

import requests
import yfinance as yf

from .formatting import as_float, finite_or_none
from .io_utils import env_value, int_env, one_byte_file_lock
from .kis_domestic_fundamentals import (
    KIS_DOMESTIC_FUNDAMENTAL_CACHE_VERSION,
    KIS_DOMESTIC_FUNDAMENTAL_SOURCE,
    kis_domestic_fundamental_payload,
    normalize_kis_domestic_fundamentals,
)
from .symbols import clean_ticker
from .yfinance_provider import safe_info
from .cache_policy import fresh_seconds as policy_fresh_seconds, stale_seconds as policy_stale_seconds


YFINANCE_FUNDAMENTAL_CACHE_VERSION = 2
YFINANCE_FUNDAMENTAL_SOURCE = "yfinance"
SEC_EDGAR_FUNDAMENTAL_SOURCE = "sec_companyfacts"
SEC_EDGAR_PROVIDER = "sec"
SUPABASE_FUNDAMENTAL_TABLE = "stock_fundamental_snapshots"
SUPABASE_FUNDAMENTAL_LATEST_TABLE = "stock_fundamental_latest"
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

FUNDAMENTAL_FIELD_CLASS_POLICIES = {
    "statement": "fundamentals_statement",
    "market_ratio": "fundamentals_market_ratio",
    "analyst": "fundamentals_market_ratio",
    "liquidity": "fundamentals_market_ratio",
}

YFINANCE_FUNDAMENTAL_FIELD_CLASSES = {
    "profitMargins": "statement",
    "operatingMargins": "statement",
    "returnOnEquity": "statement",
    "revenueGrowth": "statement",
    "earningsGrowth": "statement",
    "totalRevenue": "statement",
    "operatingCashflow": "statement",
    "freeCashflow": "statement",
    "totalCash": "statement",
    "totalDebt": "statement",
    "debtToEquity": "statement",
    "currentRatio": "statement",
    "quickRatio": "statement",
    "grossMargins": "statement",
    "ebitdaMargins": "statement",
    "trailingPE": "market_ratio",
    "forwardPE": "market_ratio",
    "priceToBook": "market_ratio",
    "enterpriseToRevenue": "market_ratio",
    "priceToSalesTrailing12Months": "market_ratio",
    "targetMeanPrice": "analyst",
    "targetMedianPrice": "analyst",
    "numberOfAnalystOpinions": "analyst",
    "recommendationMean": "analyst",
    "beta": "liquidity",
    "averageVolume": "liquidity",
    "averageVolume10days": "liquidity",
}

SCORING_FUNDAMENTAL_FIELDS = frozenset(
    {
        *YFINANCE_FUNDAMENTAL_FIELDS,
        "totalAssets",
        "totalLiabilities",
        "totalEquity",
        "operatingIncome",
        "netIncome",
        "eps",
        "bps",
        "ebitda",
        "evToEbitda",
        "listedShares",
        "marketCap",
    }
)

FUNDAMENTAL_COVERAGE_GROUPS = {
    "profitability": ["eps", "bps", "returnOnEquity", "profitMargins", "operatingMargins"],
    "growth": ["totalRevenue", "revenueGrowth", "earningsGrowth"],
    "health": ["debtToEquity", "currentRatio", "quickRatio", "totalAssets", "totalLiabilities", "totalEquity"],
    "cashflow": ["operatingCashflow", "freeCashflow"],
    "valuation": ["trailingPE", "forwardPE", "priceToBook", "enterpriseToRevenue", "priceToSalesTrailing12Months", "evToEbitda"],
    "market": ["marketCap", "beta", "averageVolume", "averageVolume10days", "targetMeanPrice", "numberOfAnalystOpinions", "recommendationMean"],
}

SEC_FACT_FIELDS = {
    "totalRevenue": ("RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"),
    "netIncome": ("NetIncomeLoss", "ProfitLoss"),
    "operatingIncome": ("OperatingIncomeLoss",),
    "totalAssets": ("Assets",),
    "currentAssets": ("AssetsCurrent",),
    "totalLiabilities": ("Liabilities",),
    "currentLiabilities": ("LiabilitiesCurrent",),
    "totalEquity": (
        "StockholdersEquity",
        "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
    ),
    "eps": ("EarningsPerShareDiluted", "EarningsPerShareBasic"),
    "operatingCashflow": ("NetCashProvidedByUsedInOperatingActivities",),
}

SEC_FACT_UNITS = {
    "eps": ("USD/shares", "USD / shares"),
}

YAHOO_QUOTE_SUMMARY_MODULES = (
    "financialData",
    "defaultKeyStatistics",
    "summaryDetail",
)


def yfinance_fundamental_cache_dir() -> Path:
    configured = env_value("STOCK_FUNDAMENTALS_CACHE_DIR")
    return Path(configured) if configured else Path.cwd() / ".stock_fundamentals_cache"


def yfinance_fundamental_cache_path(symbol: str) -> Path:
    safe_symbol = re.sub(r"[^A-Z0-9.-]", "_", clean_ticker(symbol))
    return yfinance_fundamental_cache_dir() / f"{safe_symbol}.json"


def yfinance_cache_fresh_seconds() -> int:
    return int_env("STOCK_FUNDAMENTALS_CACHE_SECONDS", policy_fresh_seconds("fundamentals_market_ratio"))


def yfinance_cache_stale_seconds() -> int:
    return int_env("STOCK_FUNDAMENTALS_STALE_SECONDS", policy_stale_seconds("fundamentals_market_ratio"))


def fundamental_field_class(field: str) -> str:
    return YFINANCE_FUNDAMENTAL_FIELD_CLASSES.get(field, "market_ratio")


def fundamental_class_policy_key(field_class: str) -> str:
    return FUNDAMENTAL_FIELD_CLASS_POLICIES.get(field_class, "fundamentals_market_ratio")


def fundamental_class_fresh_seconds(field_class: str) -> int:
    return policy_fresh_seconds(fundamental_class_policy_key(field_class))


def fundamental_class_stale_seconds(field_class: str) -> int:
    return policy_stale_seconds(fundamental_class_policy_key(field_class))


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


def normalized_fundamental_cache_meta(store: str, state: str, **extra: Any) -> dict[str, Any]:
    return {
        "source": extra.pop("source", "normalized_fundamentals"),
        "provider": extra.pop("provider", "unknown"),
        "store": store,
        "cache": state,
        **{key: value for key, value in extra.items() if value is not None},
    }


def clean_fundamental_values(values: dict[str, Any] | None) -> dict[str, float]:
    if not isinstance(values, dict):
        return {}

    cleaned: dict[str, float] = {}
    for field, value in values.items():
        if field not in SCORING_FUNDAMENTAL_FIELDS:
            continue
        parsed = as_float(value)
        if parsed is not None:
            cleaned[field] = float(parsed)
    return cleaned


def merge_fundamental_values(*sources: dict[str, Any] | None) -> dict[str, float]:
    merged: dict[str, float] = {}
    for source in sources:
        for field, value in clean_fundamental_values(source).items():
            if field not in merged:
                merged[field] = value
    return merged


def finite_divide(numerator: Any, denominator: Any, multiplier: float = 1.0) -> float | None:
    parsed_numerator = as_float(numerator)
    parsed_denominator = as_float(denominator)
    if parsed_numerator is None or not parsed_denominator:
        return None
    value = (parsed_numerator / parsed_denominator) * multiplier
    return round(value, 6) if math.isfinite(value) else None


def truthy_env(name: str) -> bool | None:
    raw = (env_value(name) or "").strip().lower()
    if not raw:
        return None
    return raw in {"1", "true", "yes", "on", "enabled"}


def sec_edgar_user_agent() -> str:
    return (
        env_value("STOCK_SEC_EDGAR_USER_AGENT")
        or env_value("SEC_EDGAR_USER_AGENT")
        or "stockstalker/0.1 contact@example.com"
    )


def sec_edgar_request_fetch_enabled() -> bool:
    configured = truthy_env("STOCK_SEC_EDGAR_REQUEST_FETCH")
    if configured is not None:
        return configured
    return yfinance_request_fetch_enabled()


def yahoo_quote_summary_fetch_enabled() -> bool:
    configured = truthy_env("STOCK_YAHOO_QUOTE_SUMMARY_FETCH")
    return True if configured is None else configured


def sec_fact_units(field: str) -> tuple[str, ...]:
    return SEC_FACT_UNITS.get(field, ("USD",))


def sec_fact_value(row: dict[str, Any]) -> float | None:
    return finite_or_none(row.get("val"))


def sec_fact_sort_key(row: dict[str, Any]) -> tuple[int, str, str]:
    form = str(row.get("form") or "").upper()
    fp = str(row.get("fp") or "").upper()
    annual = 1 if form in {"10-K", "10-K/A", "20-F", "20-F/A"} or fp == "FY" else 0
    return annual, str(row.get("end") or ""), str(row.get("filed") or "")


def latest_sec_fact(us_gaap: dict[str, Any], field: str) -> dict[str, Any] | None:
    rows: list[dict[str, Any]] = []
    for metric in SEC_FACT_FIELDS.get(field, ()):
        metric_payload = us_gaap.get(metric)
        units = metric_payload.get("units") if isinstance(metric_payload, dict) else None
        if not isinstance(units, dict):
            continue
        for unit in sec_fact_units(field):
            for row in units.get(unit) or []:
                if not isinstance(row, dict) or sec_fact_value(row) is None:
                    continue
                rows.append({**row, "metric": metric, "unit": unit, "value": sec_fact_value(row)})
    if not rows:
        return None
    annual_rows = [row for row in rows if sec_fact_sort_key(row)[0] == 1]
    return max(annual_rows or rows, key=sec_fact_sort_key)


def normalize_sec_companyfacts(payload: dict[str, Any]) -> tuple[dict[str, float], dict[str, Any], dict[str, Any]]:
    us_gaap = (((payload.get("facts") or {}).get("us-gaap")) if isinstance(payload.get("facts"), dict) else None)
    if not isinstance(us_gaap, dict):
        return {}, {}, {"source": SEC_EDGAR_FUNDAMENTAL_SOURCE, "entity_name": payload.get("entityName")}

    selected: dict[str, dict[str, Any]] = {}
    values: dict[str, Any] = {}
    for field in SEC_FACT_FIELDS:
        row = latest_sec_fact(us_gaap, field)
        if not row:
            continue
        values[field] = row["value"]
        selected[field] = {
            "metric": row.get("metric"),
            "unit": row.get("unit"),
            "form": row.get("form"),
            "fy": row.get("fy"),
            "fp": row.get("fp"),
            "end": row.get("end"),
            "filed": row.get("filed"),
            "val": row.get("value"),
        }

    revenue = values.get("totalRevenue")
    values.setdefault("profitMargins", finite_divide(values.get("netIncome"), revenue))
    values.setdefault("operatingMargins", finite_divide(values.get("operatingIncome"), revenue))
    values.setdefault("returnOnEquity", finite_divide(values.get("netIncome"), values.get("totalEquity")))
    values.setdefault("currentRatio", finite_divide(values.get("currentAssets"), values.get("currentLiabilities")))
    values.setdefault("debtToEquity", finite_divide(values.get("totalLiabilities"), values.get("totalEquity"), 100.0))

    cleaned = clean_fundamental_values(values)
    primary = selected.get("totalRevenue") or next(iter(selected.values()), {})
    fiscal_year = primary.get("fy")
    try:
        fiscal_year = int(fiscal_year) if fiscal_year is not None else None
    except (TypeError, ValueError):
        fiscal_year = None
    meta = {
        "period_end": primary.get("end"),
        "fiscal_year": fiscal_year,
        "fiscal_period": primary.get("fp"),
        "report_type": primary.get("form"),
        "currency": "USD",
    }
    compact_payload = {
        "source": SEC_EDGAR_FUNDAMENTAL_SOURCE,
        "entity_name": payload.get("entityName"),
        "selected_facts": selected,
    }
    return cleaned, meta, compact_payload


@lru_cache(maxsize=1)
def sec_company_tickers() -> dict[str, Any]:
    response = requests.get(
        "https://www.sec.gov/files/company_tickers.json",
        headers={"User-Agent": sec_edgar_user_agent()},
        timeout=SUPABASE_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    payload = response.json()
    return payload if isinstance(payload, dict) else {}


def sec_cik_for_ticker(symbol: str) -> str | None:
    ticker = clean_ticker(symbol)
    for row in sec_company_tickers().values():
        if not isinstance(row, dict) or clean_ticker(str(row.get("ticker") or "")) != ticker:
            continue
        cik = row.get("cik_str")
        return str(cik).zfill(10) if cik is not None else None
    return None


def fetch_sec_companyfacts(symbol: str) -> dict[str, Any]:
    cik = sec_cik_for_ticker(symbol)
    if not cik:
        return {}
    response = requests.get(
        f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json",
        headers={"User-Agent": sec_edgar_user_agent()},
        timeout=SUPABASE_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    payload = response.json()
    return payload if isinstance(payload, dict) else {}


def sec_edgar_fundamentals(symbol: str) -> tuple[dict[str, float], dict[str, Any], dict[str, Any]]:
    clean_symbol = clean_ticker(symbol)
    raw = fetch_sec_companyfacts(clean_symbol)
    values, fact_meta, compact_payload = normalize_sec_companyfacts(raw)
    if not values:
        return {}, normalized_fundamental_cache_meta("provider", "miss", provider=SEC_EDGAR_PROVIDER, source=SEC_EDGAR_FUNDAMENTAL_SOURCE), compact_payload

    persisted = write_supabase_normalized_fundamental_latest(
        clean_symbol,
        values,
        market="US",
        provider=SEC_EDGAR_PROVIDER,
        source=SEC_EDGAR_FUNDAMENTAL_SOURCE,
        payload=compact_payload,
        period_end=fact_meta.get("period_end"),
        fiscal_year=fact_meta.get("fiscal_year"),
        fiscal_period=fact_meta.get("fiscal_period"),
        report_type=fact_meta.get("report_type"),
        currency=fact_meta.get("currency"),
        is_consolidated=True,
    )
    return values, normalized_fundamental_cache_meta(
        "provider",
        "refreshed",
        provider=SEC_EDGAR_PROVIDER,
        source=SEC_EDGAR_FUNDAMENTAL_SOURCE,
        persisted="supabase" if persisted else "memory",
        **fact_meta,
    ), compact_payload


def yahoo_raw_value(value: Any) -> float | None:
    if isinstance(value, dict) and "raw" in value:
        return finite_or_none(value.get("raw"))
    return finite_or_none(value)


def normalize_yahoo_quote_summary_fundamentals(payload: dict[str, Any]) -> dict[str, Any]:
    values: dict[str, Any] = {}
    for module in YAHOO_QUOTE_SUMMARY_MODULES:
        section = payload.get(module)
        if not isinstance(section, dict):
            continue
        for field in YFINANCE_FUNDAMENTAL_FIELDS:
            if field in values or field not in section:
                continue
            parsed = yahoo_raw_value(section.get(field))
            if parsed is not None:
                values[field] = parsed
    return values


def yahoo_quote_summary_fundamentals(symbol: str) -> dict[str, Any]:
    yahoo_symbol = clean_ticker(symbol).replace(".", "-")
    session = requests.Session()
    session.headers["User-Agent"] = "Mozilla/5.0"
    session.get("https://fc.yahoo.com", timeout=SUPABASE_TIMEOUT_SECONDS)
    crumb_response = session.get("https://query2.finance.yahoo.com/v1/test/getcrumb", timeout=SUPABASE_TIMEOUT_SECONDS)
    crumb_response.raise_for_status()
    crumb = crumb_response.text.strip()
    response = session.get(
        f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{yahoo_symbol}",
        params={"modules": ",".join(YAHOO_QUOTE_SUMMARY_MODULES), "crumb": crumb},
        timeout=SUPABASE_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    result = ((response.json().get("quoteSummary") or {}).get("result") or [{}])[0]
    return normalize_yahoo_quote_summary_fundamentals(result if isinstance(result, dict) else {})


def fundamental_coverage(values: dict[str, Any] | None) -> dict[str, list[str]]:
    cleaned = clean_fundamental_values(values)
    return {
        group: [field for field in fields if field in cleaned]
        for group, fields in FUNDAMENTAL_COVERAGE_GROUPS.items()
        if any(field in cleaned for field in fields)
    }


def read_supabase_normalized_fundamental_cache(
    symbol: str,
    market: str = "US",
) -> tuple[dict[str, float] | None, str | None, dict[str, Any] | None, dict[str, Any] | None]:
    config = supabase_read_config()
    if not config:
        return None, None, normalized_fundamental_cache_meta("supabase", "miss", error="missing_config"), None

    url, key = config
    clean_symbol = clean_ticker(symbol)
    clean_market = clean_ticker(market) or "US"
    try:
        response = requests.get(
            f"{url}/rest/v1/{SUPABASE_FUNDAMENTAL_LATEST_TABLE}",
            params={
                "market": f"eq.{clean_market}",
                "symbol": f"eq.{clean_symbol}",
                "select": (
                    "market,symbol,provider,source,source_filing_id,period_end,fiscal_year,fiscal_period,"
                    "report_type,currency,is_consolidated,normalized_facts,coverage,payload,raw_ref,"
                    "fetched_at,expires_at,stale_expires_at"
                ),
                "limit": "1",
            },
            headers=supabase_headers(key),
            timeout=SUPABASE_TIMEOUT_SECONDS,
        )
        if response.status_code == 404:
            return None, None, normalized_fundamental_cache_meta("supabase", "miss", error="table_missing"), None
        if not response.ok:
            return None, None, normalized_fundamental_cache_meta("supabase", "miss", error=f"HTTP {response.status_code}"), None
        rows = response.json()
    except Exception as exc:
        return None, None, normalized_fundamental_cache_meta("supabase", "miss", error=str(exc)), None

    if not isinstance(rows, list) or not rows:
        return None, None, normalized_fundamental_cache_meta("supabase", "miss"), None

    row = rows[0] if isinstance(rows[0], dict) else {}
    state = supabase_cache_state(row, datetime.now(timezone.utc))
    if state is None:
        return None, None, normalized_fundamental_cache_meta("supabase", "expired"), row

    facts = clean_fundamental_values(row.get("normalized_facts") if isinstance(row.get("normalized_facts"), dict) else None)
    if not facts:
        return None, None, normalized_fundamental_cache_meta("supabase", "miss", error="empty_normalized_facts"), row

    provider = str(row.get("provider") or "unknown")
    source = str(row.get("source") or "normalized_fundamentals")
    meta = normalized_fundamental_cache_meta(
        "supabase",
        state,
        provider=provider,
        source=source,
        period_end=row.get("period_end"),
        fiscal_year=row.get("fiscal_year"),
        fiscal_period=row.get("fiscal_period"),
        currency=row.get("currency"),
        fetched_at=row.get("fetched_at"),
        expires_at=row.get("expires_at"),
        stale_expires_at=row.get("stale_expires_at"),
    )
    payload = {
        "provider": provider,
        "source": source,
        "source_filing_id": row.get("source_filing_id"),
        "period_end": row.get("period_end"),
        "fiscal_year": row.get("fiscal_year"),
        "fiscal_period": row.get("fiscal_period"),
        "report_type": row.get("report_type"),
        "currency": row.get("currency"),
        "is_consolidated": row.get("is_consolidated"),
        "normalized_facts": facts,
        "coverage": row.get("coverage") if isinstance(row.get("coverage"), dict) else {},
        "payload": row.get("payload") if isinstance(row.get("payload"), dict) else {},
        "raw_ref": row.get("raw_ref") if isinstance(row.get("raw_ref"), dict) else {},
    }
    return facts, state, meta, payload


def normalized_fundamentals(
    symbol: str,
    market: str = "US",
) -> tuple[dict[str, float], str | None, dict[str, Any], dict[str, Any]]:
    facts, state, meta, payload = read_supabase_normalized_fundamental_cache(symbol, market)
    if facts and state == "fresh":
        return facts, state, meta or normalized_fundamental_cache_meta("supabase", "fresh"), payload or {}

    clean_market = clean_ticker(market) or "US"
    clean_symbol = clean_ticker(symbol)
    if clean_market != "US" or not sec_edgar_request_fetch_enabled():
        return facts or {}, state, meta or normalized_fundamental_cache_meta("supabase", "miss"), payload or {}

    stale_facts = facts if facts and state == "stale" else None
    stale_meta = meta if facts and state == "stale" else None
    stale_payload = payload if facts and state == "stale" else None
    try:
        sec_values, sec_meta, sec_payload = sec_edgar_fundamentals(clean_symbol)
        if sec_values:
            return sec_values, "fresh", sec_meta, sec_payload
    except Exception as exc:
        if stale_facts:
            return stale_facts, "stale", {
                **(stale_meta or normalized_fundamental_cache_meta("supabase", "stale")),
                "refresh_error": str(exc),
            }, stale_payload or {}
        return {}, None, normalized_fundamental_cache_meta("provider", "miss", provider=SEC_EDGAR_PROVIDER, source=SEC_EDGAR_FUNDAMENTAL_SOURCE, refresh_error=str(exc)), {}

    if stale_facts:
        return stale_facts, "stale", stale_meta or normalized_fundamental_cache_meta("supabase", "stale"), stale_payload or {}
    return {}, None, meta or normalized_fundamental_cache_meta("provider", "miss", provider=SEC_EDGAR_PROVIDER, source=SEC_EDGAR_FUNDAMENTAL_SOURCE), payload or {}


def write_supabase_normalized_fundamental_latest(
    symbol: str,
    values: dict[str, Any],
    *,
    market: str = "US",
    provider: str,
    source: str,
    payload: dict[str, Any] | None = None,
    source_filing_id: str | None = None,
    period_end: str | None = None,
    fiscal_year: int | None = None,
    fiscal_period: str | None = None,
    report_type: str | None = None,
    currency: str | None = None,
    is_consolidated: bool | None = None,
) -> bool:
    cleaned = clean_fundamental_values(values)
    if not cleaned:
        return False

    config = supabase_write_config()
    if not config:
        return False

    url, key = config
    legacy_payload = payload if isinstance(payload, dict) else {}
    now = datetime.now(timezone.utc)
    row = {
        "market": clean_ticker(market) or "US",
        "symbol": clean_ticker(symbol),
        "provider": provider,
        "source": source,
        "source_filing_id": source_filing_id,
        "period_end": period_end,
        "fiscal_year": fiscal_year,
        "fiscal_period": fiscal_period,
        "report_type": report_type,
        "currency": currency,
        "is_consolidated": is_consolidated,
        "normalized_facts": cleaned,
        "coverage": fundamental_coverage(cleaned),
        "payload": legacy_payload,
        "raw_ref": {"legacy_payload_version": legacy_payload.get("version")} if legacy_payload else {},
        "fetched_at": legacy_payload.get("fetched_at_iso") or now.isoformat(),
        "expires_at": legacy_payload.get("expires_at_iso") or datetime.fromtimestamp(now.timestamp() + policy_fresh_seconds("fundamentals_statement"), timezone.utc).isoformat(),
        "stale_expires_at": legacy_payload.get("stale_expires_at_iso") or datetime.fromtimestamp(now.timestamp() + policy_stale_seconds("fundamentals_statement"), timezone.utc).isoformat(),
    }
    try:
        response = requests.post(
            f"{url}/rest/v1/{SUPABASE_FUNDAMENTAL_LATEST_TABLE}",
            params={"on_conflict": "market,symbol"},
            headers={
                **supabase_headers(key),
                "Prefer": "resolution=merge-duplicates,return=minimal",
            },
            json={key: value for key, value in row.items() if value is not None},
            timeout=SUPABASE_TIMEOUT_SECONDS,
        )
        return response.ok
    except Exception:
        return False


def fundamental_cache_payload(
    symbol: str,
    values: dict[str, Any],
    now: float | None = None,
    provider_mode: str | None = None,
) -> dict[str, Any]:
    timestamp = time.time() if now is None else now
    fetched_at = datetime.fromtimestamp(timestamp, timezone.utc)
    field_classes = {field: fundamental_field_class(field) for field in values.keys()}
    class_names = sorted(set(field_classes.values()) or {"market_ratio"})
    class_expires_at = {
        field_class: datetime.fromtimestamp(timestamp + fundamental_class_fresh_seconds(field_class), timezone.utc).isoformat()
        for field_class in class_names
    }
    class_stale_expires_at = {
        field_class: datetime.fromtimestamp(timestamp + fundamental_class_stale_seconds(field_class), timezone.utc).isoformat()
        for field_class in class_names
    }
    fresh_expires_at = min(parse_iso_datetime(value) for value in class_expires_at.values())
    stale_expires_at = max(parse_iso_datetime(value) for value in class_stale_expires_at.values())
    if fresh_expires_at is None:
        fresh_expires_at = datetime.fromtimestamp(timestamp + yfinance_cache_fresh_seconds(), timezone.utc)
    if stale_expires_at is None:
        stale_expires_at = datetime.fromtimestamp(timestamp + yfinance_cache_stale_seconds(), timezone.utc)
    payload = {
        "version": YFINANCE_FUNDAMENTAL_CACHE_VERSION,
        "symbol": clean_ticker(symbol),
        "source": YFINANCE_FUNDAMENTAL_SOURCE,
        "fetched_at": timestamp,
        "fetched_at_iso": fetched_at.isoformat(),
        "expires_at": fresh_expires_at.timestamp(),
        "expires_at_iso": fresh_expires_at.isoformat(),
        "stale_expires_at": stale_expires_at.timestamp(),
        "stale_expires_at_iso": stale_expires_at.isoformat(),
        "field_classes": field_classes,
        "class_expires_at": class_expires_at,
        "class_stale_expires_at": class_stale_expires_at,
        "values": values,
    }
    if provider_mode:
        payload["provider_mode"] = provider_mode
    return payload


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

    values, state = cached_payload_values_and_state(payload, datetime.now(timezone.utc))
    if not values or state is None or supabase_cache_state(row, datetime.now(timezone.utc)) is None:
        return None, None, {"source": YFINANCE_FUNDAMENTAL_SOURCE, "store": "supabase", "cache": "expired"}

    return values, state, {
        "source": YFINANCE_FUNDAMENTAL_SOURCE,
        "store": "supabase",
        "cache": state,
        "fetched_at": row.get("fetched_at"),
        "expires_at": row.get("expires_at"),
        "stale_expires_at": row.get("stale_expires_at"),
    }


def write_supabase_yfinance_fundamental_cache(
    symbol: str,
    values: dict[str, Any],
    market: str = "US",
    provider_mode: str | None = None,
) -> bool:
    config = supabase_write_config()
    if not config:
        return False

    url, key = config
    timestamp = time.time()
    payload = fundamental_cache_payload(symbol, values, timestamp, provider_mode)
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
        if yfinance_may_publish_normalized_latest(symbol, market):
            write_supabase_normalized_fundamental_latest(
                symbol,
                values,
                market=market,
                provider=YFINANCE_FUNDAMENTAL_SOURCE,
                source=YFINANCE_FUNDAMENTAL_SOURCE,
                payload=payload,
            )
        return response.ok
    except Exception:
        return False


def yfinance_may_publish_normalized_latest(symbol: str, market: str = "US") -> bool:
    facts, state, meta, _ = read_supabase_normalized_fundamental_cache(symbol, market)
    provider = str((meta or {}).get("provider") or "")
    if facts and state in {"fresh", "stale"} and provider not in {"", "unknown", YFINANCE_FUNDAMENTAL_SOURCE}:
        return False
    return True


def kis_domestic_cache_meta(store: str, state: str, **extra: Any) -> dict[str, Any]:
    return {
        "source": KIS_DOMESTIC_FUNDAMENTAL_SOURCE,
        "store": store,
        "cache": state,
        **{key: value for key, value in extra.items() if value is not None},
    }


def kis_domestic_request_fetch_enabled() -> bool:
    raw = (env_value("STOCK_KIS_DOMESTIC_FUNDAMENTALS_FETCH") or "").strip().lower()
    if raw:
        return raw in {"1", "true", "yes", "on", "enabled"}

    app_key = env_value("STOCK_API_APP_KEY") or env_value("KIS_APP_KEY")
    app_secret = env_value("STOCK_API_APP_SECRET") or env_value("KIS_APP_SECRET")
    return bool(app_key and app_secret)


def kis_domestic_fundamental_cache_payload(
    symbol: str,
    raw: dict[str, Any],
    normalized: dict[str, Any] | None = None,
    *,
    period_type: str = "annual",
    errors: dict[str, str] | None = None,
    now: float | None = None,
) -> dict[str, Any]:
    return kis_domestic_fundamental_payload(
        symbol,
        raw,
        normalized=normalized,
        period_type=period_type,
        errors=errors,
        now=now,
        fresh_seconds=policy_fresh_seconds("fundamentals_statement"),
        stale_seconds=policy_stale_seconds("fundamentals_statement"),
    )


def read_supabase_kis_domestic_fundamental_cache(
    symbol: str,
    market: str = "KR",
) -> tuple[dict[str, Any] | None, str | None, dict[str, Any] | None, dict[str, Any] | None]:
    config = supabase_read_config()
    if not config:
        return None, None, None, None

    url, key = config
    clean_symbol = clean_ticker(symbol)
    try:
        response = requests.get(
            f"{url}/rest/v1/{SUPABASE_FUNDAMENTAL_TABLE}",
            params={
                "market": f"eq.{clean_ticker(market) or 'KR'}",
                "symbol": f"eq.{clean_symbol}",
                "source": f"eq.{KIS_DOMESTIC_FUNDAMENTAL_SOURCE}",
                "select": "payload,fetched_at,expires_at,stale_expires_at",
                "limit": "1",
            },
            headers=supabase_headers(key),
            timeout=SUPABASE_TIMEOUT_SECONDS,
        )
        if response.status_code == 404:
            return None, None, kis_domestic_cache_meta("supabase", "miss", error="table_missing"), None
        if not response.ok:
            return None, None, kis_domestic_cache_meta("supabase", "miss", error=f"HTTP {response.status_code}"), None
        rows = response.json()
    except Exception as exc:
        return None, None, kis_domestic_cache_meta("supabase", "miss", error=str(exc)), None

    if not isinstance(rows, list) or not rows:
        return None, None, kis_domestic_cache_meta("supabase", "miss"), None

    row = rows[0] if isinstance(rows[0], dict) else {}
    payload = row.get("payload")
    if not isinstance(payload, dict) or payload.get("version") != KIS_DOMESTIC_FUNDAMENTAL_CACHE_VERSION:
        return None, None, kis_domestic_cache_meta("supabase", "miss", error="version_mismatch"), None

    state = supabase_cache_state(row, datetime.now(timezone.utc))
    if state is None:
        return None, None, kis_domestic_cache_meta("supabase", "expired"), payload

    normalized = payload.get("normalized") if isinstance(payload.get("normalized"), dict) else normalize_kis_domestic_fundamentals(payload)
    if not isinstance(normalized, dict) or not normalized:
        return None, None, kis_domestic_cache_meta("supabase", "expired", error="empty_payload"), payload

    return normalized, state, kis_domestic_cache_meta(
        "supabase",
        state,
        fetched_at=row.get("fetched_at"),
        expires_at=row.get("expires_at"),
        stale_expires_at=row.get("stale_expires_at"),
    ), payload


def write_supabase_kis_domestic_fundamental_cache(
    symbol: str,
    raw: dict[str, Any],
    normalized: dict[str, Any] | None = None,
    *,
    market: str = "KR",
    period_type: str = "annual",
    errors: dict[str, str] | None = None,
) -> tuple[bool, dict[str, Any]]:
    payload = kis_domestic_fundamental_cache_payload(
        symbol,
        raw,
        normalized,
        period_type=period_type,
        errors=errors,
    )
    config = supabase_write_config()
    if not config:
        return False, payload

    url, key = config
    row = {
        "market": clean_ticker(market) or "KR",
        "symbol": clean_ticker(symbol),
        "source": KIS_DOMESTIC_FUNDAMENTAL_SOURCE,
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
        write_supabase_normalized_fundamental_latest(
            symbol,
            normalized or {},
            market=market,
            provider="kis",
            source=KIS_DOMESTIC_FUNDAMENTAL_SOURCE,
            payload=payload,
            fiscal_period=payload.get("period") if isinstance(payload.get("period"), str) else None,
            report_type=period_type,
            currency="KRW",
        )
        return response.ok, payload
    except Exception:
        return False, payload


def kis_domestic_fundamentals(
    symbol: str,
    market: str = "KR",
    fetcher: Any | None = None,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    market = clean_ticker(market) or "KR"
    clean_symbol = clean_ticker(symbol)
    cached_values, cached_state, cached_meta, cached_payload = read_supabase_kis_domestic_fundamental_cache(clean_symbol, market)
    if cached_values and cached_state == "fresh":
        return cached_values, cached_meta or kis_domestic_cache_meta("supabase", "fresh"), cached_payload or {}

    stale_values = cached_values if cached_values and cached_state == "stale" else None
    stale_meta = cached_meta if cached_values and cached_state == "stale" else None
    stale_payload = cached_payload if cached_values and cached_state == "stale" else None

    if not kis_domestic_request_fetch_enabled():
        if stale_values:
            return stale_values, {
                **(stale_meta or kis_domestic_cache_meta("supabase", "stale")),
                "provider_fetch": "disabled",
            }, stale_payload or {}
        return {}, kis_domestic_cache_meta("provider", "miss", provider_fetch="disabled"), {}

    if fetcher is None:
        from .kis_client import kis_domestic_finance_bundle

        fetcher = kis_domestic_finance_bundle

    lock_path = Path.cwd() / f".kis_domestic_fundamentals_{clean_symbol}.lock"
    with one_byte_file_lock(lock_path):
        cached_values, cached_state, cached_meta, cached_payload = read_supabase_kis_domestic_fundamental_cache(clean_symbol, market)
        if cached_values and cached_state == "fresh":
            return cached_values, cached_meta or kis_domestic_cache_meta("supabase", "fresh"), cached_payload or {}
        if cached_values and cached_state == "stale":
            stale_values = cached_values
            stale_meta = cached_meta
            stale_payload = cached_payload

        try:
            bundle = fetcher(clean_symbol)
            raw = bundle.get("raw") if isinstance(bundle, dict) and isinstance(bundle.get("raw"), dict) else {}
            errors = bundle.get("errors") if isinstance(bundle, dict) and isinstance(bundle.get("errors"), dict) else {}
            period_type = str(bundle.get("period_type") or "annual") if isinstance(bundle, dict) else "annual"
            normalized = normalize_kis_domestic_fundamentals(raw)
            if normalized:
                supabase_written, payload = write_supabase_kis_domestic_fundamental_cache(
                    clean_symbol,
                    raw,
                    normalized,
                    market=market,
                    period_type=period_type,
                    errors=errors,
                )
                return normalized, kis_domestic_cache_meta(
                    "provider",
                    "refreshed",
                    persisted="supabase" if supabase_written else "memory",
                ), payload
            if stale_values:
                return stale_values, {
                    **(stale_meta or kis_domestic_cache_meta("supabase", "stale")),
                    "refresh_error": "empty_provider_payload",
                }, stale_payload or {}
            payload = kis_domestic_fundamental_cache_payload(clean_symbol, raw, {}, period_type=period_type, errors=errors)
            return {}, kis_domestic_cache_meta("provider", "miss", error="empty_provider_payload"), payload
        except Exception as exc:
            if stale_values:
                return stale_values, {
                    **(stale_meta or kis_domestic_cache_meta("supabase", "stale")),
                    "refresh_error": str(exc),
                }, stale_payload or {}
            return {}, kis_domestic_cache_meta("provider", "miss", refresh_error=str(exc)), {}


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


def cached_payload_values_and_state(cached: dict[str, Any], now: datetime) -> tuple[dict[str, Any] | None, str | None]:
    values = cached.get("values")
    if not isinstance(values, dict) or cached.get("version") != YFINANCE_FUNDAMENTAL_CACHE_VERSION:
        return None, None

    field_classes = cached.get("field_classes")
    class_expires_at = cached.get("class_expires_at")
    class_stale_expires_at = cached.get("class_stale_expires_at")
    if not isinstance(field_classes, dict) or not isinstance(class_expires_at, dict) or not isinstance(class_stale_expires_at, dict):
        state = cached_payload_state(cached, now.timestamp())
        return (values, state) if state else (None, None)

    kept: dict[str, Any] = {}
    aggregate_state = "fresh"
    for field, value in values.items():
        field_class = str(field_classes.get(field) or fundamental_field_class(field))
        expires_at = parse_iso_datetime(class_expires_at.get(field_class))
        stale_expires_at = parse_iso_datetime(class_stale_expires_at.get(field_class))
        if expires_at and now <= expires_at:
            kept[field] = value
        elif stale_expires_at and now <= stale_expires_at:
            kept[field] = value
            aggregate_state = "stale"

    if not kept:
        return None, None
    return kept, aggregate_state


def read_yfinance_fundamental_cache(symbol: str) -> tuple[dict[str, Any] | None, str | None]:
    path = yfinance_fundamental_cache_path(symbol)
    now = time.time()
    try:
        cached = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None, None
    if not isinstance(cached, dict):
        return None, None
    return cached_payload_values_and_state(cached, datetime.fromtimestamp(now, timezone.utc))


def write_yfinance_fundamental_cache(symbol: str, values: dict[str, Any], provider_mode: str | None = None) -> None:
    path = yfinance_fundamental_cache_path(symbol)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = fundamental_cache_payload(symbol, values, provider_mode=provider_mode)
    temp_path = path.with_suffix(".tmp")
    temp_path.write_text(json.dumps(payload, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    temp_path.replace(path)


def yfinance_fundamentals(symbol: str, market: str = "US") -> tuple[dict[str, Any], dict[str, Any]]:
    market = clean_ticker(market) or "US"
    clean_symbol = clean_ticker(symbol)
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

        quote_summary_error: str | None = None
        if market == "US" and yahoo_quote_summary_fetch_enabled():
            try:
                values = yahoo_quote_summary_fundamentals(clean_symbol)
                if values:
                    write_yfinance_fundamental_cache(clean_symbol, values, provider_mode="yahoo_quote_summary")
                    supabase_written = write_supabase_yfinance_fundamental_cache(
                        clean_symbol,
                        values,
                        market,
                        provider_mode="yahoo_quote_summary",
                    )
                    return values, yfinance_cache_meta(
                        "provider",
                        "refreshed",
                        provider_mode="yahoo_quote_summary",
                        persisted="supabase" if supabase_written else "file",
                    )
            except Exception as exc:
                quote_summary_error = str(exc)

        try:
            info = safe_info(yf.Ticker(symbol))
            values = {field: finite_or_none(info.get(field)) for field in YFINANCE_FUNDAMENTAL_FIELDS if info.get(field) is not None}
            if values:
                write_yfinance_fundamental_cache(symbol, values)
                supabase_written = write_supabase_yfinance_fundamental_cache(symbol, values, market)
                return values, yfinance_cache_meta(
                    "provider",
                    "refreshed",
                    provider_mode="yfinance_info",
                    yahoo_quote_summary_error=quote_summary_error,
                    persisted="supabase" if supabase_written else "file",
                )
        except Exception as exc:
            if stale_values:
                return stale_values, {
                    **(stale_meta or yfinance_cache_meta("unknown", "stale")),
                    "refresh_error": str(exc),
                    "yahoo_quote_summary_error": quote_summary_error,
                }
            return {}, yfinance_cache_meta("provider", "miss", refresh_error=str(exc), yahoo_quote_summary_error=quote_summary_error)

    if stale_values:
        return stale_values, stale_meta or yfinance_cache_meta("unknown", "stale")
    return {}, yfinance_cache_meta("provider", "miss")
