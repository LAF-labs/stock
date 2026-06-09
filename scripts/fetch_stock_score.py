from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import pandas as pd

try:
    from scripts.stock_score.formatting import (
        as_float,
        as_int,
        average,
        finite_or_none,
        first_float,
        krw_approx,
        labeled_money,
        money,
        num_label,
        pct,
        price_label,
        score_positive,
    )
except ModuleNotFoundError:
    from stock_score.formatting import (
        as_float,
        as_int,
        average,
        finite_or_none,
        first_float,
        krw_approx,
        labeled_money,
        money,
        num_label,
        pct,
        price_label,
        score_positive,
    )

try:
    from scripts.stock_score.technical_analysis import build_technical_analysis
except ModuleNotFoundError:
    from stock_score.technical_analysis import build_technical_analysis

try:
    from scripts.stock_score.timeseries import (
        CHART_SERIES_TRADING_YEAR_ROWS,
        atr_percent,
        build_chart_series,
        kis_chart_series,
        kis_domestic_chart_series,
        return_between,
        simple_rsi,
        yfinance_domestic_daily_rows,
    )
except ModuleNotFoundError:
    from stock_score.timeseries import (
        CHART_SERIES_TRADING_YEAR_ROWS,
        atr_percent,
        build_chart_series,
        kis_chart_series,
        kis_domestic_chart_series,
        return_between,
        simple_rsi,
        yfinance_domestic_daily_rows,
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
    from scripts.stock_score.io_utils import env_value, one_byte_file_lock
except ModuleNotFoundError:
    from stock_score.io_utils import env_value, one_byte_file_lock

try:
    from scripts.stock_score.kis_discovery_cache import (
        kis_discovery_cache_path,
        read_kis_discovery_cache,
        write_kis_discovery_cache,
    )
except ModuleNotFoundError:
    from stock_score.kis_discovery_cache import (
        kis_discovery_cache_path,
        read_kis_discovery_cache,
        write_kis_discovery_cache,
    )

try:
    from scripts.stock_score.kis_client import (
        KIS_DOMESTIC_SCORE_MARKET_DIV_CODE,
        KisApiError,
        discover_kis_stock,
        domestic_exchange_name,
        kis_access_token,
        kis_daily_rows,
        kis_date,
        kis_domestic_daily_rows,
        kis_domestic_news,
        kis_domestic_price,
        kis_domestic_search_info,
        kis_domestic_stock_info,
        kis_error_payload,
        kis_news,
        kis_percent,
    )
except ModuleNotFoundError:
    from stock_score.kis_client import (
        KIS_DOMESTIC_SCORE_MARKET_DIV_CODE,
        KisApiError,
        discover_kis_stock,
        domestic_exchange_name,
        kis_access_token,
        kis_daily_rows,
        kis_date,
        kis_domestic_daily_rows,
        kis_domestic_news,
        kis_domestic_price,
        kis_domestic_search_info,
        kis_domestic_stock_info,
        kis_error_payload,
        kis_news,
        kis_percent,
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
    from scripts.stock_score.provider_cache import (
        acquire_supabase_kis_token_issue_lock,
        kis_token_cache_key,
        read_local_kis_token_cache,
        read_supabase_kis_access_token,
        wait_for_supabase_kis_access_token,
        write_local_kis_token_cache,
        write_supabase_kis_access_token,
        yfinance_fundamentals,
    )
except ModuleNotFoundError:
    from stock_score.provider_cache import (
        acquire_supabase_kis_token_issue_lock,
        kis_token_cache_key,
        read_local_kis_token_cache,
        read_supabase_kis_access_token,
        wait_for_supabase_kis_access_token,
        write_local_kis_token_cache,
        write_supabase_kis_access_token,
        yfinance_fundamentals,
    )

try:
    from scripts.stock_score.yfinance_provider import safe_history_for_symbol
except ModuleNotFoundError:
    from stock_score.yfinance_provider import safe_history_for_symbol


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")


def technical_price_metrics_from_rows(
    rows: list[dict[str, Any]],
    *,
    close_key: str,
    high_key: str,
    low_key: str,
    volume_key: str,
    latest_price: float | None,
    previous_close: float | None,
) -> dict[str, Any]:
    closes = [float(row[close_key]) for row in rows if as_float(row.get(close_key)) is not None]
    highs = [as_float(row.get(high_key)) for row in rows]
    lows = [as_float(row.get(low_key)) for row in rows]
    year_high = max([value for value in highs[-252:] if value is not None], default=None)
    year_low = min([value for value in lows[-252:] if value is not None], default=None)
    ma50 = sum(closes[-50:]) / 50 if len(closes) >= 50 else None
    ma200 = sum(closes[-200:]) / 200 if len(closes) >= 200 else None
    ret_1m = return_between(closes, 21)
    ret_3m = return_between(closes, 63)
    ret_6m = return_between(closes, 126)
    ret_52w = return_between(closes, min(251, len(closes) - 1)) if len(closes) > 2 else None
    rsi14 = simple_rsi(closes, 14)
    history_df = pd.DataFrame(
        [{"High": as_float(row.get(high_key)), "Low": as_float(row.get(low_key)), "Close": as_float(row.get(close_key))} for row in rows]
    )
    atr14, atr14_pct = atr_percent(history_df.dropna(subset=["Close"]) if not history_df.empty else history_df, 14)
    distance_52w_high = ((latest_price / year_high) - 1.0) if latest_price and year_high else None
    return {
        "price": latest_price,
        "previous_close": previous_close,
        "latest_change": (((latest_price / previous_close) - 1.0) if latest_price and previous_close else None),
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
        "avg_volume_20": average([as_float(row.get(volume_key)) for row in rows[-20:]]) if rows else None,
        "avg_volume_60": average([as_float(row.get(volume_key)) for row in rows[-60:]]) if rows else None,
    }


def fetch_technical_score_kis_us(raw_ticker: str) -> dict[str, Any]:
    symbol = clean_ticker(raw_ticker)
    if not symbol or not TICKER_RE.match(symbol):
        return {"ok": False, "status": 400, "error": "invalid_ticker", "message": "정확한 미국 주식 티커만 입력하세요."}

    cached = read_kis_discovery_cache(symbol)
    discovered: dict[str, Any] | None = None
    if cached:
        market = cached["market"]
        search = cached.get("search") if isinstance(cached.get("search"), dict) else {}
        detail: dict[str, Any] = {}
    else:
        try:
            discovered = discover_kis_stock(symbol)
        except KisApiError as exc:
            fallback = fetch_technical_score_yfinance_us(raw_ticker, symbol, exc)
            if fallback.get("ok") is True:
                return fallback
            return kis_error_payload(exc)
        market = discovered["market"]
        search = discovered.get("search") if isinstance(discovered.get("search"), dict) else {}
        detail = discovered.get("detail") if isinstance(discovered.get("detail"), dict) else {}

    excd = str(market["excd"])
    try:
        daily_rows = kis_daily_rows(excd, symbol)
    except Exception:
        daily_rows = []

    currency = str(detail.get("curr") or search.get("tr_crcy_cd") or "USD")
    usd_krw = as_float(detail.get("t_rate")) if currency == "USD" else None
    latest_row = daily_rows[-1] if daily_rows else {}
    previous_row = daily_rows[-2] if len(daily_rows) >= 2 else {}
    latest_price = as_float(latest_row.get("clos")) or as_float(detail.get("last"))
    previous_close = as_float(previous_row.get("clos")) or as_float(detail.get("base"))
    latest_date = kis_date(latest_row.get("xymd")) if latest_row else datetime.now(timezone.utc).date().isoformat()
    name = str(search.get("prdt_eng_name") or search.get("ovrs_item_name") or search.get("prdt_name") or symbol)
    exchange = str(search.get("ovrs_excg_name") or market.get("label") or excd)
    price_metrics = technical_price_metrics_from_rows(
        daily_rows,
        close_key="clos",
        high_key="high",
        low_key="low",
        volume_key="tvol",
        latest_price=latest_price,
        previous_close=previous_close,
    )
    return build_technical_score_payload(
        raw_ticker=raw_ticker,
        market="US",
        symbol=symbol,
        name=name,
        exchange=exchange,
        currency=currency,
        latest_price=latest_price,
        latest_date=latest_date,
        chart_series=kis_chart_series(daily_rows, currency, usd_krw),
        price_metrics=price_metrics,
        fetch_source="market_data",
        fetch_extra={
            "daily_price_endpoint": "/uapi/overseas-price/v1/quotations/dailyprice",
            "provider_mode": "technical_fast_path",
            "exchange_code": excd,
            "history_rows": len(daily_rows),
            "discovery_cache": "hit" if cached else "miss",
        },
    )


def fetch_technical_score_yfinance_us(raw_ticker: str, symbol: str, error: Exception | None = None) -> dict[str, Any]:
    history = safe_history_for_symbol(symbol)
    if history.empty:
        return {"ok": False, "status": 404, "error": "not_found", "message": f"{symbol}의 기술 분석용 일봉 데이터를 찾지 못했습니다."}

    chart_series = build_chart_series(history, "USD", None)
    latest_row = chart_series[-1] if chart_series else {}
    previous_row = chart_series[-2] if len(chart_series) >= 2 else {}
    latest_price = as_float(latest_row.get("close"))
    previous_close = as_float(previous_row.get("close"))
    latest_date = str(latest_row.get("date") or datetime.now(timezone.utc).date().isoformat())
    price_metrics = technical_price_metrics_from_rows(
        chart_series,
        close_key="close",
        high_key="high",
        low_key="low",
        volume_key="volume",
        latest_price=latest_price,
        previous_close=previous_close,
    )
    return build_technical_score_payload(
        raw_ticker=raw_ticker,
        market="US",
        symbol=symbol,
        name=symbol,
        exchange="US",
        currency="USD",
        latest_price=latest_price,
        latest_date=latest_date,
        chart_series=chart_series,
        price_metrics=price_metrics,
        fetch_source="yfinance",
        fetch_extra={
            "provider_mode": "technical_fast_path",
            "history_source": "yfinance",
            "history_rows": len(chart_series),
            "kis_fallback_error": str(error or "")[:200] or None,
        },
    )


def fetch_technical_score_kis_domestic(raw_ticker: str) -> dict[str, Any]:
    symbol = clean_ticker(raw_ticker)
    if not symbol or not KR_TICKER_RE.match(symbol):
        return {"ok": False, "status": 400, "error": "invalid_ticker", "message": "정확한 국내 주식 종목코드만 입력하세요."}

    try:
        daily_rows = kis_domestic_daily_rows(symbol)
    except Exception:
        daily_rows = []

    latest_row = daily_rows[-1] if daily_rows else {}
    previous_row = daily_rows[-2] if len(daily_rows) >= 2 else {}
    latest_price = as_float(latest_row.get("stck_clpr"))
    previous_close = as_float(previous_row.get("stck_clpr"))
    latest_date = kis_date(latest_row.get("stck_bsop_date")) if latest_row else datetime.now(timezone.utc).date().isoformat()
    price_metrics = technical_price_metrics_from_rows(
        daily_rows,
        close_key="stck_clpr",
        high_key="stck_hgpr",
        low_key="stck_lwpr",
        volume_key="acml_vol",
        latest_price=latest_price,
        previous_close=previous_close,
    )
    return build_technical_score_payload(
        raw_ticker=raw_ticker,
        market="KR",
        symbol=symbol,
        name=symbol,
        exchange="KRX",
        currency="KRW",
        latest_price=latest_price,
        latest_date=latest_date,
        chart_series=kis_domestic_chart_series(daily_rows),
        price_metrics=price_metrics,
        fetch_source="market_data",
        fetch_extra={
            "daily_price_endpoint": "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice",
            "provider_mode": "technical_fast_path",
            "history_rows": len(daily_rows),
        },
    )


def fetch_score_kis_us(raw_ticker: str, view: str = "detail", usd_krw_override: float | None = None, use_rate_override: bool = False) -> dict[str, Any]:
    symbol = clean_ticker(raw_ticker)
    if not symbol or not TICKER_RE.match(symbol):
        return {"ok": False, "status": 400, "error": "invalid_ticker", "message": "정확한 미국 주식 티커만 입력하세요."}
    if view == "technical":
        return fetch_technical_score_kis_us(raw_ticker)

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
            "summary": "거래량과 시가총액으로 거래 체력을 봐요.",
            "metrics": [
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
        {"label": "최근 가격일", "value": latest_date},
        {"label": "52주 고가", "value": labeled_money(year_high, currency, usd_krw)},
        {"label": "52주 저가", "value": labeled_money(year_low, currency, usd_krw)},
        {"label": "상장주식수", "value": num_label(listed_shares, "주")},
        {"label": "상장일자", "value": kis_date(search.get("lstg_dt")) or "-"},
    ]

    valuation_rows = [
        {"label": "PER", "value": f"{trailing_pe:.2f}" if trailing_pe is not None and trailing_pe > 0 else "-"},
        {"label": "Forward PER", "value": f"{forward_pe:.2f}" if forward_pe is not None and forward_pe > 0 else "-"},
        {"label": "PBR", "value": f"{price_to_book:.2f}" if price_to_book is not None else "-"},
        {"label": "EV/Revenue", "value": f"{ev_to_revenue:.2f}" if ev_to_revenue is not None else "-"},
        {"label": "Price/Sales", "value": f"{price_to_sales:.2f}" if price_to_sales is not None else "-"},
        {"label": "평균 목표가", "value": price_label(target_mean_price, currency)},
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
    if view == "technical":
        return build_technical_score_payload(
            raw_ticker=raw_ticker,
            market="US",
            symbol=symbol,
            name=name,
            exchange=exchange,
            currency=currency,
            latest_price=latest_price,
            latest_date=latest_date,
            chart_series=chart_series,
            price_metrics=price_metrics,
            fetch_source="market_data",
            fetch_extra={
                "price_endpoint": "/uapi/overseas-price/v1/quotations/price",
                "dailyprice_endpoint": "/uapi/overseas-price/v1/quotations/dailyprice",
                "input_mode": "exact_ticker_only",
                "market_scope": "US listed equity",
                "exchange_code": excd,
                "history_rows": len(daily_rows),
            },
        )
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


def fetch_score_kis_domestic(raw_ticker: str, view: str = "detail", usd_krw_override: float | None = None, use_rate_override: bool = False) -> dict[str, Any]:
    symbol = clean_ticker(raw_ticker)
    if not symbol or not KR_TICKER_RE.match(symbol):
        return {"ok": False, "status": 400, "error": "invalid_ticker", "message": "정확한 국내 주식 종목코드만 입력하세요."}
    if view == "technical":
        return fetch_technical_score_kis_domestic(raw_ticker)

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
    history_source = "kis"
    if len(daily_rows) < CHART_SERIES_TRADING_YEAR_ROWS:
        yfinance_rows = yfinance_domestic_daily_rows(safe_history_for_symbol(yahoo_symbol))
        if len(yfinance_rows) > len(daily_rows):
            daily_rows = yfinance_rows
            history_source = "yfinance"
    closes = [float(row["stck_clpr"]) for row in daily_rows if as_float(row.get("stck_clpr")) is not None]
    latest_history_close = closes[-1] if closes else None
    latest_price = as_float(price.get("stck_prpr")) or latest_history_close
    previous_close = as_float(price.get("stck_sdpr")) or (closes[-2] if len(closes) >= 2 else None)
    latest_change = kis_percent(price.get("prdy_ctrt")) or (((latest_price / previous_close) - 1.0) if latest_price and previous_close else None)
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
            "summary": "유동성, 규모, 부채와 현금흐름 체력을 봐요.",
            "metrics": [
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
        {"label": "평균 목표가", "value": price_label(target_mean_price, currency)},
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
    if view == "technical":
        return build_technical_score_payload(
            raw_ticker=raw_ticker,
            market="KR",
            symbol=symbol,
            name=name,
            exchange=exchange,
            currency=currency,
            latest_price=latest_price,
            latest_date=latest_date,
            chart_series=chart_series,
            price_metrics=price_metrics,
            fetch_source="market_data",
            fetch_extra={
                "price_endpoint": "/uapi/domestic-stock/v1/quotations/inquire-price",
                "dailyprice_endpoint": "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice",
                "input_mode": "symbol_master_selection",
                "market_scope": "KR listed equity",
                "exchange_code": exchange,
                "history_rows": len(daily_rows),
                "history_source": history_source,
            },
        )
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
            "history_source": history_source,
        },
    }


def fetch_score(raw_ticker: str, view: str = "detail", usd_krw_override: float | None = None, use_rate_override: bool = False) -> dict[str, Any]:
    market, symbol = parse_symbol_ref(raw_ticker)
    if market == "KR":
        return fetch_score_kis_domestic(symbol, view=view, usd_krw_override=usd_krw_override, use_rate_override=use_rate_override)
    return fetch_score_kis_us(symbol, view=view, usd_krw_override=usd_krw_override, use_rate_override=use_rate_override)


def build_technical_score_payload(
    *,
    raw_ticker: str,
    market: str,
    symbol: str,
    name: str,
    exchange: str,
    currency: str,
    latest_price: float | None,
    latest_date: str,
    chart_series: list[dict[str, Any]],
    price_metrics: dict[str, Any],
    fetch_source: str,
    fetch_extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    technical_analysis = build_technical_analysis(chart_series)
    technical_analysis["ticker"] = f"{market}:{symbol}"
    technical_analysis["market"] = market
    technical_analysis["symbol"] = symbol
    return {
        "ok": True,
        "app": "Stock Score Reader",
        "requested_ticker": raw_ticker,
        "market": market,
        "symbol": symbol,
        "name": name,
        "exchange": exchange,
        "currency": currency,
        "score_model_version": SCORE_MODEL_VERSION,
        "latest_price": latest_price,
        "latest_bar_date": latest_date,
        "chart_series": chart_series,
        "price_metrics": price_metrics,
        "technical_analysis": technical_analysis,
        "fetch": {
            "source": fetch_source,
            "score_model_version": SCORE_MODEL_VERSION,
            "fetched_at": now.isoformat(),
            "cache": "no-store",
            "view": "technical",
            **(fetch_extra or {}),
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
    parser.add_argument("--view", choices=["detail", "compare", "technical"], default="detail")
    args = parser.parse_args()

    tickers = parse_batch_tickers(args.tickers)
    if tickers:
        results = [fetch_score(ticker, view=args.view) for ticker in tickers]
        payload = {
            "ok": any(result.get("ok") is True for result in results),
            "results": results,
        }
    else:
        if not args.ticker:
            parser.error("ticker is required unless --tickers is provided")
        payload = fetch_score(args.ticker, view=args.view)
    print(json.dumps(payload, ensure_ascii=False, allow_nan=False, default=json_default))
    return 0


if __name__ == "__main__":
    sys.exit(main())
