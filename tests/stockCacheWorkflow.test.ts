import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflowSource = readFileSync(".github/workflows/publish-stock-snapshots.yml", "utf8");

test("stock cache workflow checks and drains due chart jobs as a bounded backstop", () => {
  const scoreDrainIndex = workflowSource.indexOf("Drain legacy score refresh queue");
  const chartDrainIndex = workflowSource.indexOf("Drain chart refresh queue");

  assert.match(workflowSource, /id:\s*chart_queue/);
  assert.match(workflowSource, /--kind chart/);
  assert.match(workflowSource, /Drain chart refresh queue/);
  assert.match(workflowSource, /steps\.chart_queue\.outputs\.run == '1'/);
  assert.match(workflowSource, /STOCK_CHART_SNAPSHOT_QUEUE_LIMIT/);
  assert.match(workflowSource, /--no-warm-from-demand/);
  assert.match(workflowSource, /if:\s*always\(\) && steps\.chart_queue\.outputs\.run == '1'/);
  assert.doesNotMatch(workflowSource, /STOCK_CHART_WARM_TICKERS/);
  assert.ok(scoreDrainIndex > 0);
  assert.ok(chartDrainIndex > scoreDrainIndex);
});
