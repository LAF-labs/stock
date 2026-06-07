import { findExactSymbol } from "@/lib/symbolSearch";
import type { SymbolSearchItem } from "@/lib/symbolTypes";
import {
  technicalEligibilityFromPayload,
  tickerFromInput,
  type TechnicalEligibility,
} from "@/lib/technicalAnalysisLinks";

export {
  detailPathForTicker,
  technicalAnalysisHrefForPayload,
  technicalEligibilityFromPayload,
  technicalUnsupportedProductPayload,
  type TechnicalEligibility,
} from "@/lib/technicalAnalysisLinks";

export async function technicalEligibilityForTicker(tickerRef: string): Promise<TechnicalEligibility> {
  const ticker = tickerFromInput(tickerRef);
  if (!ticker) return { eligible: false, ticker: "US:KO", reason: "invalid_ticker" };

  const item = await findExactSymbol(ticker);
  if (!item) return { eligible: true, ticker };
  const payload = payloadFromSymbolItem(item, ticker);
  return technicalEligibilityFromPayload(payload);
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
