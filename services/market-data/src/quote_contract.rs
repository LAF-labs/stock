use std::{sync::OnceLock, time::Duration};

use serde::Deserialize;

const QUOTE_CONTRACT_JSON: &str = include_str!("../../../shared/quote-contract.json");

#[derive(Deserialize)]
struct QuoteContract {
    kis: KisContract,
    quote_cache: QuoteCacheContract,
}

#[derive(Deserialize)]
struct KisContract {
    domestic: DomesticContract,
    us_exchange_order: Vec<String>,
}

#[derive(Deserialize)]
struct DomesticContract {
    market_div_code: String,
    exchange_label: String,
}

#[derive(Deserialize)]
struct QuoteCacheContract {
    fresh_seconds: u64,
    stale_seconds: u64,
}

fn contract() -> &'static QuoteContract {
    static CONTRACT: OnceLock<QuoteContract> = OnceLock::new();
    CONTRACT.get_or_init(|| {
        serde_json::from_str(QUOTE_CONTRACT_JSON).expect("shared quote contract must be valid JSON")
    })
}

pub fn kis_domestic_market_div_code() -> &'static str {
    contract().kis.domestic.market_div_code.as_str()
}

pub fn kis_domestic_exchange_label() -> &'static str {
    contract().kis.domestic.exchange_label.as_str()
}

pub fn kis_us_exchange_order() -> &'static [String] {
    contract().kis.us_exchange_order.as_slice()
}

pub fn quote_fresh_ttl() -> Duration {
    Duration::from_secs(contract().quote_cache.fresh_seconds)
}

pub fn quote_stale_ttl() -> Duration {
    Duration::from_secs(contract().quote_cache.stale_seconds)
}
