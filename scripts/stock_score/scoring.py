from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Iterable

from .formatting import as_float, score_positive
from .symbols import clean_ticker


SCORE_MODEL_VERSION = "score-v5-dual-quality-opportunity-2026-06-05"


@dataclass(frozen=True)
class FactorScore:
    score: float
    confidence: float


@dataclass(frozen=True)
class OpportunityResult:
    score: float
    confidence: float
    components: dict[str, FactorScore]
    caps: tuple[str, ...]


def clamp_score(value: float) -> float:
    return max(0.0, min(100.0, value))


def score_positive_opt(value: float | None, low: float, high: float) -> float | None:
    if value is None or not math.isfinite(float(value)):
        return None
    if high == low:
        return 50.0
    return clamp_score(((float(value) - low) / (high - low)) * 100.0)


def score_negative_opt(value: float | None, good: float, bad: float) -> float | None:
    if value is None or not math.isfinite(float(value)):
        return None
    if bad == good:
        return 50.0
    return clamp_score((1.0 - ((float(value) - good) / (bad - good))) * 100.0)


def eps_factor_score(eps: float | None) -> float | None:
    if eps is None or not math.isfinite(float(eps)):
        return None
    if eps > 0:
        return 72.0
    if eps < 0:
        return 25.0
    return 45.0


def positive_value(value: float | None) -> float | None:
    if value is None or not math.isfinite(float(value)) or value <= 0:
        return None
    return float(value)


def positive_or(primary: float | None, fallback: float | None) -> float | None:
    return positive_value(primary) or positive_value(fallback)


def moving_average_spread_score(price: float | None, moving_average: float | None) -> float | None:
    if price is None or moving_average is None:
        return None
    if not math.isfinite(float(price)) or not math.isfinite(float(moving_average)) or moving_average <= 0:
        return None
    return score_positive_opt((float(price) / float(moving_average)) - 1.0, -0.08, 0.12)


def rsi_factor_score(rsi: float | None) -> float | None:
    if rsi is None or not math.isfinite(float(rsi)):
        return None
    value = float(rsi)
    if value < 30.0:
        return score_positive(value, 15.0, 30.0, 35.0) * 0.5
    if value <= 55.0:
        return 50.0 + ((value - 30.0) / 25.0) * 25.0
    if value <= 70.0:
        return 82.0 - ((value - 55.0) / 15.0) * 4.0
    if value <= 85.0:
        return 78.0 - ((value - 70.0) / 15.0) * 23.0
    return 40.0


def weighted_factor_score(values: Iterable[tuple[float | None, float]]) -> FactorScore:
    items = list(values)
    total_weight = sum(max(0.0, float(weight)) for _, weight in items)
    if total_weight <= 0.0:
        return FactorScore(score=50.0, confidence=0.0)

    score_sum = 0.0
    usable_weight = 0.0
    for score, weight in items:
        weight = max(0.0, float(weight))
        if score is None or not math.isfinite(float(score)) or weight <= 0.0:
            continue
        score_sum += clamp_score(float(score)) * weight
        usable_weight += weight

    if usable_weight <= 0.0:
        return FactorScore(score=50.0, confidence=0.0)
    return FactorScore(score=score_sum / usable_weight, confidence=max(0.0, min(1.0, usable_weight / total_weight)))


def momentum_factor_score(
    ret_1m: float | None,
    ret_3m: float | None,
    ret_6m: float | None,
    distance_52w_high: float | None,
    latest_price: float | None,
    ma50: float | None,
    ma200: float | None,
    rsi14: float | None,
) -> FactorScore:
    return weighted_factor_score(
        [
            (score_positive_opt(ret_1m, -0.10, 0.15), 0.8),
            (score_positive_opt(ret_3m, -0.20, 0.35), 1.0),
            (score_positive_opt(ret_6m, -0.25, 0.50), 1.0),
            (score_positive_opt(distance_52w_high, -0.45, 0.0), 1.0),
            (moving_average_spread_score(latest_price, ma50), 0.8),
            (moving_average_spread_score(latest_price, ma200), 0.8),
            (rsi_factor_score(rsi14), 0.6),
        ]
    )


def quality_adjusted_valuation(base: FactorScore, profitability: FactorScore, growth: FactorScore) -> FactorScore:
    if base.confidence <= 0.0:
        return base
    quality = weighted_factor_score(
        [
            (profitability.score, profitability.confidence * 0.55),
            (growth.score, growth.confidence * 0.45),
        ]
    )
    if quality.confidence <= 0.0 or quality.score <= base.score:
        return base

    tolerance = max(0.0, min(1.0, (quality.score - 62.0) / 25.0)) * quality.confidence
    adjusted = base.score + (quality.score - base.score) * 0.72 * tolerance
    return FactorScore(score=clamp_score(adjusted), confidence=base.confidence)


def guardrailed_valuation(
    valuation: FactorScore,
    *,
    profitability: FactorScore,
    growth: FactorScore,
    forward_pe: float | None,
    trailing_pe: float | None,
    ev_to_revenue: float | None,
    price_to_sales: float | None,
    operating_margin: float | None = None,
    fcf_margin: float | None = None,
) -> FactorScore:
    has_forward = positive_value(forward_pe) is not None
    sales_multiple = positive_or(ev_to_revenue, price_to_sales)
    capped_score = valuation.score
    confidence = valuation.confidence

    if not has_forward:
        confidence *= 0.92
        weak_profitability = profitability.score < 50.0 or (
            operating_margin is not None and operating_margin < 0.08
        )
        weak_cashflow = fcf_margin is not None and fcf_margin < 0.0
        expensive_sales = sales_multiple is not None and sales_multiple >= 8.0
        expensive_earnings = trailing_pe is not None and trailing_pe >= 80.0

        if expensive_sales and (weak_profitability or weak_cashflow):
            capped_score = min(capped_score, 45.0)
            confidence *= 0.88
        elif expensive_earnings and profitability.score < 65.0:
            capped_score = min(capped_score, 50.0)
            confidence *= 0.90
        elif growth.score >= 85.0 and profitability.score < 50.0:
            capped_score = min(capped_score, 58.0)
            confidence *= 0.94

    return FactorScore(score=clamp_score(capped_score), confidence=max(0.0, min(1.0, confidence)))


def composite_score(scores: dict[str, FactorScore]) -> tuple[float, float]:
    weights = {
        "profitability": 0.24,
        "growth": 0.22,
        "health": 0.18,
        "momentum": 0.14,
        "valuation": 0.22,
    }
    total_weight = sum(weights.values())
    effective_weight = sum(weights[key] * scores[key].confidence for key in weights)
    if effective_weight <= 0.0 or total_weight <= 0.0:
        return 50.0, 0.0

    raw = sum(scores[key].score * weights[key] * scores[key].confidence for key in weights) / effective_weight
    confidence = max(0.0, min(1.0, effective_weight / total_weight))
    return round(clamp_score(raw), 1), confidence


def analyst_count_confidence(value: float | None) -> float:
    if value is None:
        return 0.0
    return max(0.0, min(1.0, float(value) / 8.0))


def target_upside_score(latest_price: float | None, target_mean_price: float | None) -> float | None:
    if latest_price is None or target_mean_price is None:
        return None
    if not math.isfinite(float(latest_price)) or not math.isfinite(float(target_mean_price)) or latest_price <= 0:
        return None
    return score_positive_opt((float(target_mean_price) / float(latest_price)) - 1.0, -0.25, 0.45)


def recommendation_score(recommendation_mean: float | None) -> float | None:
    value = as_float(recommendation_mean)
    if value is None or value <= 0:
        return None
    return score_negative_opt(value, 1.2, 4.2)


def volume_acceleration_score(avg_volume_20: float | None, avg_volume_60: float | None) -> float | None:
    if avg_volume_20 is None or avg_volume_60 is None:
        return None
    if not math.isfinite(float(avg_volume_20)) or not math.isfinite(float(avg_volume_60)) or avg_volume_60 <= 0:
        return None
    return score_positive_opt((float(avg_volume_20) / float(avg_volume_60)) - 1.0, -0.35, 0.80)


def liquidity_floor_score(market: str, avg_volume_20: float | None, market_cap: float | None) -> float | None:
    market = clean_ticker(market)
    if market == "KR":
        volume_score = score_positive_opt(avg_volume_20, 20_000.0, 5_000_000.0)
        size_score = score_positive_opt(market_cap, 50_000_000_000.0, 5_000_000_000_000.0)
    else:
        volume_score = score_positive_opt(avg_volume_20, 50_000.0, 10_000_000.0)
        size_score = score_positive_opt(market_cap, 300_000_000.0, 50_000_000_000.0)
    return weighted_factor_score([(volume_score, 0.55), (size_score, 0.45)]).score if volume_score is not None or size_score is not None else None


def risk_control_score(atr14_pct: float | None, rsi14: float | None, beta: float | None) -> FactorScore:
    beta_score = score_negative_opt(beta, 0.8, 2.5)
    return weighted_factor_score(
        [
            (score_negative_opt(atr14_pct, 0.025, 0.10), 1.0),
            (rsi_factor_score(rsi14), 0.8),
            (beta_score, 0.4),
        ]
    )


def opportunity_factor_score(
    *,
    market: str,
    latest_price: float | None,
    ret_1m: float | None,
    ret_3m: float | None,
    ret_6m: float | None,
    ret_52w: float | None,
    distance_52w_high: float | None,
    ma50: float | None,
    ma200: float | None,
    rsi14: float | None,
    atr14_pct: float | None,
    avg_volume_20: float | None,
    avg_volume_60: float | None,
    market_cap: float | None,
    revenue_growth: float | None,
    earnings_growth: float | None,
    target_mean_price: float | None,
    analyst_count: float | None,
    recommendation_mean: float | None,
    forward_pe: float | None,
    operating_margin: float | None,
    cashflow_margin: float | None,
    ev_to_revenue: float | None,
    price_to_sales: float | None,
    beta: float | None = None,
) -> OpportunityResult:
    momentum = momentum_factor_score(ret_1m, ret_3m, ret_6m, distance_52w_high, latest_price, ma50, ma200, rsi14)
    estimate_growth = weighted_factor_score(
        [
            (score_positive_opt(revenue_growth, -0.05, 0.60), 1.2),
            (score_positive_opt(earnings_growth, -0.10, 0.70), 1.0),
            (score_positive_opt(ret_52w, -0.30, 1.20), 0.4),
        ]
    )
    coverage_confidence = analyst_count_confidence(analyst_count)
    analyst = weighted_factor_score(
        [
            (target_upside_score(latest_price, target_mean_price), 1.2 * coverage_confidence),
            (recommendation_score(recommendation_mean), 0.8 * coverage_confidence),
        ]
    )
    liquidity = weighted_factor_score(
        [
            (volume_acceleration_score(avg_volume_20, avg_volume_60), 0.9),
            (liquidity_floor_score(market, avg_volume_20, market_cap), 0.8),
        ]
    )
    risk = risk_control_score(atr14_pct, rsi14, beta)
    components = {
        "momentum": momentum,
        "estimate_growth": estimate_growth,
        "analyst": analyst,
        "liquidity": liquidity,
        "risk": risk,
    }
    weights = {
        "momentum": 0.30,
        "estimate_growth": 0.25,
        "analyst": 0.20,
        "liquidity": 0.15,
        "risk": 0.10,
    }
    total_weight = sum(weights.values())
    effective_weight = sum(weights[key] * components[key].confidence for key in weights)
    if effective_weight <= 0.0:
        raw_score = 50.0
        confidence = 0.0
    else:
        raw_score = sum(components[key].score * weights[key] * components[key].confidence for key in weights) / effective_weight
        confidence = max(0.0, min(1.0, effective_weight / total_weight))

    score = clamp_score(raw_score)
    caps: list[str] = []
    sales_multiple = positive_or(ev_to_revenue, price_to_sales)
    weak_profit = operating_margin is not None and operating_margin < 0.0
    weak_cashflow = cashflow_margin is not None and cashflow_margin < 0.0
    if sales_multiple is not None and sales_multiple >= 20.0 and (weak_profit or weak_cashflow):
        score = min(score, 72.0)
        caps.append("speculative_expensive_sales")
    if (atr14_pct is not None and atr14_pct > 0.10) or (rsi14 is not None and rsi14 > 85.0):
        score = min(score, 75.0)
        caps.append("short_term_overheat")
    target_upside = (target_mean_price / latest_price - 1.0) if target_mean_price and latest_price else None
    if target_upside is not None and target_upside < 0.0 and (revenue_growth or 0.0) < 0.10 and (earnings_growth or 0.0) < 0.10:
        score = min(score, 65.0)
        caps.append("target_below_price")
    if avg_volume_20 is not None and avg_volume_20 < (20_000.0 if clean_ticker(market) == "KR" else 50_000.0):
        score = min(score, 60.0)
        caps.append("thin_liquidity")

    return OpportunityResult(score=round(clamp_score(score), 1), confidence=confidence, components=components, caps=tuple(caps))
