export type SymbolMarket = "US" | "KR";
export type SymbolListingStatus = "listed" | "delisted" | "newly_listed" | "pending_data";

export type SymbolMasterItem = {
  market: SymbolMarket;
  ticker: string;
  exchange: string;
  exchangeName: string;
  koreanName: string;
  englishName?: string;
  instrumentType: "STOCK" | "ETF";
  currency?: string;
  standardCode?: string;
  providerSectorCode?: string;
  listingStatus?: SymbolListingStatus;
  listedAt?: string;
  delistedAt?: string;
};

export type SymbolSearchItem = SymbolMasterItem & {
  key: string;
  displayName: string;
  subtitle: string;
};
