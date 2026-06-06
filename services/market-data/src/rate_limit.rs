use std::{
    sync::Arc,
    time::{Duration, Instant},
};

use tokio::sync::Mutex;

#[derive(Clone, Debug)]
pub struct ProviderThrottle {
    min_interval: Duration,
    last_request_at: Arc<Mutex<Option<Instant>>>,
}

impl ProviderThrottle {
    pub fn new(min_interval: Duration) -> Self {
        Self {
            min_interval,
            last_request_at: Arc::new(Mutex::new(None)),
        }
    }

    pub async fn wait(&self) {
        if self.min_interval.is_zero() {
            return;
        }

        let mut last = self.last_request_at.lock().await;
        let sleep_for = last.and_then(|instant| self.min_interval.checked_sub(instant.elapsed()));

        if let Some(duration) = sleep_for {
            tokio::time::sleep(duration).await;
        }

        *last = Some(Instant::now());
    }
}

impl Default for ProviderThrottle {
    fn default() -> Self {
        Self::new(Duration::from_millis(1_050))
    }
}

#[cfg(test)]
mod tests {
    use super::ProviderThrottle;
    use std::time::{Duration, Instant};

    #[tokio::test]
    async fn concurrent_waits_are_serialized_by_min_interval() {
        let throttle = ProviderThrottle::new(Duration::from_millis(30));
        throttle.wait().await;

        let started_at = Instant::now();
        let first = throttle.wait();
        let second = throttle.wait();
        tokio::join!(first, second);

        assert!(
            started_at.elapsed() >= Duration::from_millis(55),
            "concurrent waits should serialize provider pacing, elapsed {:?}",
            started_at.elapsed()
        );
    }
}
