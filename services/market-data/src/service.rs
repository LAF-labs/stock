use std::{
    collections::HashMap,
    error::Error,
    fmt,
    future::Future,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

use serde::Serialize;
use serde_json::{Value, json};
use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard};

use crate::{
    cache::{
        CacheLookup, CacheMetadata, CacheState, CacheTtls, MemoryCacheStats, MemoryMarketDataCache,
    },
    jobs::{MemoryRefreshQueue, RefreshJob, RefreshQueueStats},
    market::{Market, ScoreView},
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MarketDataErrorKind {
    InvalidRequest,
    RateLimited,
    AuthFailed,
    ProviderUnavailable,
    InvalidProviderResponse,
}

#[derive(Debug)]
pub struct MarketDataError {
    kind: MarketDataErrorKind,
    message: String,
}

#[derive(Clone, Debug)]
pub struct QuoteRequest {
    pub market: Market,
    pub symbol: String,
}

pub trait QuoteProvider: Clone + Send + Sync + 'static {
    fn fetch_quote(
        &self,
        request: QuoteRequest,
    ) -> impl Future<Output = Result<Value, MarketDataError>> + Send;
}

#[derive(Clone)]
pub struct MarketDataService<P> {
    cache: Arc<MemoryMarketDataCache>,
    queue: Arc<MemoryRefreshQueue>,
    provider: P,
    ttl: CacheTtls,
    inflight: QuoteInflight,
    metrics: Arc<ServiceMetrics>,
}

#[derive(Default)]
struct ServiceMetrics {
    quote_cache_fresh: AtomicU64,
    quote_cache_stale: AtomicU64,
    quote_cache_miss: AtomicU64,
    score_cache_fresh: AtomicU64,
    score_cache_stale: AtomicU64,
    score_cache_miss: AtomicU64,
    provider_requests: AtomicU64,
    provider_rate_limited_errors: AtomicU64,
    provider_auth_failed_errors: AtomicU64,
    provider_unavailable_errors: AtomicU64,
    provider_invalid_response_errors: AtomicU64,
}

#[derive(Clone, Copy, Debug)]
pub struct ServiceMetricsSnapshot {
    pub quote_cache_fresh: u64,
    pub quote_cache_stale: u64,
    pub quote_cache_miss: u64,
    pub score_cache_fresh: u64,
    pub score_cache_stale: u64,
    pub score_cache_miss: u64,
    pub provider_requests: u64,
    pub provider_rate_limited_errors: u64,
    pub provider_auth_failed_errors: u64,
    pub provider_unavailable_errors: u64,
    pub provider_invalid_response_errors: u64,
}

#[derive(Clone, Debug, Serialize)]
pub struct QuoteServiceResponse {
    pub payload: Value,
    pub cache: CacheMetadata,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub job: Option<RefreshJob>,
}

#[derive(Clone, Debug, Serialize)]
pub struct ScoreServiceResponse {
    pub payload: Value,
    pub cache: CacheMetadata,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub job: Option<RefreshJob>,
}

#[derive(Clone, Default)]
struct QuoteInflight {
    locks: Arc<Mutex<HashMap<String, Arc<AsyncMutex<()>>>>>,
}

struct QuoteInflightGuard {
    key: String,
    lock: Arc<AsyncMutex<()>>,
    locks: Arc<Mutex<HashMap<String, Arc<AsyncMutex<()>>>>>,
    _guard: OwnedMutexGuard<()>,
}

impl MarketDataError {
    pub fn new(kind: MarketDataErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    pub fn kind(&self) -> MarketDataErrorKind {
        self.kind
    }

    pub fn public_message(&self) -> &'static str {
        match self.kind {
            MarketDataErrorKind::InvalidRequest => "invalid request",
            MarketDataErrorKind::RateLimited => "provider rate limited",
            MarketDataErrorKind::AuthFailed => "provider authentication failed",
            MarketDataErrorKind::ProviderUnavailable => "provider unavailable",
            MarketDataErrorKind::InvalidProviderResponse => "provider response invalid",
        }
    }
}

impl fmt::Display for MarketDataError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}", self.message)
    }
}

impl Error for MarketDataError {}

impl<P> MarketDataService<P>
where
    P: QuoteProvider,
{
    pub fn new(
        cache: Arc<MemoryMarketDataCache>,
        queue: Arc<MemoryRefreshQueue>,
        provider: P,
        ttl: CacheTtls,
    ) -> Self {
        Self {
            cache,
            queue,
            provider,
            ttl,
            inflight: QuoteInflight::default(),
            metrics: Arc::new(ServiceMetrics::default()),
        }
    }

    pub async fn quote(
        &self,
        market: Market,
        symbol: &str,
        force_refresh: bool,
    ) -> Result<QuoteServiceResponse, MarketDataError> {
        let symbol = normalize_symbol(market, symbol)?;
        if !force_refresh && let Some(response) = self.cached_quote_response(market, &symbol) {
            return Ok(response);
        }

        let _guard = self.inflight.lock(quote_key(market, &symbol)).await;
        if !force_refresh && let Some(response) = self.cached_quote_response(market, &symbol) {
            return Ok(response);
        }

        let request = QuoteRequest {
            market,
            symbol: symbol.clone(),
        };
        self.metrics
            .provider_requests
            .fetch_add(1, Ordering::Relaxed);
        let fetched = match self.provider.fetch_quote(request).await {
            Ok(payload) => payload,
            Err(error) => {
                self.metrics.record_provider_error(error.kind());
                if let Some(response) = self.cached_quote_response(market, &symbol) {
                    return Ok(response);
                }
                return Err(error);
            }
        };
        let record = self.cache.upsert_quote(market, &symbol, fetched, self.ttl);
        let cache = CacheMetadata::provider(&record);

        Ok(QuoteServiceResponse {
            payload: record.payload,
            cache,
            job: None,
        })
    }

    fn cached_quote_response(&self, market: Market, symbol: &str) -> Option<QuoteServiceResponse> {
        match self.cache.quote(market, symbol) {
            CacheLookup::Fresh(record) => {
                self.metrics
                    .quote_cache_fresh
                    .fetch_add(1, Ordering::Relaxed);
                let cache = CacheMetadata::fresh(&record);
                Some(QuoteServiceResponse {
                    payload: record.payload,
                    cache,
                    job: None,
                })
            }
            CacheLookup::Stale(record) => {
                self.metrics
                    .quote_cache_stale
                    .fetch_add(1, Ordering::Relaxed);
                let job = self.queue.enqueue_quote(market, symbol);
                let cache = CacheMetadata::stale(&record, true);
                Some(QuoteServiceResponse {
                    payload: record.payload,
                    cache,
                    job: Some(job),
                })
            }
            CacheLookup::Miss => {
                self.metrics
                    .quote_cache_miss
                    .fetch_add(1, Ordering::Relaxed);
                None
            }
        }
    }

    pub async fn score(
        &self,
        market: Market,
        symbol: &str,
        view: ScoreView,
        force_refresh: bool,
    ) -> Result<ScoreServiceResponse, MarketDataError> {
        let symbol = normalize_symbol(market, symbol)?;
        if let Some(response) = self.cached_score_response(market, &symbol, view, force_refresh) {
            return Ok(response);
        }

        let job = self.queue.enqueue_score(market, &symbol, view);
        Ok(ScoreServiceResponse {
            payload: json!({
                "status": "queued",
                "market": market.as_str(),
                "symbol": symbol,
                "view": view.as_str()
            }),
            cache: CacheMetadata::queue(CacheState::Miss),
            job: Some(job),
        })
    }

    fn cached_score_response(
        &self,
        market: Market,
        symbol: &str,
        view: ScoreView,
        force_refresh: bool,
    ) -> Option<ScoreServiceResponse> {
        match self.cache.score(market, symbol, view) {
            CacheLookup::Fresh(record) => {
                self.metrics
                    .score_cache_fresh
                    .fetch_add(1, Ordering::Relaxed);
                let job = force_refresh.then(|| self.queue.enqueue_score(market, symbol, view));
                let cache = if force_refresh {
                    CacheMetadata::fresh_refreshing(&record)
                } else {
                    CacheMetadata::fresh(&record)
                };
                Some(ScoreServiceResponse {
                    payload: record.payload,
                    cache,
                    job,
                })
            }
            CacheLookup::Stale(record) => {
                self.metrics
                    .score_cache_stale
                    .fetch_add(1, Ordering::Relaxed);
                let job = self.queue.enqueue_score(market, symbol, view);
                let cache = CacheMetadata::stale(&record, true);
                Some(ScoreServiceResponse {
                    payload: record.payload,
                    cache,
                    job: Some(job),
                })
            }
            CacheLookup::Miss => {
                self.metrics
                    .score_cache_miss
                    .fetch_add(1, Ordering::Relaxed);
                None
            }
        }
    }

    pub fn enqueue_quote_refresh(
        &self,
        market: Market,
        symbol: &str,
    ) -> Result<RefreshJob, MarketDataError> {
        let symbol = normalize_symbol(market, symbol)?;
        Ok(self.queue.enqueue_quote(market, &symbol))
    }

    pub fn enqueue_score_refresh(
        &self,
        market: Market,
        symbol: &str,
        view: ScoreView,
    ) -> Result<RefreshJob, MarketDataError> {
        let symbol = normalize_symbol(market, symbol)?;
        Ok(self.queue.enqueue_score(market, &symbol, view))
    }

    pub fn cache_stats(&self) -> MemoryCacheStats {
        self.cache.stats()
    }

    pub fn queue_stats(&self) -> RefreshQueueStats {
        self.queue.stats()
    }

    pub fn metrics_snapshot(&self) -> ServiceMetricsSnapshot {
        self.metrics.snapshot()
    }
}

impl ServiceMetrics {
    fn record_provider_error(&self, kind: MarketDataErrorKind) {
        match kind {
            MarketDataErrorKind::InvalidRequest => {}
            MarketDataErrorKind::RateLimited => {
                self.provider_rate_limited_errors
                    .fetch_add(1, Ordering::Relaxed);
            }
            MarketDataErrorKind::AuthFailed => {
                self.provider_auth_failed_errors
                    .fetch_add(1, Ordering::Relaxed);
            }
            MarketDataErrorKind::ProviderUnavailable => {
                self.provider_unavailable_errors
                    .fetch_add(1, Ordering::Relaxed);
            }
            MarketDataErrorKind::InvalidProviderResponse => {
                self.provider_invalid_response_errors
                    .fetch_add(1, Ordering::Relaxed);
            }
        }
    }

    fn snapshot(&self) -> ServiceMetricsSnapshot {
        ServiceMetricsSnapshot {
            quote_cache_fresh: self.quote_cache_fresh.load(Ordering::Relaxed),
            quote_cache_stale: self.quote_cache_stale.load(Ordering::Relaxed),
            quote_cache_miss: self.quote_cache_miss.load(Ordering::Relaxed),
            score_cache_fresh: self.score_cache_fresh.load(Ordering::Relaxed),
            score_cache_stale: self.score_cache_stale.load(Ordering::Relaxed),
            score_cache_miss: self.score_cache_miss.load(Ordering::Relaxed),
            provider_requests: self.provider_requests.load(Ordering::Relaxed),
            provider_rate_limited_errors: self.provider_rate_limited_errors.load(Ordering::Relaxed),
            provider_auth_failed_errors: self.provider_auth_failed_errors.load(Ordering::Relaxed),
            provider_unavailable_errors: self.provider_unavailable_errors.load(Ordering::Relaxed),
            provider_invalid_response_errors: self
                .provider_invalid_response_errors
                .load(Ordering::Relaxed),
        }
    }
}

impl QuoteInflight {
    async fn lock(&self, key: String) -> QuoteInflightGuard {
        let lock = {
            let mut locks = self.locks.lock().expect("quote inflight lock");
            locks
                .entry(key.clone())
                .or_insert_with(|| Arc::new(AsyncMutex::new(())))
                .clone()
        };
        let guard = lock.clone().lock_owned().await;
        QuoteInflightGuard {
            key,
            lock,
            locks: self.locks.clone(),
            _guard: guard,
        }
    }
}

impl Drop for QuoteInflightGuard {
    fn drop(&mut self) {
        if Arc::strong_count(&self.lock) > 3 {
            return;
        }
        let mut locks = self.locks.lock().expect("quote inflight lock");
        if locks
            .get(&self.key)
            .is_some_and(|current| Arc::ptr_eq(current, &self.lock))
        {
            locks.remove(&self.key);
        }
    }
}

fn normalize_symbol(market: Market, symbol: &str) -> Result<String, MarketDataError> {
    market.normalize_symbol(symbol).map_err(|error| {
        MarketDataError::new(MarketDataErrorKind::InvalidRequest, error.to_string())
    })
}

fn quote_key(market: Market, symbol: &str) -> String {
    format!("{}:{symbol}", market.as_str())
}
