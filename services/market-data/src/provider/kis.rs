use std::{
    collections::HashMap,
    future::Future,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use reqwest::header;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{
    config::AppConfig,
    market::Market,
    provider::models::{
        KisEnvelope, KisError, KisErrorKind, OverseasPriceDetail, RawOverseasPriceDetail,
        classify_http_error, classify_reqwest_error,
    },
    rate_limit::ProviderThrottle,
    service::{MarketDataError, MarketDataErrorKind, QuoteProvider, QuoteRequest},
};

#[derive(Clone, Debug)]
pub struct KisClientConfig {
    pub base_url: String,
    pub app_key: String,
    pub app_secret: String,
    pub request_timeout: Duration,
    pub min_request_interval: Duration,
}

#[derive(Clone)]
pub struct KisClient<C = MemoryTokenCache> {
    http: reqwest::Client,
    config: KisClientConfig,
    token_cache: C,
    throttle: ProviderThrottle,
}

#[derive(Clone, Debug)]
pub struct MemoryTokenCache {
    tokens: Arc<Mutex<HashMap<String, CachedToken>>>,
}

#[derive(Clone)]
pub struct KisQuoteProvider {
    client: Option<KisClient>,
    disabled_reason: Option<String>,
}

#[derive(Clone, Debug)]
struct CachedToken {
    value: String,
    expires_at: Instant,
}

#[derive(Serialize)]
struct TokenRequest<'a> {
    grant_type: &'a str,
    appkey: &'a str,
    appsecret: &'a str,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    access_token_token_expired: Option<String>,
}

impl Default for MemoryTokenCache {
    fn default() -> Self {
        Self {
            tokens: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl MemoryTokenCache {
    fn get(&self, key: &str) -> Option<String> {
        let tokens = self.tokens.lock().expect("token cache lock");
        let token = tokens.get(key)?;
        if token.expires_at > Instant::now() + Duration::from_secs(300) {
            Some(token.value.clone())
        } else {
            None
        }
    }

    fn set(&self, key: String, value: String, ttl: Duration) {
        self.tokens.lock().expect("token cache lock").insert(
            key,
            CachedToken {
                value,
                expires_at: Instant::now() + ttl,
            },
        );
    }
}

impl KisQuoteProvider {
    pub fn from_config(config: &AppConfig) -> Self {
        let Some(app_key) = config.stock_api_app_key.clone() else {
            return Self::disabled("KIS app key is not configured");
        };
        let Some(app_secret) = config.stock_api_app_secret.clone() else {
            return Self::disabled("KIS app secret is not configured");
        };

        let client = KisClient::new(
            KisClientConfig {
                base_url: config.stock_api_base.clone(),
                app_key,
                app_secret,
                request_timeout: Duration::from_secs(3),
                min_request_interval: Duration::from_millis(250),
            },
            MemoryTokenCache::default(),
        );

        match client {
            Ok(client) => Self {
                client: Some(client),
                disabled_reason: None,
            },
            Err(error) => Self::disabled(error.to_string()),
        }
    }

    fn disabled(reason: impl Into<String>) -> Self {
        Self {
            client: None,
            disabled_reason: Some(reason.into()),
        }
    }
}

impl QuoteProvider for KisQuoteProvider {
    fn fetch_quote(
        &self,
        request: QuoteRequest,
    ) -> impl Future<Output = Result<Value, MarketDataError>> + Send {
        let this = self.clone();
        async move {
            let client = this.client.as_ref().ok_or_else(|| {
                MarketDataError::new(
                    MarketDataErrorKind::ProviderUnavailable,
                    this.disabled_reason
                        .clone()
                        .unwrap_or_else(|| "KIS provider is not configured".to_string()),
                )
            })?;

            match request.market {
                Market::Us => fetch_overseas_quote(client, &request.symbol).await,
                Market::Kr => fetch_domestic_quote(client, &request.symbol).await,
            }
        }
    }
}

impl KisClient<MemoryTokenCache> {
    pub fn new(config: KisClientConfig, token_cache: MemoryTokenCache) -> Result<Self, KisError> {
        if config.base_url.trim().is_empty()
            || config.app_key.trim().is_empty()
            || config.app_secret.trim().is_empty()
        {
            return Err(KisError::new(
                KisErrorKind::AuthFailed,
                "KIS app key, secret, and base URL are required",
            ));
        }

        let http = reqwest::Client::builder()
            .timeout(config.request_timeout)
            .build()
            .map_err(|error| KisError::new(KisErrorKind::ProviderUnavailable, error.to_string()))?;

        Ok(Self {
            throttle: ProviderThrottle::new(config.min_request_interval),
            http,
            config: KisClientConfig {
                base_url: config.base_url.trim_end_matches('/').to_string(),
                ..config
            },
            token_cache,
        })
    }

    pub async fn overseas_price_detail(
        &self,
        excd: &str,
        symbol: &str,
    ) -> Result<OverseasPriceDetail, KisError> {
        validate_overseas_symbol(symbol)?;
        self.get_output::<RawOverseasPriceDetail>(
            "/uapi/overseas-price/v1/quotations/price-detail",
            "HHDFS76200200",
            &[("excd", excd), ("symb", symbol)],
        )
        .await
        .map(OverseasPriceDetail::from)
    }

    pub async fn overseas_price(
        &self,
        excd: &str,
        symbol: &str,
    ) -> Result<serde_json::Value, KisError> {
        validate_overseas_symbol(symbol)?;
        self.get_output(
            "/uapi/overseas-price/v1/quotations/price",
            "HHDFS00000300",
            &[("excd", excd), ("symb", symbol)],
        )
        .await
    }

    pub async fn overseas_search_info(
        &self,
        product_type: &str,
        symbol: &str,
    ) -> Result<serde_json::Value, KisError> {
        validate_overseas_symbol(symbol)?;
        self.get_output(
            "/uapi/overseas-price/v1/quotations/search-info",
            "CTPF1702R",
            &[("PDNO", symbol), ("PRDT_TYPE_CD", product_type)],
        )
        .await
    }

    pub async fn overseas_daily_rows(
        &self,
        excd: &str,
        symbol: &str,
    ) -> Result<serde_json::Value, KisError> {
        validate_overseas_symbol(symbol)?;
        self.get_output(
            "/uapi/overseas-price/v1/quotations/dailyprice",
            "HHDFS76240000",
            &[
                ("excd", excd),
                ("symb", symbol),
                ("gubn", "0"),
                ("bymd", ""),
                ("modp", "1"),
            ],
        )
        .await
    }

    pub async fn overseas_news(
        &self,
        excd: &str,
        symbol: &str,
    ) -> Result<serde_json::Value, KisError> {
        validate_overseas_symbol(symbol)?;
        self.get_output(
            "/uapi/overseas-price/v1/quotations/news-title",
            "HHPSTH60100C1",
            &[("EXCD", excd), ("SYMB", symbol)],
        )
        .await
    }

    pub async fn domestic_price(
        &self,
        symbol: &str,
        market_div_code: &str,
    ) -> Result<serde_json::Value, KisError> {
        validate_domestic_symbol(symbol)?;
        self.get_output(
            "/uapi/domestic-stock/v1/quotations/inquire-price",
            "FHKST01010100",
            &[
                ("FID_COND_MRKT_DIV_CODE", market_div_code),
                ("FID_INPUT_ISCD", symbol),
            ],
        )
        .await
    }

    pub async fn domestic_daily_rows(&self, symbol: &str) -> Result<serde_json::Value, KisError> {
        validate_domestic_symbol(symbol)?;
        self.get_output(
            "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice",
            "FHKST03010100",
            &[
                ("FID_COND_MRKT_DIV_CODE", "J"),
                ("FID_INPUT_ISCD", symbol),
                ("FID_INPUT_DATE_1", ""),
                ("FID_INPUT_DATE_2", ""),
                ("FID_PERIOD_DIV_CODE", "D"),
                ("FID_ORG_ADJ_PRC", "1"),
            ],
        )
        .await
    }

    pub async fn domestic_search_info(&self, symbol: &str) -> Result<serde_json::Value, KisError> {
        validate_domestic_symbol(symbol)?;
        self.get_output(
            "/uapi/domestic-stock/v1/quotations/search-info",
            "CTPF1604R",
            &[("PDNO", symbol), ("PRDT_TYPE_CD", "300")],
        )
        .await
    }

    pub async fn domestic_stock_info(&self, symbol: &str) -> Result<serde_json::Value, KisError> {
        validate_domestic_symbol(symbol)?;
        self.get_output(
            "/uapi/domestic-stock/v1/quotations/search-stock-info",
            "CTPF1002R",
            &[("PDNO", symbol), ("PRDT_TYPE_CD", "300")],
        )
        .await
    }

    pub async fn domestic_news(&self, symbol: &str) -> Result<serde_json::Value, KisError> {
        validate_domestic_symbol(symbol)?;
        self.get_output(
            "/uapi/domestic-stock/v1/quotations/news-title",
            "FHKST01011800",
            &[("FID_INPUT_ISCD", symbol)],
        )
        .await
    }

    async fn access_token(&self) -> Result<String, KisError> {
        let cache_key = self.token_cache_key();
        if let Some(token) = self.token_cache.get(&cache_key) {
            return Ok(token);
        }

        let url = format!("{}/oauth2/tokenP", self.config.base_url);
        let response = self
            .http
            .post(url)
            .json(&TokenRequest {
                grant_type: "client_credentials",
                appkey: &self.config.app_key,
                appsecret: &self.config.app_secret,
            })
            .send()
            .await
            .map_err(|error| {
                KisError::new(classify_reqwest_error(&error), "KIS token request failed")
            })?;

        if !response.status().is_success() {
            return Err(KisError::new(
                classify_http_error(response.status()),
                "KIS token request was rejected",
            ));
        }

        let payload = response.json::<TokenResponse>().await.map_err(|_| {
            KisError::new(
                KisErrorKind::InvalidProviderResponse,
                "KIS token response was invalid",
            )
        })?;
        let token = payload
            .access_token
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                KisError::new(
                    KisErrorKind::AuthFailed,
                    "KIS token response missing access_token",
                )
            })?;
        let ttl = token_ttl(payload.access_token_token_expired.as_deref());
        self.token_cache.set(cache_key, token.clone(), ttl);
        Ok(token)
    }

    fn token_cache_key(&self) -> String {
        format!("{}:{}", self.config.base_url, self.config.app_key)
    }

    async fn get_output<T>(
        &self,
        path: &str,
        tr_id: &str,
        query: &[(&str, &str)],
    ) -> Result<T, KisError>
    where
        T: for<'de> Deserialize<'de>,
    {
        let token = self.access_token().await?;
        self.throttle.wait().await;

        let url = format!("{}{}", self.config.base_url, path);
        let response = self
            .http
            .get(url)
            .header(header::AUTHORIZATION, format!("Bearer {token}"))
            .header("appkey", &self.config.app_key)
            .header("appsecret", &self.config.app_secret)
            .header("tr_id", tr_id)
            .query(query)
            .send()
            .await
            .map_err(|error| {
                KisError::new(
                    classify_reqwest_error(&error),
                    "KIS provider request failed",
                )
            })?;

        parse_kis_response::<T>(response).await
    }
}

async fn parse_kis_response<T>(response: reqwest::Response) -> Result<T, KisError>
where
    T: for<'de> Deserialize<'de>,
{
    if !response.status().is_success() {
        return Err(KisError::new(
            classify_http_error(response.status()),
            "KIS provider request was rejected",
        ));
    }

    response
        .json::<KisEnvelope<T>>()
        .await
        .map_err(|_| {
            KisError::new(
                KisErrorKind::InvalidProviderResponse,
                "KIS response was invalid",
            )
        })?
        .into_output()
}

fn validate_overseas_symbol(symbol: &str) -> Result<(), KisError> {
    let valid = !symbol.is_empty()
        && symbol.len() <= 16
        && symbol.bytes().all(|byte| {
            byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'.' || byte == b'-'
        });
    if valid {
        Ok(())
    } else {
        Err(KisError::new(
            KisErrorKind::InvalidTicker,
            "invalid overseas ticker",
        ))
    }
}

fn validate_domestic_symbol(symbol: &str) -> Result<(), KisError> {
    let valid = symbol.len() == 6 && symbol.bytes().all(|byte| byte.is_ascii_digit());
    if valid {
        Ok(())
    } else {
        Err(KisError::new(
            KisErrorKind::InvalidTicker,
            "invalid domestic ticker",
        ))
    }
}

fn token_ttl(_provider_expiry: Option<&str>) -> Duration {
    Duration::from_secs(23 * 60 * 60)
}

async fn fetch_overseas_quote(client: &KisClient, symbol: &str) -> Result<Value, MarketDataError> {
    let quote = client
        .overseas_price_detail("NAS", symbol)
        .await
        .map_err(map_kis_error)?;
    Ok(json!({
        "market": Market::Us.as_str(),
        "symbol": symbol,
        "exchange": "NAS",
        "last": quote.last,
        "currency": quote.currency,
        "previous_close": quote.previous_close,
        "volume": quote.volume
    }))
}

async fn fetch_domestic_quote(client: &KisClient, symbol: &str) -> Result<Value, MarketDataError> {
    let raw = client
        .domestic_price(symbol, "J")
        .await
        .map_err(map_kis_error)?;
    Ok(json!({
        "market": Market::Kr.as_str(),
        "symbol": symbol,
        "exchange": "KRX",
        "last": parse_number_field(&raw, "stck_prpr"),
        "currency": "KRW",
        "previous_close": parse_number_field(&raw, "stck_sdpr"),
        "volume": parse_number_field(&raw, "acml_vol"),
        "raw": raw
    }))
}

fn map_kis_error(error: KisError) -> MarketDataError {
    let kind = match error.kind() {
        KisErrorKind::InvalidTicker => MarketDataErrorKind::InvalidRequest,
        KisErrorKind::RateLimited => MarketDataErrorKind::RateLimited,
        KisErrorKind::AuthFailed => MarketDataErrorKind::AuthFailed,
        KisErrorKind::ProviderUnavailable => MarketDataErrorKind::ProviderUnavailable,
        KisErrorKind::InvalidProviderResponse => MarketDataErrorKind::InvalidProviderResponse,
    };
    MarketDataError::new(kind, error.to_string())
}

fn parse_number_field(payload: &Value, key: &str) -> Option<f64> {
    payload
        .get(key)
        .and_then(Value::as_str)
        .and_then(|value| value.replace(',', "").parse::<f64>().ok())
        .filter(|value| value.is_finite())
}
