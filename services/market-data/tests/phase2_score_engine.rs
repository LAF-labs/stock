use std::sync::Arc;

use axum::body::Body;
use http::{Method, Request, StatusCode, header};
use market_data::{
    cache::{CacheTtls, MemoryMarketDataCache},
    config::AppConfig,
    http::router_with_service,
    jobs::MemoryRefreshQueue,
    market::{Market, ScoreView},
    score::{ScoreEngineInput, compute_score, score_negative, score_positive},
    service::{MarketDataError, MarketDataService, QuoteProvider, QuoteRequest},
};
use serde_json::{Value, json};
use tower::ServiceExt;

#[derive(Clone)]
struct NoopQuoteProvider;

impl QuoteProvider for NoopQuoteProvider {
    async fn fetch_quote(&self, _request: QuoteRequest) -> Result<Value, MarketDataError> {
        unreachable!("score compute endpoint does not fetch quotes")
    }
}

fn test_config() -> AppConfig {
    AppConfig {
        bind_addr: "127.0.0.1:0".parse().expect("valid bind addr"),
        internal_token: "test-internal-token".to_string(),
        supabase_url: None,
        supabase_service_role_key: None,
        stock_api_base: "https://openapi.koreainvestment.com:9443".to_string(),
        stock_api_app_key: None,
        stock_api_app_secret: None,
        redis_url: None,
    }
}

fn test_service() -> MarketDataService<NoopQuoteProvider> {
    MarketDataService::new(
        Arc::new(MemoryMarketDataCache::default()),
        Arc::new(MemoryRefreshQueue::default()),
        NoopQuoteProvider,
        CacheTtls::fast_for_tests(),
    )
}

fn strong_input(market: Market) -> ScoreEngineInput {
    ScoreEngineInput {
        market,
        symbol: match market {
            Market::Us => "KO".to_string(),
            Market::Kr => "005930".to_string(),
        },
        name: "Strong Co".to_string(),
        currency: match market {
            Market::Us => "USD".to_string(),
            Market::Kr => "KRW".to_string(),
        },
        latest_price: Some(100.0),
        previous_close: Some(98.0),
        eps: Some(2.0),
        bps: Some(10.0),
        profit_margin: Some(0.25),
        operating_margin: Some(0.25),
        ocf_margin: Some(0.25),
        revenue_growth: Some(0.35),
        earnings_growth: Some(0.50),
        return_1m: Some(0.15),
        return_3m: Some(0.35),
        return_6m: Some(0.50),
        return_52w: Some(0.80),
        distance_52w_high: Some(0.0),
        ma50: Some(90.0),
        ma200: Some(80.0),
        avg_volume_20: Some(5_000_000.0),
        avg_volume_60: Some(4_000_000.0),
        market_cap: match market {
            Market::Us => Some(200_000_000_000.0),
            Market::Kr => Some(50_000_000_000_000.0),
        },
        debt_to_equity: Some(25.0),
        current_ratio: Some(2.0),
        quick_ratio: Some(1.6),
        trailing_pe: match market {
            Market::Us => Some(12.0),
            Market::Kr => Some(8.0),
        },
        forward_pe: Some(10.0),
        price_to_book: match market {
            Market::Us => Some(1.5),
            Market::Kr => Some(0.8),
        },
        ev_to_revenue: Some(2.0),
        price_to_sales: None,
        fcf_margin: Some(0.24),
        rsi14: Some(62.0),
        atr14_pct: Some(0.03),
        target_mean_price: None,
        analyst_count: None,
        recommendation_mean: None,
        beta: None,
        trade_enabled: Some(true),
    }
}

fn nvda_like_input() -> ScoreEngineInput {
    ScoreEngineInput {
        market: Market::Us,
        symbol: "NVDA".to_string(),
        name: "NVIDIA Corp".to_string(),
        currency: "USD".to_string(),
        latest_price: Some(150.0),
        previous_close: Some(148.0),
        eps: Some(3.0),
        bps: Some(12.0),
        profit_margin: Some(0.55),
        operating_margin: Some(0.60),
        ocf_margin: Some(0.45),
        revenue_growth: Some(0.65),
        earnings_growth: Some(0.55),
        return_1m: Some(0.02),
        return_3m: Some(0.12),
        return_6m: Some(0.25),
        return_52w: Some(0.65),
        distance_52w_high: Some(-0.08),
        ma50: Some(142.0),
        ma200: Some(118.0),
        avg_volume_20: Some(170_000_000.0),
        avg_volume_60: Some(150_000_000.0),
        market_cap: Some(3_600_000_000_000.0),
        debt_to_equity: Some(18.0),
        current_ratio: Some(4.0),
        quick_ratio: Some(3.4),
        trailing_pe: Some(65.0),
        forward_pe: Some(38.0),
        price_to_book: Some(55.0),
        ev_to_revenue: Some(35.0),
        price_to_sales: None,
        fcf_margin: Some(0.42),
        rsi14: Some(63.0),
        atr14_pct: Some(0.035),
        target_mean_price: Some(190.0),
        analyst_count: Some(58.0),
        recommendation_mean: Some(1.7),
        beta: Some(1.9),
        trade_enabled: Some(true),
    }
}

fn speculative_no_forward_input() -> ScoreEngineInput {
    ScoreEngineInput {
        market: Market::Us,
        symbol: "SPEC".to_string(),
        name: "Speculative Growth Co".to_string(),
        currency: "USD".to_string(),
        latest_price: Some(10.0),
        previous_close: Some(8.0),
        eps: Some(0.10),
        bps: Some(2.0),
        profit_margin: Some(0.0),
        operating_margin: Some(-0.20),
        ocf_margin: Some(-0.18),
        revenue_growth: Some(1.20),
        earnings_growth: None,
        return_1m: Some(0.40),
        return_3m: Some(1.20),
        return_6m: Some(1.60),
        return_52w: Some(1.80),
        distance_52w_high: Some(-0.05),
        ma50: Some(8.0),
        ma200: Some(5.0),
        avg_volume_20: Some(8_000_000.0),
        avg_volume_60: Some(7_500_000.0),
        market_cap: Some(1_500_000_000.0),
        debt_to_equity: Some(5.0),
        current_ratio: Some(2.2),
        quick_ratio: Some(1.8),
        trailing_pe: Some(24.0),
        forward_pe: None,
        price_to_book: Some(5.0),
        ev_to_revenue: Some(13.5),
        price_to_sales: Some(14.2),
        fcf_margin: Some(-0.20),
        rsi14: Some(68.0),
        atr14_pct: Some(0.065),
        target_mean_price: None,
        analyst_count: Some(1.0),
        recommendation_mean: Some(1.8),
        beta: Some(2.1),
        trade_enabled: Some(true),
    }
}

fn speculative_covered_opportunity_input() -> ScoreEngineInput {
    ScoreEngineInput {
        market: Market::Kr,
        symbol: "108490".to_string(),
        name: "Robotis".to_string(),
        currency: "KRW".to_string(),
        latest_price: Some(320_500.0),
        previous_close: Some(300_000.0),
        eps: Some(380.0),
        bps: Some(8_500.0),
        profit_margin: Some(0.01),
        operating_margin: Some(-0.03),
        ocf_margin: Some(-0.02),
        revenue_growth: Some(1.0),
        earnings_growth: Some(0.20),
        return_1m: Some(0.18),
        return_3m: Some(0.42),
        return_6m: Some(0.85),
        return_52w: Some(1.35),
        distance_52w_high: Some(-0.03),
        ma50: Some(280_000.0),
        ma200: Some(155_000.0),
        avg_volume_20: Some(1_200_000.0),
        avg_volume_60: Some(900_000.0),
        market_cap: Some(2_100_000_000_000.0),
        debt_to_equity: Some(35.0),
        current_ratio: Some(2.1),
        quick_ratio: Some(1.8),
        trailing_pe: Some(850.0),
        forward_pe: Some(176.0),
        price_to_book: Some(38.0),
        ev_to_revenue: Some(117.0),
        price_to_sales: Some(103.0),
        fcf_margin: Some(-0.02),
        rsi14: Some(72.0),
        atr14_pct: Some(0.09),
        target_mean_price: Some(340_000.0),
        analyst_count: Some(1.0),
        recommendation_mean: Some(1.7),
        beta: Some(1.8),
        trade_enabled: Some(true),
    }
}

fn sparse_input() -> ScoreEngineInput {
    ScoreEngineInput {
        market: Market::Us,
        symbol: "SPRS".to_string(),
        name: "Sparse Disclosure Co".to_string(),
        currency: "USD".to_string(),
        latest_price: Some(10.0),
        previous_close: Some(10.1),
        eps: None,
        bps: None,
        profit_margin: None,
        operating_margin: None,
        ocf_margin: None,
        revenue_growth: None,
        earnings_growth: None,
        return_1m: Some(-0.01),
        return_3m: None,
        return_6m: None,
        return_52w: None,
        distance_52w_high: None,
        ma50: None,
        ma200: None,
        avg_volume_20: None,
        avg_volume_60: None,
        market_cap: None,
        debt_to_equity: None,
        current_ratio: None,
        quick_ratio: None,
        trailing_pe: None,
        forward_pe: None,
        price_to_book: None,
        ev_to_revenue: None,
        price_to_sales: None,
        fcf_margin: None,
        rsi14: None,
        atr14_pct: None,
        target_mean_price: None,
        analyst_count: None,
        recommendation_mean: None,
        beta: None,
        trade_enabled: None,
    }
}

#[test]
fn rust_opportunity_uses_python_volume_volatility_and_cashflow_inputs() {
    let mut input = speculative_no_forward_input();
    input.avg_volume_20 = Some(30_000.0);
    input.avg_volume_60 = Some(300_000.0);
    input.atr14_pct = Some(0.14);
    input.fcf_margin = Some(-0.35);
    input.operating_margin = Some(-0.20);
    input.ev_to_revenue = Some(35.0);
    input.price_to_sales = Some(33.0);

    let output = compute_score(input, ScoreView::Detail).expect("score");
    let opportunity = output.payload["opportunity_score"]
        .as_f64()
        .expect("opportunity");
    let caps = output.payload["sia_snapshot"]["opportunity_caps"]
        .as_array()
        .expect("caps")
        .iter()
        .filter_map(|value| value.as_str())
        .collect::<Vec<_>>();

    assert!(
        opportunity <= 60.0,
        "thin liquidity and high volatility should cap opportunity"
    );
    assert!(caps.contains(&"thin_liquidity"));
    assert!(caps.contains(&"short_term_overheat"));
    assert!(caps.contains(&"speculative_expensive_sales"));
}

#[test]
fn rust_score_uses_shared_golden_opportunity_guardrails() {
    let cases: Value = serde_json::from_str(include_str!(
        "../../../tests/fixtures/golden-score-guardrails.json"
    ))
    .expect("golden fixture");
    let cases = cases.as_array().expect("fixture array");

    for case in cases {
        let ticker = case["ticker"].as_str().expect("ticker");
        let input = rust_input_from_golden_case(case);
        let output = compute_score(input, ScoreView::Detail).expect("score");
        let opportunity = output.payload["opportunity_score"]
            .as_f64()
            .expect("opportunity score");
        let opportunity_confidence = output.payload["opportunity_confidence"]
            .as_f64()
            .expect("opportunity confidence");
        let expected = &case["expected_opportunity"];
        let min = expected["min"].as_f64().expect("min");
        let max = expected["max"].as_f64().expect("max");
        let parity = &case["expected_parity"];
        let expected_score = parity["opportunity_score"]["value"]
            .as_f64()
            .expect("opportunity parity value");
        let score_tolerance = parity["opportunity_score"]["tolerance"]
            .as_f64()
            .expect("opportunity parity tolerance");
        let expected_confidence = parity["opportunity_confidence"]["value"]
            .as_f64()
            .expect("opportunity confidence parity value");
        let confidence_tolerance = parity["opportunity_confidence"]["tolerance"]
            .as_f64()
            .expect("opportunity confidence parity tolerance");

        assert!(
            opportunity >= min && opportunity <= max,
            "{ticker} opportunity {opportunity} outside shared fixture range {min}..{max}"
        );
        assert!(
            (opportunity - expected_score).abs() <= score_tolerance,
            "{ticker} opportunity {opportunity} drifted from shared parity target {expected_score} +/- {score_tolerance}"
        );
        assert!(
            (opportunity_confidence - expected_confidence).abs() <= confidence_tolerance,
            "{ticker} opportunity confidence {opportunity_confidence} drifted from shared parity target {expected_confidence} +/- {confidence_tolerance}"
        );
    }
}

fn rust_input_from_golden_case(case: &Value) -> ScoreEngineInput {
    let ticker = case["ticker"].as_str().expect("ticker");
    let values = &case["opportunity_inputs"];
    let market = match values["market"].as_str().unwrap_or("US") {
        "KR" => Market::Kr,
        _ => Market::Us,
    };

    ScoreEngineInput {
        market,
        symbol: ticker.to_string(),
        name: ticker.to_string(),
        currency: match market {
            Market::Kr => "KRW".to_string(),
            Market::Us => "USD".to_string(),
        },
        latest_price: json_number(values, "latest_price"),
        previous_close: None,
        eps: None,
        bps: None,
        profit_margin: json_number(values, "operating_margin"),
        operating_margin: json_number(values, "operating_margin"),
        ocf_margin: json_number(values, "cashflow_margin"),
        revenue_growth: json_number(values, "revenue_growth"),
        earnings_growth: json_number(values, "earnings_growth"),
        return_1m: json_number(values, "ret_1m"),
        return_3m: json_number(values, "ret_3m"),
        return_6m: json_number(values, "ret_6m"),
        return_52w: json_number(values, "ret_52w"),
        distance_52w_high: json_number(values, "distance_52w_high"),
        ma50: json_number(values, "ma50"),
        ma200: json_number(values, "ma200"),
        avg_volume_20: json_number(values, "avg_volume_20"),
        avg_volume_60: json_number(values, "avg_volume_60"),
        market_cap: json_number(values, "market_cap"),
        debt_to_equity: None,
        current_ratio: None,
        quick_ratio: None,
        trailing_pe: None,
        forward_pe: json_number(values, "forward_pe"),
        price_to_book: None,
        ev_to_revenue: json_number(values, "ev_to_revenue"),
        price_to_sales: json_number(values, "price_to_sales"),
        fcf_margin: json_number(values, "cashflow_margin"),
        rsi14: json_number(values, "rsi14"),
        atr14_pct: json_number(values, "atr14_pct"),
        target_mean_price: json_number(values, "target_mean_price"),
        analyst_count: json_number(values, "analyst_count"),
        recommendation_mean: json_number(values, "recommendation_mean"),
        beta: json_number(values, "beta"),
        trade_enabled: Some(true),
    }
}

fn json_number(value: &Value, key: &str) -> Option<f64> {
    value.get(key).and_then(Value::as_f64)
}

#[test]
fn score_helpers_match_python_collector_boundaries() {
    assert_eq!(score_positive(None, -0.10, 0.25, 45.0), 45.0);
    assert_eq!(score_positive(Some(-0.10), -0.10, 0.25, 45.0), 0.0);
    assert_eq!(score_positive(Some(0.25), -0.10, 0.25, 45.0), 100.0);
    assert_eq!(score_negative(None, 12.0, 85.0, 45.0), 45.0);
    assert_eq!(score_negative(Some(12.0), 12.0, 85.0, 45.0), 100.0);
    assert_eq!(score_negative(Some(85.0), 12.0, 85.0, 45.0), 0.0);
}

#[test]
fn computes_us_score_with_rust_ported_weights() {
    let output = compute_score(strong_input(Market::Us), ScoreView::Detail).expect("score");

    assert_eq!(output.score, 97.2);
    assert_eq!(output.grade.class, "excellent");
    assert_eq!(output.signal, "BUY");
    assert_eq!(output.components.len(), 5);
    assert_eq!(output.components[0].key, "profitability");
    assert_eq!(output.components[0].score, 93.2);
    assert_eq!(output.payload["score"], 97.2);
    assert_eq!(output.payload["quality_score"], 97.2);
    assert!(
        output.payload["opportunity_score"]
            .as_f64()
            .expect("opportunity score")
            .is_finite()
    );
    assert!(
        output.payload["opportunity_confidence"]
            .as_f64()
            .expect("opportunity confidence")
            > 0.0
    );
    assert_eq!(
        output.payload["opportunity_components"]
            .as_array()
            .expect("opportunity components")
            .len(),
        5
    );
    assert_eq!(
        output.payload["score_model_version"],
        "score-v5-dual-quality-opportunity-2026-06-05"
    );
    assert_eq!(
        output.payload["sia_snapshot"]["signal_source"],
        "market-data:rust-score-engine"
    );
}

#[test]
fn computes_kr_score_with_domestic_thresholds() {
    let output = compute_score(strong_input(Market::Kr), ScoreView::Detail).expect("score");

    assert_eq!(output.score, 96.5);
    assert_eq!(output.grade.class, "excellent");
    assert_eq!(output.signal, "BUY");
    assert_eq!(output.components[2].key, "health");
    assert_eq!(output.components[2].score, 95.2);
    assert_eq!(output.payload["requested_ticker"], "KR:005930");
}

#[test]
fn kr_score_uses_enriched_fundamentals_when_available() {
    let mut sparse = strong_input(Market::Kr);
    sparse.eps = None;
    sparse.bps = None;
    sparse.profit_margin = None;
    sparse.operating_margin = None;
    sparse.ocf_margin = None;
    sparse.revenue_growth = None;
    sparse.earnings_growth = None;
    sparse.debt_to_equity = None;
    sparse.current_ratio = None;
    sparse.quick_ratio = None;
    sparse.forward_pe = None;
    sparse.ev_to_revenue = None;

    let mut enriched = sparse.clone();
    enriched.profit_margin = Some(0.24);
    enriched.operating_margin = Some(0.22);
    enriched.ocf_margin = Some(0.20);
    enriched.revenue_growth = Some(0.25);
    enriched.earnings_growth = Some(0.35);
    enriched.debt_to_equity = Some(35.0);
    enriched.current_ratio = Some(2.1);
    enriched.quick_ratio = Some(1.7);
    enriched.forward_pe = Some(14.0);
    enriched.ev_to_revenue = Some(3.5);

    let sparse_output = compute_score(sparse, ScoreView::Detail).expect("sparse score");
    let enriched_output = compute_score(enriched, ScoreView::Detail).expect("enriched score");

    assert!(
        enriched_output.payload["sia_snapshot"]["confidence"]
            .as_f64()
            .expect("enriched confidence")
            > sparse_output.payload["sia_snapshot"]["confidence"]
                .as_f64()
                .expect("sparse confidence"),
        "fundamental enrichment should increase confidence"
    );
}

#[test]
fn premium_growth_leader_stays_excellent_despite_expensive_multiples() {
    let output = compute_score(nvda_like_input(), ScoreView::Detail).expect("score");
    let valuation = output
        .components
        .iter()
        .find(|component| component.key == "valuation")
        .expect("valuation component");

    assert!(
        output.score >= 82.0,
        "NVDA-like growth leader should not score below excellent range: {}",
        output.score
    );
    assert!(
        valuation.score >= 45.0,
        "premium valuation should be moderated by quality and growth, not collapse to {}",
        valuation.score
    );
    assert_eq!(output.grade.class, "excellent");
}

#[test]
fn speculative_growth_setup_gets_separate_capped_opportunity_score() {
    let output =
        compute_score(speculative_covered_opportunity_input(), ScoreView::Detail).expect("score");
    let opportunity = output.payload["opportunity_score"]
        .as_f64()
        .expect("opportunity score");

    assert!(
        output.score < 55.0,
        "quality score should remain cautious for weak profitability and extreme valuation: {}",
        output.score
    );
    assert!(
        (58.0..=72.0).contains(&opportunity),
        "opportunity should reflect setup but respect risk caps: {opportunity}"
    );
    let snapshot_quality = output.payload["sia_snapshot"]["quality_score"]
        .as_f64()
        .expect("snapshot quality");
    assert!((snapshot_quality - output.score / 100.0).abs() < 0.001);
    assert!(
        output.payload["sia_snapshot"]["opportunity_score"]
            .as_f64()
            .expect("snapshot opportunity")
            > 0.55
    );
}

#[test]
fn no_forward_weak_quality_growth_story_stays_below_good_range() {
    let output = compute_score(speculative_no_forward_input(), ScoreView::Detail).expect("score");
    let valuation = output
        .components
        .iter()
        .find(|component| component.key == "valuation")
        .expect("valuation component");

    assert!(
        output.score < 65.0,
        "speculative no-forward growth story should not reach good range: {}",
        output.score
    );
    assert!(
        valuation.score <= 45.0,
        "valuation should be capped for weak quality without forward coverage: {}",
        valuation.score
    );
}

#[test]
fn opportunity_risk_component_exposes_beta_metric_when_available() {
    let output = compute_score(nvda_like_input(), ScoreView::Detail).expect("score");
    let risk_metrics = output
        .payload
        .get("opportunity_components")
        .and_then(Value::as_array)
        .and_then(|components| {
            components.iter().find(|component| {
                component.get("key").and_then(Value::as_str) == Some("opportunity_risk")
            })
        })
        .and_then(|component| component.get("metrics"))
        .and_then(Value::as_array)
        .expect("risk metrics");

    assert!(
        risk_metrics.iter().any(|metric| {
            metric.get("label").and_then(Value::as_str) == Some("베타")
                && metric.get("value").and_then(Value::as_str) == Some("1.90")
        }),
        "risk metrics should include the beta value, got {risk_metrics:?}"
    );
}

#[test]
fn fcf_only_weak_cashflow_caps_expensive_no_forward_valuation() {
    let mut input = speculative_no_forward_input();
    input.profit_margin = Some(0.18);
    input.operating_margin = Some(0.12);
    input.ocf_margin = None;
    input.fcf_margin = Some(-0.25);
    input.forward_pe = None;
    input.ev_to_revenue = Some(11.0);
    input.price_to_sales = Some(10.5);

    let output = compute_score(input, ScoreView::Detail).expect("score");
    let valuation = output
        .components
        .iter()
        .find(|component| component.key == "valuation")
        .expect("valuation component");

    assert!(
        valuation.score <= 45.0,
        "negative FCF should cap expensive no-forward valuation even without OCF margin: {}",
        valuation.score
    );
}

#[test]
fn sparse_input_lowers_confidence_instead_of_claiming_full_certainty() {
    let output = compute_score(sparse_input(), ScoreView::Detail).expect("score");
    let confidence = output.payload["sia_snapshot"]["confidence"]
        .as_f64()
        .expect("confidence");

    assert!(
        confidence <= 0.65,
        "sparse input should carry visibly lower confidence, got {confidence}"
    );
    assert!(
        (35.0..=60.0).contains(&output.score),
        "sparse input should stay neutral-to-cautious, got {}",
        output.score
    );
}

#[tokio::test]
async fn score_compute_endpoint_requires_auth_and_returns_payload() {
    let app = router_with_service(test_config(), test_service());
    let body = json!({
        "view": "detail",
        "input": strong_input(Market::Us)
    });

    let unauthorized = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/v1/score/compute")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body.to_string()))
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);

    let authorized = app
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/v1/score/compute")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::AUTHORIZATION, "Bearer test-internal-token")
                .body(Body::from(body.to_string()))
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(authorized.status(), StatusCode::OK);
    let body = axum::body::to_bytes(authorized.into_body(), usize::MAX)
        .await
        .expect("body");
    let payload: Value = serde_json::from_slice(&body).expect("json body");
    assert_eq!(payload["ok"], true);
    assert_eq!(payload["data"]["score"], 97.2);
    assert_eq!(payload["data"]["fetch"]["source"], "rust_score_engine");
}
