export type SymbolMarket = "US" | "KR";

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
};

export type SymbolSearchItem = SymbolMasterItem & {
  key: string;
  displayName: string;
  subtitle: string;
};
