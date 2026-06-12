import type {
  StockChartView,
  StockDisplayPartName,
  StockDisplayView,
  StockIdentityView,
  StockPriceView,
  StockScoreView,
} from "@/lib/stockDisplayTypes";

export type StockDetailViewMode = "partial" | "ready" | "failed_irreversible";

export type StockDetailPartName = "price" | "chart" | "score" | "financials" | "analyst";

export type StockDetailPartState =
  | "ready"
  | "stale_ready"
  | "refreshing"
  | "failed_retrying"
  | "missing"
  | "unsupported";

export type StockDetailPartStatus = {
  state: StockDetailPartState;
  displayPart?: StockDisplayPartName;
  reason?: string;
};

export type StockDetailViewModel = {
  ok: true;
  mode: Exclude<StockDetailViewMode, "failed_irreversible">;
  ticker: string;
  requestedTicker: string;
  view: StockDisplayView;
  generatedAt: string;
  snapshotVersion: string;
  degradedReason?: "identity_only";
  nextPollMs?: number;
  identity: StockIdentityView;
  sections: {
    price?: StockPriceView;
    chart?: StockChartView;
    score?: StockScoreView;
    financials?: Record<string, unknown>;
    analyst?: Record<string, unknown>;
  };
  parts: Record<StockDetailPartName, StockDetailPartStatus>;
  jobs: Array<{
    part: StockDetailPartName;
    state: "queued" | "retrying";
  }>;
};

export type StockDetailIrreversibleFailure = {
  ok: false;
  mode: "failed_irreversible";
  error: string;
  message: string;
  ticker?: string;
};

export type StockDetailViewResponse = StockDetailViewModel | StockDetailIrreversibleFailure;
