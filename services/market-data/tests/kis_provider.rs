use std::{
    net::SocketAddr,
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{
    Json, Router,
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
};
use market_data::{
    config::AppConfig,
    market::Market,
    provider::{
        kis::{KisClient, KisClientConfig, KisQuoteProvider, MemoryTokenCache},
        models::KisErrorKind,
    },
    service::{QuoteProvider, QuoteRequest},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::net::TcpListener;

#[derive(Clone, Copy)]
enum Scenario {
    Ok,
    NysOnly,
    RateLimited,
    AuthFailure,
    SlowDetail,
}

#[derive(Clone)]
struct MockState {
    scenario: Scenario,
    token_hits: Arc<Mutex<usize>>,
    detail_authorizations: Arc<Mutex<Vec<String>>>,
    detail_exchanges: Arc<Mutex<Vec<String>>>,
}

#[derive(Deserialize)]
struct DetailQuery {
    excd: Option<String>,
    #[allow(dead_code)]
    symb: Option<String>,
}

#[derive(Serialize)]
struct TokenPayload {
    access_token: String,
    access_token_token_expired: String,
}

async fn spawn_mock_kis(scenario: Scenario) -> (String, MockState) {
    let state = MockState {
        scenario,
        token_hits: Arc::new(Mutex::new(0)),
        detail_authorizations: Arc::new(Mutex::new(Vec::new())),
        detail_exchanges: Arc::new(Mutex::new(Vec::new())),
    };
    let app = Router::new()
        .route("/oauth2/tokenP", post(token_handler))
        .route(
            "/uapi/overseas-price/v1/quotations/price-detail",
            get(detail_handler),
        )
        .with_state(state.clone());
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind mock KIS");
    let addr: SocketAddr = listener.local_addr().expect("mock addr");

    tokio::spawn(async move {
        axum::serve(listener, app).await.expect("mock KIS server");
    });

    (format!("http://{addr}"), state)
}

async fn token_handler(State(state): State<MockState>) -> Result<Json<TokenPayload>, StatusCode> {
    *state.token_hits.lock().expect("token hits lock") += 1;
    if matches!(state.scenario, Scenario::AuthFailure) {
        return Err(StatusCode::UNAUTHORIZED);
    }

    Ok(Json(TokenPayload {
        access_token: "test-access-token".to_string(),
        access_token_token_expired: "2099-12-31 23:59:59".to_string(),
    }))
}

async fn detail_handler(
    State(state): State<MockState>,
    headers: HeaderMap,
    Query(query): Query<DetailQuery>,
) -> (StatusCode, Json<Value>) {
    if matches!(state.scenario, Scenario::SlowDetail) {
        tokio::time::sleep(Duration::from_millis(200)).await;
    }

    state.detail_authorizations.lock().expect("auth lock").push(
        headers
            .get("authorization")
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_string(),
    );
    let exchange = query.excd.unwrap_or_default();
    state
        .detail_exchanges
        .lock()
        .expect("exchange lock")
        .push(exchange.clone());

    if matches!(state.scenario, Scenario::RateLimited) {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({
                "rt_cd": "1",
                "msg_cd": "EGW00201",
                "msg1": "초당 거래건수를 초과했습니다."
            })),
        );
    }
    if matches!(state.scenario, Scenario::NysOnly) && exchange != "NYS" {
        return (
            StatusCode::OK,
            Json(json!({
                "rt_cd": "0",
                "output": {
                    "last": null,
                    "curr": "USD",
                    "base": "71.80",
                    "tvol": "12345678"
                }
            })),
        );
    }

    (
        StatusCode::OK,
        Json(json!({
            "rt_cd": "0",
            "output": {
                "last": "72.25",
                "curr": "USD",
                "base": "71.80",
                "tvol": "12345678"
            }
        })),
    )
}

fn provider_config(base_url: String) -> AppConfig {
    AppConfig {
        bind_addr: "127.0.0.1:0".parse().expect("valid bind addr"),
        internal_token: "test-internal-token".to_string(),
        supabase_url: None,
        supabase_service_role_key: None,
        stock_api_base: base_url,
        stock_api_app_key: Some("app-key".to_string()),
        stock_api_app_secret: Some("app-secret".to_string()),
        redis_url: None,
    }
}

fn client(base_url: String, timeout_ms: u64) -> KisClient<MemoryTokenCache> {
    KisClient::new(
        KisClientConfig {
            base_url,
            app_key: "app-key".to_string(),
            app_secret: "app-secret".to_string(),
            request_timeout: Duration::from_millis(timeout_ms),
            min_request_interval: Duration::from_millis(0),
        },
        MemoryTokenCache::default(),
    )
    .expect("KIS client")
}

#[tokio::test]
async fn reuses_access_token_between_provider_requests() {
    let (base_url, state) = spawn_mock_kis(Scenario::Ok).await;
    let client = client(base_url, 1_000);

    let first = client
        .overseas_price_detail("NAS", "KO")
        .await
        .expect("first detail");
    let second = client
        .overseas_price_detail("NAS", "KO")
        .await
        .expect("second detail");

    assert_eq!(first.last, Some(72.25));
    assert_eq!(second.last, Some(72.25));
    assert_eq!(*state.token_hits.lock().expect("token hits lock"), 1);
    assert_eq!(
        state
            .detail_authorizations
            .lock()
            .expect("auth lock")
            .as_slice(),
        ["Bearer test-access-token", "Bearer test-access-token"]
    );
}

#[tokio::test]
async fn maps_kis_rate_limit_response_to_stable_error_kind() {
    let (base_url, _state) = spawn_mock_kis(Scenario::RateLimited).await;
    let client = client(base_url, 1_000);

    let error = client
        .overseas_price_detail("NAS", "KO")
        .await
        .expect_err("rate limit error");

    assert_eq!(error.kind(), KisErrorKind::RateLimited);
}

#[tokio::test]
async fn maps_token_failure_to_auth_failed_error_kind() {
    let (base_url, _state) = spawn_mock_kis(Scenario::AuthFailure).await;
    let client = client(base_url, 1_000);

    let error = client
        .overseas_price_detail("NAS", "KO")
        .await
        .expect_err("auth error");

    assert_eq!(error.kind(), KisErrorKind::AuthFailed);
}

#[tokio::test]
async fn maps_provider_timeout_to_provider_unavailable() {
    let (base_url, _state) = spawn_mock_kis(Scenario::SlowDetail).await;
    let client = client(base_url, 20);

    let error = client
        .overseas_price_detail("NAS", "KO")
        .await
        .expect_err("timeout error");

    assert_eq!(error.kind(), KisErrorKind::ProviderUnavailable);
}

#[tokio::test]
async fn us_quote_provider_falls_back_to_nyse_when_nasdaq_price_is_empty() {
    let (base_url, state) = spawn_mock_kis(Scenario::NysOnly).await;
    let provider = KisQuoteProvider::from_config(&provider_config(base_url));

    let payload = provider
        .fetch_quote(QuoteRequest {
            market: Market::Us,
            symbol: "IBM".to_string(),
        })
        .await
        .expect("fallback quote");

    assert_eq!(payload["exchange"], "NYS");
    assert_eq!(payload["last"], 72.25);
    assert_eq!(
        state
            .detail_exchanges
            .lock()
            .expect("exchange lock")
            .as_slice(),
        ["NAS", "NYS"]
    );
}
