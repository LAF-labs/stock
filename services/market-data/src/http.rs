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
    cache::{CacheSource, CacheTtls, MemoryMarketDataCache},
    config::AppConfig,
    jobs::MemoryRefreshQueue,
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
}

#[derive(Serialize)]
struct DependencyStatus {
    supabase_configured: bool,
    kis_configured: bool,
    redis_configured: bool,
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
    Json(HealthPayload {
        ok: true,
        service: "market-data",
        dependencies: DependencyStatus {
            supabase_configured: state.config.supabase_url.is_some()
                && state.config.supabase_service_role_key.is_some(),
            kis_configured: state.config.stock_api_app_key.is_some()
                && state.config.stock_api_app_secret.is_some(),
            redis_configured: state.config.redis_url.is_some(),
        },
    })
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
        .body(Body::from(
            [
                "# HELP market_data_service_info Market data service info",
                "# TYPE market_data_service_info gauge",
                "market_data_service_info 1",
                "",
            ]
            .join("\n"),
        ))
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
