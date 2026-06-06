export type MarketCode = "US" | "KR";

export type ParsedTickerRef = {
  ticker: string;
  market: MarketCode;
  symbol: string;
};

const DOMESTIC_SYMBOL_RE = /^(?:\d{6}|Q\d{6})$/;

export function cleanTickerSymbol(value: string): string {
  return value.trim().replace(/^!/, "").toUpperCase().replace(/[^A-Z0-9.-]/g, "");
}

export function normalizeTickerRef(value: string | null | undefined, fallback = "US:ASTS"): string {
  const raw = (value || fallback).trim().replace(/^!/, "").toUpperCase();

  if (raw.includes(":")) {
    const [market, symbolPart] = raw.split(":", 2);
    const symbol = cleanTickerSymbol(symbolPart || "");
    if ((market === "US" || market === "KR") && symbol) return `${market}:${symbol}`;
  }

  const symbol = cleanTickerSymbol(raw);
  if (!symbol) return fallback;
  if (DOMESTIC_SYMBOL_RE.test(symbol)) return `KR:${symbol}`;
  return `US:${symbol}`;
}

export function parseTickerRef(value: string | null | undefined, fallback = "US:ASTS"): ParsedTickerRef {
  const ticker = normalizeTickerRef(value, fallback);
  const [marketPart, symbolPart] = ticker.split(":", 2);
  const market: MarketCode = marketPart === "KR" ? "KR" : "US";
  const symbol = cleanTickerSymbol(symbolPart || "");
  return {
    ticker: `${market}:${symbol}`,
    market,
    symbol,
  };
}
