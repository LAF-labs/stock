use std::{error::Error, fmt};

use serde::Deserialize;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum KisErrorKind {
    InvalidTicker,
    RateLimited,
    AuthFailed,
    ProviderUnavailable,
    InvalidProviderResponse,
}

#[derive(Debug)]
pub struct KisError {
    kind: KisErrorKind,
    message: String,
}

impl KisError {
    pub fn new(kind: KisErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    pub fn kind(&self) -> KisErrorKind {
        self.kind
    }
}

impl fmt::Display for KisError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}", self.message)
    }
}

impl Error for KisError {}

#[derive(Debug, Deserialize)]
pub struct KisEnvelope<T> {
    pub rt_cd: Option<String>,
    pub msg_cd: Option<String>,
    pub msg1: Option<String>,
    pub output: Option<T>,
}

impl<T> KisEnvelope<T> {
    pub fn into_output(self) -> Result<T, KisError> {
        if self.rt_cd.as_deref() == Some("0") {
            return self.output.ok_or_else(|| {
                KisError::new(
                    KisErrorKind::InvalidProviderResponse,
                    "KIS response missing output",
                )
            });
        }

        let message = self
            .msg1
            .unwrap_or_else(|| "KIS provider returned an error".to_string());
        let kind = classify_kis_error(self.msg_cd.as_deref(), &message);
        Err(KisError::new(kind, message))
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct OverseasPriceDetail {
    pub last: Option<f64>,
    pub currency: Option<String>,
    pub previous_close: Option<f64>,
    pub volume: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub struct RawOverseasPriceDetail {
    pub last: Option<String>,
    pub curr: Option<String>,
    pub base: Option<String>,
    pub tvol: Option<String>,
}

impl From<RawOverseasPriceDetail> for OverseasPriceDetail {
    fn from(value: RawOverseasPriceDetail) -> Self {
        Self {
            last: parse_f64(value.last.as_deref()),
            currency: value.curr,
            previous_close: parse_f64(value.base.as_deref()),
            volume: parse_u64(value.tvol.as_deref()),
        }
    }
}

pub fn classify_http_error(status: reqwest::StatusCode) -> KisErrorKind {
    match status.as_u16() {
        401 | 403 => KisErrorKind::AuthFailed,
        429 => KisErrorKind::RateLimited,
        _ => KisErrorKind::ProviderUnavailable,
    }
}

pub fn classify_reqwest_error(error: &reqwest::Error) -> KisErrorKind {
    if error.is_timeout() || error.is_connect() || error.is_request() {
        KisErrorKind::ProviderUnavailable
    } else {
        KisErrorKind::InvalidProviderResponse
    }
}

fn classify_kis_error(code: Option<&str>, message: &str) -> KisErrorKind {
    let normalized = message.to_lowercase();
    if code == Some("EGW00201")
        || message.contains("초당")
        || message.contains("한도")
        || normalized.contains("rate")
    {
        KisErrorKind::RateLimited
    } else if message.contains("인증")
        || normalized.contains("auth")
        || normalized.contains("token")
    {
        KisErrorKind::AuthFailed
    } else {
        KisErrorKind::ProviderUnavailable
    }
}

fn parse_f64(value: Option<&str>) -> Option<f64> {
    value?
        .replace(',', "")
        .parse::<f64>()
        .ok()
        .filter(|value| value.is_finite())
}

fn parse_u64(value: Option<&str>) -> Option<u64> {
    value?.replace(',', "").parse::<u64>().ok()
}
