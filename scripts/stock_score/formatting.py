from __future__ import annotations

import math
from datetime import datetime
from typing import Any, Iterable

import pandas as pd


def is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value))


def as_float(value: Any) -> float | None:
    if is_number(value):
        return float(value)
    if isinstance(value, str):
        cleaned = value.strip().replace(",", "")
        if not cleaned or cleaned in {"-", "."}:
            return None
        try:
            parsed = float(cleaned)
            return parsed if math.isfinite(parsed) else None
        except ValueError:
            return None
    return None


def first_float(*values: Any) -> float | None:
    for value in values:
        parsed = as_float(value)
        if parsed is not None:
            return parsed
    return None


def as_int(value: Any) -> int | None:
    parsed = as_float(value)
    if parsed is not None:
        return int(parsed)
    return None


def finite_or_none(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if hasattr(value, "item"):
        try:
            return finite_or_none(value.item())
        except Exception:
            return None
    return value


def score_positive(value: float | None, low: float, high: float, missing: float = 45.0) -> float:
    if value is None:
        return missing
    if high == low:
        return missing
    return max(0.0, min(100.0, ((value - low) / (high - low)) * 100.0))


def score_negative(value: float | None, good: float, bad: float, missing: float = 45.0) -> float:
    if value is None:
        return missing
    if bad == good:
        return missing
    return max(0.0, min(100.0, (1.0 - ((value - good) / (bad - good))) * 100.0))


def average(values: Iterable[float | None]) -> float:
    usable = [float(value) for value in values if value is not None and math.isfinite(float(value))]
    if not usable:
        return 45.0
    return sum(usable) / len(usable)


def pct(value: float | None) -> str:
    if value is None:
        return "-"
    return f"{value * 100:+.1f}%"


def num_label(value: float | int | None, suffix: str = "") -> str:
    if value is None:
        return "-"
    return f"{value:,.0f}{suffix}"


def money(value: float | int | None, currency: str = "USD") -> str:
    if value is None:
        return "-"
    sign = "-" if value < 0 else ""
    abs_value = abs(float(value))
    if currency == "USD":
        prefix = "$"
    elif currency == "KRW":
        prefix = "₩"
    else:
        prefix = f"{currency} "
    if abs_value >= 1_000_000_000_000:
        body = f"{abs_value / 1_000_000_000_000:.2f}T"
    elif abs_value >= 1_000_000_000:
        body = f"{abs_value / 1_000_000_000:.2f}B"
    elif abs_value >= 1_000_000:
        body = f"{abs_value / 1_000_000:.2f}M"
    elif abs_value >= 1_000:
        body = f"{abs_value:,.0f}"
    else:
        body = f"{abs_value:.2f}"
    return f"{sign}{prefix}{body}"


def price_label(value: float | None, currency: str = "USD") -> str:
    if value is None:
        return "-"
    if currency == "KRW":
        return f"{value:,.0f}원"
    prefix = "$" if currency == "USD" else f"{currency} "
    return f"{prefix}{value:,.2f}"


def krw_approx(value: float | None, usd_krw_rate: float | None) -> str | None:
    if value is None or usd_krw_rate is None:
        return None
    krw = value * usd_krw_rate
    if abs(krw) >= 1_000_000_000_000:
        return f"약 {krw / 1_000_000_000_000:.1f}조원"
    if abs(krw) >= 100_000_000:
        return f"약 {krw / 100_000_000:.1f}억원"
    if abs(krw) >= 10_000:
        return f"약 {krw / 10_000:.1f}만원"
    return f"약 {krw:,.0f}원"


def labeled_money(value: float | None, currency: str, usd_krw_rate: float | None) -> str:
    label = money(value, currency)
    approx = krw_approx(value, usd_krw_rate) if currency == "USD" else None
    return f"{label} ({approx})" if approx else label
