export class StockProviderEmptyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StockProviderEmptyError";
  }
}

export function providerEmptyError(message: string): StockProviderEmptyError {
  return new StockProviderEmptyError(message);
}

export function isProviderConfirmedEmptyError(error: unknown): boolean {
  if (error instanceof StockProviderEmptyError) return true;
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return providerConfirmedEmptyMessage(message);
}

export function providerConfirmedEmptyMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.includes("fetch failed")) return false;
  if (normalized.includes("rate limit") || normalized.includes("rate_limited")) return false;
  if (normalized.includes("timeout") || normalized.includes("timed out")) return false;
  if (normalized.includes("token_failed") || normalized.includes("expired token")) return false;
  if (/http\s+5\d\d/.test(normalized)) return false;

  return [
    "kis_not_found",
    "no data found",
    "symbol may be delisted",
    "possibly delisted",
    "empty price",
    "empty daily chart",
    "daily chart was not found",
    "chart_series_missing",
    "no price data found",
    "not found",
    "http 404",
  ].some((marker) => normalized.includes(marker));
}

export function combineProviderErrors(ticker: string, errors: unknown[]): Error {
  const messages = errors.map((error) => error instanceof Error ? error.message : String(error)).filter(Boolean);
  const message = messages.join("; ") || `${ticker} provider data was not found.`;
  if (errors.length > 0 && errors.every(isProviderConfirmedEmptyError)) {
    return providerEmptyError(message);
  }
  return new Error(message);
}
