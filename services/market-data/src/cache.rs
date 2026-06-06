use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use serde_json::Value;

use crate::market::{Market, ScoreView};

#[derive(Clone, Copy, Debug)]
pub struct CacheTtls {
    pub quote_fresh: Duration,
    pub quote_stale: Duration,
    pub score_fresh: Duration,
    pub score_stale: Duration,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CacheState {
    Fresh,
    Stale,
    Miss,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CacheSource {
    Cache,
    Provider,
    Queue,
}

#[derive(Clone, Debug, Serialize)]
pub struct CacheMetadata {
    pub state: CacheState,
    pub source: CacheSource,
    pub refresh_started: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fetched_at_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stale_expires_at_ms: Option<u64>,
}

#[derive(Clone, Debug)]
pub struct CacheRecord {
    pub payload: Value,
    pub fetched_at_ms: u64,
    pub expires_at_ms: u64,
    pub stale_expires_at_ms: u64,
}

#[derive(Clone, Debug)]
pub enum CacheLookup {
    Fresh(CacheRecord),
    Stale(CacheRecord),
    Miss,
}

#[derive(Default)]
pub struct MemoryMarketDataCache {
    quotes: Mutex<HashMap<QuoteKey, CacheRecord>>,
    scores: Mutex<HashMap<ScoreKey, CacheRecord>>,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct QuoteKey {
    market: Market,
    symbol: String,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct ScoreKey {
    market: Market,
    symbol: String,
    view: ScoreView,
}

impl Default for CacheTtls {
    fn default() -> Self {
        Self {
            quote_fresh: Duration::from_secs(30),
            quote_stale: Duration::from_secs(300),
            score_fresh: Duration::from_secs(300),
            score_stale: Duration::from_secs(1_800),
        }
    }
}

impl CacheTtls {
    pub fn fast_for_tests() -> Self {
        Self {
            quote_fresh: Duration::from_secs(30),
            quote_stale: Duration::from_secs(300),
            score_fresh: Duration::from_secs(30),
            score_stale: Duration::from_secs(300),
        }
    }
}

impl CacheMetadata {
    pub fn fresh(record: &CacheRecord) -> Self {
        Self::from_record(CacheState::Fresh, CacheSource::Cache, false, record)
    }

    pub fn fresh_refreshing(record: &CacheRecord) -> Self {
        Self::from_record(CacheState::Fresh, CacheSource::Cache, true, record)
    }

    pub fn stale(record: &CacheRecord, refresh_started: bool) -> Self {
        Self::from_record(
            CacheState::Stale,
            CacheSource::Cache,
            refresh_started,
            record,
        )
    }

    pub fn provider(record: &CacheRecord) -> Self {
        Self::from_record(CacheState::Miss, CacheSource::Provider, false, record)
    }

    pub fn queue(state: CacheState) -> Self {
        Self {
            state,
            source: CacheSource::Queue,
            refresh_started: true,
            fetched_at_ms: None,
            expires_at_ms: None,
            stale_expires_at_ms: None,
        }
    }

    fn from_record(
        state: CacheState,
        source: CacheSource,
        refresh_started: bool,
        record: &CacheRecord,
    ) -> Self {
        Self {
            state,
            source,
            refresh_started,
            fetched_at_ms: Some(record.fetched_at_ms),
            expires_at_ms: Some(record.expires_at_ms),
            stale_expires_at_ms: Some(record.stale_expires_at_ms),
        }
    }
}

impl MemoryMarketDataCache {
    pub fn quote(&self, market: Market, symbol: &str) -> CacheLookup {
        let key = QuoteKey::new(market, symbol);
        lookup(self.quotes.lock().expect("quote cache lock").get(&key))
    }

    pub fn upsert_quote(
        &self,
        market: Market,
        symbol: &str,
        payload: Value,
        ttl: CacheTtls,
    ) -> CacheRecord {
        let record = CacheRecord::new(payload, ttl.quote_fresh, ttl.quote_stale);
        self.quotes
            .lock()
            .expect("quote cache lock")
            .insert(QuoteKey::new(market, symbol), record.clone());
        record
    }

    pub fn score(&self, market: Market, symbol: &str, view: ScoreView) -> CacheLookup {
        let key = ScoreKey::new(market, symbol, view);
        lookup(self.scores.lock().expect("score cache lock").get(&key))
    }

    pub fn upsert_score(
        &self,
        market: Market,
        symbol: &str,
        view: ScoreView,
        payload: Value,
        ttl: CacheTtls,
    ) -> CacheRecord {
        let record = CacheRecord::new(payload, ttl.score_fresh, ttl.score_stale);
        self.scores
            .lock()
            .expect("score cache lock")
            .insert(ScoreKey::new(market, symbol, view), record.clone());
        record
    }
}

impl CacheRecord {
    fn new(payload: Value, fresh_for: Duration, stale_for: Duration) -> Self {
        let fetched_at_ms = now_ms();
        Self {
            payload,
            fetched_at_ms,
            expires_at_ms: fetched_at_ms + duration_ms(fresh_for),
            stale_expires_at_ms: fetched_at_ms + duration_ms(stale_for),
        }
    }
}

impl QuoteKey {
    fn new(market: Market, symbol: &str) -> Self {
        Self {
            market,
            symbol: symbol.to_string(),
        }
    }
}

impl ScoreKey {
    fn new(market: Market, symbol: &str, view: ScoreView) -> Self {
        Self {
            market,
            symbol: symbol.to_string(),
            view,
        }
    }
}

fn lookup(record: Option<&CacheRecord>) -> CacheLookup {
    let Some(record) = record else {
        return CacheLookup::Miss;
    };
    let now = now_ms();
    if record.expires_at_ms >= now {
        CacheLookup::Fresh(record.clone())
    } else if record.stale_expires_at_ms >= now {
        CacheLookup::Stale(record.clone())
    } else {
        CacheLookup::Miss
    }
}

fn now_ms() -> u64 {
    let elapsed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock before unix epoch");
    elapsed.as_millis().min(u128::from(u64::MAX)) as u64
}

pub(crate) fn now_ms_for_jobs() -> u64 {
    now_ms()
}

fn duration_ms(duration: Duration) -> u64 {
    duration.as_millis().min(u128::from(u64::MAX)) as u64
}
