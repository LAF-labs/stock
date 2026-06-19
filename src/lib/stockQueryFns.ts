import { apiJson, apiPayloadMessage, stringFromUnknown, type ClientApiPayload } from "@/lib/clientApi";
import { stockJudgmentRequestPayload } from "@/lib/stockJudgmentPayload";
import { stockScorePayloadNeedsEnrichment } from "@/lib/stockQueryCompleteness";
import type {
  ApiCooldown,
  ApiError,
  ApiPartial,
  ApiPending,
  ApiReady,
  ApiUnsupported,
  DisplayQueryResult,
  JudgmentQueryResult,
  QuoteQueryResult,
  QuoteRefreshMutationResult,
  ScoreQueryResult,
  StockScoreView,
  SymbolSearchQueryResult,
  TechnicalScoreQueryResult,
} from "@/lib/stockQueryTypes";
import type { StockJudgment, StockQuoteResponse, StockScoreResponse } from "@/lib/types";
import type { SymbolSearchItem } from "@/lib/symbolTypes";
import type { StockDisplayPayload, StockDisplayView } from "@/lib/stockDisplayTypes";
import type { StockDetailViewResponse } from "@/lib/stockDetailViewTypes";

type ApiJsonInit = RequestInit & { signal?: AbortSignal };

export class StockQueryError extends Error {
  status: number;
  code: string;
  payload?: ClientApiPayload;

  constructor(error: ApiError) {
    super(error.message);
    this.name = "StockQueryError";
    this.status = error.status;
    this.code = error.error;
    this.payload = error.payload;
  }
}

export async function fetchStockScore({
  ticker,
  view = "detail",
  signal,
}: {
  ticker: string;
  view?: StockScoreView;
  signal?: AbortSignal;
}): Promise<ScoreQueryResult> {
  const query = new URLSearchParams({ ticker, partial: "1" });
  if (view !== "detail") query.set("view", view);
  const { payload, response } = await apiJson(`/api/score?${query.toString()}`, noStoreInit(signal));
  return classifyScorePayload(payload, response.status);
}

export async function fetchStockDisplay({
  ticker,
  view = "detail",
  signal,
}: {
  ticker: string;
  view?: StockDisplayView;
  signal?: AbortSignal;
}): Promise<DisplayQueryResult> {
  const query = new URLSearchParams({ ticker, view });
  const { payload, response } = await apiJson(`/api/stock/display?${query.toString()}`, noStoreInit(signal));
  if (!response.ok || payload.ok === false) throwStockQueryError(payload, response.status, "display_failed");
  return readyResult(payload as StockDisplayPayload, payload, response.status);
}

export async function fetchStockDetailView({
  ticker,
  view = "detail",
  signal,
}: {
  ticker: string;
  view?: StockDisplayView;
  signal?: AbortSignal;
}): Promise<StockDetailViewResponse> {
  const query = new URLSearchParams({ ticker, view });
  const { payload } = await apiJson(`/api/stock/detail-view?${query.toString()}`, noStoreInit(signal));
  return payload as StockDetailViewResponse;
}

export async function fetchTechnicalScore(ticker: string, signal?: AbortSignal): Promise<TechnicalScoreQueryResult> {
  return fetchStockScore({ ticker, view: "technical", signal });
}

export async function fetchStockQuote(ticker: string, signal?: AbortSignal): Promise<QuoteQueryResult> {
  const query = new URLSearchParams({ ticker });
  const { payload, response } = await apiJson(`/api/quote?${query.toString()}`, noStoreInit(signal));
  return classifyQuotePayload(payload, response.status);
}

export async function refreshQuote(ticker: string, signal?: AbortSignal): Promise<QuoteRefreshMutationResult> {
  const query = new URLSearchParams({ ticker, refresh: "1" });
  const { payload, response } = await apiJson(`/api/quote?${query.toString()}`, noStoreInit(signal));
  if (isRefreshCooldownPayload(payload)) return cooldownResult(payload, response.status);
  const result = classifyQuotePayload(payload, response.status);
  if (result.state !== "partial") return result;
  return result.pending || {
    state: "pending",
    status: result.status,
    payload: result.payload,
    error: "snapshot_pending",
    message: "현재가를 화면에 반영합니다.",
    queued: false,
  };
}

export async function fetchSymbols({
  query,
  market,
  limit = 8,
  signal,
}: {
  query: string;
  market?: string;
  limit?: number;
  signal?: AbortSignal;
}): Promise<SymbolSearchQueryResult> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  if (market) params.set("market", market);
  const { payload, response } = await apiJson(`/api/symbols?${params.toString()}`, { signal });
  if (!response.ok || payload.ok === false) throwStockQueryError(payload, response.status, "symbol_search_failed");
  return {
    state: "ready",
    status: response.status,
    payload,
    data: {
      query: stringFromUnknown(payload.query) || query,
      total: numberFromUnknown(payload.total) ?? itemsFromPayload(payload).length,
      items: itemsFromPayload(payload),
    },
  };
}

export async function postJudgment(payload: Record<string, unknown>, signal?: AbortSignal): Promise<JudgmentQueryResult> {
  const { payload: responsePayload, response } = await apiJson("/api/judgment", {
    ...noStoreInit(signal),
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(stockJudgmentRequestPayload(payload)),
  });
  if (!response.ok || responsePayload.ok === false) throwStockQueryError(responsePayload, response.status, "judgment_failed");
  const judgment = responsePayload.judgment;
  if (!judgment || typeof judgment !== "object" || Array.isArray(judgment)) {
    throwStockQueryError(responsePayload, response.status, "judgment_missing");
  }
  return {
    state: "ready",
    status: response.status,
    payload: responsePayload,
    data: judgment as StockJudgment,
  };
}

export function classifyScorePayload(payload: ClientApiPayload, status: number): ScoreQueryResult {
  const unsupported = unsupportedResult(payload, status);
  if (unsupported) return unsupported;

  const partial = partialResult<StockScoreResponse>(payload, status);
  if (partial) return partial;

  const pending = pendingResult(payload, status);
  if (pending) return pending;

  if (status >= 400 || payload.ok === false) throwStockQueryError(payload, status, "score_failed");
  if (stockScorePayloadNeedsEnrichment(payload)) return enrichmentPartialResult<StockScoreResponse>(payload, status);
  return readyResult(payload as StockScoreResponse, payload, status);
}

export function classifyQuotePayload(payload: ClientApiPayload, status: number): QuoteQueryResult {
  const pending = pendingResult(payload, status);
  if (pending) return pending;
  if (status >= 400 || payload.ok === false) throwStockQueryError(payload, status, "quote_failed");
  return readyResult(payload as StockQuoteResponse, payload, status);
}

function noStoreInit(signal?: AbortSignal): ApiJsonInit {
  return {
    cache: "no-store",
    signal,
  };
}

function readyResult<TData extends ClientApiPayload>(data: TData, payload: ClientApiPayload, status: number): ApiReady<TData> {
  return {
    state: "ready",
    status,
    payload,
    data,
  };
}

function partialResult<TData extends ClientApiPayload>(payload: ClientApiPayload, status: number): ApiPartial<TData> | undefined {
  if (payload.type !== "partial_stock_snapshot") return undefined;
  return {
    state: "partial",
    status,
    payload,
    data: payload as TData,
    pending: pendingResult(objectFromUnknown(payload.pending_snapshot), status),
  };
}

function enrichmentPartialResult<TData extends ClientApiPayload>(payload: ClientApiPayload, status: number): ApiPartial<TData> {
  return {
    state: "partial",
    status,
    payload,
    data: payload as TData,
    pending: pendingResult(enrichmentPendingPayload(payload), 202),
  };
}

function enrichmentPendingPayload(payload: ClientApiPayload): ClientApiPayload {
  const ticker = stringFromUnknown(payload.requested_ticker) || stringFromUnknown(payload.ticker);
  return {
    ok: false,
    error: "snapshot_pending",
    ticker,
    requested_ticker: ticker,
    reason: "pending_enrichment",
    message: "가격 데이터는 먼저 반영했고, 차트와 점수는 확보되는 즉시 조용히 반영합니다.",
    retry_after_seconds: 5,
    refresh_request: { queued: true },
  };
}

function pendingResult(payload: ClientApiPayload | undefined, status: number): ApiPending | undefined {
  if (!payload) return undefined;
  const error = payload?.error;
  if (error !== "snapshot_pending" && error !== "snapshot_unavailable") return undefined;
  const refreshRequest = objectFromUnknown(payload.refresh_request);
  return {
    state: "pending",
    status,
    payload,
    error,
    message: stringFromUnknown(payload.message) || stringFromUnknown(payload.reason) || "확보된 데이터를 화면에 반영합니다.",
    ticker: stringFromUnknown(payload.ticker) || stringFromUnknown(payload.requested_ticker),
    queued: refreshRequest?.queued === true,
    retryAfterSeconds: numberFromUnknown(payload.retry_after_seconds),
  };
}

function unsupportedResult(payload: ClientApiPayload, status: number): ApiUnsupported | undefined {
  if (payload.error !== "technical_unsupported_product") return undefined;
  return {
    state: "unsupported",
    status,
    payload,
    error: "technical_unsupported_product",
    ticker: stringFromUnknown(payload.ticker),
    redirectTo: stringFromUnknown(payload.redirect_to),
  };
}

function cooldownResult(payload: ClientApiPayload, status: number): ApiCooldown<StockQuoteResponse> {
  const cooldown = objectFromUnknown(payload.refresh_cooldown);
  return {
    state: "cooldown",
    status,
    payload,
    data: payload.ok === false ? undefined : payload as StockQuoteResponse,
    message: apiPayloadMessage(payload, "Manual refresh is cooling down."),
    nextAllowedAt: stringFromUnknown(cooldown?.next_allowed_at),
  };
}

function isRefreshCooldownPayload(payload: ClientApiPayload): boolean {
  return payload.error === "refresh_cooldown" || objectFromUnknown(payload.refresh_cooldown) !== undefined;
}

function throwStockQueryError(payload: ClientApiPayload | undefined, status: number, fallback: string): never {
  throw new StockQueryError(errorResult(payload, status, stringFromUnknown(payload?.error) || fallback, apiPayloadMessage(payload || {}, fallback)));
}

function errorResult(payload: ClientApiPayload | undefined, status: number, error: string, message: string): ApiError {
  return {
    state: "error",
    status,
    payload,
    error,
    message,
  };
}

function itemsFromPayload(payload: ClientApiPayload): SymbolSearchItem[] {
  return Array.isArray(payload.items) ? payload.items as SymbolSearchItem[] : [];
}

function objectFromUnknown(value: unknown): ClientApiPayload | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as ClientApiPayload : undefined;
}

function numberFromUnknown(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
