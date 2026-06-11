from __future__ import annotations

import json
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import requests

from .formatting import as_float
from .io_utils import env_value, one_byte_file_lock
from .kis_discovery_cache import read_kis_discovery_cache, write_kis_discovery_cache
from .kis_domestic_fundamentals import KIS_DOMESTIC_FINANCE_ENDPOINTS, kis_period_type, normalized_kis_symbol
from .provider_cache import (
    acquire_supabase_kis_token_issue_lock,
    delete_supabase_kis_access_token,
    kis_token_cache_key,
    read_local_kis_token_cache,
    read_supabase_kis_access_token,
    wait_for_supabase_kis_access_token,
    write_local_kis_token_cache,
    write_supabase_kis_access_token,
)


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
KIS_DOMESTIC_SCORE_MARKET_DIV_CODE = "J"
KIS_DAILY_HISTORY_CALENDAR_DAYS = 365
KIS_DAILY_HISTORY_TOLERANCE_DAYS = 7
KIS_US_DAILY_MAX_PAGES = 6


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


def kis_access_token(skip_shared_cache: bool = False) -> str:
    config = kis_config()
    cache_key = kis_token_cache_key(config)
    cache_path = Path.cwd() / f".kis_token_cache_{cache_key}.json"
    lock_path = cache_path.with_suffix(".lock")

    with one_byte_file_lock(lock_path):
        cached = read_local_kis_token_cache(cache_path)
        if cached:
            return cached[0]

        if not skip_shared_cache:
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


def invalidate_kis_access_token(config: dict[str, str] | None = None) -> None:
    resolved = config or kis_config()
    cache_key = kis_token_cache_key(resolved)
    cache_path = Path.cwd() / f".kis_token_cache_{cache_key}.json"
    try:
        cache_path.unlink()
    except FileNotFoundError:
        pass
    except Exception:
        pass
    delete_supabase_kis_access_token(cache_key)


def kis_token_expired_message(message: str) -> bool:
    normalized = str(message or "").strip().lower()
    return "expired token" in normalized or ("만료" in normalized and ("token" in normalized or "토큰" in normalized))


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
    payload, message = kis_get_once(config, path, tr_id, params)
    if payload is not None:
        return payload
    if kis_token_expired_message(message):
        invalidate_kis_access_token(config)
        payload, retry_message = kis_get_once(config, path, tr_id, params, skip_shared_cache=True)
        if payload is not None:
            return payload
        raise KisApiError(str(retry_message))
    raise KisApiError(str(message))


def kis_get_once(config: dict[str, str], path: str, tr_id: str, params: dict[str, Any], skip_shared_cache: bool = False) -> tuple[dict[str, Any] | None, str]:
    kis_throttle()
    response = requests.get(
        f"{config['base_url']}{path}",
        headers={
            "content-type": "application/json; charset=utf-8",
            "authorization": f"Bearer {kis_access_token(skip_shared_cache=skip_shared_cache)}",
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
        return None, str(message)
    return payload, ""


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


def _kis_row_date(value: Any) -> date | None:
    text = str(value or "").strip()
    if len(text) != 8 or not text.isdigit():
        return None
    try:
        return datetime.strptime(text, "%Y%m%d").date()
    except ValueError:
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


def kis_daily_rows(excd: str, symbol: str, *, as_of: date | None = None, max_pages: int = KIS_US_DAILY_MAX_PAGES) -> list[dict[str, Any]]:
    end = as_of or datetime.now(timezone.utc).date()
    target_start = end - timedelta(days=KIS_DAILY_HISTORY_CALENDAR_DAYS)
    rows_by_date: dict[str, dict[str, Any]] = {}
    before = end

    for page_index in range(max(1, max_pages)):
        bymd = "" if page_index == 0 else before.strftime("%Y%m%d")
        payload = kis_get(
            "/uapi/overseas-price/v1/quotations/dailyprice",
            "HHDFS76240000",
            {"AUTH": "", "EXCD": excd, "SYMB": symbol, "GUBN": "0", "BYMD": bymd, "MODP": "1"},
        )
        page_rows = output_list(payload, "output2") or output_list(payload, "output")
        page_rows = [row for row in page_rows if kis_date(row.get("xymd")) and as_float(row.get("clos")) is not None]
        if not page_rows:
            break
        for row in page_rows:
            rows_by_date[str(row.get("xymd") or "")] = row
        page_dates = [_kis_row_date(row.get("xymd")) for row in page_rows]
        page_dates = [value for value in page_dates if value is not None]
        if not page_dates:
            break
        earliest = min(page_dates)
        if earliest <= target_start + timedelta(days=KIS_DAILY_HISTORY_TOLERANCE_DAYS):
            break
        next_before = earliest - timedelta(days=1)
        if next_before >= before:
            break
        before = next_before

    rows = list(rows_by_date.values())
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


def kis_domestic_finance_rows(
    symbol: str,
    endpoint_key: str,
    *,
    period: str = "0",
    market_div_code: str = KIS_DOMESTIC_SCORE_MARKET_DIV_CODE,
) -> list[dict[str, Any]]:
    endpoint = next((item for item in KIS_DOMESTIC_FINANCE_ENDPOINTS if item["key"] == endpoint_key), None)
    if endpoint is None:
        raise KisApiError(f"지원하지 않는 국내 재무 API입니다: {endpoint_key}")
    return output_list(
        kis_get(
            str(endpoint["path"]),
            str(endpoint["tr_id"]),
            {
                "FID_DIV_CLS_CODE": str(period),
                "FID_COND_MRKT_DIV_CODE": market_div_code,
                "FID_INPUT_ISCD": normalized_kis_symbol(symbol),
            },
        )
    )


def kis_domestic_finance_bundle(
    symbol: str,
    *,
    period: str = "0",
    market_div_code: str = KIS_DOMESTIC_SCORE_MARKET_DIV_CODE,
) -> dict[str, Any]:
    clean_symbol = normalized_kis_symbol(symbol)
    raw: dict[str, list[dict[str, Any]]] = {}
    errors: dict[str, str] = {}
    for endpoint in KIS_DOMESTIC_FINANCE_ENDPOINTS:
        key = str(endpoint["key"])
        try:
            rows = kis_domestic_finance_rows(clean_symbol, key, period=period, market_div_code=market_div_code)
            if rows:
                raw[key] = rows
        except Exception as exc:
            message = str(exc)
            errors[key] = message
            if "초당" in message or "거래건수" in message or "토큰" in message or "token" in message.lower():
                raise
    return {
        "symbol": clean_symbol,
        "period": str(period),
        "period_type": kis_period_type(str(period)),
        "market_div_code": market_div_code,
        "raw": raw,
        "errors": errors,
    }


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
        errors.append(f"{excd} detail: missing last")

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
