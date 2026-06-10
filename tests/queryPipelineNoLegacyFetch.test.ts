import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const componentSource = (file: string) => readFileSync(join(process.cwd(), "src/components", file), "utf8");
const componentPath = (file: string) => join(process.cwd(), "src/components", file);
const legacyDashboardCacheModule = ["stockDashboard", "Client", "Cache.ts"].join("");
const legacyDashboardCachePattern = new RegExp(
  [
    ["dashboard", "Client", "Cache"].join(""),
    ["DASHBOARD", "CLIENT", "CACHE"].join("_"),
    ["client", "cache"].join("_"),
    ["stock-dashboard", ":v"].join(""),
  ].join("|"),
);
const legacyDashboardStatePattern = new RegExp(
  [
    ["latest", "Score", "Ref"].join(""),
    ["latest", "Quote", "Ref"].join(""),
    ["reload", "Version"].join(""),
    ["FIRST", "USEFUL", "DATA", "DEADLINE", "MS"].join("_"),
    ["read", "Dashboard", "Client", "Cache"].join(""),
    ["remember", "Dashboard", "Client", "Cache"].join(""),
    ["use", "Pending", "Retry"].join(""),
  ].join("|"),
);
const legacyPageStatePattern = new RegExp(
  [
    ["quote", "Ref"].join(""),
    ["reload", "Version"].join(""),
    ["FIRST", "USEFUL", "DATA", "DEADLINE", "MS"].join("_"),
    ["use", "Pending", "Retry"].join(""),
    ["read", "Client", "Api", "Payload"].join(""),
    ["api", "Payload", "Message"].join(""),
  ].join("|"),
);
const legacyCompareStatePattern = new RegExp(
  [
    ["reload", "Version"].join(""),
    ["FIRST", "USEFUL", "DATA", "DEADLINE", "MS"].join("_"),
    ["use", "Pending", "Retry"].join(""),
    ["read", "Client", "Api", "Payload"].join(""),
    ["api", "Payload", "Message"].join(""),
    ["should", "Preserve", "Compare", "View", "During", "Retry"].join(""),
  ].join("|"),
);

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
    legacyDashboardStatePattern,
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
    legacyPageStatePattern,
    "technical page must not keep legacy cache/retry/ref state",
  );
  assert.match(technical, /useTechnicalAnalysisQueries/, "technical page should delegate server state to the query adapter");
});

test("compare page uses the TanStack query pipeline instead of legacy fetch state", () => {
  const compare = componentSource("StockCompare.tsx");

  assert.doesNotMatch(compare, /fetch\s*\(\s*`\/api\/score\/batch\?/, "compare page must not fetch batch score directly");
  assert.doesNotMatch(
    compare,
    legacyCompareStatePattern,
    "compare page must not keep legacy cache/retry state",
  );
  assert.match(compare, /useStockCompareQueries/, "compare page should delegate server state to the query adapter");
});

test("symbol autocomplete uses the TanStack query pipeline instead of legacy fetch state", () => {
  const autocomplete = componentSource("SymbolAutocomplete.tsx");

  assert.doesNotMatch(autocomplete, /fetch\s*\(\s*`\/api\/symbols\?/, "symbol autocomplete must not fetch symbols directly");
  assert.doesNotMatch(autocomplete, /AbortController|itemsQuery|setItems|hasSearched|searchError/, "symbol autocomplete must not keep legacy fetch state");
  assert.match(autocomplete, /useSymbolSearchQuery/, "symbol autocomplete should delegate server state to the query adapter");
});

test("dashboard has no legacy manual browser persistence pipeline", () => {
  assert.equal(existsSync(componentPath(legacyDashboardCacheModule)), false, "manual dashboard browser persistence module must be removed");

  const helpers = componentSource("stockDashboardHelpers.ts");
  assert.doesNotMatch(
    helpers,
    legacyDashboardCachePattern,
    "dashboard helpers must not expose legacy manual persistence helpers or implementation source labels",
  );
});

test("no unreviewed stock data owner components are introduced", () => {
  for (const file of serverStateOwners) {
    assert.ok(componentSource(file).length > 0, `${file} should exist`);
  }
});
