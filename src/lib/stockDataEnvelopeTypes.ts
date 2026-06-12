import type { PartState } from "@/lib/stockPartState";
import type {
  StockChartView,
  StockDisplayHotnessTier,
  StockDisplayPartName,
  StockDisplayView,
  StockFundamentalsView,
  StockIdentityView,
  StockIndustryBenchmarkView,
  StockNewsView,
  StockPriceView,
  StockScoreView,
  StockTechnicalView,
} from "@/lib/stockDisplayTypes";

export type StockDataEnvelopeParts = Partial<Record<StockDisplayPartName, PartState<Record<string, unknown>>>> & {
  identity: PartState<StockIdentityView>;
  price?: PartState<StockPriceView>;
  chart?: PartState<StockChartView>;
  score?: PartState<StockScoreView>;
  technical?: PartState<StockTechnicalView>;
  fundamentals?: PartState<StockFundamentalsView>;
  industryBenchmark?: PartState<StockIndustryBenchmarkView>;
  news?: PartState<StockNewsView>;
};

export type StockDataEnvelope = {
  ticker: string;
  requestedTicker: string;
  view: StockDisplayView;
  generatedAt: string;
  hotnessTier: StockDisplayHotnessTier;
  parts: StockDataEnvelopeParts;
};
