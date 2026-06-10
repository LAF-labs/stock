import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const componentSource = (file: string) => readFileSync(join(process.cwd(), "src/components", file), "utf8");

const serverStateOwners = [
  "StockDashboard.tsx",
  "StockCompare.tsx",
  "TechnicalAnalysisPage.tsx",
  "SymbolAutocomplete.tsx",
];

const presentationalComponents = [
  "StockHeader.tsx",
  "StockDetailSections.tsx",
  "TechnicalAnalysisSections.tsx",
  "TechnicalOverlayChart.tsx",
];

test("presentational stock components do not own stock API fetches or query hooks", () => {
  for (const file of presentationalComponents) {
    const source = componentSource(file);
    assert.doesNotMatch(source, /fetch\s*\(\s*[`"']\/api\/(?:score|quote|symbols|judgment)/, `${file} must not fetch stock APIs`);
    assert.doesNotMatch(source, /\buse(Query|Mutation)\b|queryOptions|stockQueryKeys/, `${file} must stay presentational`);
  }
});

test("detail dashboard uses the TanStack query pipeline instead of legacy fetch state", () => {
  const dashboard = componentSource("StockDashboard.tsx");

  assert.doesNotMatch(dashboard, /fetch\s*\(\s*`\/api\/score\?/, "detail dashboard must not fetch score directly");
  assert.doesNotMatch(dashboard, /fetch\s*\(\s*`\/api\/quote\?/, "detail dashboard must not fetch quote directly");
  assert.doesNotMatch(dashboard, /fetch\s*\(\s*["']\/api\/judgment["']/, "detail dashboard must not post judgment directly");
  assert.doesNotMatch(
    dashboard,
    /latestScoreRef|latestQuoteRef|reloadVersion|FIRST_USEFUL_DATA_DEADLINE_MS|readDashboardClientCache|rememberDashboardClientCache|usePendingRetry/,
    "detail dashboard must not keep legacy cache/retry/ref state",
  );
  assert.match(dashboard, /useStockDashboardQueries/, "detail dashboard should delegate server state to the query adapter");
});

test("technical analysis page uses the TanStack query pipeline instead of legacy fetch state", () => {
  const technical = componentSource("TechnicalAnalysisPage.tsx");

  assert.doesNotMatch(technical, /fetch\s*\(\s*`\/api\/score\?/, "technical page must not fetch technical score directly");
  assert.doesNotMatch(technical, /fetch\s*\(\s*`\/api\/quote\?/, "technical page must not fetch quote directly");
  assert.doesNotMatch(
    technical,
    /quoteRef|reloadVersion|FIRST_USEFUL_DATA_DEADLINE_MS|usePendingRetry|readClientApiPayload|apiPayloadMessage/,
    "technical page must not keep legacy cache/retry/ref state",
  );
  assert.match(technical, /useTechnicalAnalysisQueries/, "technical page should delegate server state to the query adapter");
});

test("remaining phase 5 legacy client pipeline owners are recorded before migration", () => {
  const compare = componentSource("StockCompare.tsx");
  const autocomplete = componentSource("SymbolAutocomplete.tsx");

  assert.match(compare, /fetch\s*\(\s*`\/api\/score\/batch\?/);
  assert.match(compare, /reloadVersion|FIRST_USEFUL_DATA_DEADLINE_MS|usePendingRetry/);

  assert.match(autocomplete, /fetch\s*\(\s*`\/api\/symbols\?/);
});

test("no unreviewed stock data owner components are introduced", () => {
  for (const file of serverStateOwners) {
    assert.ok(componentSource(file).length > 0, `${file} should exist`);
  }
});
