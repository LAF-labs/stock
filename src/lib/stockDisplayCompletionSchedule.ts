import {
  planStockDisplayPayloadCompletion,
  scheduleStockDisplayCompletion,
  type CompletionScheduleResult,
} from "@/lib/stockCompletionPlanner";
import { safeErrorMessage } from "@/lib/errorSafety";
import type { StockDisplayPayload } from "@/lib/stockDisplayTypes";
import { numericEnv } from "@/lib/supabaseRest";

type ScheduleOutcome =
  | { status: "completed"; results: CompletionScheduleResult[] }
  | { status: "unknown" };

export async function stockDisplayPayloadWithQueueSchedule(payload: StockDisplayPayload): Promise<StockDisplayPayload> {
  const plan = planStockDisplayPayloadCompletion(payload);
  if (!plan.actions.length) {
    return {
      ...payload,
      refresh: {
        ...payload.refresh,
        pollable: false,
        queue: {
          state: "idle",
          attempted: false,
          queuedActions: 0,
          failedActions: 0,
        },
      },
    };
  }

  const outcome = await scheduleWithDeadline(plan);
  if (outcome.status === "unknown") {
    return {
      ...payload,
      refresh: {
        ...payload.refresh,
        queue: {
          state: "unknown",
          attempted: true,
          queuedActions: 0,
          failedActions: 0,
        },
      },
    };
  }

  const queue = queueSummary(outcome.results);
  if (queue.failedActions > 0) {
    console.warn("stock_display_completion_enqueue_partial_failure", {
      ticker: payload.ticker,
      queuedActions: queue.queuedActions,
      failedActions: queue.failedActions,
      failures: queue.failures,
    });
  }

  if (queue.queuedActions === 0 && queue.failedActions > 0) {
    return {
      ...payload,
      completion: {
        ...payload.completion,
        recoveringParts: [],
      },
      refresh: {
        active: false,
        pollable: false,
        staleParts: payload.refresh.staleParts,
        recoveringParts: [],
        queue,
      },
    };
  }

  return {
    ...payload,
    refresh: {
      ...payload.refresh,
      pollable: true,
      queue,
    },
  };
}

async function scheduleWithDeadline(
  plan: ReturnType<typeof planStockDisplayPayloadCompletion>,
): Promise<ScheduleOutcome> {
  const timeoutMs = numericEnv("STOCK_DISPLAY_COMPLETION_QUEUE_DEADLINE_MS", 400);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      scheduleStockDisplayCompletion(plan).then((results): ScheduleOutcome => ({ status: "completed", results })),
      new Promise<ScheduleOutcome>((resolve) => {
        timer = setTimeout(() => resolve({ status: "unknown" }), timeoutMs);
      }),
    ]);
  } catch (error) {
    console.warn("stock_display_completion_schedule_failed", { ticker: plan.ticker, error: safeErrorMessage(error) });
    return { status: "completed", results: plan.actions.map((action) => ({ action, queued: false, reason: "enqueue_failed" })) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function queueSummary(results: CompletionScheduleResult[]): NonNullable<StockDisplayPayload["refresh"]["queue"]> {
  const failures = results
    .filter((result) => !result.queued)
    .map((result) => ({
      part: result.action.part,
      reason: result.reason || "enqueue_failed",
    }));
  return {
    state: failures.length === results.length ? "unavailable" : "queued",
    attempted: true,
    queuedActions: results.filter((result) => result.queued).length,
    failedActions: failures.length,
    ...(failures.length ? { failures } : {}),
  };
}
