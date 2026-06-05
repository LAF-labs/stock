use axum::{
    Json, Router,
    body::Body,
    extract::State,
    http::{HeaderMap, Response, StatusCode, header},
    response::IntoResponse,
    routing::get,
};
use serde::Serialize;
use tower_http::trace::TraceLayer;

use crate::{auth::has_internal_bearer, config::AppConfig};

#[derive(Clone)]
struct AppState {
    config: AppConfig,
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

pub fn router(config: AppConfig) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/metrics", get(metrics))
        .layer(TraceLayer::new_for_http())
        .with_state(AppState { config })
}

async fn healthz(State(state): State<AppState>) -> Json<HealthPayload> {
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

async fn metrics(State(state): State<AppState>, headers: HeaderMap) -> Response<Body> {
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

fn unauthorized_response() -> Response<Body> {
    (
        StatusCode::UNAUTHORIZED,
        [(header::WWW_AUTHENTICATE, "Bearer")],
        "unauthorized\n",
    )
        .into_response()
}
