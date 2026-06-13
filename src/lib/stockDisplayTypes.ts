export type StockDisplayView = "detail" | "technical" | "compare";

export type StockDisplayPartName =
  | "identity"
  | "price"
  | "chart"
  | "score"
  | "technical"
  | "fundamentals"
  | "news"
  | "industryBenchmark"
  | "judgment";

export type StockDisplayHotnessTier = "active" | "search_candidate" | "recent" | "popular" | "long_tail";

export type DisplayPartFreshness = "fresh" | "stale" | "fallback";

export type DisplayPartSource = "memory" | "supabase" | "market-data" | "symbol-master" | "fast-path" | "derived";

export type DisplayPart<T> = {
  value: T;
  freshness: DisplayPartFreshness;
  source: DisplayPartSource;
  version?: string;
  fetchedAt?: string;
  expiresAt?: string;
};

export type StockIdentityView = {
  ticker: string;
  market: "US" | "KR";
  symbol: string;
  name: string;
  koreanName?: string;
  englishName?: string;
  exchange?: string;
  instrumentType?: string;
};

export type StockPriceView = Record<string, unknown>;
export type StockChartView = Record<string, unknown>;
export type StockScoreView = Record<string, unknown>;
export type StockTechnicalView = Record<string, unknown>;
export type StockFundamentalsView = Record<string, unknown>;
export type StockNewsView = Record<string, unknown>;
export type StockIndustryBenchmarkView = Record<string, unknown>;
export type StockJudgmentView = Record<string, unknown>;

export type StockDisplayUnavailablePart = {
  part: StockDisplayPartName;
  reason: "unsupported" | "no_history" | "provider_confirmed_empty" | "configuration";
};

export type StockDisplayCompletion = {
  requiredParts: StockDisplayPartName[];
  presentParts: StockDisplayPartName[];
  missingParts: StockDisplayPartName[];
  recoveringParts: StockDisplayPartName[];
  unavailableParts: StockDisplayUnavailablePart[];
};

export type StockDisplaySnapshotParts = Partial<{
  identity: DisplayPart<StockIdentityView>;
  price: DisplayPart<StockPriceView>;
  chart: DisplayPart<StockChartView>;
  score: DisplayPart<StockScoreView>;
  technical: DisplayPart<StockTechnicalView>;
  fundamentals: DisplayPart<StockFundamentalsView>;
  news: DisplayPart<StockNewsView>;
  industryBenchmark: DisplayPart<StockIndustryBenchmarkView>;
  judgment: DisplayPart<StockJudgmentView>;
}>;

export type StockDisplaySnapshot = {
  ticker: string;
  view: StockDisplayView;
  snapshotVersion: string;
  generatedAt: string;
  hotnessTier: StockDisplayHotnessTier;
  parts: StockDisplaySnapshotParts;
  completion: StockDisplayCompletion;
};

export type StockDisplayRefresh = {
  active: boolean;
  pollable?: boolean;
  staleParts: StockDisplayPartName[];
  recoveringParts: StockDisplayPartName[];
  nextPollMs?: number;
  queue?: {
    state: "idle" | "queued" | "unavailable" | "unknown";
    attempted: boolean;
    queuedActions: number;
    failedActions: number;
    failures?: Array<{ part: StockDisplayPartName; reason: string }>;
  };
};

export type StockDisplayCapabilities = {
  canCompare: boolean;
  canTechnical: boolean;
  technicalHref?: string;
};

export type StockDisplayPayload = {
  ok: true;
  ticker: string;
  requestedTicker: string;
  view: StockDisplayView;
  generatedAt: string;
  snapshotVersion: string;
  hotnessTier: StockDisplayHotnessTier;
  identity: DisplayPart<StockIdentityView>;
  price?: DisplayPart<StockPriceView>;
  chart?: DisplayPart<StockChartView>;
  score?: DisplayPart<StockScoreView>;
  technical?: DisplayPart<StockTechnicalView>;
  fundamentals?: DisplayPart<StockFundamentalsView>;
  news?: DisplayPart<StockNewsView>;
  industryBenchmark?: DisplayPart<StockIndustryBenchmarkView>;
  judgment?: DisplayPart<StockJudgmentView>;
  completion: StockDisplayCompletion;
  refresh: StockDisplayRefresh;
  capabilities: StockDisplayCapabilities;
};
