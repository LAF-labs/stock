from __future__ import annotations

import re


TICKER_RE = re.compile(r"^[A-Z][A-Z0-9.-]{0,11}$")
KR_TICKER_RE = re.compile(r"^(?:\d{6}|Q\d{6})$")


def clean_ticker(raw: str) -> str:
    return (raw or "").strip().replace(" ", "").replace("!", "").upper()


def parse_symbol_ref(raw: str) -> tuple[str, str]:
    text = clean_ticker(raw)
    if ":" in text:
        market, symbol = text.split(":", 1)
        market = market.upper()
        symbol = clean_ticker(symbol)
        if market in {"US", "KR"}:
            return market, symbol
    if KR_TICKER_RE.match(text):
        return "KR", text
    return "US", text


def domestic_yfinance_symbol(symbol: str, exchange: str) -> str:
    clean = clean_ticker(symbol)
    if clean.startswith("Q") and re.fullmatch(r"Q\d{6}", clean):
        clean = clean[1:]
    if not re.fullmatch(r"\d{6}", clean):
        return clean

    exchange_upper = clean_ticker(exchange)
    if exchange_upper in {"KOSDAQ", "KONEX"} or "KOSDAQ" in exchange_upper or "KONEX" in exchange_upper:
        return f"{clean}.KQ"
    return f"{clean}.KS"
