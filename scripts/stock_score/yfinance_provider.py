from __future__ import annotations

from typing import Any

import pandas as pd
import yfinance as yf

from .formatting import as_float, as_int, finite_or_none, num_label, price_label


def safe_info(ticker: Any) -> dict[str, Any]:
    try:
        info = ticker.info
        return info if isinstance(info, dict) else {}
    except Exception:
        return {}


def safe_fast_info(ticker: Any) -> dict[str, Any]:
    try:
        return dict(ticker.fast_info)
    except Exception:
        return {}


def safe_history(ticker: Any) -> pd.DataFrame:
    try:
        data = ticker.history(period="1y", interval="1d", auto_adjust=False, actions=False)
        return data.dropna(subset=["Close"]) if not data.empty else data
    except Exception:
        return pd.DataFrame()


def safe_intraday(ticker: Any) -> list[dict[str, Any]]:
    try:
        data = ticker.history(period="5d", interval="5m", auto_adjust=False, actions=False)
    except Exception:
        return []
    if data.empty:
        return []
    rows: list[dict[str, Any]] = []
    for index, row in data.tail(120).iterrows():
        close = as_float(row.get("Close"))
        if close is None:
            continue
        rows.append(
            {
                "ts": index.isoformat() if hasattr(index, "isoformat") else str(index),
                "close": close,
                "close_label": price_label(close),
                "volume": as_int(row.get("Volume")),
                "volume_label": num_label(as_int(row.get("Volume")), "주"),
            }
        )
    return rows


def usd_krw_rate() -> float | None:
    try:
        fast = dict(yf.Ticker("USDKRW=X").fast_info)
        return as_float(fast.get("lastPrice"))
    except Exception:
        return None


def latest_statement(statement: pd.DataFrame, labels: dict[str, str]) -> dict[str, Any]:
    if statement.empty:
        return {}
    try:
        latest_col = statement.columns[0]
        result: dict[str, Any] = {"reported_date": str(latest_col.date()) if hasattr(latest_col, "date") else str(latest_col)}
        for source_key, label in labels.items():
            if source_key in statement.index:
                result[label] = finite_or_none(statement.loc[source_key, latest_col])
        return result
    except Exception:
        return {}


def safe_news(ticker: Any) -> list[dict[str, Any]]:
    try:
        raw_news = ticker.news or []
    except Exception:
        return []
    news: list[dict[str, Any]] = []
    for item in raw_news[:6]:
        if not isinstance(item, dict):
            continue
        content = item.get("content") if isinstance(item.get("content"), dict) else item
        title = content.get("title") or item.get("title")
        link = content.get("canonicalUrl") or content.get("clickThroughUrl") or item.get("link")
        if isinstance(link, dict):
            link = link.get("url")
        provider = content.get("provider") or item.get("publisher")
        if isinstance(provider, dict):
            provider = provider.get("displayName")
        published = content.get("pubDate") or item.get("providerPublishTime")
        news.append(
            {
                "title": title,
                "publisher": provider,
                "link": link,
                "provider_publish_time": published if isinstance(published, int) else None,
                "published_at": published if isinstance(published, str) else None,
            }
        )
    return news
