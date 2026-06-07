export type MarketCode = "US" | "KR";

export type ParsedTickerRef = {
  ticker: string;
  market: MarketCode;
  symbol: string;
};

export type StrictTickerRefResult =
  | ({ ok: true } & ParsedTickerRef)
  | { ok: false; error: "missing_ticker" | "invalid_ticker" };

const DOMESTIC_SYMBOL_RE = /^(?:[0-9][A-Z0-9]{5}|Q\d{6})$/;
const US_SYMBOL_RE = /^[A-Z0-9.-]{1,16}$/;

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

export function parseStrictTickerRef(value: string | null | undefined): StrictTickerRefResult {
  const raw = value?.trim().replace(/^!/, "").toUpperCase();
  if (!raw) return { ok: false, error: "missing_ticker" };

  if (raw.includes(":")) {
    const [marketPart, symbolPart] = raw.split(":", 2);
    if (marketPart !== "US" && marketPart !== "KR") return { ok: false, error: "invalid_ticker" };
    const symbol = symbolPart?.trim().toUpperCase() || "";
    if (!validTickerSymbolForMarket(marketPart, symbol)) return { ok: false, error: "invalid_ticker" };
    return { ok: true, ticker: `${marketPart}:${symbol}`, market: marketPart, symbol };
  }

  if (DOMESTIC_SYMBOL_RE.test(raw)) return { ok: true, ticker: `KR:${raw}`, market: "KR", symbol: raw };
  if (US_SYMBOL_RE.test(raw)) return { ok: true, ticker: `US:${raw}`, market: "US", symbol: raw };
  return { ok: false, error: "invalid_ticker" };
}

export function validTickerSymbolForMarket(market: MarketCode, symbol: string): boolean {
  const clean = cleanTickerSymbol(symbol);
  if (market === "KR") return DOMESTIC_SYMBOL_RE.test(clean);
  return US_SYMBOL_RE.test(clean);
}
