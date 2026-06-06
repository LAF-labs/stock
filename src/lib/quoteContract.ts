import quoteContract from "../../shared/quote-contract.json";

type KisMarketDetail = {
  productType: string;
  label: string;
};

const US_MARKET_DETAILS: Record<string, KisMarketDetail> = {
  NAS: { productType: "512", label: "Nasdaq" },
  NYS: { productType: "513", label: "NYSE" },
  AMS: { productType: "529", label: "AMEX" },
};

export const KIS_DOMESTIC_MARKET_DIV_CODE = quoteContract.kis.domestic.market_div_code;
export const KIS_DOMESTIC_EXCHANGE_LABEL = quoteContract.kis.domestic.exchange_label;
export const QUOTE_CACHE_FRESH_SECONDS = quoteContract.quote_cache.fresh_seconds;
export const QUOTE_CACHE_STALE_SECONDS = quoteContract.quote_cache.stale_seconds;

export const KIS_US_MARKETS = quoteContract.kis.us_exchange_order.map((excd) => ({
  excd,
  ...(US_MARKET_DETAILS[excd] ?? { productType: "", label: excd }),
}));
