from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .formatting import as_float, finite_or_none
from .symbols import clean_ticker


KIS_DOMESTIC_FUNDAMENTAL_SOURCE = "kis_domestic_financials"
KIS_DOMESTIC_FUNDAMENTAL_CACHE_VERSION = 1

KIS_DOMESTIC_FINANCE_ENDPOINTS = (
    {
        "key": "balance_sheet",
        "path": "/uapi/domestic-stock/v1/finance/balance-sheet",
        "tr_id": "FHKST66430100",
    },
    {
        "key": "income_statement",
        "path": "/uapi/domestic-stock/v1/finance/income-statement",
        "tr_id": "FHKST66430200",
    },
    {
        "key": "financial_ratio",
        "path": "/uapi/domestic-stock/v1/finance/financial-ratio",
        "tr_id": "FHKST66430300",
    },
    {
        "key": "profit_ratio",
        "path": "/uapi/domestic-stock/v1/finance/profit-ratio",
        "tr_id": "FHKST66430400",
    },
    {
        "key": "other_major_ratios",
        "path": "/uapi/domestic-stock/v1/finance/other-major-ratios",
        "tr_id": "FHKST66430500",
    },
    {
        "key": "stability_ratio",
        "path": "/uapi/domestic-stock/v1/finance/stability-ratio",
        "tr_id": "FHKST66430600",
    },
    {
        "key": "growth_ratio",
        "path": "/uapi/domestic-stock/v1/finance/growth-ratio",
        "tr_id": "FHKST66430800",
    },
)


def kis_period_type(period: str) -> str:
    return "quarterly" if str(period).strip() == "1" else "annual"


def normalized_kis_symbol(symbol: str) -> str:
    return clean_ticker(symbol)


def compact_finite_mapping(values: dict[str, Any]) -> dict[str, Any]:
    compacted: dict[str, Any] = {}
    for key, value in values.items():
        finite_value = finite_or_none(value)
        if finite_value is not None:
            compacted[key] = finite_value
    return compacted


def row_list(payload: dict[str, Any], key: str) -> list[dict[str, Any]]:
    rows = payload.get(key)
    if isinstance(rows, dict):
        rows = [rows]
    if not isinstance(rows, list):
        return []
    return [row for row in rows if isinstance(row, dict)]


def latest_row(payload: dict[str, Any], key: str) -> dict[str, Any]:
    rows = row_list(payload, key)
    if not rows:
        return {}
    return max(rows, key=lambda row: str(row.get("stac_yymm") or ""))


def pct_to_ratio(value: Any) -> float | None:
    parsed = as_float(value)
    return parsed / 100.0 if parsed is not None else None


def percent_ratio_to_multiple(value: Any) -> float | None:
    parsed = as_float(value)
    if parsed is None:
        return None
    return parsed / 100.0 if abs(parsed) > 10 else parsed


def ratio_as_reported(value: Any) -> float | None:
    return as_float(value)


def divide(numerator: Any, denominator: Any) -> float | None:
    parsed_numerator = as_float(numerator)
    parsed_denominator = as_float(denominator)
    if parsed_numerator is None or not parsed_denominator:
        return None
    return parsed_numerator / parsed_denominator


def first_present(*values: Any) -> float | None:
    for value in values:
        parsed = as_float(value)
        if parsed is not None:
            return parsed
    return None


def first_ratio(*values: Any) -> float | None:
    for value in values:
        parsed = pct_to_ratio(value)
        if parsed is not None:
            return parsed
    return None


def normalize_kis_domestic_fundamentals(payload: dict[str, Any]) -> dict[str, Any]:
    raw = payload.get("raw") if isinstance(payload.get("raw"), dict) else payload
    if not isinstance(raw, dict):
        return {}

    balance = latest_row(raw, "balance_sheet")
    income = latest_row(raw, "income_statement")
    financial = latest_row(raw, "financial_ratio")
    profit = latest_row(raw, "profit_ratio")
    other = latest_row(raw, "other_major_ratios")
    stability = latest_row(raw, "stability_ratio")
    growth = latest_row(raw, "growth_ratio")

    revenue = first_present(income.get("sale_account"))
    operating_income = first_present(income.get("bsop_prti"))
    net_income = first_present(income.get("thtr_ntin"))
    total_assets = first_present(balance.get("total_aset"))
    total_liabilities = first_present(balance.get("total_lblt"))
    total_equity = first_present(balance.get("total_cptl"))
    profit_margin = first_ratio(profit.get("sale_ntin_rate"))
    if profit_margin is None:
        profit_margin = divide(net_income, revenue)

    period_candidates = [
        financial.get("stac_yymm"),
        income.get("stac_yymm"),
        balance.get("stac_yymm"),
        profit.get("stac_yymm"),
        stability.get("stac_yymm"),
        growth.get("stac_yymm"),
        other.get("stac_yymm"),
    ]
    period = next((str(value) for value in period_candidates if str(value or "").strip()), None)

    normalized = {
        "period": period,
        "periodEnded": period,
        "totalRevenue": revenue,
        "operatingIncome": operating_income,
        "netIncome": net_income,
        "totalAssets": total_assets,
        "currentAssets": first_present(balance.get("cras")),
        "totalLiabilities": total_liabilities,
        "currentLiabilities": first_present(balance.get("flow_lblt")),
        "totalEquity": total_equity,
        "operatingMargins": divide(operating_income, revenue),
        "profitMargins": profit_margin,
        "grossMargins": first_ratio(profit.get("sale_totl_rate")),
        "returnOnEquity": first_ratio(financial.get("roe_val"), profit.get("self_cptl_ntin_inrt")),
        "revenueGrowth": first_ratio(financial.get("grs"), growth.get("grs")),
        "operatingIncomeGrowth": first_ratio(financial.get("bsop_prfi_inrt"), growth.get("bsop_prfi_inrt")),
        "earningsGrowth": first_ratio(financial.get("ntin_inrt")),
        "equityGrowth": first_ratio(growth.get("equt_inrt")),
        "assetGrowth": first_ratio(growth.get("totl_aset_inrt")),
        "eps": first_present(financial.get("eps")),
        "bps": first_present(financial.get("bps")),
        "salesPerShare": first_present(financial.get("sps")),
        "reserveRatio": ratio_as_reported(financial.get("rsrv_rate")),
        "debtToEquity": ratio_as_reported(stability.get("lblt_rate") or financial.get("lblt_rate")),
        "borrowingsDependency": ratio_as_reported(stability.get("bram_depn")),
        "currentRatio": percent_ratio_to_multiple(stability.get("crnt_rate")),
        "quickRatio": percent_ratio_to_multiple(stability.get("quck_rate")),
        "payoutRatio": first_ratio(other.get("payout_rate")),
        "eva": first_present(other.get("eva")),
        "ebitda": first_present(other.get("ebitda")),
        "evToEbitda": first_present(other.get("ev_ebitda")),
    }
    return compact_finite_mapping(normalized)


def kis_domestic_fundamental_payload(
    symbol: str,
    raw: dict[str, Any],
    *,
    normalized: dict[str, Any] | None = None,
    period_type: str = "annual",
    errors: dict[str, str] | None = None,
    now: float | None = None,
    fresh_seconds: int,
    stale_seconds: int,
) -> dict[str, Any]:
    timestamp = datetime.now(timezone.utc).timestamp() if now is None else now
    fetched_at = datetime.fromtimestamp(timestamp, timezone.utc)
    expires_at = datetime.fromtimestamp(timestamp + fresh_seconds, timezone.utc)
    stale_expires_at = datetime.fromtimestamp(timestamp + stale_seconds, timezone.utc)
    normalized_values = normalized if normalized is not None else normalize_kis_domestic_fundamentals(raw)
    return {
        "version": KIS_DOMESTIC_FUNDAMENTAL_CACHE_VERSION,
        "source": KIS_DOMESTIC_FUNDAMENTAL_SOURCE,
        "symbol": normalized_kis_symbol(symbol),
        "period_type": period_type,
        "fetched_at": timestamp,
        "fetched_at_iso": fetched_at.isoformat(),
        "expires_at": expires_at.timestamp(),
        "expires_at_iso": expires_at.isoformat(),
        "stale_expires_at": stale_expires_at.timestamp(),
        "stale_expires_at_iso": stale_expires_at.isoformat(),
        "raw": raw,
        "normalized": normalized_values,
        "errors": errors or {},
    }
