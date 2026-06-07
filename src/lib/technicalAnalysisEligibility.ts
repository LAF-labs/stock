import { findExactSymbol } from "@/lib/symbolSearch";
import { cleanTickerSymbol, parseStrictTickerRef } from "@/lib/tickerRef";
import type { SymbolSearchItem } from "@/lib/symbolTypes";

export type TechnicalEligibility =
  | { eligible: true; ticker: string }
  | { eligible: false; ticker: string; reason: "unsupported_product" | "invalid_ticker" };

const BLOCKED_ASSET_CLASSES = new Set(["etf", "etn", "fund", "derivative", "warrant", "structured_product"]);
const BLOCKED_NAME_RE = /(ETF|ETN|ELW|ETP|WARRANT|워런트|펀드|상장지수|레버리지|인버스|선물|파생|커버드콜|채권혼합|원자재|지수|단일종목)/i;

export function technicalEligibilityFromPayload(payload: Record<string, unknown>): TechnicalEligibility {
  const ticker = tickerFromPayload(payload);
  if (!ticker) return { eligible: false, ticker: "US:KO", reason: "invalid_ticker" };
  if (isUnsupportedProduct(payload)) return { eligible: false, ticker, reason: "unsupported_product" };
  return { eligible: true, ticker };
}

export async function technicalEligibilityForTicker(tickerRef: string): Promise<TechnicalEligibility> {
  const ticker = tickerFromInput(tickerRef);
  if (!ticker) return { eligible: false, ticker: "US:KO", reason: "invalid_ticker" };

  const item = await findExactSymbol(ticker);
  if (!item) return { eligible: true, ticker };
  const payload = payloadFromSymbolItem(item, ticker);
  return technicalEligibilityFromPayload(payload);
}

export function technicalAnalysisHrefForPayload(payload: Record<string, unknown>): string | undefined {
  const eligibility = technicalEligibilityFromPayload(payload);
  if (!eligibility.eligible) return undefined;
  return `/technical?ticker=${encodeURIComponent(eligibility.ticker)}`;
}

export function detailPathForTicker(value: string | undefined): string {
  const ticker = tickerFromInput(value) || "US:KO";
  return `/?ticker=${encodeURIComponent(ticker)}`;
}

export function technicalUnsupportedProductPayload(ticker: string) {
  return {
    ok: false,
    error: "technical_unsupported_product",
    ticker,
    redirect_to: detailPathForTicker(ticker),
  };
}

function payloadFromSymbolItem(item: SymbolSearchItem, ticker: string): Record<string, unknown> {
  return {
    requested_ticker: ticker,
    market: item.market,
    symbol: item.ticker,
    name: item.displayName || item.koreanName || item.englishName,
    instrument_type: item.instrumentType,
    industry_profile: {
      asset_class: item.instrumentType.toLowerCase(),
      name: item.displayName || item.koreanName || item.englishName,
      instrument_type: item.instrumentType,
    },
  };
}

function tickerFromPayload(payload: Record<string, unknown>): string | undefined {
  const requested = typeof payload.requested_ticker === "string" ? payload.requested_ticker : undefined;
  const requestedTicker = tickerFromInput(requested);
  if (requestedTicker) return requestedTicker;

  const market = typeof payload.market === "string" ? payload.market : undefined;
  const symbol = typeof payload.symbol === "string" ? payload.symbol : undefined;
  return tickerFromInput(market && symbol ? `${market}:${symbol}` : symbol);
}

function tickerFromInput(value: string | undefined): string | undefined {
  const raw = value?.trim().replace(/^!/, "").toUpperCase();
  if (!raw) return undefined;
  if (raw.includes(":")) {
    const [marketPart, symbolPart] = raw.split(":", 2);
    if (marketPart !== "US" && marketPart !== "KR") return undefined;
    const symbol = cleanTickerSymbol(symbolPart || "");
    return symbol ? `${marketPart}:${symbol}` : undefined;
  }

  const parsed = parseStrictTickerRef(raw);
  return parsed.ok ? parsed.ticker : undefined;
}

function isUnsupportedProduct(payload: Record<string, unknown>): boolean {
  const profile = recordFromUnknown(payload.industry_profile);
  const assetClass = text(profile?.asset_class).toLowerCase();
  if (BLOCKED_ASSET_CLASSES.has(assetClass)) return true;

  const instrumentType = text(payload.instrument_type || profile?.instrument_type).toUpperCase();
  if (instrumentType === "ETF") return true;

  const name = [payload.name, profile?.name].map(text).filter(Boolean).join(" ");
  return BLOCKED_NAME_RE.test(name);
}

function recordFromUnknown(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
