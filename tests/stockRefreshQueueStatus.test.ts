import assert from "node:assert/strict";
import test from "node:test";

import { parseQueueStatusOptions, refreshQueueStatus } from "../scripts/stock_refresh_queue_status";

test("refresh queue status checks due score job existence without exact counts", async () => {
  const originalFetch = global.fetch;
  let requestedUrl = "";
  global.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify([{ id: "job-score" }]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const payload = await refreshQueueStatus(
      { url: "https://example.supabase.co", key: "service-role-key" },
      { kind: "score", dueOnly: true, json: true, timeoutMs: 1000 },
      new Date("2026-06-06T00:00:00Z")
    );

    assert.equal(payload.queued_jobs, 1);
    assert.equal(payload.should_run, true);
    assert.match(requestedUrl, /kind=eq\.score/);
    assert.match(decodeURIComponent(requestedUrl), /status\.eq\.queued/);
    assert.match(decodeURIComponent(requestedUrl), /run_after\.lte\.2026-06-06T00:00:00\.000Z/);
    assert.match(decodeURIComponent(requestedUrl), /status\.eq\.running/);
    assert.match(decodeURIComponent(requestedUrl), /locked_until\.lt\.2026-06-06T00:00:00\.000Z/);
    assert.match(decodeURIComponent(requestedUrl), /locked_until\.is\.null/);
    assert.doesNotMatch(decodeURIComponent(requestedUrl), /lease_until/);
    assert.doesNotMatch(requestedUrl, /attempts=/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("refresh queue status can check due chart jobs", async () => {
  const originalFetch = global.fetch;
  let requestedUrl = "";
  global.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify([{ id: "job-chart" }]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const payload = await refreshQueueStatus(
      { url: "https://example.supabase.co", key: "service-role-key" },
      { kind: "chart", dueOnly: true, json: true, timeoutMs: 1000 },
      new Date("2026-06-06T00:00:00Z")
    );

    assert.equal(payload.kind, "chart");
    assert.equal(payload.queued_jobs, 1);
    assert.equal(payload.should_run, true);
    assert.match(requestedUrl, /kind=eq\.chart/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("refresh queue status can force execution for manual ticker lists", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () =>
    new Response("[]", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  try {
    const payload = await refreshQueueStatus(
      { url: "https://example.supabase.co", key: "service-role-key" },
      { kind: "score", dueOnly: true, json: true, timeoutMs: 1000, forceIfList: "NVDA,TSLA" },
      new Date("2026-06-06T00:00:00Z")
    );

    assert.equal(payload.queued_jobs, 0);
    assert.equal(payload.forced, true);
    assert.equal(payload.should_run, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test("refresh queue status option parser defaults to score queue checks", () => {
  const options = parseQueueStatusOptions(["--due-only", "--json", "--github-output-key", "run"]);

  assert.equal(options.kind, "score");
  assert.equal(options.dueOnly, true);
  assert.equal(options.json, true);
  assert.equal(options.githubOutputKey, "run");
});

test("refresh queue status option parser accepts chart queue checks", () => {
  const options = parseQueueStatusOptions(["--kind", "chart", "--due-only"]);

  assert.equal(options.kind, "chart");
  assert.equal(options.dueOnly, true);
});
