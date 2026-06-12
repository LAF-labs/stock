import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflowSource = readFileSync(".github/workflows/publish-stock-snapshots.yml", "utf8");

test("stock cache workflow checks and drains due chart jobs as a bounded backstop", () => {
  const scoreBlock = workflowSource.split("\n  score:", 2)[1].split("\n  chart:", 1)[0];
  const chartBlock = workflowSource.split("\n  chart:", 2)[1];

  assert.doesNotMatch(scoreBlock, /Drain chart refresh queue/);
  assert.match(chartBlock, /needs: market_guard/);
  assert.match(chartBlock, /if: always\(\)/);
  assert.match(chartBlock, /id:\s*chart_queue/);
  assert.match(chartBlock, /--kind chart/);
  assert.match(chartBlock, /Drain chart refresh queue/);
  assert.match(chartBlock, /steps\.chart_queue\.outputs\.run == '1'/);
  assert.match(chartBlock, /STOCK_CHART_SNAPSHOT_QUEUE_LIMIT/);
  assert.match(chartBlock, /--no-warm-from-demand/);
  assert.match(chartBlock, /if:\s*steps\.chart_queue\.outputs\.run == '1'/);
  assert.doesNotMatch(workflowSource, /STOCK_CHART_WARM_TICKERS/);
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

test("stock cache workflow plans SLA target jobs before stale backstops", () => {
  const quoteBlock = workflowSource.split("\n  quote:", 2)[1].split("\n  score:", 1)[0];
  const scoreBlock = workflowSource.split("\n  score:", 2)[1].split("\n  chart:", 1)[0];
  const chartBlock = workflowSource.split("\n  chart:", 2)[1];

  assert.match(quoteBlock, /STOCK_REFRESH_PLANNER_QUOTE_LIMIT/);
  assert.match(quoteBlock, /Plan quote refresh target jobs/);
  assert.match(quoteBlock, /node --import tsx scripts\/plan_stock_refresh_jobs\.ts/);
  assert.match(quoteBlock, /--kind quote/);
  assert.ok(quoteBlock.indexOf("Plan quote refresh target jobs") < quoteBlock.indexOf("Enqueue stale quote refresh jobs"));

  assert.match(scoreBlock, /STOCK_REFRESH_PLANNER_SCORE_LIMIT/);
  assert.match(scoreBlock, /Plan score refresh target jobs/);
  assert.ok(scoreBlock.indexOf("Plan score refresh target jobs") < scoreBlock.indexOf("Enqueue stale score snapshot refresh jobs"));

  assert.match(chartBlock, /STOCK_REFRESH_PLANNER_CHART_LIMIT/);
  assert.match(chartBlock, /Plan chart refresh target jobs/);
  assert.ok(chartBlock.indexOf("Plan chart refresh target jobs") < chartBlock.indexOf("Check due chart refresh jobs"));
});
