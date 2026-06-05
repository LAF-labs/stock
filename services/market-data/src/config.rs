use std::{env, error::Error, fmt, net::SocketAddr};

#[derive(Clone)]
pub struct AppConfig {
    pub bind_addr: SocketAddr,
    pub internal_token: String,
    pub supabase_url: Option<String>,
    pub supabase_service_role_key: Option<String>,
    pub stock_api_base: String,
    pub stock_api_app_key: Option<String>,
    pub stock_api_app_secret: Option<String>,
    pub redis_url: Option<String>,
}

#[derive(Debug)]
pub enum ConfigError {
    InvalidBindAddr(String),
    MissingInternalToken,
}

impl fmt::Display for ConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidBindAddr(value) => {
                write!(formatter, "invalid MARKET_DATA_BIND_ADDR: {value}")
            }
            Self::MissingInternalToken => {
                write!(formatter, "MARKET_DATA_INTERNAL_TOKEN is required")
            }
        }
    }
}

impl Error for ConfigError {}

impl AppConfig {
    pub fn from_env() -> Result<Self, ConfigError> {
        let bind_addr = env_value("MARKET_DATA_BIND_ADDR")
            .unwrap_or_else(|| "0.0.0.0:8080".to_string())
            .parse()
            .map_err(|_| {
                ConfigError::InvalidBindAddr(env_value("MARKET_DATA_BIND_ADDR").unwrap_or_default())
            })?;
        let internal_token =
            env_value("MARKET_DATA_INTERNAL_TOKEN").ok_or(ConfigError::MissingInternalToken)?;

        Ok(Self {
            bind_addr,
            internal_token,
            supabase_url: env_value("SUPABASE_URL")
                .map(|value| value.trim_end_matches('/').to_string()),
            supabase_service_role_key: env_value("SUPABASE_SERVICE_ROLE_KEY"),
            stock_api_base: env_value("STOCK_API_BASE")
                .unwrap_or_else(|| "https://openapi.koreainvestment.com:9443".to_string())
                .trim_end_matches('/')
                .to_string(),
            stock_api_app_key: env_value("STOCK_API_APP_KEY").or_else(|| env_value("KIS_APP_KEY")),
            stock_api_app_secret: env_value("STOCK_API_APP_SECRET")
                .or_else(|| env_value("KIS_APP_SECRET")),
            redis_url: env_value("REDIS_URL"),
        })
    }
}

fn env_value(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}
