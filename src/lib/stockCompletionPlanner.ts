import type { ScoreView } from "@/lib/stockScoreContract";
import { STOCK_REFRESH_PRIORITIES } from "@/lib/stockRefreshPriorities";
import { enqueueStockRefreshJob, type EnqueueStockRefreshInput } from "@/lib/stockRefreshQueue";
import { normalizeTickerRef } from "@/lib/tickerRef";
import type { StockDisplayPartName, StockDisplayPayload, StockDisplayUnavailablePart, StockDisplayView } from "@/lib/stockDisplayTypes";

export type CompletionActionKind = "fetch_quote" | "fetch_chart" | "refresh_score" | "refresh_technical";

export type CompletionAction = {
  kind: CompletionActionKind;
  ticker: string;
  part: StockDisplayPartName;
  priority: number;
  queueKind: "quote" | "chart" | "score";
  scoreView?: ScoreView;
};

export type StockCompletionPlan = {
  ticker: string;
  view: StockDisplayView;
  requiredParts: StockDisplayPartName[];
  presentParts: StockDisplayPartName[];
  missingParts: StockDisplayPartName[];
  recoveringParts: StockDisplayPartName[];
  unavailableParts: StockDisplayUnavailablePart[];
  actions: CompletionAction[];
};

export type StockCompletionInput = {
  ticker: string;
  view: StockDisplayView;
  presentParts?: StockDisplayPartName[];
  requiredParts?: StockDisplayPartName[];
  unavailableParts?: StockDisplayUnavailablePart[];
  providerTimedOutParts?: StockDisplayPartName[];
};

export type CompareCompletionInput = {
  ticker: string;
  presentParts?: StockDisplayPartName[];
  unavailableParts?: StockDisplayUnavailablePart[];
  providerTimedOutParts?: StockDisplayPartName[];
};

const REQUIRED_PARTS_BY_VIEW: Record<StockDisplayView, StockDisplayPartName[]> = {
  detail: ["identity", "price", "chart", "score"],
  technical: ["identity", "price", "chart", "technical"],
  compare: ["identity", "price", "chart", "score"],
};

export function requiredDisplayParts(view: StockDisplayView): StockDisplayPartName[] {
  return [...REQUIRED_PARTS_BY_VIEW[view]];
}

export function planStockDisplayCompletion(input: StockCompletionInput): StockCompletionPlan {
  const ticker = normalizeTickerRef(input.ticker);
  const requiredParts = uniqueParts(input.requiredParts || requiredDisplayParts(input.view));
  const presentParts = uniqueParts(input.presentParts || []);
  const unavailableParts = uniqueUnavailable(input.unavailableParts || []);
  const unavailableSet = new Set(unavailableParts.map((item) => item.part));
  const missingParts = requiredParts.filter((part) => !presentParts.includes(part) && !unavailableSet.has(part));
  const recoveringParts = [...missingParts];
  const actions = uniqueActions(missingParts.flatMap((part) => actionForPart(ticker, input.view, part)));

  return {
    ticker,
    view: input.view,
    requiredParts,
    presentParts,
    missingParts,
    recoveringParts,
    unavailableParts,
    actions,
  };
}

export function planCompareDisplayCompletion(inputs: CompareCompletionInput[]): StockCompletionPlan[] {
  const seen = new Set<string>();
  const plans: StockCompletionPlan[] = [];
  for (const input of inputs) {
    const ticker = normalizeTickerRef(input.ticker);
    if (seen.has(ticker)) continue;
    seen.add(ticker);
    plans.push(planStockDisplayCompletion({ ...input, ticker, view: "compare" }));
  }
  return plans;
}

export function stockCompletionRefreshInput(action: CompletionAction): EnqueueStockRefreshInput {
  if (action.queueKind === "score") {
    return {
      kind: "score",
      ticker: action.ticker,
      view: action.scoreView || "detail",
      priority: action.priority,
      reason: "snapshot_miss",
    };
  }
  return {
    kind: action.queueKind,
    ticker: action.ticker,
    priority: action.priority,
    reason: "snapshot_miss",
  };
}

export function stockCompletionInputFromPayload(
  payload: Pick<StockDisplayPayload, "ticker" | "view" | "completion">,
): StockCompletionInput {
  return {
    ticker: payload.ticker,
    view: payload.view,
    requiredParts: payload.completion.requiredParts,
    presentParts: payload.completion.presentParts,
    unavailableParts: payload.completion.unavailableParts,
  };
}

export function planStockDisplayPayloadCompletion(
  payload: Pick<StockDisplayPayload, "ticker" | "view" | "completion">,
): StockCompletionPlan {
  return planStockDisplayCompletion(stockCompletionInputFromPayload(payload));
}

export function scheduleStockDisplayPayloadCompletion(
  payload: Pick<StockDisplayPayload, "ticker" | "view" | "completion">,
): void {
  scheduleStockDisplayCompletion(planStockDisplayPayloadCompletion(payload));
}

export function scheduleStockDisplayCompletion(plan: StockCompletionPlan): void {
  for (const action of plan.actions) {
    void enqueueStockRefreshJob(stockCompletionRefreshInput(action)).catch(() => undefined);
  }
}

function actionForPart(ticker: string, view: StockDisplayView, part: StockDisplayPartName): CompletionAction[] {
  if (part === "price") {
    return [{
      kind: "fetch_quote",
      ticker,
      part,
      priority: STOCK_REFRESH_PRIORITIES.USER_QUOTE_MISS,
      queueKind: "quote",
    }];
  }
  if (part === "chart") {
    return [{
      kind: "fetch_chart",
      ticker,
      part,
      priority: STOCK_REFRESH_PRIORITIES.USER_CHART_MISS,
      queueKind: "chart",
    }];
  }
  if (part === "score") {
    return [{
      kind: "refresh_score",
      ticker,
      part,
      priority: view === "compare" ? STOCK_REFRESH_PRIORITIES.USER_COMPARE_SCORE_MISS : STOCK_REFRESH_PRIORITIES.USER_DETAIL_SCORE_MISS,
      queueKind: "score",
      scoreView: view === "compare" ? "compare" : "detail",
    }];
  }
  if (part === "technical") {
    return [{
      kind: "refresh_technical",
      ticker,
      part,
      priority: STOCK_REFRESH_PRIORITIES.USER_TECHNICAL_SCORE_MISS,
      queueKind: "score",
      scoreView: "technical",
    }];
  }
  if (part === "fundamentals" || part === "industryBenchmark") {
    return [{
      kind: "refresh_score",
      ticker,
      part,
      priority: view === "compare" ? STOCK_REFRESH_PRIORITIES.USER_COMPARE_SCORE_MISS : STOCK_REFRESH_PRIORITIES.USER_DETAIL_SCORE_MISS,
      queueKind: "score",
      scoreView: view === "compare" ? "compare" : "detail",
    }];
  }
  return [];
}

function uniqueParts(parts: StockDisplayPartName[]): StockDisplayPartName[] {
  const seen = new Set<StockDisplayPartName>();
  return parts.filter((part) => {
    if (seen.has(part)) return false;
    seen.add(part);
    return true;
  });
}

function uniqueUnavailable(parts: StockDisplayUnavailablePart[]): StockDisplayUnavailablePart[] {
  const seen = new Set<StockDisplayPartName>();
  return parts.filter((item) => {
    if (seen.has(item.part)) return false;
    seen.add(item.part);
    return true;
  });
}

function uniqueActions(actions: CompletionAction[]): CompletionAction[] {
  const seen = new Set<string>();
  return actions.filter((action) => {
    const key = `${action.queueKind}:${action.scoreView || ""}:${action.ticker}:${action.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
