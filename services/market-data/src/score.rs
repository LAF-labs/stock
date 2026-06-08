use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{
    market::{Market, ScoreView},
    service::{MarketDataError, MarketDataErrorKind},
};

const SCORE_MODEL_VERSION: &str = "score-v5-dual-quality-opportunity-2026-06-05";

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ScoreEngineInput {
    pub market: Market,
    pub symbol: String,
    pub name: String,
    pub currency: String,
    pub latest_price: Option<f64>,
    pub previous_close: Option<f64>,
    pub eps: Option<f64>,
    pub bps: Option<f64>,
    pub profit_margin: Option<f64>,
    pub operating_margin: Option<f64>,
    pub ocf_margin: Option<f64>,
    pub revenue_growth: Option<f64>,
    pub earnings_growth: Option<f64>,
    pub return_1m: Option<f64>,
    pub return_3m: Option<f64>,
    pub return_6m: Option<f64>,
    pub return_52w: Option<f64>,
    pub distance_52w_high: Option<f64>,
    pub ma50: Option<f64>,
    pub ma200: Option<f64>,
    pub avg_volume_20: Option<f64>,
    pub avg_volume_60: Option<f64>,
    pub market_cap: Option<f64>,
    pub debt_to_equity: Option<f64>,
    pub current_ratio: Option<f64>,
    pub quick_ratio: Option<f64>,
    pub trailing_pe: Option<f64>,
    pub forward_pe: Option<f64>,
    pub price_to_book: Option<f64>,
    pub ev_to_revenue: Option<f64>,
    pub price_to_sales: Option<f64>,
    #[serde(alias = "cashflow_margin")]
    pub fcf_margin: Option<f64>,
    pub rsi14: Option<f64>,
    pub atr14_pct: Option<f64>,
    pub target_mean_price: Option<f64>,
    pub analyst_count: Option<f64>,
    pub recommendation_mean: Option<f64>,
    pub beta: Option<f64>,
    pub trade_enabled: Option<bool>,
}

#[derive(Clone, Debug, Serialize)]
pub struct ScoreEngineOutput {
    pub score: f64,
    pub grade: ScoreGrade,
    pub signal: String,
    pub components: Vec<ScoreComponent>,
    pub payload: Value,
}

#[derive(Clone, Debug, Serialize)]
pub struct ScoreGrade {
    pub class: String,
    pub label: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct ScoreComponent {
    pub key: String,
    pub label: String,
    pub short: String,
    pub score: f64,
    pub summary: String,
    pub metrics: Vec<ScoreMetric>,
}

#[derive(Clone, Debug, Serialize)]
pub struct ScoreMetric {
    pub label: String,
    pub value: String,
}

#[derive(Clone, Copy, Debug)]
struct ComponentScore {
    score: f64,
    confidence: f64,
}

#[derive(Clone, Copy, Debug)]
struct ComponentScores {
    profitability: ComponentScore,
    growth: ComponentScore,
    health: ComponentScore,
    momentum: ComponentScore,
    valuation: ComponentScore,
}

#[derive(Clone, Copy, Debug)]
struct OpportunityScores {
    momentum: ComponentScore,
    estimate_growth: ComponentScore,
    analyst: ComponentScore,
    liquidity: ComponentScore,
    risk: ComponentScore,
}

#[derive(Clone, Debug)]
struct OpportunityResult {
    score: f64,
    confidence: f64,
    components: OpportunityScores,
    caps: Vec<&'static str>,
}

pub fn compute_score(
    input: ScoreEngineInput,
    view: ScoreView,
) -> Result<ScoreEngineOutput, MarketDataError> {
    let symbol = input
        .market
        .normalize_symbol(&input.symbol)
        .map_err(|error| {
            MarketDataError::new(MarketDataErrorKind::InvalidRequest, error.to_string())
        })?;

    match input.market {
        Market::Us => compute_us_score(input, symbol, view),
        Market::Kr => compute_kr_score(input, symbol, view),
    }
}

pub fn score_positive(value: Option<f64>, low: f64, high: f64, missing: f64) -> f64 {
    let Some(value) = finite(value) else {
        return missing;
    };
    if high == low {
        return missing;
    }
    clamp(((value - low) / (high - low)) * 100.0, 0.0, 100.0)
}

pub fn score_negative(value: Option<f64>, good: f64, bad: f64, missing: f64) -> f64 {
    let Some(value) = finite(value) else {
        return missing;
    };
    if bad == good {
        return missing;
    }
    clamp((1.0 - ((value - good) / (bad - good))) * 100.0, 0.0, 100.0)
}

fn compute_us_score(
    input: ScoreEngineInput,
    symbol: String,
    view: ScoreView,
) -> Result<ScoreEngineOutput, MarketDataError> {
    let roe = ratio(input.eps, input.bps);
    let ev_or_sales = positive_or(input.ev_to_revenue, input.price_to_sales);
    let trade_score = match input.trade_enabled {
        Some(true) => 70.0,
        Some(false) => 25.0,
        None => 45.0,
    };

    let profitability = weighted_average(&[
        (eps_score(input.eps), 0.6),
        (score_positive_opt(roe, -0.10, 0.25), 1.2),
        (score_positive_opt(input.profit_margin, -0.05, 0.25), 1.2),
        (score_positive_opt(input.operating_margin, -0.05, 0.25), 1.0),
        (score_positive_opt(input.ocf_margin, -0.05, 0.25), 1.0),
    ]);
    let growth = weighted_average(&[
        (score_positive_opt(input.revenue_growth, -0.10, 0.35), 1.3),
        (score_positive_opt(input.earnings_growth, -0.20, 0.50), 1.2),
        (score_positive_opt(input.return_1m, -0.10, 0.15), 0.4),
        (score_positive_opt(input.return_6m, -0.25, 0.50), 0.7),
        (score_positive_opt(input.return_52w, -0.35, 0.80), 0.7),
    ]);
    let health = weighted_average(&[
        (Some(trade_score), 0.8),
        (
            score_positive_opt(input.avg_volume_20, 50_000.0, 5_000_000.0),
            0.8,
        ),
        (
            score_positive_opt(input.market_cap, 1_000_000_000.0, 200_000_000_000.0),
            1.0,
        ),
        (score_negative_opt(input.debt_to_equity, 25.0, 220.0), 0.9),
        (score_positive_opt(input.current_ratio, 0.8, 2.0), 0.7),
        (score_positive_opt(input.quick_ratio, 0.7, 1.6), 0.5),
        (score_positive_opt(input.ocf_margin, -0.05, 0.18), 0.6),
    ]);
    let momentum = momentum_score(&input);
    let valuation_base = weighted_average(&[
        (
            score_negative_opt(positive(input.trailing_pe), 12.0, 85.0),
            0.9,
        ),
        (
            score_negative_opt(positive(input.forward_pe), 10.0, 70.0),
            1.2,
        ),
        (
            score_negative_opt(positive(input.price_to_book), 1.5, 25.0),
            0.6,
        ),
        (score_negative_opt(positive(ev_or_sales), 2.0, 25.0), 0.8),
    ]);
    let valuation = guardrailed_valuation(
        quality_adjusted_valuation(valuation_base, profitability, growth),
        profitability,
        growth,
        &input,
    );

    build_output(
        input,
        symbol,
        view,
        ComponentScores {
            profitability,
            growth,
            health,
            momentum,
            valuation,
        },
    )
}

fn compute_kr_score(
    input: ScoreEngineInput,
    symbol: String,
    view: ScoreView,
) -> Result<ScoreEngineOutput, MarketDataError> {
    let roe = ratio(input.eps, input.bps);
    let ev_or_sales = positive_or(input.ev_to_revenue, input.price_to_sales);
    let trade_score = if input.trade_enabled.unwrap_or(false) {
        72.0
    } else {
        25.0
    };

    let profitability = weighted_average(&[
        (eps_score(input.eps), 0.6),
        (score_positive_opt(roe, -0.10, 0.25), 1.2),
        (score_positive_opt(input.profit_margin, -0.05, 0.25), 0.9),
        (score_positive_opt(input.operating_margin, -0.05, 0.25), 0.8),
        (score_positive_opt(input.ocf_margin, -0.05, 0.25), 0.8),
    ]);
    let growth = weighted_average(&[
        (score_positive_opt(input.revenue_growth, -0.10, 0.35), 1.1),
        (score_positive_opt(input.earnings_growth, -0.20, 0.50), 1.0),
        (score_positive_opt(input.return_1m, -0.10, 0.15), 0.5),
        (score_positive_opt(input.return_6m, -0.25, 0.50), 0.8),
        (score_positive_opt(input.return_52w, -0.35, 0.80), 0.8),
    ]);
    let health = weighted_average(&[
        (Some(trade_score), 0.8),
        (
            score_positive_opt(input.avg_volume_20, 20_000.0, 5_000_000.0),
            0.8,
        ),
        (
            score_positive_opt(input.market_cap, 50_000_000_000.0, 50_000_000_000_000.0),
            1.0,
        ),
        (score_negative_opt(input.debt_to_equity, 25.0, 220.0), 0.7),
        (score_positive_opt(input.current_ratio, 0.8, 2.0), 0.5),
        (score_positive_opt(input.quick_ratio, 0.7, 1.6), 0.4),
        (score_positive_opt(input.ocf_margin, -0.05, 0.18), 0.5),
    ]);
    let momentum = momentum_score(&input);
    let valuation_base = weighted_average(&[
        (
            score_negative_opt(positive(input.trailing_pe), 8.0, 60.0),
            1.0,
        ),
        (
            score_negative_opt(positive(input.forward_pe), 8.0, 50.0),
            0.9,
        ),
        (
            score_negative_opt(positive(input.price_to_book), 0.8, 8.0),
            0.8,
        ),
        (score_negative_opt(positive(ev_or_sales), 1.5, 15.0), 0.6),
    ]);
    let valuation = guardrailed_valuation(
        quality_adjusted_valuation(valuation_base, profitability, growth),
        profitability,
        growth,
        &input,
    );

    build_output(
        input,
        symbol,
        view,
        ComponentScores {
            profitability,
            growth,
            health,
            momentum,
            valuation,
        },
    )
}

fn build_output(
    input: ScoreEngineInput,
    symbol: String,
    view: ScoreView,
    scores: ComponentScores,
) -> Result<ScoreEngineOutput, MarketDataError> {
    let (score, confidence) = composite_score(scores);
    let opportunity = opportunity_score(&input);
    let grade = grade_for(score);
    let opportunity_grade = grade_for(opportunity.score);
    let signal = signal_for(score, input.rsi14, input.return_3m);
    let components = components_for(scores);
    let opportunity_components = opportunity_components_for(&opportunity);
    let requested_ticker = format!("{}:{symbol}", market_code(input.market));
    let payload_symbol = symbol.clone();
    let latest_change = match (input.latest_price, input.previous_close) {
        (Some(price), Some(previous)) if previous != 0.0 => Some((price / previous) - 1.0),
        _ => None,
    };
    let payload = json!({
        "ok": true,
        "app": "Stock Score Reader",
        "requested_ticker": requested_ticker,
        "market": market_code(input.market),
        "symbol": payload_symbol,
        "name": input.name,
        "currency": input.currency,
        "score_model_version": SCORE_MODEL_VERSION,
        "score": score,
        "quality_score": score,
        "quality_grade": grade.clone(),
        "opportunity_score": opportunity.score,
        "opportunity_grade": opportunity_grade,
        "opportunity_confidence": round3(opportunity.confidence),
        "grade": grade.clone(),
        "summary": format!("{} quality {:.1}/100, opportunity {:.1}/100.", market_code(input.market), score, opportunity.score),
        "latest_price": input.latest_price,
        "components": components.clone(),
        "opportunity_components": opportunity_components,
        "price_metrics": {
            "price": input.latest_price,
            "previous_close": input.previous_close,
            "latest_change": latest_change
        },
        "financials": {
            "eps": input.eps,
            "bps": input.bps
        },
        "sia_snapshot": {
            "symbol": symbol,
            "price": input.latest_price,
            "raw_signal": signal.clone(),
            "risk_level": risk_level(score),
            "score_model_version": SCORE_MODEL_VERSION,
            "confidence": round3(confidence),
            "quality_score": round3(score / 100.0),
            "opportunity_score": round3(opportunity.score / 100.0),
            "opportunity_confidence": round3(opportunity.confidence),
            "spot_score": round3(score / 100.0),
            "profitability_score": round3(scores.profitability.score / 100.0),
            "growth_score": round3(scores.growth.score / 100.0),
            "health_score": round3(scores.health.score / 100.0),
            "momentum_score": round3(scores.momentum.score / 100.0),
            "valuation_score": round3(scores.valuation.score / 100.0),
            "opportunity_caps": opportunity.caps,
            "signal_source": "market-data:rust-score-engine"
        },
        "fetch": {
            "source": "rust_score_engine",
            "score_model_version": SCORE_MODEL_VERSION,
            "cache": "server"
        },
        "view": view.as_str()
    });

    Ok(ScoreEngineOutput {
        score,
        grade,
        signal,
        components,
        payload,
    })
}

fn components_for(scores: ComponentScores) -> Vec<ScoreComponent> {
    vec![
        component("profitability", "Profitability", "P", scores.profitability),
        component("growth", "Growth", "G", scores.growth),
        component("health", "Trading health", "H", scores.health),
        component("momentum", "Momentum", "M", scores.momentum),
        component("valuation", "Valuation", "V", scores.valuation),
    ]
}

fn opportunity_components_for(opportunity: &OpportunityResult) -> Vec<ScoreComponent> {
    vec![
        component(
            "opportunity_momentum",
            "Opportunity momentum",
            "M",
            opportunity.components.momentum,
        ),
        component(
            "opportunity_growth",
            "Estimate growth",
            "G",
            opportunity.components.estimate_growth,
        ),
        component(
            "opportunity_analyst",
            "Target upside",
            "T",
            opportunity.components.analyst,
        ),
        component(
            "opportunity_liquidity",
            "Liquidity attention",
            "L",
            opportunity.components.liquidity,
        ),
        component(
            "opportunity_risk",
            "Risk control",
            "R",
            opportunity.components.risk,
        ),
    ]
}

fn component(key: &str, label: &str, short: &str, score: ComponentScore) -> ScoreComponent {
    ScoreComponent {
        key: key.to_string(),
        label: label.to_string(),
        short: short.to_string(),
        score: round1(score.score),
        summary: format!("{label} score"),
        metrics: Vec::new(),
    }
}

fn momentum_score(input: &ScoreEngineInput) -> ComponentScore {
    weighted_average(&[
        (score_positive_opt(input.return_1m, -0.10, 0.15), 0.8),
        (score_positive_opt(input.return_3m, -0.20, 0.35), 1.0),
        (score_positive_opt(input.return_6m, -0.25, 0.50), 1.0),
        (score_positive_opt(input.distance_52w_high, -0.45, 0.0), 1.0),
        (ma_spread_score(input.latest_price, input.ma50), 0.8),
        (ma_spread_score(input.latest_price, input.ma200), 0.8),
        (rsi_score(input.rsi14), 0.6),
    ])
}

fn opportunity_score(input: &ScoreEngineInput) -> OpportunityResult {
    let momentum = momentum_score(input);
    let estimate_growth = weighted_average(&[
        (score_positive_opt(input.revenue_growth, -0.05, 0.60), 1.2),
        (score_positive_opt(input.earnings_growth, -0.10, 0.70), 1.0),
        (score_positive_opt(input.return_52w, -0.30, 1.20), 0.4),
    ]);
    let coverage_confidence = analyst_count_confidence(input.analyst_count);
    let analyst = weighted_average(&[
        (
            target_upside_score(input.latest_price, input.target_mean_price),
            1.2 * coverage_confidence,
        ),
        (
            recommendation_score(input.recommendation_mean),
            0.8 * coverage_confidence,
        ),
    ]);
    let liquidity = weighted_average(&[
        (
            volume_acceleration_score(input.avg_volume_20, input.avg_volume_60),
            0.9,
        ),
        (
            liquidity_floor_score(input.market, input.avg_volume_20, input.market_cap),
            0.8,
        ),
    ]);
    let risk = risk_control_score(input.atr14_pct, input.rsi14, input.beta);
    let components = OpportunityScores {
        momentum,
        estimate_growth,
        analyst,
        liquidity,
        risk,
    };
    let weighted = [
        (components.momentum, 0.30),
        (components.estimate_growth, 0.25),
        (components.analyst, 0.20),
        (components.liquidity, 0.15),
        (components.risk, 0.10),
    ];
    let total_weight: f64 = weighted.iter().map(|(_, weight)| weight).sum();
    let effective_weight: f64 = weighted
        .iter()
        .map(|(component, weight)| weight * component.confidence)
        .sum();
    let (raw_score, confidence) = if effective_weight <= 0.0 || total_weight <= 0.0 {
        (50.0, 0.0)
    } else {
        (
            weighted
                .iter()
                .map(|(component, weight)| component.score * weight * component.confidence)
                .sum::<f64>()
                / effective_weight,
            clamp(effective_weight / total_weight, 0.0, 1.0),
        )
    };
    let mut score = clamp(
        raw_score * confidence + 50.0 * (1.0 - confidence),
        0.0,
        100.0,
    );
    let mut caps = Vec::new();
    let sales_multiple = positive_or(input.ev_to_revenue, input.price_to_sales);
    let weak_profit = input
        .operating_margin
        .is_some_and(|margin| margin.is_finite() && margin < 0.0);
    let weak_cashflow =
        cashflow_margin(input).is_some_and(|margin| margin.is_finite() && margin < 0.0);
    if sales_multiple.is_some_and(|multiple| multiple >= 20.0) && (weak_profit || weak_cashflow) {
        score = score.min(72.0);
        caps.push("speculative_expensive_sales");
    }
    if positive(input.forward_pe).is_none() && input.analyst_count.unwrap_or(0.0) < 3.0 {
        score = score.min(68.0);
        caps.push("low_forward_coverage");
    }
    if input
        .atr14_pct
        .is_some_and(|atr| atr.is_finite() && atr > 0.10)
        || input.rsi14.is_some_and(|rsi| rsi.is_finite() && rsi > 85.0)
    {
        score = score.min(75.0);
        caps.push("short_term_overheat");
    }
    if input.avg_volume_20.is_some_and(|volume| {
        volume.is_finite()
            && volume
                < match input.market {
                    Market::Kr => 20_000.0,
                    Market::Us => 50_000.0,
                }
    }) {
        score = score.min(60.0);
        caps.push("thin_liquidity");
    }
    let target_upside = match (finite(input.target_mean_price), finite(input.latest_price)) {
        (Some(target), Some(price)) if price > 0.0 => Some((target / price) - 1.0),
        _ => None,
    };
    if target_upside.is_some_and(|upside| upside < 0.0)
        && input.revenue_growth.unwrap_or(0.0) < 0.10
        && input.earnings_growth.unwrap_or(0.0) < 0.10
    {
        score = score.min(65.0);
        caps.push("target_below_price");
    }
    OpportunityResult {
        score: round1(score),
        confidence,
        components,
        caps,
    }
}

fn analyst_count_confidence(value: Option<f64>) -> f64 {
    finite(value)
        .map(|value| clamp(value / 8.0, 0.0, 1.0))
        .unwrap_or(0.0)
}

fn volume_acceleration_score(
    avg_volume_20: Option<f64>,
    avg_volume_60: Option<f64>,
) -> Option<f64> {
    match (finite(avg_volume_20), finite(avg_volume_60)) {
        (Some(short), Some(long)) if long > 0.0 => {
            score_positive_opt(Some((short / long) - 1.0), -0.35, 0.80)
        }
        _ => None,
    }
}

fn target_upside_score(latest_price: Option<f64>, target_mean_price: Option<f64>) -> Option<f64> {
    match (finite(latest_price), finite(target_mean_price)) {
        (Some(price), Some(target)) if price > 0.0 => {
            score_positive_opt(Some((target / price) - 1.0), -0.25, 0.45)
        }
        _ => None,
    }
}

fn recommendation_score(recommendation_mean: Option<f64>) -> Option<f64> {
    positive(recommendation_mean).and_then(|value| score_negative_opt(Some(value), 1.2, 4.2))
}

fn liquidity_floor_score(
    market: Market,
    avg_volume_20: Option<f64>,
    market_cap: Option<f64>,
) -> Option<f64> {
    let (volume_score, size_score) = match market {
        Market::Us => (
            score_positive_opt(avg_volume_20, 50_000.0, 10_000_000.0),
            score_positive_opt(market_cap, 300_000_000.0, 50_000_000_000.0),
        ),
        Market::Kr => (
            score_positive_opt(avg_volume_20, 20_000.0, 5_000_000.0),
            score_positive_opt(market_cap, 50_000_000_000.0, 5_000_000_000_000.0),
        ),
    };
    if volume_score.is_none() && size_score.is_none() {
        None
    } else {
        Some(weighted_average(&[(volume_score, 0.55), (size_score, 0.45)]).score)
    }
}

fn risk_control_score(
    atr14_pct: Option<f64>,
    rsi14: Option<f64>,
    beta: Option<f64>,
) -> ComponentScore {
    weighted_average(&[
        (score_negative_opt(atr14_pct, 0.025, 0.10), 1.0),
        (rsi_score(rsi14), 0.8),
        (score_negative_opt(beta, 0.8, 2.5), 0.4),
    ])
}

fn cashflow_margin(input: &ScoreEngineInput) -> Option<f64> {
    finite(input.fcf_margin).or_else(|| finite(input.ocf_margin))
}

fn eps_score(eps: Option<f64>) -> Option<f64> {
    finite(eps).map(|value| {
        if value > 0.0 {
            72.0
        } else if value < 0.0 {
            25.0
        } else {
            45.0
        }
    })
}

fn score_positive_opt(value: Option<f64>, low: f64, high: f64) -> Option<f64> {
    finite(value).map(|value| {
        if high == low {
            50.0
        } else {
            clamp(((value - low) / (high - low)) * 100.0, 0.0, 100.0)
        }
    })
}

fn score_negative_opt(value: Option<f64>, good: f64, bad: f64) -> Option<f64> {
    finite(value).map(|value| {
        if bad == good {
            50.0
        } else {
            clamp((1.0 - ((value - good) / (bad - good))) * 100.0, 0.0, 100.0)
        }
    })
}

fn ma_spread_score(price: Option<f64>, moving_average: Option<f64>) -> Option<f64> {
    match (finite(price), finite(moving_average)) {
        (Some(price), Some(moving_average)) if moving_average > 0.0 => {
            score_positive_opt(Some((price / moving_average) - 1.0), -0.08, 0.12)
        }
        _ => None,
    }
}

fn rsi_score(rsi: Option<f64>) -> Option<f64> {
    finite(rsi).map(|value| {
        if value < 30.0 {
            score_positive(Some(value), 15.0, 30.0, 35.0) * 0.5
        } else if value <= 55.0 {
            50.0 + ((value - 30.0) / 25.0) * 25.0
        } else if value <= 70.0 {
            82.0 - ((value - 55.0) / 15.0) * 4.0
        } else if value <= 85.0 {
            78.0 - ((value - 70.0) / 15.0) * 23.0
        } else {
            40.0
        }
    })
}

fn weighted_average(values: &[(Option<f64>, f64)]) -> ComponentScore {
    let total_weight: f64 = values.iter().map(|(_, weight)| weight.max(0.0)).sum();
    if total_weight <= 0.0 {
        return ComponentScore {
            score: 50.0,
            confidence: 0.0,
        };
    }

    let mut score_sum = 0.0;
    let mut usable_weight = 0.0;
    for (score, weight) in values {
        let weight = weight.max(0.0);
        if let Some(score) = finite(*score) {
            score_sum += clamp(score, 0.0, 100.0) * weight;
            usable_weight += weight;
        }
    }

    if usable_weight <= 0.0 {
        return ComponentScore {
            score: 50.0,
            confidence: 0.0,
        };
    }

    ComponentScore {
        score: score_sum / usable_weight,
        confidence: clamp(usable_weight / total_weight, 0.0, 1.0),
    }
}

fn quality_adjusted_valuation(
    base: ComponentScore,
    profitability: ComponentScore,
    growth: ComponentScore,
) -> ComponentScore {
    if base.confidence <= 0.0 {
        return base;
    }
    let quality = weighted_average(&[
        (Some(profitability.score), profitability.confidence * 0.55),
        (Some(growth.score), growth.confidence * 0.45),
    ]);
    if quality.confidence <= 0.0 || quality.score <= base.score {
        return base;
    }

    let tolerance = clamp((quality.score - 62.0) / 25.0, 0.0, 1.0) * quality.confidence;
    let adjusted = base.score + (quality.score - base.score) * 0.72 * tolerance;
    ComponentScore {
        score: clamp(adjusted, 0.0, 100.0),
        confidence: base.confidence,
    }
}

fn guardrailed_valuation(
    valuation: ComponentScore,
    profitability: ComponentScore,
    growth: ComponentScore,
    input: &ScoreEngineInput,
) -> ComponentScore {
    if positive(input.forward_pe).is_some() {
        return valuation;
    }

    let sales_multiple = positive_or(input.ev_to_revenue, input.price_to_sales);
    let weak_profitability = profitability.score < 50.0
        || input
            .operating_margin
            .is_some_and(|margin| margin.is_finite() && margin < 0.08);
    let weak_cashflow =
        cashflow_margin(input).is_some_and(|margin| margin.is_finite() && margin < 0.0);
    let expensive_sales = sales_multiple.is_some_and(|multiple| multiple >= 8.0);
    let expensive_earnings = positive(input.trailing_pe).is_some_and(|multiple| multiple >= 80.0);

    let mut score = valuation.score;
    let mut confidence = valuation.confidence * 0.92;
    if expensive_sales && (weak_profitability || weak_cashflow) {
        score = score.min(45.0);
        confidence *= 0.88;
    } else if expensive_earnings && profitability.score < 65.0 {
        score = score.min(50.0);
        confidence *= 0.90;
    } else if growth.score >= 85.0 && profitability.score < 50.0 {
        score = score.min(58.0);
        confidence *= 0.94;
    }

    ComponentScore {
        score: clamp(score, 0.0, 100.0),
        confidence: clamp(confidence, 0.0, 1.0),
    }
}

fn composite_score(scores: ComponentScores) -> (f64, f64) {
    let components = [
        (scores.profitability, 0.24),
        (scores.growth, 0.22),
        (scores.health, 0.18),
        (scores.momentum, 0.14),
        (scores.valuation, 0.22),
    ];
    let total_weight: f64 = components.iter().map(|(_, weight)| weight).sum();
    let effective_weight: f64 = components
        .iter()
        .map(|(component, weight)| weight * component.confidence)
        .sum();
    if effective_weight <= 0.0 || total_weight <= 0.0 {
        return (50.0, 0.0);
    }

    let raw = components
        .iter()
        .map(|(component, weight)| component.score * weight * component.confidence)
        .sum::<f64>()
        / effective_weight;
    let confidence = clamp(effective_weight / total_weight, 0.0, 1.0);
    let anchored = raw * confidence + 50.0 * (1.0 - confidence);
    (round1(clamp(anchored, 0.0, 100.0)), confidence)
}

fn grade_for(score: f64) -> ScoreGrade {
    if score >= 80.0 {
        ScoreGrade {
            class: "excellent".to_string(),
            label: "Excellent".to_string(),
        }
    } else if score >= 65.0 {
        ScoreGrade {
            class: "good".to_string(),
            label: "Good".to_string(),
        }
    } else if score >= 50.0 {
        ScoreGrade {
            class: "normal".to_string(),
            label: "Normal".to_string(),
        }
    } else {
        ScoreGrade {
            class: "watch".to_string(),
            label: "Watch".to_string(),
        }
    }
}

fn signal_for(score: f64, rsi: Option<f64>, return_3m: Option<f64>) -> String {
    if score >= 70.0 && return_3m.unwrap_or(0.0) > 0.0 && rsi.unwrap_or(50.0) < 75.0 {
        "BUY".to_string()
    } else if score < 40.0 || return_3m.is_some_and(|value| value < -0.15) {
        "WATCH".to_string()
    } else {
        "HOLD".to_string()
    }
}

fn risk_level(score: f64) -> &'static str {
    if score >= 70.0 {
        "LOW"
    } else if score >= 45.0 {
        "MEDIUM"
    } else {
        "HIGH"
    }
}

fn ratio(left: Option<f64>, right: Option<f64>) -> Option<f64> {
    match (finite(left), finite(right)) {
        (Some(left), Some(right)) if right != 0.0 => Some(left / right),
        _ => None,
    }
}

fn positive(value: Option<f64>) -> Option<f64> {
    finite(value).filter(|value| *value > 0.0)
}

fn positive_or(primary: Option<f64>, fallback: Option<f64>) -> Option<f64> {
    positive(primary).or_else(|| positive(fallback))
}

fn finite(value: Option<f64>) -> Option<f64> {
    value.filter(|value| value.is_finite())
}

fn clamp(value: f64, low: f64, high: f64) -> f64 {
    value.max(low).min(high)
}

fn round1(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

fn round3(value: f64) -> f64 {
    (value * 1_000.0).round() / 1_000.0
}

fn market_code(market: Market) -> &'static str {
    match market {
        Market::Us => "US",
        Market::Kr => "KR",
    }
}
