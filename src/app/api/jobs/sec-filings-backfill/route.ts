import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { backfillSecFilings } from "@/lib/secFilingBackfillRunner";
import {
  nextSecFilingBackfillState,
  readOrCreateSecFilingBackfillState,
  secFilingBackfillPublicError,
  stateIsLocked,
  usBackfillTickers,
  writeSecFilingBackfillState,
  type SecFilingBackfillState,
} from "@/lib/secFilingBackfillJob";
import { envValue, numericEnv } from "@/lib/supabaseRest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  return runBackfillJob(request);
}

export async function POST(request: NextRequest) {
  return runBackfillJob(request);
}

async function runBackfillJob(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const jobId = searchParams.get("job") || "default";
  const state = await readOrCreateSecFilingBackfillState({
    jobId,
    since: envValue("SEC_FILINGS_BACKFILL_SINCE"),
    batchSize: bounded(numericEnv("SEC_FILINGS_BACKFILL_BATCH_SIZE", 40), 1, 120),
    maxFilingsPerTicker: bounded(numericEnv("SEC_FILINGS_BACKFILL_MAX_FILINGS_PER_TICKER", 80), 1, 200),
    fetchDocLimit: bounded(numericEnv("SEC_FILINGS_BACKFILL_FETCH_DOC_LIMIT", 40), 0, 120),
  });

  if (state.status === "completed") {
    return NextResponse.json({ ok: true, status: "completed", state }, { status: 200 });
  }

  if (stateIsLocked(state)) {
    return NextResponse.json({ ok: true, status: "locked", state }, { status: 200 });
  }

  const tickers = usBackfillTickers().slice(state.cursor, state.cursor + state.batchSize);
  if (!tickers.length) {
    const completed = {
      ...state,
      status: "completed" as const,
      processedTickers: state.totalTickers,
      cursor: state.totalTickers,
      lockedBy: undefined,
      lockedUntil: undefined,
      completedAt: new Date().toISOString(),
    };
    await writeSecFilingBackfillState(completed);
    return NextResponse.json({ ok: true, status: "completed", state: completed }, { status: 200 });
  }

  const now = new Date();
  const lockedState: SecFilingBackfillState = {
    ...state,
    status: "running",
    lockedBy: `vercel-${randomUUID()}`,
    lockedUntil: new Date(now.getTime() + 4 * 60 * 1000).toISOString(),
    lastError: undefined,
    startedAt: state.startedAt || now.toISOString(),
  };
  await writeSecFilingBackfillState(lockedState);

  try {
    const result = await backfillSecFilings({
      allUs: false,
      tickers,
      since: lockedState.since,
      limitTickers: 0,
      maxFilingsPerTicker: lockedState.maxFilingsPerTicker,
      fetchDocLimit: lockedState.fetchDocLimit,
      json: true,
      dryRun: false,
    });
    const nextState = nextSecFilingBackfillState(lockedState, result, tickers.length, new Date().toISOString());
    await writeSecFilingBackfillState(nextState);
    return NextResponse.json({
      ok: true,
      status: nextState.status,
      batch: {
        start: state.cursor,
        count: tickers.length,
        rows: result.rows,
        skipped: result.skipped,
        docFetches: result.doc_fetches,
        companyFactsFetches: result.company_facts_fetches,
      },
      state: nextState,
    }, { status: 200 });
  } catch (error) {
    const failedState: SecFilingBackfillState = {
      ...lockedState,
      status: "queued",
      lockedBy: undefined,
      lockedUntil: undefined,
      lastError: secFilingBackfillPublicError(error),
    };
    await writeSecFilingBackfillState(failedState).catch(() => undefined);
    return NextResponse.json({ ok: false, error: failedState.lastError, state: failedState }, { status: 500 });
  }
}

function authorized(request: NextRequest): boolean {
  const secrets = [envValue("SEC_FILINGS_JOB_SECRET"), envValue("CRON_SECRET")].filter(Boolean);
  if (!secrets.length) return process.env.NODE_ENV !== "production";
  const candidate = request.headers.get("x-refresh-secret") || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(candidate && secrets.includes(candidate));
}

function bounded(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}
