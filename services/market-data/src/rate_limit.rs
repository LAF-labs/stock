use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

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

        let sleep_for = {
            let last = self.last_request_at.lock().expect("provider throttle lock");
            last.and_then(|instant| self.min_interval.checked_sub(instant.elapsed()))
        };

        if let Some(duration) = sleep_for {
            tokio::time::sleep(duration).await;
        }

        *self.last_request_at.lock().expect("provider throttle lock") = Some(Instant::now());
    }
}

impl Default for ProviderThrottle {
    fn default() -> Self {
        Self::new(Duration::from_millis(1_050))
    }
}
