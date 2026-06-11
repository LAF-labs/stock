import { enrichStockPayloadWithSymbolDisplay } from "@/lib/symbolSearch";
import { enrichStockPayloadWithSymbolProfile } from "@/lib/symbolProfiles";

export async function enrichQuotePayloadForDisplay<T extends Record<string, unknown>>(payload: T): Promise<T & Record<string, unknown>> {
  const displayPayload = quoteNeedsSymbolProfile(payload) ? await enrichStockPayloadWithSymbolDisplay(payload) : payload;
  return quoteNeedsSymbolProfile(displayPayload) ? enrichStockPayloadWithSymbolProfile(displayPayload) : displayPayload as T & Record<string, unknown>;
}

export function quoteNeedsSymbolProfile(payload: Record<string, unknown>): boolean {
  const symbol = comparableText(payload.symbol);
  const requestedTicker = comparableText(payload.requested_ticker);
  const displayName = comparableText(payload.display_name) || comparableText(payload.korean_name) || comparableText(payload.english_name);
  if (displayName && displayName !== symbol && displayName !== requestedTicker) return false;

  const name = comparableText(payload.name);
  if (!name) return true;
  return name === symbol || name === requestedTicker;
}

function comparableText(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase().replace(/[^A-Z0-9가-힣]/g, "") : "";
}
