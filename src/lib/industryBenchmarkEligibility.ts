export type IndustryBenchmarkEligibility =
  | { eligible: true }
  | { eligible: false; reason: "unsupported_product" };

const BLOCKED_ASSET_CLASSES = new Set([
  "etf",
  "etn",
  "etp",
  "fund",
  "mutual_fund",
  "derivative",
  "warrant",
  "structured_product",
  "preferred",
  "spac",
  "reit",
  "other",
]);

const BLOCKED_INSTRUMENT_TYPES = new Set([
  "ETF",
  "ETN",
  "ETP",
  "ELW",
  "FUND",
  "MUTUAL_FUND",
  "WARRANT",
  "DERIVATIVE",
  "STRUCTURED_PRODUCT",
  "PREFERRED",
  "PREF",
  "SPAC",
  "REIT",
]);

const BLOCKED_NAME_RE =
  /\b(ETF|ETN|ETP|ELW|WARRANT|COVERED CALL|LEVERAGED|INVERSE|FUTURES?)\b|워런트|펀드|상장지수|레버리지|인버스|선물|파생|커버드콜|채권혼합|원자재|단일종목/i;

export function industryBenchmarkEligibilityFromPayload(payload: Record<string, unknown>): IndustryBenchmarkEligibility {
  return isUnsupportedBenchmarkProduct(payload)
    ? { eligible: false, reason: "unsupported_product" }
    : { eligible: true };
}

function isUnsupportedBenchmarkProduct(payload: Record<string, unknown>): boolean {
  const profile = recordFromUnknown(payload.industry_profile);
  const assetClass = text(payload.asset_class || profile?.asset_class).toLowerCase();
  if (BLOCKED_ASSET_CLASSES.has(assetClass)) return true;

  const instrumentType = text(payload.instrument_type || profile?.instrument_type).toUpperCase();
  if (BLOCKED_INSTRUMENT_TYPES.has(instrumentType)) return true;

  const name = [
    payload.name,
    payload.korean_name,
    payload.english_name,
    profile?.name,
  ].map(text).filter(Boolean).join(" ");
  return BLOCKED_NAME_RE.test(name);
}

function recordFromUnknown(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
