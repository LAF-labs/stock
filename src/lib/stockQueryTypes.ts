import type { ClientApiPayload } from "@/lib/clientApi";
import type { StockJudgment, StockQuoteResponse, StockScoreResponse } from "@/lib/types";
import type { SymbolSearchItem } from "@/lib/symbolTypes";

export type StockScoreView = "detail" | "compare" | "technical";

export type ApiPending = {
  state: "pending";
  status: number;
  payload: ClientApiPayload;
  error: "snapshot_pending" | "snapshot_unavailable";
  message: string;
  ticker?: string;
  queued: boolean;
  retryAfterSeconds?: number;
};

export type ApiPartial<TData> = {
  state: "partial";
  status: number;
  payload: ClientApiPayload;
  data: TData;
  pending?: ApiPending;
};

export type ApiReady<TData> = {
  state: "ready";
  status: number;
  payload: ClientApiPayload;
  data: TData;
};

export type ApiUnsupported = {
  state: "unsupported";
  status: number;
  payload: ClientApiPayload;
  error: "technical_unsupported_product";
  ticker?: string;
  redirectTo?: string;
};

export type ApiCooldown<TData> = {
  state: "cooldown";
  status: number;
  payload: ClientApiPayload;
  data?: TData;
  message: string;
  nextAllowedAt?: string;
};

export type ApiError = {
  state: "error";
  status: number;
  payload?: ClientApiPayload;
  error: string;
  message: string;
};

export type ScoreQueryResult = ApiReady<StockScoreResponse> | ApiPartial<StockScoreResponse> | ApiPending | ApiUnsupported;
export type TechnicalScoreQueryResult = ScoreQueryResult;
export type QuoteQueryResult = ApiReady<StockQuoteResponse> | ApiPartial<StockQuoteResponse> | ApiPending;
export type QuoteRefreshMutationResult = ApiReady<StockQuoteResponse> | ApiPending | ApiCooldown<StockQuoteResponse>;

export type CompareScoreItemResult =
  | { ticker: string; result: ApiReady<StockScoreResponse> | ApiPartial<StockScoreResponse> | ApiPending | ApiUnsupported | ApiError };

export type CompareQueryResult = {
  state: "ready" | "partial" | "pending";
  status: number;
  payload: ClientApiPayload;
  results: CompareScoreItemResult[];
};

export type SymbolSearchQueryResult = ApiReady<{
  query: string;
  items: SymbolSearchItem[];
  total: number;
}>;

export type JudgmentQueryResult = ApiReady<StockJudgment>;
