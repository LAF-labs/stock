from __future__ import annotations

from dataclasses import dataclass
from math import isfinite
from typing import Any, Iterable


MAX_TECHNICAL_BARS = 260


@dataclass(frozen=True)
class Bar:
    date: str
    open: float
    high: float
    low: float
    close: float
    volume: float | None


def coverage_tier_for_bars(count: int) -> str:
    if count <= 0:
        return "insufficient"
    if count < 20:
        return "starter"
    if count < 60:
        return "short"
    if count < 120:
        return "standard"
    if count < 200:
        return "full"
    return "long_history"


def build_technical_analysis(rows: Iterable[dict[str, Any]], latest_bar_closed: bool = True) -> dict[str, Any]:
    bars = normalize_bars(rows)
    tier = coverage_tier_for_bars(len(bars))
    signal_bars = bars if latest_bar_closed else bars[:-1]
    warnings = warnings_for_tier(tier, len(bars))

    if not signal_bars:
        return {
            "type": "technical_analysis",
            "version": "technical-v1",
            "timeframe": "1d",
            "status": "unavailable",
            "coverage_tier": tier,
            "bars": len(bars),
            "data_window": {
                "available_days": len(bars),
                "required_days": 20,
                "is_newly_listed": len(bars) > 0 and len(bars) < 60,
                "message": "가격 데이터가 부족해 기술적 분석을 계산할 수 없어요.",
            },
            "summary": {
                "tone": "limited",
                "headline": "아직 판단할 차트 데이터가 부족해요",
                "bullets": ["상장 초기이거나 가격 데이터가 충분히 쌓이지 않았어요."],
            },
            "signals": [],
            "indicators": [],
            "overlays": {},
            "warnings": warnings,
        }

    closes = [bar.close for bar in signal_bars]
    ema20 = ema_series(closes, 20)
    ema50 = ema_series(closes, 50)
    sma200 = sma_series(closes, 200)
    rsi14 = rsi_series(closes, 14)
    fvg_zones = detect_fvg(signal_bars)
    order_blocks = detect_order_blocks(signal_bars)
    fib = fibonacci_levels(signal_bars)

    signals = [
        moving_average_signal(signal_bars, ema20, ema50, sma200),
        ichimoku_signal(signal_bars),
        rsi_divergence_signal(signal_bars, rsi14),
        fvg_signal(fvg_zones),
        order_block_signal(order_blocks, signal_bars[-1].close),
        fibonacci_signal(signal_bars, fib),
        volume_candle_signal(signal_bars),
        trend_signal(signal_bars),
    ]
    signals = [signal for signal in signals if signal]
    indicators = indicator_cards(signals)
    confluence = confluence_for(signals, tier)
    summary = summary_for(signals, confluence, tier)

    data_window = {
        "available_days": len(bars),
        "required_days": 120,
        "start_date": bars[0].date,
        "end_date": bars[-1].date,
        "is_newly_listed": len(bars) < 60,
        "message": data_window_message(tier),
    }

    payload: dict[str, Any] = {
        "type": "technical_analysis",
        "version": "technical-v1",
        "timeframe": "1d",
        "status": "ready" if tier in {"standard", "full", "long_history"} else "limited",
        "coverage_tier": tier,
        "bars": len(bars),
        "closed_bar_date": signal_bars[-1].date,
        "data_window": data_window,
        "summary": summary,
        "signals": signals,
        "indicators": indicators,
        "overlays": {
            "moving_average": {
                "ema20": overlay_line(signal_bars, ema20),
                "ema50": overlay_line(signal_bars, ema50),
                "sma200": overlay_line(signal_bars, sma200),
            },
            "rsi14": overlay_line(signal_bars, rsi14),
            "fvg_zones": fvg_zones[-5:],
            "order_blocks": order_blocks[-4:],
            "fibonacci": fib,
        },
        "warnings": warnings,
        "glossary": glossary(),
    }
    if confluence is not None:
        payload["confluence"] = confluence
    if not latest_bar_closed:
        payload["warnings"].append("마지막 봉은 진행 중일 수 있어 점수 계산에서 제외했어요.")
    return payload


def normalize_bars(rows: Iterable[dict[str, Any]]) -> list[Bar]:
    bars: list[Bar] = []
    for row in rows:
        date = str(row.get("date") or row.get("ts") or "").strip()
        close = number(row.get("close"))
        if not date or close is None:
            continue
        open_price = number(row.get("open")) or close
        high = number(row.get("high"))
        low = number(row.get("low"))
        high = max(open_price, close) if high is None else high
        low = min(open_price, close) if low is None else low
        if low > high:
            low, high = high, low
        bars.append(
            Bar(
                date=date[:10],
                open=open_price,
                high=high,
                low=low,
                close=close,
                volume=number(row.get("volume")),
            )
        )
    bars.sort(key=lambda bar: bar.date)
    return bars[-MAX_TECHNICAL_BARS:]


def number(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        parsed = float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return None
    return parsed if isfinite(parsed) else None


def warnings_for_tier(tier: str, bars: int) -> list[str]:
    if tier == "insufficient":
        return ["가격 데이터가 없어 기술적 분석을 제공할 수 없어요."]
    if tier in {"starter", "short"}:
        return [f"상장 초기 또는 데이터 부족 구간이에요. 현재 {bars}개 일봉만 반영했어요."]
    return []


def data_window_message(tier: str) -> str:
    if tier == "starter":
        return "짧은 차트라 이평선·거래량처럼 빠른 신호만 참고하세요."
    if tier == "short":
        return "중기 구름·피보나치는 제한적으로만 해석하세요."
    return "주요 기술적 분석을 계산할 만큼 일봉 데이터가 쌓였어요."


def ema_series(values: list[float], period: int) -> list[float | None]:
    if not values:
        return []
    alpha = 2 / (period + 1)
    result: list[float | None] = []
    current: float | None = None
    for index, value in enumerate(values):
        current = value if current is None else value * alpha + current * (1 - alpha)
        result.append(round(current, 6) if index + 1 >= period else None)
    return result


def sma_series(values: list[float], period: int) -> list[float | None]:
    result: list[float | None] = []
    window_sum = 0.0
    for index, value in enumerate(values):
        window_sum += value
        if index >= period:
            window_sum -= values[index - period]
        result.append(round(window_sum / period, 6) if index + 1 >= period else None)
    return result


def rsi_series(values: list[float], period: int = 14) -> list[float | None]:
    if len(values) < 2:
        return [None for _ in values]
    result: list[float | None] = [None]
    gains: list[float] = []
    losses: list[float] = []
    avg_gain: float | None = None
    avg_loss: float | None = None
    for index in range(1, len(values)):
        change = values[index] - values[index - 1]
        gain = max(change, 0.0)
        loss = max(-change, 0.0)
        gains.append(gain)
        losses.append(loss)
        if index < period:
            result.append(None)
            continue
        if index == period:
            avg_gain = sum(gains[-period:]) / period
            avg_loss = sum(losses[-period:]) / period
        else:
            assert avg_gain is not None and avg_loss is not None
            avg_gain = (avg_gain * (period - 1) + gain) / period
            avg_loss = (avg_loss * (period - 1) + loss) / period
        if avg_loss == 0:
            result.append(100.0)
        else:
            rs = (avg_gain or 0.0) / avg_loss
            result.append(round(100 - (100 / (1 + rs)), 2))
    return result


def moving_average_signal(bars: list[Bar], ema20: list[float | None], ema50: list[float | None], sma200: list[float | None]) -> dict[str, Any]:
    latest = bars[-1]
    e20 = last_value(ema20)
    e50 = last_value(ema50)
    s200 = last_value(sma200)
    if e20 is None or e50 is None:
        return signal("moving_average", "이평선", "limited", "20·50일선 계산 전이에요.", f"일봉 {len(bars)}개", "trend", "20EMA와 50EMA의 위치를 봐요.")
    if latest.close > e20 > e50 and (s200 is None or latest.close > s200):
        return signal("moving_average", "이평선", "bullish", "가격이 단기·중기선 위에 있어요.", f"종가 {fmt(latest.close)} > EMA20 {fmt(e20)} > EMA50 {fmt(e50)}", "trend", "가격이 주요 이평선 위면 매수세가 우세해요.")
    if latest.close < e20 < e50:
        return signal("moving_average", "이평선", "bearish", "가격이 이평선 아래로 눌려 있어요.", f"종가 {fmt(latest.close)} < EMA20 {fmt(e20)} < EMA50 {fmt(e50)}", "trend", "가격이 이평선 아래면 반등 확인이 필요해요.")
    return signal("moving_average", "이평선", "neutral", "이평선 방향이 아직 섞여 있어요.", f"종가 {fmt(latest.close)} · EMA20 {fmt(e20)} · EMA50 {fmt(e50)}", "trend", "선들이 엇갈리면 방향 판단을 보류해요.")


def ichimoku_signal(bars: list[Bar]) -> dict[str, Any]:
    if len(bars) < 52:
        return signal("ichimoku", "일목구름", "limited", "구름 계산에 필요한 52봉 전이에요.", f"일봉 {len(bars)}개", "cloud", "전환선·기준선·구름 위치를 봐요.")
    tenkan = midpoint(bars[-9:])
    kijun = midpoint(bars[-26:])
    span_a = (tenkan + kijun) / 2
    span_b = midpoint(bars[-52:])
    cloud_top = max(span_a, span_b)
    cloud_bottom = min(span_a, span_b)
    close = bars[-1].close
    if close > cloud_top and tenkan > kijun:
        return signal("ichimoku", "일목구름", "bullish", "가격이 구름 위에 있어요.", f"종가 {fmt(close)} > 구름상단 {fmt(cloud_top)}", "cloud", "구름 위는 추세가 위로 열린 상태로 봐요.")
    if close < cloud_bottom and tenkan < kijun:
        return signal("ichimoku", "일목구름", "bearish", "가격이 구름 아래에 있어요.", f"종가 {fmt(close)} < 구름하단 {fmt(cloud_bottom)}", "cloud", "구름 아래는 저항 확인이 먼저예요.")
    return signal("ichimoku", "일목구름", "neutral", "가격이 구름 근처에서 방향을 고르고 있어요.", f"구름 {fmt(cloud_bottom)}~{fmt(cloud_top)}", "cloud", "구름 안팎에서는 돌파·이탈을 기다려요.")


def rsi_divergence_signal(bars: list[Bar], rsi14: list[float | None]) -> dict[str, Any]:
    latest_rsi = last_value(rsi14)
    if latest_rsi is None:
        return signal("rsi_divergence", "RSI 다이버전스", "limited", "RSI 계산에 필요한 데이터가 적어요.", f"일봉 {len(bars)}개", "momentum", "가격 저점·고점과 RSI 방향을 비교해요.")
    divergence = detect_rsi_divergence(bars, rsi14)
    if divergence == "bullish":
        return signal("rsi_divergence", "RSI 다이버전스", "bullish", "가격은 낮아졌지만 RSI는 버텼어요.", f"RSI14 {latest_rsi:.1f}", "momentum", "하락 중 RSI가 높아지면 매도세 둔화로 봐요.")
    if divergence == "bearish":
        return signal("rsi_divergence", "RSI 다이버전스", "bearish", "가격 고점 대비 RSI 힘이 줄었어요.", f"RSI14 {latest_rsi:.1f}", "momentum", "상승 중 RSI가 낮아지면 탄력 둔화로 봐요.")
    tone = "caution" if latest_rsi >= 70 else "bullish" if latest_rsi <= 30 else "neutral"
    plain = "과열권이라 식힘이 필요해요." if latest_rsi >= 70 else "과매도권 반등을 볼 수 있어요." if latest_rsi <= 30 else "RSI는 중립 구간이에요."
    return signal("rsi_divergence", "RSI 다이버전스", tone, plain, f"RSI14 {latest_rsi:.1f}", "momentum", "RSI 70 이상은 과열, 30 이하는 과매도로 봐요.")


def detect_rsi_divergence(bars: list[Bar], rsi14: list[float | None]) -> str | None:
    if len(bars) < 24:
        return None
    start = len(bars) - 24
    mid = len(bars) - 12
    left = range(start, mid)
    right = range(mid, len(bars))
    left_low = min(left, key=lambda index: bars[index].close)
    right_low = min(right, key=lambda index: bars[index].close)
    left_high = max(left, key=lambda index: bars[index].close)
    right_high = max(right, key=lambda index: bars[index].close)
    if usable_rsi(rsi14, left_low, right_low) and bars[right_low].close < bars[left_low].close * 0.995 and rsi14[right_low] > rsi14[left_low] + 3:
        return "bullish"
    if usable_rsi(rsi14, left_high, right_high) and bars[right_high].close > bars[left_high].close * 1.005 and rsi14[right_high] < rsi14[left_high] - 3:
        return "bearish"
    return None


def usable_rsi(values: list[float | None], left: int, right: int) -> bool:
    return values[left] is not None and values[right] is not None


def fvg_signal(zones: list[dict[str, Any]]) -> dict[str, Any]:
    if not zones:
        return signal("fvg", "ICT FVG", "neutral", "최근 뚜렷한 가격 갭은 없어요.", "최근 3봉 갭 없음", "ict", "3봉 사이 빈 가격대를 FVG로 봐요.")
    zone = zones[-1]
    tone = "bullish" if zone["direction"] == "bullish" else "bearish"
    plain = "매수 갭이 남아 되돌림 구간이에요." if tone == "bullish" else "매도 갭이 남아 저항 구간이에요."
    return signal("fvg", "ICT FVG", tone, plain, f"{zone['date']} 갭 {fmt(zone['low'])}~{fmt(zone['high'])}", "ict", "강한 캔들 뒤 빈 구간은 재방문 가능성이 있어요.")


def order_block_signal(blocks: list[dict[str, Any]], close: float) -> dict[str, Any]:
    if not blocks:
        return signal("order_block", "ICT OB", "neutral", "최근 기준 주문블록은 약해요.", "강한 반전 전 캔들 없음", "ict", "강한 이동 직전 반대 캔들을 OB로 봐요.")
    block = blocks[-1]
    in_zone = block["low"] <= close <= block["high"]
    tone = "bullish" if block["direction"] == "demand" else "caution"
    plain = "수요 주문블록 근처예요." if block["direction"] == "demand" else "공급 주문블록 근처예요."
    if not in_zone:
        plain = "가까운 주문블록을 참고하세요."
        tone = "neutral"
    return signal("order_block", "ICT OB", tone, plain, f"{block['date']} {fmt(block['low'])}~{fmt(block['high'])}", "ict", "OB 안에서는 반응 여부를 확인해요.")


def fibonacci_signal(bars: list[Bar], fib: dict[str, Any]) -> dict[str, Any]:
    if not fib.get("levels"):
        return signal("fibonacci", "피보나치", "limited", "피보나치 범위가 아직 짧아요.", f"일봉 {len(bars)}개", "levels", "최근 고점과 저점 사이 되돌림을 봐요.")
    close = bars[-1].close
    nearest = min(fib["levels"], key=lambda item: abs(close - item["price"]))
    distance = abs(close / nearest["price"] - 1) if nearest["price"] else 0
    tone = "neutral"
    plain = "주요 되돌림 가격 근처예요." if distance < 0.02 else "되돌림 기준선 사이에 있어요."
    return signal("fibonacci", "피보나치", tone, plain, f"{nearest['label']} {fmt(nearest['price'])}", "levels", "38.2·50·61.8%는 반응을 보기 좋은 선이에요.")


def volume_candle_signal(bars: list[Bar]) -> dict[str, Any]:
    latest = bars[-1]
    volumes = [bar.volume for bar in bars[-21:-1] if bar.volume is not None and bar.volume > 0]
    avg_volume = sum(volumes) / len(volumes) if volumes else None
    body = latest.close - latest.open
    if avg_volume is None or latest.volume is None:
        return signal("volume_candle", "거래량·캔들", "limited", "거래량 데이터가 부족해요.", "20일 평균 거래량 없음", "volume", "큰 거래량과 캔들 방향을 같이 봐요.")
    ratio = latest.volume / avg_volume if avg_volume else 0
    if body > 0 and ratio >= 1.5:
        return signal("volume_candle", "거래량·캔들", "bullish", "큰 거래량 양봉이 나왔어요.", f"거래량 {ratio:.1f}배", "volume", "거래량이 붙은 양봉은 수요 확인으로 봐요.")
    if body < 0 and ratio >= 1.5:
        return signal("volume_candle", "거래량·캔들", "bearish", "큰 거래량 음봉이라 주의예요.", f"거래량 {ratio:.1f}배", "volume", "거래량이 붙은 음봉은 매물 출회로 봐요.")
    return signal("volume_candle", "거래량·캔들", "neutral", "거래량은 평소 수준이에요.", f"거래량 {ratio:.1f}배", "volume", "거래량이 평균을 넘는지 확인해요.")


def trend_signal(bars: list[Bar]) -> dict[str, Any]:
    close = bars[-1].close
    ret20 = close / bars[-21].close - 1 if len(bars) >= 21 and bars[-21].close else None
    ret60 = close / bars[-61].close - 1 if len(bars) >= 61 and bars[-61].close else None
    recent_high = max(bar.high for bar in bars[-20:])
    recent_low = min(bar.low for bar in bars[-20:])
    if ret20 is not None and ret20 > 0.05 and (ret60 is None or ret60 > 0):
        return signal("trend", "추세", "bullish", "최근 추세는 위쪽이에요.", f"20일 {pct(ret20)} · 고점 {fmt(recent_high)}", "trend", "고점·저점과 20일 수익률을 함께 봐요.")
    if ret20 is not None and ret20 < -0.05 and (ret60 is None or ret60 < 0):
        return signal("trend", "추세", "bearish", "최근 추세는 아래쪽이에요.", f"20일 {pct(ret20)} · 저점 {fmt(recent_low)}", "trend", "하락 추세에서는 반등 확인이 먼저예요.")
    return signal("trend", "추세", "neutral", "추세는 아직 중립이에요.", f"20일 {pct(ret20)}", "trend", "방향이 애매하면 지지·저항 확인이 우선이에요.")


def detect_fvg(bars: list[Bar]) -> list[dict[str, Any]]:
    zones: list[dict[str, Any]] = []
    for index in range(2, len(bars)):
        left = bars[index - 2]
        current = bars[index]
        if current.low > left.high:
            zones.append(
                {
                    "direction": "bullish",
                    "date": current.date,
                    "low": round(left.high, 4),
                    "high": round(current.low, 4),
                }
            )
        elif current.high < left.low:
            zones.append(
                {
                    "direction": "bearish",
                    "date": current.date,
                    "low": round(current.high, 4),
                    "high": round(left.low, 4),
                }
            )
    return zones[-12:]


def detect_order_blocks(bars: list[Bar]) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    if len(bars) < 8:
        return blocks
    ranges = [max(bar.high - bar.low, 0.0) for bar in bars]
    for index in range(1, len(bars)):
        previous = bars[index - 1]
        current = bars[index]
        avg_range = sum(ranges[max(0, index - 10):index]) / max(1, len(ranges[max(0, index - 10):index]))
        body = abs(current.close - current.open)
        if avg_range <= 0 or body < avg_range * 0.8:
            continue
        if current.close > current.open and previous.close < previous.open:
            blocks.append({"direction": "demand", "date": previous.date, "low": round(previous.low, 4), "high": round(previous.high, 4)})
        elif current.close < current.open and previous.close > previous.open:
            blocks.append({"direction": "supply", "date": previous.date, "low": round(previous.low, 4), "high": round(previous.high, 4)})
    return blocks[-8:]


def fibonacci_levels(bars: list[Bar]) -> dict[str, Any]:
    lookback = bars[-min(len(bars), 120):]
    if len(lookback) < 20:
        return {"lookback": len(lookback), "levels": []}
    high_bar = max(lookback, key=lambda bar: bar.high)
    low_bar = min(lookback, key=lambda bar: bar.low)
    span = high_bar.high - low_bar.low
    if span <= 0:
        return {"lookback": len(lookback), "levels": []}
    up_move = low_bar.date <= high_bar.date
    levels = []
    for label, ratio in [("23.6%", 0.236), ("38.2%", 0.382), ("50.0%", 0.5), ("61.8%", 0.618), ("78.6%", 0.786)]:
        price = high_bar.high - span * ratio if up_move else low_bar.low + span * ratio
        levels.append({"label": label, "price": round(price, 4)})
    return {
        "lookback": len(lookback),
        "swing_high": {"date": high_bar.date, "price": round(high_bar.high, 4)},
        "swing_low": {"date": low_bar.date, "price": round(low_bar.low, 4)},
        "direction": "up" if up_move else "down",
        "levels": levels,
    }


def indicator_cards(signals: list[dict[str, Any]]) -> list[dict[str, Any]]:
    keys = {
        "moving_average": "moving_average",
        "ichimoku": "ichimoku",
        "rsi_divergence": "rsi_divergence",
        "fvg": "ict",
        "fibonacci": "fibonacci",
        "volume_candle": "volume_candle",
        "trend": "trend",
    }
    cards: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in signals:
        key = keys.get(str(item.get("key")))
        if not key or key in seen:
            continue
        seen.add(key)
        cards.append(
            {
                "key": key,
                "title": item["title"],
                "tone": tone_from_status(item["status"]),
                "summary": item["plain"],
                "rule": item["rule"],
                "evidence": [item["evidence"]],
            }
        )
    return cards


def confluence_for(signals: list[dict[str, Any]], tier: str) -> dict[str, Any] | None:
    if tier in {"insufficient", "starter"}:
        return None
    weights = {
        "moving_average": 1.2,
        "trend": 1.2,
        "volume_candle": 0.9,
        "fvg": 0.8,
        "order_block": 0.6,
        "rsi_divergence": 0.8,
        "fibonacci": 0.5,
        "ichimoku": 0.9,
    }
    groups = []
    total = 0.0
    weight_sum = 0.0
    for item in signals:
        key = item["key"]
        weight = weights.get(key, 0.5)
        score = status_score(item["status"])
        groups.append({"key": key, "label": item["title"], "score": score, "weight": weight, "reason": item["plain"]})
        total += score * weight
        weight_sum += weight
    normalized = 50 + (total / weight_sum) * 50 if weight_sum else 50
    normalized = max(0, min(100, normalized))
    label = "우호" if normalized >= 62 else "주의" if normalized <= 38 else "중립"
    return {"score": round(normalized, 1), "label": label, "groups": groups}


def summary_for(signals: list[dict[str, Any]], confluence: dict[str, Any] | None, tier: str) -> dict[str, Any]:
    if confluence is None:
        return {
            "tone": "limited",
            "headline": "상장 초기라 빠른 신호만 참고하세요",
            "bullets": [signals[0]["plain"] if signals else "가격 데이터가 더 쌓이면 신뢰도가 올라가요."],
        }
    tone = "positive" if confluence["score"] >= 62 else "cautious" if confluence["score"] <= 38 else "neutral"
    headline = "여러 신호가 상승 쪽으로 모여 있어요" if tone == "positive" else "하락·저항 신호를 먼저 확인하세요" if tone == "cautious" else "신호가 엇갈려 확인이 필요해요"
    ranked = sorted(signals, key=lambda item: abs(status_score(item["status"])), reverse=True)
    bullets = [item["plain"] for item in ranked[:3]]
    return {"tone": tone, "headline": headline, "bullets": bullets}


def signal(key: str, title: str, status: str, plain: str, evidence: str, layer: str, rule: str) -> dict[str, Any]:
    return {
        "key": key,
        "title": title,
        "status": status,
        "tone": tone_from_status(status),
        "plain": short(plain),
        "evidence": short(evidence),
        "layer": layer,
        "rule": short(rule),
    }


def tone_from_status(status: str) -> str:
    if status == "bullish":
        return "bullish"
    if status == "bearish":
        return "bearish"
    if status in {"caution", "limited"}:
        return "caution" if status == "caution" else "insufficient"
    return "neutral"


def status_score(status: str) -> int:
    if status == "bullish":
        return 1
    if status == "bearish":
        return -1
    if status == "caution":
        return -1
    return 0


def overlay_line(bars: list[Bar], values: list[float | None]) -> list[dict[str, Any]]:
    points = []
    for bar, value in zip(bars, values):
        if value is not None:
            points.append({"date": bar.date, "value": round(value, 4)})
    return points[-MAX_TECHNICAL_BARS:]


def midpoint(bars: list[Bar]) -> float:
    return (max(bar.high for bar in bars) + min(bar.low for bar in bars)) / 2


def last_value(values: list[float | None]) -> float | None:
    for value in reversed(values):
        if value is not None:
            return value
    return None


def fmt(value: float | None) -> str:
    if value is None:
        return "-"
    if abs(value) >= 1000:
        return f"{value:,.0f}"
    if abs(value) >= 100:
        return f"{value:,.1f}"
    return f"{value:,.2f}"


def pct(value: float | None) -> str:
    return "-" if value is None else f"{value * 100:+.1f}%"


def short(value: str, limit: int = 96) -> str:
    value = " ".join(value.split())
    return value if len(value) <= limit else value[: limit - 1].rstrip() + "…"


def glossary() -> list[dict[str, str]]:
    return [
        {"term": "이평선", "meaning": "여러 날의 평균 가격선이에요. 가격이 선 위에 있으면 매수세가 강한 편으로 봐요."},
        {"term": "FVG", "meaning": "강한 캔들 뒤 비어 보이는 가격 구간이에요. 되돌림 때 반응을 확인해요."},
        {"term": "OB", "meaning": "큰 움직임 직전의 반대 캔들 구간이에요. 지지·저항 후보로 봐요."},
    ]
