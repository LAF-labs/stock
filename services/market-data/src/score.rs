use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{
    market::{Market, ScoreView},
    service::{MarketDataError, MarketDataErrorKind},
};

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
    pub market_cap: Option<f64>,
    pub debt_to_equity: Option<f64>,
    pub current_ratio: Option<f64>,
    pub quick_ratio: Option<f64>,
    pub trailing_pe: Option<f64>,
    pub forward_pe: Option<f64>,
    pub price_to_book: Option<f64>,
    pub ev_to_revenue: Option<f64>,
    pub price_to_sales: Option<f64>,
    pub rsi14: Option<f64>,
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
struct ComponentScores {
    profitability: f64,
    growth: f64,
    health: f64,
    momentum: f64,
    valuation: f64,
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

    let profitability = average(&[
        eps_score(input.eps),
        Some(score_positive(roe, -0.10, 0.25, 45.0)),
        Some(score_positive(input.profit_margin, -0.05, 0.25, 45.0)),
        Some(score_positive(input.operating_margin, -0.05, 0.25, 45.0)),
        Some(score_positive(input.ocf_margin, -0.05, 0.25, 45.0)),
    ]);
    let growth = average(&[
        Some(score_positive(input.revenue_growth, -0.10, 0.35, 45.0)),
        Some(score_positive(input.earnings_growth, -0.20, 0.50, 45.0)),
        Some(score_positive(input.return_1m, -0.10, 0.15, 45.0)),
        Some(score_positive(input.return_6m, -0.25, 0.50, 45.0)),
        Some(score_positive(input.return_52w, -0.35, 0.80, 45.0)),
    ]);
    let health = average(&[
        Some(trade_score),
        Some(score_positive(
            input.avg_volume_20,
            50_000.0,
            5_000_000.0,
            45.0,
        )),
        Some(score_positive(
            input.market_cap,
            1_000_000_000.0,
            200_000_000_000.0,
            45.0,
        )),
        Some(score_negative(input.debt_to_equity, 25.0, 220.0, 45.0)),
        Some(score_positive(input.current_ratio, 0.8, 2.0, 45.0)),
        Some(score_positive(input.quick_ratio, 0.7, 1.6, 45.0)),
        Some(score_positive(input.ocf_margin, -0.05, 0.18, 45.0)),
    ]);
    let momentum = momentum_score(&input);
    let valuation = average(&[
        Some(score_negative(
            positive(input.trailing_pe),
            12.0,
            85.0,
            45.0,
        )),
        Some(score_negative(positive(input.forward_pe), 10.0, 70.0, 45.0)),
        Some(score_negative(
            positive(input.price_to_book),
            1.5,
            25.0,
            45.0,
        )),
        Some(score_negative(positive(ev_or_sales), 2.0, 25.0, 45.0)),
    ]);

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
    let trade_score = if input.trade_enabled.unwrap_or(false) {
        72.0
    } else {
        25.0
    };

    let profitability = average(&[
        eps_score(input.eps),
        Some(score_positive(roe, -0.10, 0.25, 45.0)),
    ]);
    let growth = average(&[
        Some(score_positive(input.return_1m, -0.10, 0.15, 45.0)),
        Some(score_positive(input.return_6m, -0.25, 0.50, 45.0)),
        Some(score_positive(input.return_52w, -0.35, 0.80, 45.0)),
    ]);
    let health = average(&[
        Some(trade_score),
        Some(score_positive(
            input.avg_volume_20,
            20_000.0,
            5_000_000.0,
            45.0,
        )),
        Some(score_positive(
            input.market_cap,
            50_000_000_000.0,
            50_000_000_000_000.0,
            45.0,
        )),
    ]);
    let momentum = momentum_score(&input);
    let valuation = average(&[
        Some(score_negative(positive(input.trailing_pe), 8.0, 60.0, 45.0)),
        Some(score_negative(
            positive(input.price_to_book),
            0.8,
            8.0,
            45.0,
        )),
    ]);

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
    let score = round1(clamp(
        scores.profitability * 0.18
            + scores.growth * 0.22
            + scores.health * 0.16
            + scores.momentum * 0.26
            + scores.valuation * 0.18,
        0.0,
        100.0,
    ));
    let grade = grade_for(score);
    let signal = signal_for(score, input.rsi14, input.return_3m);
    let components = components_for(scores);
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
        "score": score,
        "grade": grade.clone(),
        "summary": format!("{} score {:.1}/100.", market_code(input.market), score),
        "latest_price": input.latest_price,
        "components": components.clone(),
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
            "confidence": 1.0,
            "spot_score": round3(score / 100.0),
            "profitability_score": round3(scores.profitability / 100.0),
            "growth_score": round3(scores.growth / 100.0),
            "health_score": round3(scores.health / 100.0),
            "momentum_score": round3(scores.momentum / 100.0),
            "valuation_score": round3(scores.valuation / 100.0),
            "signal_source": "market-data:rust-score-engine"
        },
        "fetch": {
            "source": "rust_score_engine",
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

fn component(key: &str, label: &str, short: &str, score: f64) -> ScoreComponent {
    ScoreComponent {
        key: key.to_string(),
        label: label.to_string(),
        short: short.to_string(),
        score: round1(score),
        summary: format!("{label} score"),
        metrics: Vec::new(),
    }
}

fn momentum_score(input: &ScoreEngineInput) -> f64 {
    average(&[
        Some(score_positive(input.return_1m, -0.10, 0.15, 45.0)),
        Some(score_positive(input.return_3m, -0.20, 0.35, 45.0)),
        Some(score_positive(input.return_6m, -0.25, 0.50, 45.0)),
        Some(score_positive(input.distance_52w_high, -0.45, 0.0, 45.0)),
        Some(if above(input.latest_price, input.ma50) {
            80.0
        } else {
            35.0
        }),
        Some(if above(input.latest_price, input.ma200) {
            80.0
        } else {
            35.0
        }),
    ])
}

fn eps_score(eps: Option<f64>) -> Option<f64> {
    finite(eps).map(|value| {
        if value > 0.0 {
            75.0
        } else if value < 0.0 {
            25.0
        } else {
            45.0
        }
    })
}

fn average(values: &[Option<f64>]) -> f64 {
    let usable: Vec<f64> = values.iter().filter_map(|value| finite(*value)).collect();
    if usable.is_empty() {
        return 45.0;
    }
    usable.iter().sum::<f64>() / usable.len() as f64
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

fn above(left: Option<f64>, right: Option<f64>) -> bool {
    match (finite(left), finite(right)) {
        (Some(left), Some(right)) => left > right,
        _ => false,
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
