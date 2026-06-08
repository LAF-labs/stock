export type MarketCode = "US" | "KR";

export type ParsedTickerRef = {
  ticker: string;
  market: MarketCode;
  symbol: string;
};

export type StrictTickerRefResult =
  | ({ ok: true } & ParsedTickerRef)
  | { ok: false; error: "missing_ticker" | "invalid_ticker" };

export type TickerAliasResolution =
  | ({
      ok: true;
      input: string;
      confidence: "exact" | "deterministic";
      source: "format_alias" | "known_alias" | "provider_suffix" | "symbol_master";
    } & ParsedTickerRef)
  | { ok: false; input: string; error: "missing_ticker" | "ambiguous_ticker" | "invalid_ticker" };

const DOMESTIC_SYMBOL_RE = /^(?:[0-9][A-Z0-9]{5}|Q\d{6})$/;
const US_SYMBOL_RE = /^[A-Z0-9.-]{1,16}$/;
const DOMESTIC_PROVIDER_SUFFIX_RE = /^(?:(KR):)?([0-9][A-Z0-9]{5}|Q\d{6})\.(?:KS|KQ)$/;
const OPTIONAL_US_CLASS_ALIAS_RE = /^(?:(US):)?(.+)$/;

const US_CLASS_SHARE_ALIASES = new Map([
  ["BRK/B", "BRK.B"],
  ["BRK B", "BRK.B"],
  ["BRK-B", "BRK.B"],
]);

const KNOWN_TICKER_ALIASES: Array<{ aliases: string[]; ticker: string }> = [
  { aliases: ["삼전", "삼성전자"], ticker: "KR:005930" },
  { aliases: ["삼전우", "삼성전자우"], ticker: "KR:005935" },
  { aliases: ["하닉", "SK하닉", "SK하이닉스", "에스케이하이닉스"], ticker: "KR:000660" },
  { aliases: ["현차", "현대차", "현대자동차"], ticker: "KR:005380" },
  { aliases: ["기아", "기아차"], ticker: "KR:000270" },
  { aliases: ["삼바", "삼성바이오로직스"], ticker: "KR:207940" },
  { aliases: ["네이버", "NAVER"], ticker: "KR:035420" },
  { aliases: ["카카오"], ticker: "KR:035720" },
  { aliases: ["카뱅", "카카오뱅크"], ticker: "KR:323410" },
  { aliases: ["셀트", "셀트리온"], ticker: "KR:068270" },
  { aliases: ["엔솔", "엘지엔솔", "LG엔솔", "LG에너지솔루션"], ticker: "KR:373220" },
  { aliases: ["엘화", "LG화학"], ticker: "KR:051910" },
  { aliases: ["엘전", "LG전자"], ticker: "KR:066570" },
  { aliases: ["포홀", "포스코홀딩스"], ticker: "KR:005490" },
  { aliases: ["한화에어로", "한화에어로스페이스"], ticker: "KR:012450" },
  { aliases: ["두산에너빌리티"], ticker: "KR:034020" },
  { aliases: ["엔비디아", "NVIDIA"], ticker: "US:NVDA" },
  { aliases: ["테슬라"], ticker: "US:TSLA" },
  { aliases: ["브로드컴"], ticker: "US:AVGO" },
  { aliases: ["마벨"], ticker: "US:MRVL" },
  { aliases: ["팔란티어"], ticker: "US:PLTR" },
  { aliases: ["버크셔", "버크셔해서웨이", "BERKSHIRE"], ticker: "US:BRK.B" },
  { aliases: ["애플", "APPLE"], ticker: "US:AAPL" },
  { aliases: ["마소", "마이크로소프트", "MICROSOFT"], ticker: "US:MSFT" },
  { aliases: ["구글", "구글A", "GOOGLE"], ticker: "US:GOOGL" },
  { aliases: ["구글C"], ticker: "US:GOOG" },
  { aliases: ["아마존", "AMAZON"], ticker: "US:AMZN" },
  { aliases: ["메타", "페북", "페이스북"], ticker: "US:META" },
  { aliases: ["넷플릭스"], ticker: "US:NFLX" },
  { aliases: ["암드", "에이엠디"], ticker: "US:AMD" },
  { aliases: ["마이크론"], ticker: "US:MU" },
  { aliases: ["퀄컴"], ticker: "US:QCOM" },
  { aliases: ["티에스엠씨", "TSMC"], ticker: "US:TSM" },
  { aliases: ["온큐", "아이온큐", "이온큐"], ticker: "US:IONQ" },
  { aliases: ["스트레티지", "스트래티지", "마이크로스트레티지", "마이크로스트래티지", "MICROSTRATEGY", "STRATEGY"], ticker: "US:MSTR" },
  { aliases: ["슈마컴", "슈퍼마이크로", "슈퍼마이크로컴퓨터"], ticker: "US:SMCI" },
  { aliases: ["코인베이스"], ticker: "US:COIN" },
  { aliases: ["로빈후드"], ticker: "US:HOOD" },
  { aliases: ["리비안"], ticker: "US:RIVN" },
  { aliases: ["루시드"], ticker: "US:LCID" },
  { aliases: ["리게티"], ticker: "US:RGTI" },
  { aliases: ["디웨이브"], ticker: "US:QBTS" },
  { aliases: ["레딧"], ticker: "US:RDDT" },
  { aliases: ["오라클"], ticker: "US:ORCL" },
  { aliases: ["일라이릴리"], ticker: "US:LLY" },
  { aliases: ["노보노디스크"], ticker: "US:NVO" },
];

const KNOWN_TICKER_ALIAS_MAP = new Map<string, string>(
  KNOWN_TICKER_ALIASES.flatMap((entry) => entry.aliases.map((alias) => [aliasKey(alias), entry.ticker] as const))
);

const AMBIGUOUS_TICKER_ALIASES = new Set(
  [
    "삼성",
    "SK",
    "LG",
    "현대",
    "포스코",
    "한화",
    "두산",
    "네카오",
    "빅테크",
    "반도체",
    "칩주",
    "AI주",
    "전기차",
    "양자",
    "2차전지",
    "배터리",
    "알파벳",
    "우",
    "우선주",
    "코인",
    "비트",
    "비트코인",
  ].map(aliasKey)
);

export function cleanTickerSymbol(value: string): string {
  return value.trim().replace(/^!/, "").toUpperCase().replace(/[^A-Z0-9.-]/g, "");
}

export function resolveTickerAlias(value: string | null | undefined): TickerAliasResolution {
  const input = value?.trim().replace(/^!/, "") || "";
  if (!input) return { ok: false, input, error: "missing_ticker" };

  const classAlias = resolveUsClassShareAlias(input);
  if (classAlias) return canonicalAliasResolution(input, `US:${classAlias}`, "format_alias");

  const providerSuffix = input.toUpperCase().match(DOMESTIC_PROVIDER_SUFFIX_RE);
  if (providerSuffix) return canonicalAliasResolution(input, `KR:${providerSuffix[2]}`, "provider_suffix");

  const key = aliasKey(input);
  const knownAlias = KNOWN_TICKER_ALIAS_MAP.get(key);
  if (knownAlias) return canonicalAliasResolution(input, knownAlias, "known_alias");
  if (AMBIGUOUS_TICKER_ALIASES.has(key)) return { ok: false, input, error: "ambiguous_ticker" };

  const strict = parseStrictTickerRef(input);
  if (strict.ok) {
    return {
      ok: true,
      input,
      ticker: strict.ticker,
      market: strict.market,
      symbol: strict.symbol,
      confidence: "exact",
      source: "symbol_master",
    };
  }

  return { ok: false, input, error: strict.error };
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
  const raw = symbol.trim().toUpperCase();
  if (market === "KR") return DOMESTIC_SYMBOL_RE.test(raw);
  return US_SYMBOL_RE.test(raw);
}

function canonicalAliasResolution(
  input: string,
  ticker: string,
  source: Extract<TickerAliasResolution, { ok: true }>["source"]
): TickerAliasResolution {
  const strict = parseStrictTickerRef(ticker);
  if (!strict.ok) return { ok: false, input, error: "invalid_ticker" };
  return {
    ok: true,
    input,
    ticker: strict.ticker,
    market: strict.market,
    symbol: strict.symbol,
    confidence: source === "symbol_master" ? "exact" : "deterministic",
    source,
  };
}

function resolveUsClassShareAlias(input: string): string | undefined {
  const match = input.trim().toUpperCase().match(OPTIONAL_US_CLASS_ALIAS_RE);
  if (!match || (match[1] && match[1] !== "US")) return undefined;
  return US_CLASS_SHARE_ALIASES.get(match[2].trim().replace(/\s+/g, " "));
}

function aliasKey(value: string): string {
  return value
    .trim()
    .replace(/^!/, "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[.\-_/()[\],]/g, "");
}
