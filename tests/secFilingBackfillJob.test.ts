import test from "node:test";
import assert from "node:assert/strict";

import {
  nextSecFilingBackfillState,
  stateIsLocked,
  type SecFilingBackfillState,
} from "../src/lib/secFilingBackfillJob";

test("sec filing backfill state advances cursor and keeps job queued", () => {
  const state = baseState({ cursor: 40, processedTickers: 40, rowsUpserted: 10 });

  const next = nextSecFilingBackfillState(
    state,
    { tickers: 40, rows: 12, skipped: 2, doc_fetches: 5, company_facts_fetches: 3 },
    40,
    "2026-06-15T00:00:00.000Z"
  );

  assert.equal(next.status, "queued");
  assert.equal(next.cursor, 80);
  assert.equal(next.processedTickers, 80);
  assert.equal(next.rowsUpserted, 22);
  assert.equal(next.skippedTickers, 2);
  assert.equal(next.docFetches, 5);
  assert.equal(next.companyFactsFetches, 3);
  assert.equal(next.lockedBy, undefined);
  assert.equal(next.lockedUntil, undefined);
  assert.equal(next.completedAt, undefined);
});

test("sec filing backfill state marks completion on final batch", () => {
  const next = nextSecFilingBackfillState(
    baseState({ cursor: 80, processedTickers: 80, totalTickers: 100, status: "running" }),
    { tickers: 20, rows: 7, skipped: 1, doc_fetches: 2, company_facts_fetches: 2 },
    20,
    "2026-06-15T00:10:00.000Z"
  );

  assert.equal(next.status, "completed");
  assert.equal(next.cursor, 100);
  assert.equal(next.processedTickers, 100);
  assert.equal(next.completedAt, "2026-06-15T00:10:00.000Z");
});

test("sec filing backfill lock only blocks unexpired running jobs", () => {
  assert.equal(
    stateIsLocked(baseState({ status: "running", lockedUntil: "2026-06-15T00:10:00.000Z" }), Date.parse("2026-06-15T00:05:00.000Z")),
    true
  );
  assert.equal(
    stateIsLocked(baseState({ status: "running", lockedUntil: "2026-06-15T00:10:00.000Z" }), Date.parse("2026-06-15T00:15:00.000Z")),
    false
  );
  assert.equal(
    stateIsLocked(baseState({ status: "queued", lockedUntil: "2026-06-15T00:10:00.000Z" }), Date.parse("2026-06-15T00:05:00.000Z")),
    false
  );
});

function baseState(overrides: Partial<SecFilingBackfillState> = {}): SecFilingBackfillState {
  return {
    jobId: "default",
    status: "queued",
    since: "2025-06-15",
    cursor: 0,
    totalTickers: 100,
    batchSize: 40,
    maxFilingsPerTicker: 80,
    fetchDocLimit: 40,
    processedTickers: 0,
    rowsUpserted: 0,
    skippedTickers: 0,
    docFetches: 0,
    companyFactsFetches: 0,
    startedAt: "2026-06-15T00:00:00.000Z",
    ...overrides,
  };
}
