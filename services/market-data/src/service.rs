use std::{
    collections::HashMap,
    error::Error,
    fmt,
    future::Future,
    sync::{Arc, Mutex},
};

use serde::Serialize;
use serde_json::{Value, json};
use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard};

use crate::{
    cache::{CacheLookup, CacheMetadata, CacheState, CacheTtls, MemoryMarketDataCache},
    jobs::{MemoryRefreshQueue, RefreshJob},
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
        let fetched = match self.provider.fetch_quote(request).await {
            Ok(payload) => payload,
            Err(error) => {
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
                let cache = CacheMetadata::fresh(&record);
                Some(QuoteServiceResponse {
                    payload: record.payload,
                    cache,
                    job: None,
                })
            }
            CacheLookup::Stale(record) => {
                let job = self.queue.enqueue_quote(market, symbol);
                let cache = CacheMetadata::stale(&record, true);
                Some(QuoteServiceResponse {
                    payload: record.payload,
                    cache,
                    job: Some(job),
                })
            }
            CacheLookup::Miss => None,
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
                let job = self.queue.enqueue_score(market, symbol, view);
                let cache = CacheMetadata::stale(&record, true);
                Some(ScoreServiceResponse {
                    payload: record.payload,
                    cache,
                    job: Some(job),
                })
            }
            CacheLookup::Miss => None,
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
