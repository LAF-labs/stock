use std::{
    collections::HashMap,
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

use serde::Serialize;

use crate::{
    cache::now_ms_for_jobs,
    market::{Market, ScoreView},
};

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RefreshKind {
    Quote,
    Score,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RefreshJobStatus {
    Queued,
}

#[derive(Clone, Debug, Serialize)]
pub struct RefreshJob {
    pub id: String,
    pub kind: RefreshKind,
    pub market: Market,
    pub symbol: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub view: Option<ScoreView>,
    pub status: RefreshJobStatus,
    pub queued_at_ms: u64,
}

pub struct MemoryRefreshQueue {
    sequence: AtomicU64,
    jobs: Mutex<HashMap<RefreshKey, RefreshJob>>,
    capacity: usize,
}

#[derive(Clone, Copy, Debug, Serialize)]
pub struct RefreshQueueStats {
    pub depth: usize,
    pub capacity: usize,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct RefreshKey {
    kind: RefreshKind,
    market: Market,
    symbol: String,
    view: Option<ScoreView>,
}

impl Default for MemoryRefreshQueue {
    fn default() -> Self {
        Self {
            sequence: AtomicU64::new(0),
            jobs: Mutex::new(HashMap::new()),
            capacity: 4_096,
        }
    }
}

impl MemoryRefreshQueue {
    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            sequence: AtomicU64::new(0),
            jobs: Mutex::new(HashMap::new()),
            capacity,
        }
    }

    pub fn enqueue_quote(&self, market: Market, symbol: &str) -> RefreshJob {
        self.enqueue(RefreshKind::Quote, market, symbol, None)
    }

    pub fn enqueue_score(&self, market: Market, symbol: &str, view: ScoreView) -> RefreshJob {
        self.enqueue(RefreshKind::Score, market, symbol, Some(view))
    }

    pub fn len(&self) -> usize {
        self.jobs.lock().expect("refresh queue lock").len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn stats(&self) -> RefreshQueueStats {
        RefreshQueueStats {
            depth: self.len(),
            capacity: self.capacity,
        }
    }

    fn enqueue(
        &self,
        kind: RefreshKind,
        market: Market,
        symbol: &str,
        view: Option<ScoreView>,
    ) -> RefreshJob {
        let key = RefreshKey {
            kind,
            market,
            symbol: symbol.to_string(),
            view,
        };
        let mut jobs = self.jobs.lock().expect("refresh queue lock");
        if let Some(existing) = jobs.get(&key) {
            return existing.clone();
        }

        let id = format!("job-{}", self.sequence.fetch_add(1, Ordering::SeqCst) + 1);
        let job = RefreshJob {
            id,
            kind,
            market,
            symbol: symbol.to_string(),
            view,
            status: RefreshJobStatus::Queued,
            queued_at_ms: now_ms_for_jobs(),
        };
        if self.capacity > 0 {
            if jobs.len() >= self.capacity
                && let Some(oldest_key) = jobs
                    .iter()
                    .min_by_key(|(_, value)| value.queued_at_ms)
                    .map(|(key, _)| key.clone())
            {
                jobs.remove(&oldest_key);
            }
            jobs.insert(key, job.clone());
        }
        job
    }
}
