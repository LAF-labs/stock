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

test("phase 0 records the legacy client pipeline owners before migration", () => {
  const dashboard = componentSource("StockDashboard.tsx");
  const compare = componentSource("StockCompare.tsx");
  const technical = componentSource("TechnicalAnalysisPage.tsx");
  const autocomplete = componentSource("SymbolAutocomplete.tsx");

  assert.match(dashboard, /fetch\s*\(\s*`\/api\/score\?/);
  assert.match(dashboard, /fetch\s*\(\s*`\/api\/quote\?/);
  assert.match(dashboard, /fetch\s*\(\s*["']\/api\/judgment["']/);
  assert.match(dashboard, /latestScoreRef|latestQuoteRef|reloadVersion|FIRST_USEFUL_DATA_DEADLINE_MS/);

  assert.match(compare, /fetch\s*\(\s*`\/api\/score\/batch\?/);
  assert.match(compare, /reloadVersion|FIRST_USEFUL_DATA_DEADLINE_MS|usePendingRetry/);

  assert.match(technical, /fetch\s*\(\s*`\/api\/score\?/);
  assert.match(technical, /quoteRef|reloadVersion|FIRST_USEFUL_DATA_DEADLINE_MS|usePendingRetry/);

  assert.match(autocomplete, /fetch\s*\(\s*`\/api\/symbols\?/);
});

test("no unreviewed stock data owner components are introduced", () => {
  for (const file of serverStateOwners) {
    assert.ok(componentSource(file).length > 0, `${file} should exist`);
  }
});
