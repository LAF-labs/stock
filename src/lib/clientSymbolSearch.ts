import { buildSymbolSearchIndex, type SymbolSearchIndexEntry } from "@/lib/symbolLocalSearch";
import type { SymbolListingStatus, SymbolMasterItem } from "@/lib/symbolTypes";

type ClientSymbolTuple = [
  market: "US" | "KR",
  ticker: string,
  exchange: string,
  exchangeName: string,
  koreanName: string,
  englishName: string,
  instrumentType: "STOCK" | "ETF",
  listingStatus?: SymbolListingStatus | "",
];

let clientIndexPromise: Promise<SymbolSearchIndexEntry[]> | undefined;

export function getClientSymbolSearchIndex(): Promise<SymbolSearchIndexEntry[]> {
  if (!clientIndexPromise) {
    clientIndexPromise = import("@/data/symbols.client.generated.json").then((module) => {
      const rows = module.default as ClientSymbolTuple[];
      return buildSymbolSearchIndex(rows.map(symbolMasterItemFromTuple));
    });
  }
  return clientIndexPromise;
}

function symbolMasterItemFromTuple(row: ClientSymbolTuple): SymbolMasterItem {
  const [market, ticker, exchange, exchangeName, koreanName, englishName, instrumentType, listingStatus] = row;
  return {
    market,
    ticker,
    exchange,
    exchangeName,
    koreanName,
    englishName,
    instrumentType,
    listingStatus: listingStatus || undefined,
  };
}
