use std::{future::Future, sync::Arc};

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
    fn fetch_quote(
        &self,
        _request: QuoteRequest,
    ) -> impl Future<Output = Result<Value, MarketDataError>> + Send {
        async move { unreachable!("score compute endpoint does not fetch quotes") }
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
        rsi14: Some(62.0),
        trade_enabled: Some(true),
    }
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

    assert_eq!(output.score, 96.2);
    assert_eq!(output.grade.class, "excellent");
    assert_eq!(output.signal, "BUY");
    assert_eq!(output.components.len(), 5);
    assert_eq!(output.components[0].key, "profitability");
    assert_eq!(output.components[0].score, 92.1);
    assert_eq!(output.payload["score"], 96.2);
    assert_eq!(
        output.payload["sia_snapshot"]["signal_source"],
        "market-data:rust-score-engine"
    );
}

#[test]
fn computes_kr_score_with_domestic_thresholds() {
    let output = compute_score(strong_input(Market::Kr), ScoreView::Detail).expect("score");

    assert_eq!(output.score, 93.2);
    assert_eq!(output.grade.class, "excellent");
    assert_eq!(output.signal, "BUY");
    assert_eq!(output.components[2].key, "health");
    assert_eq!(output.components[2].score, 90.7);
    assert_eq!(output.payload["requested_ticker"], "KR:005930");
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
    assert_eq!(payload["data"]["score"], 96.2);
    assert_eq!(payload["data"]["fetch"]["source"], "rust_score_engine");
}
