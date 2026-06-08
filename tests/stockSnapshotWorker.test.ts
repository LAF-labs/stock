import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDrainOptions,
  parseWorkerOptions,
  runWorkerLoop,
  runWorkerPass,
} from "../scripts/stock_snapshot_worker";

test("stock snapshot worker defaults to quote and chart lanes without legacy score fallback", () => {
  const options = parseWorkerOptions([], {});

  assert.deepEqual(options.lanes, ["quote", "chart"]);
  assert.equal(options.maxPasses, undefined);
  assert.equal(options.idleSleepMs, 4000);
  assert.equal(options.allowScorePythonFallback, false);
});

test("stock snapshot worker enables score lane only with explicit fallback", () => {
  const options = parseWorkerOptions(["--lanes", "quote,chart,score", "--allow-score-python-fallback", "--once"], {});

  assert.deepEqual(options.lanes, ["quote", "chart", "score"]);
  assert.equal(options.maxPasses, 1);
  assert.equal(options.allowScorePythonFallback, true);
});

test("stock snapshot worker builds kind-specific drain options", () => {
  const worker = parseWorkerOptions(["--worker-id", "worker-a", "--queue-limit", "9", "--queue-lock-seconds", "30"], {});
  const drain = buildDrainOptions("chart", worker);

  assert.equal(drain.mode, "chart");
  assert.equal(drain.workerId, "worker-a:chart");
  assert.equal(drain.queueLimit, 9);
  assert.equal(drain.queueLockSeconds, 30);
  assert.equal(drain.drainQueue, true);
});

test("stock snapshot worker continues other lanes after one lane failure", async () => {
  const drained: string[] = [];
  const result = await runWorkerPass(
    parseWorkerOptions(["--lanes", "quote,chart"], {}),
    {
      config: { url: "https://example.supabase.co", key: "service-role-key" },
      readiness: async () => undefined,
      drain: async (_config, options) => {
        drained.push(options.mode);
        if (options.mode === "quote") throw new Error("quote provider failed");
        return [{ status: "succeeded" }];
      },
      sleep: async () => undefined,
    }
  );

  assert.equal(result.ok, false);
  assert.deepEqual(drained, ["quote", "chart"]);
  assert.equal(result.lanes[0].lane, "quote");
  assert.equal(result.lanes[0].ok, false);
  assert.equal(result.lanes[1].lane, "chart");
  assert.equal(result.lanes[1].ok, true);
});

test("stock snapshot worker loop stops after max passes", async () => {
  let passes = 0;
  const results = await runWorkerLoop(
    parseWorkerOptions(["--once"], {}),
    {
      config: { url: "https://example.supabase.co", key: "service-role-key" },
      pass: async () => {
        passes += 1;
        return { ok: true, lanes: [] };
      },
      sleep: async () => undefined,
    }
  );

  assert.equal(passes, 1);
  assert.equal(results.length, 1);
});
