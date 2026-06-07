import type { SymbolMarket } from "@/lib/symbolTypes";

export type SymbolDisplayInput = {
  market?: string;
  ticker?: string;
  symbol?: string;
  requested_ticker?: string;
  displayName?: string;
  display_name?: string;
  koreanName?: string;
  korean_name?: string;
  englishName?: string;
  english_name?: string;
  instrumentType?: string;
  instrument_type?: string;
  name?: string;
};

type DisplayOptions = {
  fallbackToTicker?: boolean;
};

const US_DERIVATIVE_NAME_RE = /(ETF|ETN|LEVERAGE|LEVERAGED|INVERSE|BULL|BEAR|2X|3X|DAILY|SHORT|ULTRA|FUTURES|OPTION|OPTIONS|YIELDMAX|DIREXION|PROSHARES|T-REX|TRADR|레버리지|인버스|선물|옵션|단일종목)/i;

export function symbolDisplayName(input: SymbolDisplayInput, options: DisplayOptions = {}): string {
  const fallbackToTicker = options.fallbackToTicker ?? true;
  const ticker = displayTicker(input);

  if (isUsDerivativeSymbol(input)) return ticker || symbolNameCandidate(input) || "";

  const name = symbolNameCandidate(input);
  if (name) return name;
  return fallbackToTicker ? ticker : "";
}

export function symbolNameCandidate(input: SymbolDisplayInput): string | undefined {
  return firstText(...symbolNameCandidates(input));
}

export function isUsDerivativeSymbol(input: SymbolDisplayInput): boolean {
  const market = normalizedMarket(input.market) || marketFromTicker(input);
  if (market !== "US") return false;

  const instrumentType = firstText(input.instrumentType, input.instrument_type)?.toUpperCase();
  if (instrumentType === "ETF" || instrumentType === "ETN") return true;

  return symbolNameCandidates(input).some((name) => US_DERIVATIVE_NAME_RE.test(name));
}

export function displayTicker(input: SymbolDisplayInput): string {
  const explicit = firstText(input.ticker, input.symbol);
  if (explicit) return stripMarketPrefix(explicit);

  const requested = firstText(input.requested_ticker);
  if (requested) return stripMarketPrefix(requested);

  return "";
}

function marketFromTicker(input: SymbolDisplayInput): SymbolMarket | undefined {
  const ticker = firstText(input.requested_ticker, input.ticker, input.symbol);
  if (!ticker) return undefined;
  const prefixed = ticker.match(/^(US|KR):/i)?.[1]?.toUpperCase();
  if (prefixed === "US" || prefixed === "KR") return prefixed;
  return /^(?:[0-9][A-Z0-9]{5}|Q\d{6})$/.test(ticker) ? "KR" : undefined;
}

function normalizedMarket(value: string | undefined): SymbolMarket | undefined {
  const market = value?.trim().toUpperCase();
  return market === "US" || market === "KR" ? market : undefined;
}

function symbolNameCandidates(input: SymbolDisplayInput): string[] {
  const values = [
    input.koreanName,
    input.korean_name,
    input.displayName,
    input.display_name,
    input.englishName,
    input.english_name,
    input.name,
  ];
  const names: string[] = [];
  for (const value of values) {
    const text = firstText(value);
    if (text && !names.includes(text)) names.push(text);
  }
  return names;
}

function stripMarketPrefix(value: string): string {
  return value.trim().replace(/^(US|KR):/i, "").toUpperCase();
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const text = value.trim();
    if (text && text !== "-") return text;
  }
  return undefined;
}
