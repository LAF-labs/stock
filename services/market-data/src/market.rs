use std::{error::Error, fmt};

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Market {
    Us,
    Kr,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ScoreView {
    Detail,
    Compare,
}

#[derive(Debug)]
pub struct MarketParseError {
    message: String,
}

impl Market {
    pub fn parse(value: &str) -> Result<Self, MarketParseError> {
        match value.trim().to_ascii_lowercase().as_str() {
            "us" | "usa" | "nasdaq" | "nyse" | "amex" => Ok(Self::Us),
            "kr" | "kor" | "korea" | "kospi" | "kosdaq" => Ok(Self::Kr),
            _ => Err(MarketParseError::new("unsupported market")),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Us => "us",
            Self::Kr => "kr",
        }
    }

    pub fn normalize_symbol(self, symbol: &str) -> Result<String, MarketParseError> {
        let symbol = symbol.trim();
        if symbol.is_empty() {
            return Err(MarketParseError::new("symbol is required"));
        }

        match self {
            Self::Us => normalize_us_symbol(symbol),
            Self::Kr => normalize_kr_symbol(symbol),
        }
    }
}

impl ScoreView {
    pub fn parse(value: Option<&str>) -> Result<Self, MarketParseError> {
        match value
            .unwrap_or("detail")
            .trim()
            .to_ascii_lowercase()
            .as_str()
        {
            "detail" => Ok(Self::Detail),
            "compare" => Ok(Self::Compare),
            _ => Err(MarketParseError::new("unsupported score view")),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Detail => "detail",
            Self::Compare => "compare",
        }
    }
}

impl MarketParseError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl fmt::Display for MarketParseError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}", self.message)
    }
}

impl Error for MarketParseError {}

fn normalize_us_symbol(symbol: &str) -> Result<String, MarketParseError> {
    let normalized = symbol.to_ascii_uppercase();
    let valid = normalized
        .chars()
        .all(|value| value.is_ascii_alphanumeric() || value == '.' || value == '-');
    if valid && normalized.len() <= 12 {
        Ok(normalized)
    } else {
        Err(MarketParseError::new("invalid US ticker"))
    }
}

fn normalize_kr_symbol(symbol: &str) -> Result<String, MarketParseError> {
    if symbol.len() == 6 && symbol.chars().all(|value| value.is_ascii_digit()) {
        Ok(symbol.to_string())
    } else {
        Err(MarketParseError::new("invalid KR ticker"))
    }
}
