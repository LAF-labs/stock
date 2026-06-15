import assert from "node:assert/strict";
import test from "node:test";

import {
  adminTodayWindow,
  summarizeAdminMetrics,
  type AdminPageViewRow,
  type AdminRefreshJobRow,
} from "../src/lib/adminMetrics";

test("adminTodayWindow uses the Seoul calendar day", () => {
  const window = adminTodayWindow(new Date("2026-06-15T16:00:00.000Z"));

  assert.equal(window.dateLabel, "2026-06-16");
  assert.equal(window.startIso, "2026-06-15T15:00:00.000Z");
  assert.equal(window.endIso, "2026-06-16T15:00:00.000Z");
});

test("summarizeAdminMetrics counts visitors, stock views, and queue rows", () => {
  const views: AdminPageViewRow[] = [
    { visitor_key: "a", ticker: "US:KO", occurred_at: "2026-06-16T00:00:00.000Z" },
    { visitor_key: "a", ticker: "US:KO", occurred_at: "2026-06-16T00:01:00.000Z" },
    { visitor_key: "b", ticker: "KR:005930", occurred_at: "2026-06-16T00:02:00.000Z" },
    { visitor_key: "c", ticker: null, occurred_at: "2026-06-16T00:03:00.000Z" },
  ];
  const jobs: AdminRefreshJobRow[] = [
    { id: "1", kind: "quote", market: "US", symbol: "KO", view_mode: null, status: "queued", priority: 50, attempts: 0, max_attempts: 3, run_after: "2026-06-16T00:00:00.000Z", locked_by: null, locked_at: null, last_error: null, created_at: "2026-06-16T00:00:00.000Z", updated_at: "2026-06-16T00:00:00.000Z" },
    { id: "2", kind: "score", market: "KR", symbol: "005930", view_mode: "detail", status: "running", priority: 40, attempts: 1, max_attempts: 3, run_after: "2026-06-16T00:00:00.000Z", locked_by: "worker", locked_at: "2026-06-16T00:04:00.000Z", last_error: null, created_at: "2026-06-16T00:01:00.000Z", updated_at: "2026-06-16T00:04:00.000Z" },
  ];

  const summary = summarizeAdminMetrics(views, jobs);

  assert.equal(summary.todayVisitors, 3);
  assert.equal(summary.todayViews, 4);
  assert.equal(summary.stockViews[0].ticker, "US:KO");
  assert.equal(summary.stockViews[0].views, 2);
  assert.equal(summary.stockViews[0].visitors, 1);
  assert.deepEqual(summary.jobsByStatus, { queued: 1, running: 1 });
});
