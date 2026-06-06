use std::{
    future::Future,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};

use axum::body::Body;
use http::{Request, StatusCode, header};
use market_data::{
    cache::{CacheSource, CacheState, CacheTtls, MemoryMarketDataCache},
    config::AppConfig,
    http::router_with_service,
    jobs::MemoryRefreshQueue,
    market::{Market, ScoreView},
    service::{
        MarketDataError, MarketDataErrorKind, MarketDataService, QuoteProvider, QuoteRequest,
    },
};
use serde_json::{Value, json};
use tower::ServiceExt;

#[derive(Clone)]
struct FakeQuoteProvider {
    calls: Arc<AtomicUsize>,
    mode: Arc<Mutex<FakeMode>>,
    delay: Arc<Mutex<Duration>>,
}

#[derive(Clone)]
enum FakeMode {
    Ok(Value),
    Err(MarketDataErrorKind),
}

impl FakeQuoteProvider {
    fn ok(payload: Value) -> Self {
        Self {
            calls: Arc::new(AtomicUsize::new(0)),
            mode: Arc::new(Mutex::new(FakeMode::Ok(payload))),
            delay: Arc::new(Mutex::new(Duration::ZERO)),
        }
    }

    fn with_delay(self, delay: Duration) -> Self {
        *self.delay.lock().expect("fake provider delay lock") = delay;
        self
    }

    fn set_error(&self, kind: MarketDataErrorKind) {
        *self.mode.lock().expect("fake provider mode lock") = FakeMode::Err(kind);
    }

    fn calls(&self) -> usize {
        self.calls.load(Ordering::SeqCst)
    }
}

impl QuoteProvider for FakeQuoteProvider {
    fn fetch_quote(
        &self,
        request: QuoteRequest,
    ) -> impl Future<Output = Result<Value, MarketDataError>> + Send {
        let this = self.clone();
        async move {
            this.calls.fetch_add(1, Ordering::SeqCst);
            let delay = *this.delay.lock().expect("fake provider delay lock");
            if delay > Duration::ZERO {
                tokio::time::sleep(delay).await;
            }
            match this.mode.lock().expect("fake provider mode lock").clone() {
                FakeMode::Ok(payload) => Ok(json!({
                    "market": request.market.as_str(),
                    "symbol": request.symbol,
                    "quote": payload
                })),
                FakeMode::Err(kind) => Err(MarketDataError::new(kind, "provider unavailable")),
            }
        }
    }
}

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

fn test_service(
    provider: FakeQuoteProvider,
    ttl: CacheTtls,
) -> (
    MarketDataService<FakeQuoteProvider>,
    Arc<MemoryMarketDataCache>,
    Arc<MemoryRefreshQueue>,
) {
    let cache = Arc::new(MemoryMarketDataCache::default());
    let queue = Arc::new(MemoryRefreshQueue::default());
    let service = MarketDataService::new(cache.clone(), queue.clone(), provider, ttl);
    (service, cache, queue)
}

#[test]
fn default_quote_ttls_match_production_quote_contract() {
    let ttls = CacheTtls::default();

    assert_eq!(ttls.quote_fresh, Duration::from_secs(300));
    assert_eq!(ttls.quote_stale, Duration::from_secs(86_400));
}

#[test]
fn bounded_memory_cache_evicts_oldest_quote_entries() {
    let cache = MemoryMarketDataCache::with_limits(1, 1);
    cache.upsert_quote(
        Market::Us,
        "AAPL",
        json!({"symbol": "AAPL"}),
        CacheTtls::fast_for_tests(),
    );
    cache.upsert_quote(
        Market::Us,
        "MSFT",
        json!({"symbol": "MSFT"}),
        CacheTtls::fast_for_tests(),
    );

    assert!(matches!(
        cache.quote(Market::Us, "AAPL"),
        market_data::cache::CacheLookup::Miss
    ));
    assert!(matches!(
        cache.quote(Market::Us, "MSFT"),
        market_data::cache::CacheLookup::Fresh(_)
    ));
    assert_eq!(cache.stats().quote_entries, 1);
}

#[test]
fn bounded_memory_queue_evicts_oldest_unique_refresh_jobs() {
    let queue = MemoryRefreshQueue::with_capacity(2);
    queue.enqueue_quote(Market::Us, "AAPL");
    queue.enqueue_quote(Market::Us, "MSFT");
    queue.enqueue_quote(Market::Us, "NVDA");

    assert_eq!(queue.len(), 2);
    assert_eq!(queue.stats().capacity, 2);
}

#[tokio::test]
async fn concurrent_quote_miss_singleflights_provider_fetch() {
    let provider = FakeQuoteProvider::ok(json!({"last": 182.0, "currency": "USD"}))
        .with_delay(Duration::from_millis(25));
    let (service, _cache, queue) = test_service(provider.clone(), CacheTtls::fast_for_tests());
    let service = Arc::new(service);

    let mut requests = Vec::new();
    for _ in 0..16 {
        let service = service.clone();
        requests.push(tokio::spawn(async move {
            service
                .quote(Market::Us, "tsla", false)
                .await
                .expect("quote")
        }));
    }

    for request in requests {
        let response = request.await.expect("task");
        assert_eq!(response.payload["symbol"], "TSLA");
    }

    assert_eq!(provider.calls(), 1);
    assert_eq!(queue.len(), 0);
}

#[tokio::test]
async fn metrics_track_cache_queue_and_provider_error_state() {
    let provider = FakeQuoteProvider::ok(json!({"last": 913.0, "currency": "USD"}));
    let (service, _cache, _queue) = test_service(provider.clone(), CacheTtls::fast_for_tests());
    let app = router_with_service(test_config(), service);

    app.clone()
        .oneshot(
            Request::builder()
                .uri("/v1/score/us/NVDA")
                .header(header::AUTHORIZATION, "Bearer test-internal-token")
                .body(Body::empty())
                .expect("score request"),
        )
        .await
        .expect("score response");

    provider.set_error(MarketDataErrorKind::ProviderUnavailable);
    app.clone()
        .oneshot(
            Request::builder()
                .uri("/v1/quote/us/FAIL")
                .header(header::AUTHORIZATION, "Bearer test-internal-token")
                .body(Body::empty())
                .expect("quote request"),
        )
        .await
        .expect("quote response");

    let metrics = app
        .oneshot(
            Request::builder()
                .uri("/metrics")
                .header(header::AUTHORIZATION, "Bearer test-internal-token")
                .body(Body::empty())
                .expect("metrics request"),
        )
        .await
        .expect("metrics response");
    assert_eq!(metrics.status(), StatusCode::OK);
    let body = axum::body::to_bytes(metrics.into_body(), usize::MAX)
        .await
        .expect("metrics body");
    let text = String::from_utf8(body.to_vec()).expect("metrics utf8");

    assert!(text.contains("market_data_refresh_queue_depth 1"));
    assert!(text.contains("market_data_provider_errors_total{kind=\"provider_unavailable\"} 1"));
    assert!(text.contains("market_data_cache_events_total{kind=\"score\",state=\"miss\"} 1"));
}

#[tokio::test]
async fn quote_miss_fetches_provider_and_reuses_fresh_cache() {
    let provider = FakeQuoteProvider::ok(json!({"last": 101.25, "currency": "USD"}));
    let (service, _cache, queue) = test_service(provider.clone(), CacheTtls::fast_for_tests());

    let first = service
        .quote(Market::Us, "aapl", false)
        .await
        .expect("quote miss fetch");

    assert_eq!(first.payload["symbol"], "AAPL");
    assert_eq!(first.cache.state, CacheState::Miss);
    assert_eq!(first.cache.source, CacheSource::Provider);
    assert!(!first.cache.refresh_started);
    assert_eq!(provider.calls(), 1);
    assert_eq!(queue.len(), 0);

    let second = service
        .quote(Market::Us, "AAPL", false)
        .await
        .expect("quote cache hit");

    assert_eq!(second.cache.state, CacheState::Fresh);
    assert_eq!(second.cache.source, CacheSource::Cache);
    assert_eq!(second.payload["quote"]["last"], 101.25);
    assert_eq!(provider.calls(), 1);
}

#[tokio::test]
async fn stale_quote_returns_cached_payload_and_dedupes_refresh_job() {
    let provider = FakeQuoteProvider::ok(json!({"last": 221.40, "currency": "USD"}));
    let (service, _cache, queue) = test_service(
        provider.clone(),
        CacheTtls {
            quote_fresh: Duration::from_millis(5),
            quote_stale: Duration::from_secs(60),
            score_fresh: Duration::from_secs(60),
            score_stale: Duration::from_secs(300),
        },
    );

    service
        .quote(Market::Us, "MSFT", false)
        .await
        .expect("initial quote fetch");
    provider.set_error(MarketDataErrorKind::ProviderUnavailable);
    tokio::time::sleep(Duration::from_millis(15)).await;

    let stale = service
        .quote(Market::Us, "MSFT", false)
        .await
        .expect("stale quote");
    let stale_again = service
        .quote(Market::Us, "MSFT", false)
        .await
        .expect("stale quote again");

    assert_eq!(stale.cache.state, CacheState::Stale);
    assert_eq!(stale.cache.source, CacheSource::Cache);
    assert!(stale.cache.refresh_started);
    assert_eq!(stale.payload["quote"]["last"], 221.40);
    assert_eq!(stale.job.as_ref().map(|job| job.id.as_str()), Some("job-1"));
    assert_eq!(
        stale_again.job.as_ref().map(|job| job.id.as_str()),
        Some("job-1")
    );
    assert_eq!(queue.len(), 1);
}

#[tokio::test]
async fn score_miss_returns_accepted_and_enqueues_single_refresh_job() {
    let provider = FakeQuoteProvider::ok(json!({"last": 913.0, "currency": "USD"}));
    let (service, _cache, queue) = test_service(provider, CacheTtls::fast_for_tests());

    let first = service
        .score(Market::Us, "NVDA", ScoreView::Detail, false)
        .await
        .expect("score miss");
    let second = service
        .score(Market::Us, "nvda", ScoreView::Detail, false)
        .await
        .expect("score miss dedupe");

    assert_eq!(first.cache.state, CacheState::Miss);
    assert_eq!(first.cache.source, CacheSource::Queue);
    assert!(first.cache.refresh_started);
    assert_eq!(first.payload["status"], "queued");
    assert_eq!(first.job.as_ref().map(|job| job.id.as_str()), Some("job-1"));
    assert_eq!(
        second.job.as_ref().map(|job| job.id.as_str()),
        Some("job-1")
    );
    assert_eq!(queue.len(), 1);
}

#[tokio::test]
async fn score_force_refresh_serves_stale_cache_and_enqueues_refresh_job() {
    let provider = FakeQuoteProvider::ok(json!({"last": 913.0, "currency": "USD"}));
    let (service, cache, queue) = test_service(
        provider,
        CacheTtls {
            quote_fresh: Duration::from_secs(30),
            quote_stale: Duration::from_secs(300),
            score_fresh: Duration::from_millis(5),
            score_stale: Duration::from_secs(60),
        },
    );
    cache.upsert_score(
        Market::Us,
        "NVDA",
        ScoreView::Detail,
        json!({"score": 84, "symbol": "NVDA"}),
        CacheTtls {
            quote_fresh: Duration::from_secs(30),
            quote_stale: Duration::from_secs(300),
            score_fresh: Duration::from_millis(5),
            score_stale: Duration::from_secs(60),
        },
    );
    tokio::time::sleep(Duration::from_millis(15)).await;

    let response = service
        .score(Market::Us, "nvda", ScoreView::Detail, true)
        .await
        .expect("score force refresh fallback");

    assert_eq!(response.cache.state, CacheState::Stale);
    assert_eq!(response.cache.source, CacheSource::Cache);
    assert!(response.cache.refresh_started);
    assert_eq!(response.payload["score"], 84);
    assert_eq!(
        response.job.as_ref().map(|job| job.id.as_str()),
        Some("job-1")
    );
    assert_eq!(queue.len(), 1);
}

#[tokio::test]
async fn v1_quote_api_requires_internal_bearer_and_returns_cache_metadata() {
    let provider = FakeQuoteProvider::ok(json!({"last": 48_000.0, "currency": "KRW"}));
    let (service, _cache, _queue) = test_service(provider, CacheTtls::fast_for_tests());
    let app = router_with_service(test_config(), service);

    let unauthorized = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/v1/quote/kr/005930")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);

    let authorized = app
        .oneshot(
            Request::builder()
                .uri("/v1/quote/kr/005930")
                .header(header::AUTHORIZATION, "Bearer test-internal-token")
                .body(Body::empty())
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
    assert_eq!(payload["data"]["symbol"], "005930");
    assert_eq!(payload["server_cache"]["state"], "miss");
    assert_eq!(payload["server_cache"]["source"], "provider");
}
