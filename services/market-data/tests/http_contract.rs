use axum::body::Body;
use http::{Method, Request, StatusCode, header};
use market_data::{config::AppConfig, http::router};
use tower::ServiceExt;

fn test_config() -> AppConfig {
    AppConfig {
        bind_addr: "127.0.0.1:0".parse().expect("valid bind addr"),
        internal_token: "test-internal-token".to_string(),
        supabase_url: Some("https://example.supabase.co".to_string()),
        supabase_service_role_key: Some("service-role-key".to_string()),
        stock_api_base: "https://openapi.koreainvestment.com:9443".to_string(),
        stock_api_app_key: Some("kis-app-key".to_string()),
        stock_api_app_secret: Some("kis-app-secret".to_string()),
        redis_url: Some("redis://127.0.0.1:6379".to_string()),
    }
}

#[tokio::test]
async fn healthz_is_public_and_reports_service_status() {
    let response = router(test_config())
        .oneshot(
            Request::builder()
                .uri("/healthz")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::OK);

    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body");
    let payload: serde_json::Value = serde_json::from_slice(&body).expect("json body");
    assert_eq!(payload["ok"], true);
    assert_eq!(payload["service"], "market-data");
}

#[tokio::test]
async fn metrics_requires_internal_bearer_token() {
    let response = router(test_config())
        .oneshot(
            Request::builder()
                .uri("/metrics")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn metrics_accepts_internal_bearer_token() {
    let response = router(test_config())
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/metrics")
                .header(header::AUTHORIZATION, "Bearer test-internal-token")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok()),
        Some("text/plain; version=0.0.4")
    );
}
