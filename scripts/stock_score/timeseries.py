from __future__ import annotations

from typing import Any

import pandas as pd

from .formatting import as_float, as_int, labeled_money, num_label, pct, price_label

CHART_SERIES_TRADING_YEAR_ROWS = 260


def return_between(closes: list[float], days: int) -> float | None:
    if len(closes) <= days:
        return None
    base = closes[-days - 1]
    latest = closes[-1]
    if not base:
        return None
    return (latest / base) - 1.0


def simple_rsi(closes: list[float], period: int = 14) -> float | None:
    if len(closes) <= period:
        return None
    gains: list[float] = []
    losses: list[float] = []
    for current, previous in zip(closes[-period:], closes[-period - 1 : -1]):
        change = current - previous
        gains.append(max(change, 0.0))
        losses.append(abs(min(change, 0.0)))
    avg_gain = sum(gains) / period
    avg_loss = sum(losses) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100.0 - (100.0 / (1.0 + rs))


def atr_percent(history: pd.DataFrame, period: int = 14) -> tuple[float | None, float | None]:
    if len(history) <= period:
        return None, None
    true_ranges: list[float] = []
    closes = history["Close"].tolist()
    for idx in range(1, len(history)):
        high = as_float(history.iloc[idx]["High"])
        low = as_float(history.iloc[idx]["Low"])
        prev_close = as_float(closes[idx - 1])
        if high is None or low is None or prev_close is None:
            continue
        true_ranges.append(max(high - low, abs(high - prev_close), abs(low - prev_close)))
    if len(true_ranges) < period:
        return None, None
    atr = sum(true_ranges[-period:]) / period
    latest = as_float(closes[-1])
    return atr, (atr / latest) if latest else None


def build_chart_series(history: pd.DataFrame, currency: str, usd_krw: float | None) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    previous_close: float | None = None
    for index, row in history.tail(CHART_SERIES_TRADING_YEAR_ROWS).iterrows():
        close = as_float(row.get("Close"))
        if close is None:
            continue
        open_value = as_float(row.get("Open"))
        high = as_float(row.get("High"))
        low = as_float(row.get("Low"))
        volume = as_int(row.get("Volume"))
        change = ((close / previous_close) - 1.0) if previous_close else None
        rows.append(
            {
                "date": _index_date(index),
                "open": open_value,
                "high": high,
                "low": low,
                "close": close,
                "volume": volume,
                "currency": currency,
                "open_label": price_label(open_value, currency),
                "high_label": price_label(high, currency),
                "low_label": price_label(low, currency),
                "close_label": labeled_money(close, currency, usd_krw),
                "volume_label": num_label(volume, "주"),
                "change_pct": change,
                "change_label": pct(change),
                "range_pct": ((high - low) / close) if high is not None and low is not None and close else None,
                "range_label": pct(((high - low) / close) if high is not None and low is not None and close else None),
                "ohl_label": f"{price_label(open_value, currency)} / {price_label(high, currency)} / {price_label(low, currency)}",
            }
        )
        previous_close = close
    return rows


def yfinance_domestic_daily_rows(history: pd.DataFrame) -> list[dict[str, Any]]:
    if history.empty:
        return []

    rows: list[dict[str, Any]] = []
    for index, row in history.iterrows():
        close = as_float(row.get("Close"))
        date = yfinance_history_date(index)
        if close is None or date is None:
            continue
        rows.append(
            {
                "stck_bsop_date": date,
                "stck_oprc": row.get("Open"),
                "stck_hgpr": row.get("High"),
                "stck_lwpr": row.get("Low"),
                "stck_clpr": close,
                "acml_vol": as_int(row.get("Volume")),
            }
        )
    rows.sort(key=lambda row: str(row.get("stck_bsop_date") or ""))
    return rows


def yfinance_history_date(index: Any) -> str | None:
    try:
        timestamp = pd.Timestamp(index)
        if pd.isna(timestamp):
            return None
        return timestamp.date().strftime("%Y%m%d")
    except Exception:
        value = str(index)[:10]
        if len(value) == 10 and value[4] == "-" and value[7] == "-":
            return value.replace("-", "")
        return None


def kis_chart_series(rows: list[dict[str, Any]], currency: str, usd_krw: float | None) -> list[dict[str, Any]]:
    chart: list[dict[str, Any]] = []
    previous_close: float | None = None
    for row in rows[-CHART_SERIES_TRADING_YEAR_ROWS:]:
        close = as_float(row.get("clos"))
        if close is None:
            continue
        open_value = as_float(row.get("open"))
        high = as_float(row.get("high"))
        low = as_float(row.get("low"))
        volume = as_int(row.get("tvol"))
        change = ((close / previous_close) - 1.0) if previous_close else _kis_percent(row.get("rate"))
        chart.append(
            {
                "date": _yyyymmdd_date(row.get("xymd")),
                "open": open_value,
                "high": high,
                "low": low,
                "close": close,
                "volume": volume,
                "currency": currency,
                "open_label": price_label(open_value, currency),
                "high_label": price_label(high, currency),
                "low_label": price_label(low, currency),
                "close_label": labeled_money(close, currency, usd_krw),
                "volume_label": num_label(volume, "주"),
                "change_pct": change,
                "change_label": pct(change),
                "range_pct": ((high - low) / close) if high is not None and low is not None and close else None,
                "range_label": pct(((high - low) / close) if high is not None and low is not None and close else None),
                "ohl_label": f"{price_label(open_value, currency)} / {price_label(high, currency)} / {price_label(low, currency)}",
            }
        )
        previous_close = close
    return chart


def kis_domestic_chart_series(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    chart: list[dict[str, Any]] = []
    previous_close: float | None = None
    for row in rows[-CHART_SERIES_TRADING_YEAR_ROWS:]:
        close = as_float(row.get("stck_clpr"))
        if close is None:
            continue
        open_value = as_float(row.get("stck_oprc"))
        high = as_float(row.get("stck_hgpr"))
        low = as_float(row.get("stck_lwpr"))
        volume = as_int(row.get("acml_vol"))
        change = ((close / previous_close) - 1.0) if previous_close else None
        chart.append(
            {
                "date": _yyyymmdd_date(row.get("stck_bsop_date")),
                "open": open_value,
                "high": high,
                "low": low,
                "close": close,
                "volume": volume,
                "currency": "KRW",
                "open_label": price_label(open_value, "KRW"),
                "high_label": price_label(high, "KRW"),
                "low_label": price_label(low, "KRW"),
                "close_label": price_label(close, "KRW"),
                "volume_label": num_label(volume, "주"),
                "change_pct": change,
                "change_label": pct(change),
                "range_pct": ((high - low) / close) if high is not None and low is not None and close else None,
                "range_label": pct(((high - low) / close) if high is not None and low is not None and close else None),
                "ohl_label": f"{price_label(open_value, 'KRW')} / {price_label(high, 'KRW')} / {price_label(low, 'KRW')}",
            }
        )
        previous_close = close
    return chart


def _index_date(index: Any) -> str:
    return index.date().isoformat() if hasattr(index, "date") else str(index)


def _yyyymmdd_date(value: Any) -> str | None:
    text = str(value or "").strip()
    if len(text) == 8 and text.isdigit():
        return f"{text[:4]}-{text[4:6]}-{text[6:8]}"
    return None


def _kis_percent(value: Any) -> float | None:
    parsed = as_float(value)
    if parsed is None:
        return None
    return parsed / 100.0
