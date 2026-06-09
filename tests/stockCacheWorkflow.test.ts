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

test("stock cache workflow prewarms hot technical score snapshots", () => {
  assert.match(workflowSource, /STOCK_SCORE_WARM_TICKERS/);
  assert.match(workflowSource, /STOCK_SCORE_WARM_VIEWS/);
  assert.match(workflowSource, /NVDA,TSLA,GOOGL/);
  assert.match(workflowSource, /005930,000660/);
  assert.match(workflowSource, /--views "\$STOCK_SCORE_WARM_VIEWS"/);
  assert.match(workflowSource, /FORCE_TICKERS="\$\{MANUAL_WARM_TICKERS:-\}"/);
  assert.match(workflowSource, /needs\.market_guard\.outputs\.run/);
  assert.match(workflowSource, /FORCE_TICKERS="\$FORCE_TICKERS,\$STOCK_SCORE_WARM_TICKERS"/);
  assert.match(workflowSource, /--force-if-list "\$FORCE_TICKERS"/);
});
