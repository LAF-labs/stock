use axum::{
    Json, Router,
    body::Body,
    extract::{Path, Query, State},
    http::{HeaderMap, Response, StatusCode, header},
    response::IntoResponse,
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tower_http::trace::TraceLayer;

use std::sync::Arc;

use crate::{
    auth::has_internal_bearer,
    cache::{CacheSource, CacheTtls, MemoryCacheStats, MemoryMarketDataCache},
    config::AppConfig,
    jobs::{MemoryRefreshQueue, RefreshQueueStats},
    market::{Market, ScoreView},
    provider::kis::KisQuoteProvider,
    score::{ScoreEngineInput, compute_score},
    service::{MarketDataError, MarketDataErrorKind, MarketDataService, QuoteProvider},
};

#[derive(Clone)]
struct AppState<P> {
    config: AppConfig,
    service: MarketDataService<P>,
}

#[derive(Serialize)]
struct HealthPayload {
    ok: bool,
    service: &'static str,
    dependencies: DependencyStatus,
    backends: BackendStatus,
    score: ScoreReadiness,
}

#[derive(Serialize)]
struct DependencyStatus {
    supabase_configured: bool,
    kis_configured: bool,
    redis_configured: bool,
}

#[derive(Serialize)]
struct ReadinessPayload {
    ok: bool,
    service: &'static str,
    dependencies: DependencyStatus,
    backends: BackendStatus,
    score: ScoreReadiness,
}

#[derive(Serialize)]
struct BackendStatus {
    cache: CacheBackendStatus,
    queue: QueueBackendStatus,
}

#[derive(Serialize)]
struct CacheBackendStatus {
    active: &'static str,
    durable: bool,
    quote_entries: usize,
    score_entries: usize,
    quote_capacity: usize,
    score_capacity: usize,
}

#[derive(Serialize)]
struct QueueBackendStatus {
    active: &'static str,
    durable: bool,
    depth: usize,
    capacity: usize,
}

#[derive(Serialize)]
struct ScoreReadiness {
    durable_refresh_available: bool,
    refresh_backend: &'static str,
    recommended_next_client_flag: &'static str,
}

#[derive(Deserialize)]
struct QuoteQuery {
    refresh: Option<bool>,
}

#[derive(Deserialize)]
struct ScoreQuery {
    refresh: Option<bool>,
    view: Option<String>,
}

#[derive(Deserialize)]
struct RefreshPayload {
    kind: Option<String>,
    market: String,
    symbol: String,
    view: Option<String>,
}

#[derive(Deserialize)]
struct ScoreComputePayload {
    view: Option<String>,
    input: ScoreEngineInput,
}

pub fn router(config: AppConfig) -> Router {
    let provider = KisQuoteProvider::from_config(&config);
    let service = MarketDataService::new(
        Arc::new(MemoryMarketDataCache::default()),
        Arc::new(MemoryRefreshQueue::default()),
        provider,
        CacheTtls::default(),
    );
    router_with_service(config, service)
}

pub fn router_with_service<P>(config: AppConfig, service: MarketDataService<P>) -> Router
where
    P: QuoteProvider,
{
    Router::new()
        .route("/healthz", get(healthz))
        .route("/readyz", get(readyz))
        .route("/metrics", get(metrics))
        .route("/v1/quote/{market}/{symbol}", get(quote::<P>))
        .route("/v1/score/{market}/{symbol}", get(score::<P>))
        .route("/v1/score/compute", post(score_compute::<P>))
        .route("/v1/refresh", post(refresh::<P>))
        .layer(TraceLayer::new_for_http())
        .with_state(AppState { config, service })
}

async fn healthz<P>(State(state): State<AppState<P>>) -> Json<HealthPayload>
where
    P: QuoteProvider,
{
    let cache = state.service.cache_stats();
    let queue = state.service.queue_stats();
    Json(HealthPayload {
        ok: true,
        service: "market-data",
        dependencies: dependency_status(&state.config),
        backends: backend_status(cache, queue),
        score: score_readiness(),
    })
}

async fn readyz<P>(State(state): State<AppState<P>>, headers: HeaderMap) -> Response<Body>
where
    P: QuoteProvider,
{
    if !has_internal_bearer(&headers, &state.config.internal_token) {
        return unauthorized_response();
    }

    let cache = state.service.cache_stats();
    let queue = state.service.queue_stats();
    json_response(
        StatusCode::OK,
        json!(ReadinessPayload {
            ok: true,
            service: "market-data",
            dependencies: dependency_status(&state.config),
            backends: backend_status(cache, queue),
            score: score_readiness(),
        }),
    )
}

async fn metrics<P>(State(state): State<AppState<P>>, headers: HeaderMap) -> Response<Body>
where
    P: QuoteProvider,
{
    if !has_internal_bearer(&headers, &state.config.internal_token) {
        return unauthorized_response();
    }

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/plain; version=0.0.4")
        .body(Body::from(metrics_body(&state)))
        .expect("valid metrics response")
}

async fn quote<P>(
    State(state): State<AppState<P>>,
    Path((market, symbol)): Path<(String, String)>,
    Query(query): Query<QuoteQuery>,
    headers: HeaderMap,
) -> Response<Body>
where
    P: QuoteProvider,
{
    if !has_internal_bearer(&headers, &state.config.internal_token) {
        return unauthorized_response();
    }

    let market = match parse_market(&market) {
        Ok(market) => market,
        Err(error) => return service_error_response(error),
    };
    match state
        .service
        .quote(market, &symbol, query.refresh.unwrap_or(false))
        .await
    {
        Ok(response) => json_response(
            StatusCode::OK,
            json!({
                "ok": true,
                "data": response.payload,
                "server_cache": response.cache,
                "job": response.job
            }),
        ),
        Err(error) => service_error_response(error),
    }
}

async fn score<P>(
    State(state): State<AppState<P>>,
    Path((market, symbol)): Path<(String, String)>,
    Query(query): Query<ScoreQuery>,
    headers: HeaderMap,
) -> Response<Body>
where
    P: QuoteProvider,
{
    if !has_internal_bearer(&headers, &state.config.internal_token) {
        return unauthorized_response();
    }

    let market = match parse_market(&market) {
        Ok(market) => market,
        Err(error) => return service_error_response(error),
    };
    let view = match ScoreView::parse(query.view.as_deref()) {
        Ok(view) => view,
        Err(error) => {
            return service_error_response(MarketDataError::new(
                MarketDataErrorKind::InvalidRequest,
                error.to_string(),
            ));
        }
    };

    match state
        .service
        .score(market, &symbol, view, query.refresh.unwrap_or(false))
        .await
    {
        Ok(response) => {
            let status = if response.cache.source == CacheSource::Queue {
                StatusCode::ACCEPTED
            } else {
                StatusCode::OK
            };
            json_response(
                status,
                json!({
                    "ok": true,
                    "data": response.payload,
                    "server_cache": response.cache,
                    "job": response.job
                }),
            )
        }
        Err(error) => service_error_response(error),
    }
}

async fn score_compute<P>(
    State(state): State<AppState<P>>,
    headers: HeaderMap,
    Json(payload): Json<ScoreComputePayload>,
) -> Response<Body>
where
    P: QuoteProvider,
{
    if !has_internal_bearer(&headers, &state.config.internal_token) {
        return unauthorized_response();
    }

    let view = match ScoreView::parse(payload.view.as_deref()) {
        Ok(view) => view,
        Err(error) => {
            return service_error_response(MarketDataError::new(
                MarketDataErrorKind::InvalidRequest,
                error.to_string(),
            ));
        }
    };

    match compute_score(payload.input, view) {
        Ok(output) => json_response(
            StatusCode::OK,
            json!({
                "ok": true,
                "data": output.payload,
                "engine": {
                    "name": "rust_score_engine",
                    "view": view.as_str()
                }
            }),
        ),
        Err(error) => service_error_response(error),
    }
}

async fn refresh<P>(
    State(state): State<AppState<P>>,
    headers: HeaderMap,
    Json(payload): Json<RefreshPayload>,
) -> Response<Body>
where
    P: QuoteProvider,
{
    if !has_internal_bearer(&headers, &state.config.internal_token) {
        return unauthorized_response();
    }

    let market = match parse_market(&payload.market) {
        Ok(market) => market,
        Err(error) => return service_error_response(error),
    };
    let kind = payload
        .kind
        .as_deref()
        .unwrap_or("quote")
        .trim()
        .to_ascii_lowercase();

    let job = match kind.as_str() {
        "quote" => state.service.enqueue_quote_refresh(market, &payload.symbol),
        "score" => {
            let view = match ScoreView::parse(payload.view.as_deref()) {
                Ok(view) => view,
                Err(error) => {
                    return service_error_response(MarketDataError::new(
                        MarketDataErrorKind::InvalidRequest,
                        error.to_string(),
                    ));
                }
            };
            state
                .service
                .enqueue_score_refresh(market, &payload.symbol, view)
        }
        _ => Err(MarketDataError::new(
            MarketDataErrorKind::InvalidRequest,
            "unsupported refresh kind",
        )),
    };

    match job {
        Ok(job) => json_response(StatusCode::ACCEPTED, json!({ "ok": true, "job": job })),
        Err(error) => service_error_response(error),
    }
}

fn unauthorized_response() -> Response<Body> {
    (
        StatusCode::UNAUTHORIZED,
        [(header::WWW_AUTHENTICATE, "Bearer")],
        "unauthorized\n",
    )
        .into_response()
}

fn dependency_status(config: &AppConfig) -> DependencyStatus {
    DependencyStatus {
        supabase_configured: config.supabase_url.is_some()
            && config.supabase_service_role_key.is_some(),
        kis_configured: config.stock_api_app_key.is_some() && config.stock_api_app_secret.is_some(),
        redis_configured: config.redis_url.is_some(),
    }
}

fn backend_status(cache: MemoryCacheStats, queue: RefreshQueueStats) -> BackendStatus {
    BackendStatus {
        cache: CacheBackendStatus {
            active: "memory",
            durable: false,
            quote_entries: cache.quote_entries,
            score_entries: cache.score_entries,
            quote_capacity: cache.quote_capacity,
            score_capacity: cache.score_capacity,
        },
        queue: QueueBackendStatus {
            active: "memory",
            durable: false,
            depth: queue.depth,
            capacity: queue.capacity,
        },
    }
}

fn score_readiness() -> ScoreReadiness {
    ScoreReadiness {
        durable_refresh_available: false,
        refresh_backend: "memory_queue",
        recommended_next_client_flag: "MARKET_DATA_SERVICE_ENABLE_SCORE=0",
    }
}

fn metrics_body<P>(state: &AppState<P>) -> String
where
    P: QuoteProvider,
{
    let dependencies = dependency_status(&state.config);
    let cache = state.service.cache_stats();
    let queue = state.service.queue_stats();
    let metrics = state.service.metrics_snapshot();
    [
        "# HELP market_data_service_info Market data service info".to_string(),
        "# TYPE market_data_service_info gauge".to_string(),
        "market_data_service_info 1".to_string(),
        "# HELP market_data_dependency_configured Configured dependency flags".to_string(),
        "# TYPE market_data_dependency_configured gauge".to_string(),
        format!(
            "market_data_dependency_configured{{dependency=\"supabase\"}} {}",
            bool_gauge(dependencies.supabase_configured)
        ),
        format!(
            "market_data_dependency_configured{{dependency=\"kis\"}} {}",
            bool_gauge(dependencies.kis_configured)
        ),
        format!(
            "market_data_dependency_configured{{dependency=\"redis\"}} {}",
            bool_gauge(dependencies.redis_configured)
        ),
        "# HELP market_data_backend_info Active backend information".to_string(),
        "# TYPE market_data_backend_info gauge".to_string(),
        "market_data_backend_info{kind=\"cache\",backend=\"memory\",durable=\"false\"} 1"
            .to_string(),
        "market_data_backend_info{kind=\"queue\",backend=\"memory\",durable=\"false\"} 1"
            .to_string(),
        "# HELP market_data_cache_entries Current memory cache entries".to_string(),
        "# TYPE market_data_cache_entries gauge".to_string(),
        format!(
            "market_data_cache_entries{{kind=\"quote\"}} {}",
            cache.quote_entries
        ),
        format!(
            "market_data_cache_entries{{kind=\"score\"}} {}",
            cache.score_entries
        ),
        "# HELP market_data_cache_capacity Configured memory cache capacity".to_string(),
        "# TYPE market_data_cache_capacity gauge".to_string(),
        format!(
            "market_data_cache_capacity{{kind=\"quote\"}} {}",
            cache.quote_capacity
        ),
        format!(
            "market_data_cache_capacity{{kind=\"score\"}} {}",
            cache.score_capacity
        ),
        "# HELP market_data_refresh_queue_depth Current refresh queue depth".to_string(),
        "# TYPE market_data_refresh_queue_depth gauge".to_string(),
        format!("market_data_refresh_queue_depth {}", queue.depth),
        "# HELP market_data_refresh_queue_capacity Configured refresh queue capacity".to_string(),
        "# TYPE market_data_refresh_queue_capacity gauge".to_string(),
        format!("market_data_refresh_queue_capacity {}", queue.capacity),
        "# HELP market_data_cache_events_total Cache lookup events by kind and state".to_string(),
        "# TYPE market_data_cache_events_total counter".to_string(),
        format!(
            "market_data_cache_events_total{{kind=\"quote\",state=\"fresh\"}} {}",
            metrics.quote_cache_fresh
        ),
        format!(
            "market_data_cache_events_total{{kind=\"quote\",state=\"stale\"}} {}",
            metrics.quote_cache_stale
        ),
        format!(
            "market_data_cache_events_total{{kind=\"quote\",state=\"miss\"}} {}",
            metrics.quote_cache_miss
        ),
        format!(
            "market_data_cache_events_total{{kind=\"score\",state=\"fresh\"}} {}",
            metrics.score_cache_fresh
        ),
        format!(
            "market_data_cache_events_total{{kind=\"score\",state=\"stale\"}} {}",
            metrics.score_cache_stale
        ),
        format!(
            "market_data_cache_events_total{{kind=\"score\",state=\"miss\"}} {}",
            metrics.score_cache_miss
        ),
        "# HELP market_data_provider_requests_total Provider request attempts".to_string(),
        "# TYPE market_data_provider_requests_total counter".to_string(),
        format!(
            "market_data_provider_requests_total {}",
            metrics.provider_requests
        ),
        "# HELP market_data_provider_errors_total Provider errors by stable class".to_string(),
        "# TYPE market_data_provider_errors_total counter".to_string(),
        format!(
            "market_data_provider_errors_total{{kind=\"rate_limited\"}} {}",
            metrics.provider_rate_limited_errors
        ),
        format!(
            "market_data_provider_errors_total{{kind=\"auth_failed\"}} {}",
            metrics.provider_auth_failed_errors
        ),
        format!(
            "market_data_provider_errors_total{{kind=\"provider_unavailable\"}} {}",
            metrics.provider_unavailable_errors
        ),
        format!(
            "market_data_provider_errors_total{{kind=\"invalid_provider_response\"}} {}",
            metrics.provider_invalid_response_errors
        ),
        "".to_string(),
    ]
    .join("\n")
}

fn bool_gauge(value: bool) -> u8 {
    u8::from(value)
}

fn parse_market(value: &str) -> Result<Market, MarketDataError> {
    Market::parse(value).map_err(|error| {
        MarketDataError::new(MarketDataErrorKind::InvalidRequest, error.to_string())
    })
}

fn service_error_response(error: MarketDataError) -> Response<Body> {
    let status = match error.kind() {
        MarketDataErrorKind::InvalidRequest => StatusCode::BAD_REQUEST,
        MarketDataErrorKind::RateLimited => StatusCode::TOO_MANY_REQUESTS,
        MarketDataErrorKind::AuthFailed
        | MarketDataErrorKind::ProviderUnavailable
        | MarketDataErrorKind::InvalidProviderResponse => StatusCode::BAD_GATEWAY,
    };
    json_response(
        status,
        json!({
            "ok": false,
            "error": {
                "kind": format!("{:?}", error.kind()),
                "message": error.public_message()
            }
        }),
    )
}

fn json_response(status: StatusCode, payload: serde_json::Value) -> Response<Body> {
    (status, Json(payload)).into_response()
}
