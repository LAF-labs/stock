from __future__ import annotations

import time
from typing import Any

from .formatting import as_int, num_label, pct, price_label
from .scoring import OpportunityResult


def grade_for(score: float) -> dict[str, str]:
    if score >= 80:
        return {"class": "excellent", "label": "우수"}
    if score >= 65:
        return {"class": "good", "label": "양호"}
    if score >= 50:
        return {"class": "normal", "label": "보통"}
    return {"class": "watch", "label": "주의"}


def signal_for(score: float, rsi: float | None, return_3m: float | None) -> str:
    if score >= 70 and (return_3m or 0.0) > 0 and (rsi or 50.0) < 75:
        return "BUY"
    if score < 40 or (return_3m is not None and return_3m < -0.15):
        return "WATCH"
    return "HOLD"


def confidence_pct(value: float | None) -> str:
    if value is None:
        return "-"
    return f"{value * 100:.1f}%"


def top_like_current(
    symbol: str,
    name: str,
    price: float | None,
    currency: str,
    score: float,
    components: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    component_map = {component["key"]: component["score"] for component in components}
    return [
        {
            "symbol": symbol,
            "name": name,
            "price": price,
            "currency": currency,
            "score": round(score, 1),
            "grade": grade_for(score),
            "components": component_map,
            "ts": int(time.time()),
        }
    ]


def opportunity_components_for(
    opportunity: OpportunityResult,
    *,
    latest_price: float | None,
    target_mean_price: float | None,
    currency: str = "USD",
    analyst_count: float | None,
    recommendation_mean: float | None,
    avg_volume_20: float | None,
    avg_volume_60: float | None,
    atr14_pct: float | None,
    beta: float | None,
) -> list[dict[str, Any]]:
    components = opportunity.components
    target_upside = (target_mean_price / latest_price - 1.0) if latest_price and target_mean_price else None
    return [
        {
            "key": "opportunity_momentum",
            "label": "기회 모멘텀",
            "short": "모",
            "score": round(components["momentum"].score, 1),
            "summary": "중기 가격 흐름과 신고가 접근도를 봐요.",
            "metrics": [
                {"label": "근거 충분도", "value": confidence_pct(components["momentum"].confidence)},
            ],
        },
        {
            "key": "opportunity_growth",
            "label": "추정 성장",
            "short": "성",
            "score": round(components["estimate_growth"].score, 1),
            "summary": "매출과 이익 성장률이 기회로 이어질 수 있는지 봐요.",
            "metrics": [
                {"label": "근거 충분도", "value": confidence_pct(components["estimate_growth"].confidence)},
            ],
        },
        {
            "key": "opportunity_analyst",
            "label": "목표가 여지",
            "short": "목",
            "score": round(components["analyst"].score, 1),
            "summary": "평균 목표가, 투자의견, 커버리지 수를 보수적으로 봐요.",
            "metrics": [
                {"label": "목표가 여지", "value": pct(target_upside)},
                {"label": "평균 목표가", "value": price_label(target_mean_price, currency)},
                {"label": "애널리스트 수", "value": num_label(as_int(analyst_count), "명")},
            ],
        },
        {
            "key": "opportunity_liquidity",
            "label": "유동성 관심",
            "short": "유",
            "score": round(components["liquidity"].score, 1),
            "summary": "거래량 체력과 최근 거래 관심 증가를 봐요.",
            "metrics": [
                {"label": "20일 평균 거래량", "value": num_label(as_int(avg_volume_20), "주")},
                {"label": "60일 평균 거래량", "value": num_label(as_int(avg_volume_60), "주")},
            ],
        },
        {
            "key": "opportunity_risk",
            "label": "위험 제어",
            "short": "위",
            "score": round(components["risk"].score, 1),
            "summary": "변동성과 과열도를 함께 봐요.",
            "metrics": [
                {"label": "ATR14", "value": pct(atr14_pct)},
                {"label": "베타", "value": f"{beta:.2f}" if beta is not None else "-"},
            ],
        },
    ]
