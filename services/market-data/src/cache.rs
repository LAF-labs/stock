use std::{
    collections::HashMap,
    hash::Hash,
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

pub struct MemoryMarketDataCache {
    quotes: Mutex<HashMap<QuoteKey, CacheRecord>>,
    scores: Mutex<HashMap<ScoreKey, CacheRecord>>,
    quote_capacity: usize,
    score_capacity: usize,
}

#[derive(Clone, Copy, Debug, Serialize)]
pub struct MemoryCacheStats {
    pub quote_entries: usize,
    pub score_entries: usize,
    pub quote_capacity: usize,
    pub score_capacity: usize,
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

impl Default for MemoryMarketDataCache {
    fn default() -> Self {
        Self::with_limits(4_096, 4_096)
    }
}

impl MemoryMarketDataCache {
    pub fn with_limits(quote_capacity: usize, score_capacity: usize) -> Self {
        Self {
            quotes: Mutex::new(HashMap::new()),
            scores: Mutex::new(HashMap::new()),
            quote_capacity,
            score_capacity,
        }
    }

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
        let mut quotes = self.quotes.lock().expect("quote cache lock");
        insert_bounded(
            &mut quotes,
            QuoteKey::new(market, symbol),
            record.clone(),
            self.quote_capacity,
        );
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
        let mut scores = self.scores.lock().expect("score cache lock");
        insert_bounded(
            &mut scores,
            ScoreKey::new(market, symbol, view),
            record.clone(),
            self.score_capacity,
        );
        record
    }

    pub fn stats(&self) -> MemoryCacheStats {
        MemoryCacheStats {
            quote_entries: self.quotes.lock().expect("quote cache lock").len(),
            score_entries: self.scores.lock().expect("score cache lock").len(),
            quote_capacity: self.quote_capacity,
            score_capacity: self.score_capacity,
        }
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

fn insert_bounded<K>(
    records: &mut HashMap<K, CacheRecord>,
    key: K,
    record: CacheRecord,
    capacity: usize,
) where
    K: Eq + Hash + Clone,
{
    let now = now_ms();
    records.retain(|_, value| value.stale_expires_at_ms >= now);
    if capacity == 0 {
        return;
    }
    if !records.contains_key(&key) && records.len() >= capacity {
        if let Some(oldest_key) = records
            .iter()
            .min_by_key(|(_, value)| value.fetched_at_ms)
            .map(|(key, _)| key.clone())
        {
            records.remove(&oldest_key);
        }
    }
    records.insert(key, record);
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
