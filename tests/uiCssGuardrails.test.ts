import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
const designTokensCss = readFileSync(join(process.cwd(), "src/styles/design-tokens.css"), "utf8");
const dashboardSource = readFileSync(join(process.cwd(), "src/components/StockDashboard.tsx"), "utf8");
const compareSource = readFileSync(join(process.cwd(), "src/components/StockCompare.tsx"), "utf8");
const autocompleteSource = readFileSync(join(process.cwd(), "src/components/SymbolAutocomplete.tsx"), "utf8");
const symbolSearchHookSource = readFileSync(join(process.cwd(), "src/components/useSymbolSearchQuery.ts"), "utf8");
const stockDetailSectionsSource = readFileSync(join(process.cwd(), "src/components/StockDetailSections.tsx"), "utf8");
const loadingSkeletonSource = readFileSync(join(process.cwd(), "src/components/StockLoadingSkeletons.tsx"), "utf8");
const compareRouteSource = readFileSync(join(process.cwd(), "src/app/compare/page.tsx"), "utf8");
const technicalRouteSource = readFileSync(join(process.cwd(), "src/app/technical/page.tsx"), "utf8");
const marketCapSource = readFileSync(join(process.cwd(), "src/components/MarketCapDashboard.tsx"), "utf8");
const marketCapHookSource = readFileSync(join(process.cwd(), "src/components/useMarketCapDashboardQuery.ts"), "utf8");
const marketCapHelperSource = readFileSync(join(process.cwd(), "src/components/marketCapDashboardHelpers.ts"), "utf8");
const appNavigationSource = readFileSync(join(process.cwd(), "src/components/AppNavigationMenu.tsx"), "utf8");
const appNavigationLinksSource = readFileSync(join(process.cwd(), "src/components/AppNavigationLinks.tsx"), "utf8");
const searchChromeSource = readFileSync(join(process.cwd(), "src/components/SearchChromeWithNavigation.tsx"), "utf8");
const collapsibleSearchChromeSource = readFileSync(join(process.cwd(), "src/components/useCollapsibleSearchChrome.ts"), "utf8");

function lastCssDeclaration(selector: string, property: string): string | undefined {
  let value: string | undefined;
  const rulePattern = /([^{}]+)\s*\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = rulePattern.exec(css))) {
    const selectors = match[1].split(",").map((item) => item.trim().replace(/\s+/g, " "));
    if (!selectors.includes(selector)) continue;
    for (const declaration of match[2].split(";")) {
      const [rawName, ...rawValueParts] = declaration.split(":");
      if (rawName?.trim() === property) {
        value = rawValueParts.join(":").trim();
      }
    }
  }
  return value;
}

const semanticRootAliases: Record<string, string> = {
  "--bg": "var(--color-app-bg)",
  "--surface": "var(--color-surface)",
  "--surface-soft": "var(--color-surface-subtle)",
  "--surface-accent": "var(--color-surface-accent)",
  "--text": "var(--color-text-primary)",
  "--subtext": "var(--color-text-secondary)",
  "--muted": "var(--color-text-muted)",
  "--line": "var(--color-border)",
  "--line-strong": "var(--color-border-strong)",
  "--accent": "var(--color-accent)",
  "--accent-strong": "var(--color-accent-strong)",
  "--accent-soft": "var(--color-accent-soft)",
  "--red": "var(--color-negative)",
  "--down": "var(--color-accent)",
  "--focus": "var(--color-accent)",
};

test("visited link color is scoped to news links", () => {
  assert.doesNotMatch(css, /(^|})\s*a:visited\s*\{/);
  assert.match(css, /\.news-list\s+a:visited\s*\{[\s\S]*?color:\s*#6b4eff;/);
});

test("desktop index layouts use centered grid containers", () => {
  assert.doesNotMatch(
    css,
    /--detail-index-left|--detail-content-left|--compare-side-left|--compare-content-left|calc\(50vw - 600px\)/,
  );
  assert.match(css, /\.stock-detail-app\.has-detail-context\s*\{[\s\S]*?grid-template-columns:\s*184px minmax\(0, 1fr\);/);
  assert.doesNotMatch(css, /\.compare-app\s*\{[^}]*grid-template-columns:\s*184px minmax\(0, 1fr\);/);
  assert.match(css, /\.app-desktop-nav\s*\{[\s\S]*?position:\s*sticky;[\s\S]*?top:\s*12px;/);
});

test("font weights stay on supported tiers", () => {
  assert.doesNotMatch(css, /font-weight:\s*(?:550|650|750|760|780|790|820)\b/);
});

test("first-screen display typography uses a calmer scale", () => {
  assert.match(css, /\/\* Typography density refinement \*\//);
  assert.match(css, /\.stock-detail-app \.stock-name-row h2\s*\{[\s\S]*?font-size:\s*42px;[\s\S]*?font-weight:\s*600;/);
  assert.match(css, /\.stock-detail-app \.price-block strong\s*\{[\s\S]*?font-size:\s*36px;[\s\S]*?font-weight:\s*600;/);
  assert.match(css, /\.compare-app \.compare-hero h1\s*\{[\s\S]*?font-size:\s*30px;[\s\S]*?font-weight:\s*600;/);
  assert.match(css, /\.compare-score-tile strong\s*\{[\s\S]*?font-size:\s*24px;[\s\S]*?font-weight:\s*600;/);
  assert.match(css, /\.technical-analysis-app \.technical-hero-heading h1\s*\{[\s\S]*?font-size:\s*36px;[\s\S]*?font-weight:\s*600;/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.stock-detail-app \.stock-name-row h2\s*\{[\s\S]*?font-size:\s*30px;/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.compare-app \.compare-hero h1\s*\{[\s\S]*?font-size:\s*26px;/);
});

test("primary CTA styles use shared tokens instead of black overrides", () => {
  assert.match(css, /--cta-primary-bg:\s*var\(--accent\);/);
  assert.match(css, /\.technical-analysis-link\s*\{[\s\S]*?background:\s*var\(--cta-secondary-bg\);/);
  assert.doesNotMatch(css, /\.technical-analysis-link\s*\{[\s\S]*?background:\s*#111827;/);
});

test("design system foundation tokens are role based and imported first", () => {
  assert.equal(css.startsWith('@import "../styles/design-tokens.css";'), true);
  assert.match(designTokensCss, /--color-app-bg:\s*#f5f7fa;/);
  assert.match(designTokensCss, /--color-surface:\s*#ffffff;/);
  assert.match(designTokensCss, /--color-text-primary:\s*#191f28;/);
  assert.match(designTokensCss, /--color-accent:\s*#2878f0;/);
  assert.match(designTokensCss, /--space-4:\s*16px;/);
  assert.match(designTokensCss, /--radius-pill:\s*999px;/);
  assert.match(designTokensCss, /--control-height-lg:\s*56px;/);
  assert.match(designTokensCss, /--motion-standard:\s*180ms cubic-bezier\(0\.22, 1, 0\.36, 1\);/);
  assert.match(designTokensCss, /--bg:\s*var\(--color-app-bg\);/);
  assert.match(designTokensCss, /--surface:\s*var\(--color-surface\);/);

  const seenAliases = new Set<string>();
  const rootBlocks = Array.from(css.matchAll(/:root\s*\{([^{}]*)\}/g));
  assert.ok(rootBlocks.length > 0);
  rootBlocks.forEach((rootBlock, rootIndex) => {
    for (const declaration of rootBlock[1].split(";")) {
      const [rawName, ...rawValueParts] = declaration.split(":");
      const name = rawName?.trim();
      if (!name || !(name in semanticRootAliases)) continue;
      const value = rawValueParts.join(":").trim();
      seenAliases.add(name);
      assert.equal(value, semanticRootAliases[name], `${name} in :root block ${rootIndex + 1}`);
    }
  });
  for (const alias of Object.keys(semanticRootAliases)) {
    assert.equal(seenAliases.has(alias), true, `${alias} is declared in a :root block`);
  }
});

test("mobile stock summary prioritizes judgment and compact score cards", () => {
  assert.match(css, /\.stock-detail-app \.hero-verdict\s*\{[\s\S]*?order:\s*3;/);
  assert.match(css, /\.stock-detail-app \.quick-read\s*\{[\s\S]*?order:\s*4;[\s\S]*?grid-template-columns:\s*1fr;/);
  assert.match(css, /\.stock-detail-app \.quick-read article,[\s\S]*?\.stock-detail-app \.quick-read \.score-panel\s*\{[\s\S]*?grid-column:\s*1;/);
  assert.match(css, /\.stock-detail-app \.quick-read article\.quick-metric-card\s*\{[\s\S]*?grid-column:\s*1;/);
  assert.match(css, /\.stock-detail-app \.quick-read \.quality-score-panel\s*\{[\s\S]*?order:\s*1;/);
  assert.match(css, /\.stock-detail-app \.quick-read \.opportunity-panel\s*\{[\s\S]*?order:\s*2;/);
  assert.match(css, /\.stock-detail-app \.score-donut\s*\{[\s\S]*?width:\s*64px;[\s\S]*?height:\s*64px;/);
});

test("home screen has no old default ticker fallback and renders animated landing", () => {
  assert.doesNotMatch(dashboardSource, /searchParams\.get\("ticker"\)\s*\|\|\s*"US:KO"/);
  assert.doesNotMatch(dashboardSource, /tickerParam\s*\|\|\s*"US:KO"/);
  assert.match(dashboardSource, /dashboardTickerFromSearchParam\(searchParams\.get\("ticker"\)\)/);
  assert.match(dashboardSource, /!tickerParam && <DashboardLandingHero \/>/);
  assert.match(css, /\.dashboard-landing-hero\s*\{/);
  assert.match(css, /@keyframes landing-orbit/);
  assert.match(css, /@keyframes landing-pulse/);
});

test("compare and technical routes do not invent a default stock selection", () => {
  assert.doesNotMatch(compareSource, /tickers\[0\]\s*\|\|\s*"US:KO"/);
  assert.doesNotMatch(compareSource, /encodeURIComponent\(baseTicker\)[\s\S]*"US:KO"/);
  assert.doesNotMatch(compareRouteSource, /parseTickers\([\s\S]*\|\|\s*"KO"/);
  assert.match(compareRouteSource, /buildInitialComparePayloads/);
  assert.match(compareRouteSource, /view: "compare"/);
  assert.match(compareSource, /비교할 종목을 검색해서 추가해주세요/);
  assert.doesNotMatch(technicalRouteSource, /firstParam\(params\?\.ticker\)\s*\|\|\s*"US:KO"/);
  assert.match(technicalRouteSource, /if \(!rawTicker\) \{\s*redirect\("\/"\);/);
});

test("landing hero has four scrollable headline sections and a seamless stock loop", () => {
  const storyMatches = dashboardSource.match(/className="landing-story-section/g) || [];
  const proofMatches = dashboardSource.match(/className="landing-proof-list"/g) || [];
  assert.equal(storyMatches.length, 4);
  assert.equal(proofMatches.length, 4);
  assert.match(dashboardSource, /<h2>종목만 입력하세요<\/h2>[\s\S]*<h2>종목 정보 확인<\/h2>[\s\S]*<h2>기술적 분석<\/h2>[\s\S]*<h2>종목별 비교<\/h2>/);
  assert.match(dashboardSource, /한글 종목명·해외 티커[\s\S]*시총·섹터·재무[\s\S]*추세·변동성·신호[\s\S]*후보를 나란히 비교/);
  assert.match(css, /\.dashboard-landing\s*\{/);
  assert.match(css, /\.landing-story-section\s*\{/);
  assert.match(css, /\.landing-proof-list\s*\{/);
  assert.match(css, /\.landing-visual\s*\{[\s\S]*?min-height:\s*300px;/);
  assert.match(css, /@media \(min-width: 900px\)[\s\S]*?\.landing-visual\s*\{[\s\S]*?min-height:\s*340px;/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.landing-visual\s*\{[\s\S]*?min-height:\s*280px;/);
  assert.match(css, /@keyframes landing-info-orbit/);
  assert.match(css, /@keyframes landing-chart-sweep/);
  assert.match(css, /@keyframes landing-compare-glow/);
  assert.match(dashboardSource, /기술적 분석/);
  assert.match(dashboardSource, /종목별 비교/);
  assert.match(dashboardSource, /<span>NVDA<\/span>[\s\S]*<span>애플<\/span>[\s\S]*<span>TSLA<\/span>[\s\S]*<span>엔비디아<\/span>/);
  assert.match(dashboardSource, /<span>삼성전자<\/span>[\s\S]*<span>SK하이닉스<\/span>[\s\S]*<span>현대차<\/span>[\s\S]*<span>네이버<\/span>/);
  assert.match(dashboardSource, /className="landing-loop-group"[\s\S]*className="landing-loop-group" aria-hidden="true"/);
  assert.match(css, /--landing-loop-distance:\s*50%;/);
  assert.match(css, /translateX\(calc\(-1 \* var\(--landing-loop-distance\)\)\)/);
  assert.match(css, /\.landing-loop-window\s*\{[\s\S]*?mask-image:\s*linear-gradient\(90deg, transparent 0, #000 22px, #000 calc\(100% - 22px\), transparent 100%\);/);
});

test("home search is a floating pill that collapses to a compact text pill", () => {
  assert.match(dashboardSource, /SearchChromeWithNavigation/);
  assert.match(dashboardSource, /useCollapsibleSearchChrome/);
  assert.match(collapsibleSearchChromeSource, /isCollapsed/);
  assert.match(collapsibleSearchChromeSource, /isExpanding/);
  assert.match(collapsibleSearchChromeSource, /searchExpandTimerRef/);
  assert.match(collapsibleSearchChromeSource, /search-expanding/);
  assert.match(dashboardSource, /variant="floating"/);
  assert.match(dashboardSource, /onExpandRequest/);
  assert.match(collapsibleSearchChromeSource, /scrollY/);
  assert.match(autocompleteSource, /function SearchIcon/);
  assert.match(autocompleteSource, /type=\{isCollapsed \? "button" : "submit"\}/);
  assert.match(autocompleteSource, /onPointerDown=\{isCollapsed \? onFloatingPointerDown : undefined\}/);
  assert.match(autocompleteSource, /formAction/);
  assert.match(autocompleteSource, /inputName/);
  assert.match(autocompleteSource, /variant === "floating"/);
  assert.match(dashboardSource, /formAction="\/"/);
  assert.match(dashboardSource, /inputName="ticker"/);
  assert.match(collapsibleSearchChromeSource, /delta > 0/);
  assert.match(collapsibleSearchChromeSource, /delta < 0/);
  assert.doesNotMatch(dashboardSource, /delta > 8/);
  assert.doesNotMatch(dashboardSource, /delta < -24/);
  assert.match(css, /\.stock-search-form\.symbol-autocomplete-floating\s*\{[\s\S]*?border-radius:\s*999px;/);
  assert.match(css, /\.stock-search-form\.symbol-autocomplete-floating\.is-collapsed\s*\{[\s\S]*?width:\s*56px;/);
  assert.match(css, /\.stock-search-form\.symbol-autocomplete-floating\.is-collapsed input\s*\{[\s\S]*?opacity:\s*0;/);
  assert.match(css, /\.stock-search-form\.symbol-autocomplete-floating\.is-collapsed \.symbol-search-action\s*\{[\s\S]*?border-radius:\s*50%;/);
});

test("home floating search has one clean white surface without a blue wrapper", () => {
  const stockSearchRule = css.match(/\.stock-search\s*\{([^}]*)\}/)?.[1] || "";
  const floatingBoxRule = css.match(/\.stock-search-form\.symbol-autocomplete-floating \.symbol-search-box\s*\{([^}]*)\}/)?.[1] || "";
  const floatingActionRule = css.match(/\.stock-search-form\.symbol-autocomplete-floating \.symbol-search-action\s*\{([^}]*)\}/)?.[1] || "";
  const suggestionsRule = css.match(/(?:^|\n)\.symbol-suggestions\s*\{([^}]*)\}/)?.[1] || "";

  assert.match(stockSearchRule, /background:\s*transparent;/);
  assert.doesNotMatch(stockSearchRule, /linear-gradient/);
  assert.match(floatingBoxRule, /border:\s*1px solid rgba\(15,\s*23,\s*42,\s*0\.06\);/);
  assert.match(floatingBoxRule, /background:\s*#fff;/);
  assert.doesNotMatch(floatingBoxRule, /rgba\(49,\s*130,\s*246/);
  assert.match(floatingActionRule, /background:\s*#f7f8fa;/);
  assert.doesNotMatch(floatingActionRule, /rgba\(49,\s*130,\s*246/);
  assert.match(suggestionsRule, /background:\s*#fff;/);
  assert.doesNotMatch(suggestionsRule, /rgba\(255,\s*255,\s*255,\s*0\./);
});

test("symbol autocomplete shows local suggestions before debounced server search", () => {
  assert.match(symbolSearchHookSource, /getClientSymbolSearchIndex/);
  assert.match(symbolSearchHookSource, /searchSymbolIndex/);
  assert.match(symbolSearchHookSource, /localItems/);
  assert.match(symbolSearchHookSource, /mergeSymbolItems/);
  assert.doesNotMatch(symbolSearchHookSource, /const visibleItems = canFetchCurrentQuery && resultQuery === query \? items : \[\];/);
});

test("market-cap dashboard renders tabs, a compact sector filter, and detail row links", () => {
  assert.match(marketCapSource, /market-cap-tabs/);
  assert.match(marketCapSource, /market-cap-sector-filter/);
  assert.match(marketCapSource, /detailHrefForMarketCapRow/);
  assert.match(marketCapHookSource, /\/api\/market-cap/);
  assert.match(marketCapSource, /marketCapScopeLabel/);
  assert.match(marketCapHelperSource, /전체/);
  assert.match(marketCapHelperSource, /국내/);
  assert.match(marketCapHelperSource, /해외/);
  assert.match(css, /\.market-cap-app\s*\{/);
  assert.match(css, /\.market-cap-toolbar\s*\{[\s\S]*?justify-content:\s*space-between;/);
  assert.match(css, /\.market-cap-table-row\s*\{[\s\S]*?grid-template-columns:\s*72px minmax\(180px,\s*1\.4fr\) minmax\(86px,\s*0\.5fr\) minmax\(130px,\s*0\.8fr\) minmax\(110px,\s*0\.6fr\) minmax\(96px,\s*0\.5fr\);/);
});

test("shared navigation exposes global GNB and mobile bottom bar without replacing compare sheet UX", () => {
  assert.match(appNavigationSource, /globalNavigationItemsForContext/);
  assert.match(appNavigationSource, /AppNavigationLinks/);
  assert.doesNotMatch(appNavigationSource, /import \{ Menu \} from "lucide-react"/);
  assert.doesNotMatch(appNavigationSource, /app-navigation-trigger/);
  assert.match(appNavigationLinksSource, /type AppNavigationLinksVariant = "global" \| "bottom" \| "index"/);
  assert.match(searchChromeSource, /AppNavigationMenu/);
  assert.match(searchChromeSource, /searchChrome\.className/);
  assert.match(collapsibleSearchChromeSource, /detailSearchScrollDecision/);
  assert.match(collapsibleSearchChromeSource, /compareSearchScrollDecision/);
  assert.match(dashboardSource, /SearchChromeWithNavigation/);
  assert.doesNotMatch(dashboardSource, /stock-detail-index-menu/);
  assert.match(compareSource, /AppNavigationMenu/);
  assert.match(compareSource, /mobileContextAction/);
  assert.match(css, /\.app-bottom-menu-trigger\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?bottom:\s*max\(14px, env\(safe-area-inset-bottom, 0px\)\);/);
  assert.match(css, /\.app-bottom-nav\.is-open\s*\{[\s\S]*?transform:\s*translate\(-50%, 0\) scale\(1\);/);
  assert.doesNotMatch(css, /\.app-navigation-trigger/);
});

test("detail search keeps user draft edits separate from server identity sync", () => {
  assert.match(dashboardSource, /isSearchEditing/);
  assert.match(dashboardSource, /handleTickerInputChange/);
  assert.match(dashboardSource, /onValueChange=\{handleTickerInputChange\}/);
  assert.doesNotMatch(dashboardSource, /onValueChange=\{setTickerInput\}/);
});

test("chart story does not truncate fetched history on the client", () => {
  assert.doesNotMatch(stockDetailSectionsSource, /usable\.slice\(-260\)/);
  assert.match(stockDetailSectionsSource, /const chartPoints = usable;/);
  assert.match(stockDetailSectionsSource, /<LazyTradingPriceChart points=\{chartPoints\}/);
});

test("newly listed detail chart renders a one-bar chart instead of an empty state", () => {
  assert.match(stockDetailSectionsSource, /if \(usable\.length < 1\)/);
  assert.doesNotMatch(stockDetailSectionsSource, /if \(usable\.length < 2\)/);
});

test("newly listed zero-bar chart empty state does not reuse absolute chart fallback overlay", () => {
  const emptyStoryBlock = stockDetailSectionsSource.match(/className="chart-story chart-empty-story"[\s\S]*?<\/section>/)?.[0] || "";
  assert.match(emptyStoryBlock, /chart-empty-note/);
  assert.doesNotMatch(emptyStoryBlock, /chart-fallback/);
  assert.match(css, /\.chart-empty-note\s*\{[\s\S]*?position:\s*static;/);
});

test("technical pending view shows a one-bar candle before trend analysis is available", () => {
  const technicalSectionsSource = readFileSync(join(process.cwd(), "src/components/TechnicalAnalysisSections.tsx"), "utf8");
  assert.match(technicalSectionsSource, /chartPointCount >= 1 \? <TechnicalOverlayChart/);
  assert.doesNotMatch(technicalSectionsSource, /chartPointCount >= 2 \? <TechnicalOverlayChart/);
  assert.match(technicalSectionsSource, /아직 하루치라 방향을 판단하기엔 이릅니다/);
  assert.match(technicalSectionsSource, /가격 기록이 하루치라 이동평균이나 추세 신호는 아직 참고하기 어려워요/);
  assert.match(technicalSectionsSource, /const chartPointCount = usableChartPoints\(data\.chart_series\)\.length;[\s\S]*const summaryHeadline = chartPointCount === 1/);
});

test("compare chart is driven by visible price history instead of scored compare cards", () => {
  assert.match(compareSource, /const \{ states, items, chartItems,/);
  assert.match(compareSource, /<CompareChart items=\{chartItems\}/);
  assert.doesNotMatch(compareSource, /items\.length >= 2 \? <CompareChart items=\{items\}/);
});

test("waiting states use shared skeletons instead of error containers", () => {
  assert.match(loadingSkeletonSource, /function StockDetailLoadingSkeleton/);
  assert.match(loadingSkeletonSource, /function TechnicalAnalysisLoadingSkeleton/);
  assert.doesNotMatch(loadingSkeletonSource, /function CompareWaitingCardsSkeleton|function ComparePendingRowsSkeleton/);
  assert.match(dashboardSource, /<StockDetailLoadingSkeleton/);
  assert.match(compareSource, /function CompareSkeletonCard/);
  assert.doesNotMatch(compareSource, /className="compare-errors compare-pending"/);
  assert.doesNotMatch(css, /skeleton-pending-action|technical-pending-action/);
});

test("compare page keeps selected tickers editable and removes dense duplicate copy", () => {
  assert.match(compareSource, /AppNavigationMenu/);
  assert.match(compareSource, /context=\{\{ page: "compare"/);
  assert.match(compareSource, /label: "종목 편집"/);
  assert.match(compareSource, /ariaLabel: "비교 종목 편집"/);
  assert.match(compareSource, /tickers\.length <= 1/);
  assert.match(compareSource, /disabled=\{entry\.removeDisabled\}/);
  assert.match(compareSource, /className="stock-search-form compare-add-form"/);
  assert.match(compareSource, /const \[isMobileSearchOpen, setIsMobileSearchOpen\] = useState\(false\);/);
  assert.match(compareSource, /function CompareSearchSheet/);
  assert.match(compareSource, /compare-add-button/);
  assert.doesNotMatch(compareSource, /isSearchCollapsed|setCompareSearchCollapsed|lastScrollYRef|isSearchCollapsedRef|variant="floating"|isCollapsed=\{/);
  assert.doesNotMatch(compareSource, /선택됨|먼저 볼 차이|높을수록 유리해요|CompareBrief|compareItemSummary/);
  assert.doesNotMatch(css, /compare-insight|compare-metric-values|compare-stock-card > p|compare-picks b\s*\{|compare-picks span\.base|--compare-count/);
  assert.match(css, /\.compare-add-sheet\s*\{/);
  assert.match(css, /\.compare-sheet-backdrop\s*\{/);
  assert.match(css, /\.compare-sheet-panel\s*\{/);
  assert.match(compareSource, /\["compare-pick-list", className\]/);
  assert.match(compareSource, /className="compare-sheet-picks"/);
  assert.match(compareSource, /aria-label="종목 편집 닫기"/);
});

test("desktop compare layout keeps page chrome open instead of stacking large cards", () => {
  assert.match(css, /@media \(min-width: 900px\)[\s\S]*?\.compare-app\s*\{[\s\S]*?width:\s*min\(1040px,\s*calc\(100% - 48px\)\);/);
  assert.match(css, /@media \(min-width: 900px\)[\s\S]*?\.compare-app \.compare-landing,[\s\S]*?\.compare-app \.compare-picks,[\s\S]*?\.compare-app \.compare-toolbar\s*\{[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/);
  assert.match(css, /@media \(min-width: 900px\)[\s\S]*?\.compare-app \.compare-toolbar\s*\{[\s\S]*?position:\s*static;[\s\S]*?border-bottom:\s*1px solid rgba\(49,\s*130,\s*246,\s*0\.12\);/);
  assert.doesNotMatch(compareSource, /compare-side-index/);
});

test("compare cards give quality and opportunity matching mobile-safe score hierarchy", () => {
  const scoreTileTextRule = css.match(/\.compare-score-tile span,[\s\S]*?\.compare-score-tile small\s*\{([^}]*)\}/)?.[1] || "";

  assert.match(compareSource, /<CompareScoreTile[\s\S]*label="품질"[\s\S]*<CompareScoreTile[\s\S]*label="기회"/);
  assert.doesNotMatch(compareSource, /compare-score-line|compare-opportunity-line|compare-card-scorebar/);
  assert.match(css, /\.compare-stock-card\s*\{[\s\S]*?grid-template-areas:\s*"top scores metrics";/);
  assert.match(css, /\.compare-score-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(scoreTileTextRule, /overflow-wrap:\s*anywhere;/);
  assert.doesNotMatch(scoreTileTextRule, /white-space:\s*nowrap;/);
});

test("compare empty state gives mobile users a next action instead of blank space", () => {
  assert.match(compareSource, /!states\.length \? <CompareEmptyState/);
  assert.match(compareSource, /function CompareEmptyState/);
  assert.match(compareSource, /엔비디아/);
  assert.match(compareSource, /삼성전자/);
  assert.match(css, /\.compare-empty-state\s*\{[\s\S]*?border-top:\s*12px solid #f2f4f6;/);
});

test("compare feed grid items can shrink inside mobile viewport", () => {
  assert.match(css, /\.compare-feed\s*\{[\s\S]*?min-width:\s*0;/);
  assert.match(css, /\.compare-section\s*\{[\s\S]*?min-width:\s*0;/);
});

test("mobile pages cannot create document-level horizontal scroll", () => {
  assert.match(css, /html,\s*body\s*\{[\s\S]*?overflow-x:\s*clip;/);
  assert.match(css, /\.stock-app\s*\{[\s\S]*?max-width:\s*100%;[\s\S]*?overflow-x:\s*clip;/);
  assert.match(css, /\.stock-feed\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);[\s\S]*?min-width:\s*0;/);
  assert.match(css, /\.stock-feed-section\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?max-width:\s*100%;/);
  assert.match(css, /\.stock-title-card,[\s\S]*?\.chart-story,[\s\S]*?\.static-card\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?max-width:\s*100%;/);
});

test("wide mobile content scrolls inside its own touch container", () => {
  const compareMetricGroupRule = css.match(/\.compare-metric-group\s*\{([^}]*)\}/)?.[1] || "";
  const compareMetricTableRule = css.match(/\.compare-metric-table\s*\{([^}]*)\}/)?.[1] || "";

  assert.match(css, /\.ticker-chips\s*\{[\s\S]*?overflow-x:\s*auto;[\s\S]*?-webkit-overflow-scrolling:\s*touch;/);
  assert.match(compareMetricGroupRule, /min-width:\s*0;/);
  assert.match(compareMetricGroupRule, /max-width:\s*100%;/);
  assert.match(css, /\.compare-metric-table\s*\{[\s\S]*?overflow-x:\s*auto;[\s\S]*?-webkit-overflow-scrolling:\s*touch;/);
  assert.match(compareMetricTableRule, /width:\s*100%;/);
  assert.match(compareMetricTableRule, /min-width:\s*0;/);
  assert.match(compareMetricTableRule, /max-width:\s*100%;/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.compare-metric-row\s*\{[\s\S]*?min-width:\s*calc\(96px \+ var\(--compare-cols\) \* 112px \+ var\(--compare-cols\) \* 8px\);/);
  assert.doesNotMatch(css, /\.compare-suggestions,[\s\S]*?\.compare-metric-table\s*\{[\s\S]*?mask-image:/);
});

test("mobile compare navigation keeps route tabs and contextual add action separate", () => {
  const mobileBottomNavRule = css.match(/\.app-bottom-nav\s*\{([^}]*)\}/)?.[1] || "";
  const mobileBottomItemRule = css.match(/\.app-bottom-nav-item\s*\{([^}]*)\}/)?.[1] || "";
  const mobileMenuTriggerRule = css.match(/\.app-bottom-menu-trigger\s*\{([^}]*)\}/)?.[1] || "";
  const mobileContextActionRule = css.match(/\.app-bottom-context-action\s*\{([^}]*)\}/)?.[1] || "";
  const mobileContextActionSpanRule = css.match(/\.app-bottom-context-action span\s*\{([^}]*)\}/)?.[1] || "";
  const mobileContextActionCompactSpanRule = css.match(/\.app-bottom-context-action\.is-compact span\s*\{([^}]*)\}/)?.[1] || "";

  assert.match(mobileBottomNavRule, /grid-auto-flow:\s*column;/);
  assert.match(mobileBottomNavRule, /width:\s*min\(calc\(100vw - 28px\),\s*396px\);/);
  assert.match(mobileBottomNavRule, /opacity:\s*0;/);
  assert.match(mobileBottomItemRule, /min-height:\s*44px;/);
  assert.match(mobileMenuTriggerRule, /position:\s*fixed;/);
  assert.match(mobileMenuTriggerRule, /left:\s*max\(16px,\s*calc\(\(100vw - 396px\) \/ 2 \+ 12px\)\);/);
  assert.doesNotMatch(mobileMenuTriggerRule, /left:\s*50%;/);
  assert.match(mobileMenuTriggerRule, /width:\s*48px;/);
  assert.match(mobileMenuTriggerRule, /height:\s*48px;/);
  assert.match(appNavigationSource, /import \{ BarChart3, FileText, GitCompareArrows, Menu, PencilLine, Plus, Search \} from "lucide-react"/);
  assert.match(appNavigationSource, /mobileContextAction\?\.icon === "edit" \? PencilLine : Plus/);
  assert.match(appNavigationSource, /app-bottom-menu-trigger/);
  assert.match(appNavigationSource, /app-bottom-nav-backdrop/);
  assert.match(appNavigationSource, /nextMobileNavigationOpen/);
  assert.doesNotMatch(appNavigationSource, /app-bottom-nav-action/);
  assert.doesNotMatch(appNavigationSource, /mobileAction/);
  assert.match(appNavigationSource, /app-bottom-context-action/);
  assert.match(compareSource, /mobileContextAction/);
  assert.doesNotMatch(compareSource, /IntersectionObserver/);
  assert.doesNotMatch(compareSource, /isTickerRailVisible/);
  assert.match(css, /\.app-bottom-context-action\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?border-radius:\s*999px;/);
  assert.match(mobileContextActionRule, /width:\s*104px;/);
  assert.match(mobileContextActionRule, /transition:[\s\S]*?width 220ms/);
  assert.match(css, /\.app-bottom-context-action\.is-compact\s*\{[\s\S]*?width:\s*42px;[\s\S]*?height:\s*42px;/);
  assert.match(mobileContextActionSpanRule, /max-width:\s*64px;/);
  assert.match(mobileContextActionSpanRule, /transition:/);
  assert.match(mobileContextActionCompactSpanRule, /max-width:\s*0;/);
  assert.match(mobileContextActionCompactSpanRule, /opacity:\s*0;/);
  assert.doesNotMatch(mobileContextActionCompactSpanRule, /display:\s*none;/);
  assert.match(css, /\.app-bottom-nav\.is-open\s*\{[\s\S]*?opacity:\s*1;[\s\S]*?pointer-events:\s*auto;/);
  assert.match(css, /@media \(max-width: 899px\)[\s\S]*?\.stock-app\s*\{[\s\S]*?padding-bottom:\s*calc\(104px \+ env\(safe-area-inset-bottom,\s*0px\)\);/);
});

test("mobile route headers keep first content flush and compact", () => {
  assert.match(css, /\/\* Mobile route header polish \*\//);
  assert.match(autocompleteSource, /function collapsedContentWidth/);
  assert.match(autocompleteSource, /"--symbol-search-content-width"/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.stock-detail-app \.stock-search\.search-collapsed\s*\{[\s\S]*?min-height:\s*80px;[\s\S]*?height:\s*80px;[\s\S]*?background:\s*transparent;[\s\S]*?border-bottom:\s*0;/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.stock-search\.search-collapsed \.stock-search-form\.symbol-autocomplete-floating\s*\{[\s\S]*?right:\s*0;[\s\S]*?left:\s*0;[\s\S]*?width:\s*clamp\(96px,\s*calc\(var\(--symbol-search-content-width,\s*8ch\) \+ 32px\),\s*calc\(100vw - 32px\)\);[\s\S]*?margin-inline:\s*auto;[\s\S]*?transform:\s*none;/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.stock-search\.search-expanding \.stock-search-form\.symbol-autocomplete-floating\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?right:\s*16px;[\s\S]*?left:\s*16px;[\s\S]*?width:\s*calc\(100vw - 32px\);[\s\S]*?transform-origin:\s*center top;/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.stock-search\.search-collapsed \.stock-search-form\.symbol-autocomplete-floating \.symbol-search-box\s*\{[\s\S]*?min-height:\s*28px;[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.stock-search\.search-collapsed \.stock-search-form\.symbol-autocomplete-floating input\s*\{[\s\S]*?opacity:\s*1;[\s\S]*?color:\s*var\(--muted\);[\s\S]*?font-size:\s*13px;/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.stock-search\.search-collapsed \.stock-search-form\.symbol-autocomplete-floating \.symbol-search-action\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?inset:\s*0;[\s\S]*?opacity:\s*0;/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.stock-search\.search-collapsed \.stock-search-form\.symbol-autocomplete-floating \.symbol-search-action svg\s*\{[\s\S]*?display:\s*none;/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.stock-detail-app \.stock-feed\s*\{[\s\S]*?margin-top:\s*0;/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.stock-detail-app \.stock-title-card,[\s\S]*?\.compare-app \.compare-hero\s*\{[\s\S]*?border:\s*0;[\s\S]*?border-radius:\s*0;/);
  assert.match(css, /\.app-bottom-nav\s*\{[\s\S]*?min-height:\s*56px;/);
  assert.match(css, /\.app-bottom-nav-item\s*\{[\s\S]*?font-size:\s*10px;/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.compare-picks\s*\{[\s\S]*?padding-top:\s*10px;[\s\S]*?padding-bottom:\s*12px;/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.technical-analysis-app \.technical-hero\s*\{[\s\S]*?border-top:\s*0;[\s\S]*?padding-top:\s*28px;/);
});

test("compare search explains the five ticker limit in place", () => {
  assert.match(compareSource, /const compareLimitReached = tickers\.length >= MAX_COMPARE;/);
  assert.match(compareSource, /placeholder=\{compareLimitReached \? "최대 5개입니다" : "비교할 종목 검색"\}/);
  assert.match(compareSource, /buttonLabel=\{compareLimitReached \? "완료" : "추가"\}/);
  assert.match(compareSource, /disabled=\{compareLimitReached\}/);
  assert.match(compareSource, /closeLabel=\{compareLimitReached \? "완료" : "닫기"\}/);
});

test("mobile compare add search is an explicit sheet instead of scroll-collapsing input", () => {
  assert.doesNotMatch(compareSource, /window\.addEventListener\("scroll"[\s\S]*setCompareSearchCollapsed/);
  assert.match(compareSource, /document\.documentElement\.classList\.add\("compare-search-open"\)/);
  assert.match(compareSource, /document\.body\.classList\.add\("compare-search-open"\)/);
  assert.match(compareSource, /<CompareSearchSheet/);
  assert.match(compareSource, /autoFocusOnMount/);
  assert.match(css, /html\.compare-search-open,[\s\S]*?body\.compare-search-open\s*\{[\s\S]*?overflow:\s*hidden;/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.compare-toolbar\s*\{[\s\S]*?display:\s*none;/);
  assert.match(css, /@media \(min-width: 641px\)[\s\S]*?\.compare-add-sheet\s*\{[\s\S]*?display:\s*none;/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.compare-ticker-rail\s*\{[\s\S]*?display:\s*none;/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.compare-sheet-picks\s*\{[\s\S]*?display:\s*grid;/);
  assert.match(css, /\.compare-sheet-panel\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?inset-inline:\s*0;[\s\S]*?bottom:\s*0;/);
});

test("mobile compare add sheet owns the screen while searching", () => {
  assert.match(appNavigationSource, /suppressMobileChrome/);
  assert.match(compareSource, /suppressMobileChrome=\{isMobileSearchOpen\}/);
  assert.match(appNavigationSource, /!suppressMobileChrome && mobileNavigation\.isOpen/);
  assert.match(appNavigationSource, /!suppressMobileChrome && mobileContextAction/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.compare-sheet-panel\s*\{[\s\S]*?top:\s*0;[\s\S]*?bottom:\s*0;[\s\S]*?max-height:\s*none;[\s\S]*?border-radius:\s*0;/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.compare-sheet-search \.symbol-suggestions\s*\{[\s\S]*?max-height:\s*calc\(100dvh - 318px - env\(safe-area-inset-bottom,\s*0px\)\);/);
});

test("mobile compare sheet suggestions do not inherit primary add button colors", () => {
  assert.equal(lastCssDeclaration(".compare-sheet-search .symbol-suggestions button", "background"), "transparent");
  assert.equal(lastCssDeclaration(".compare-sheet-search .symbol-suggestions button", "color"), "var(--text)");
  assert.equal(lastCssDeclaration(".compare-sheet-search .symbol-suggestions button.active", "background"), "var(--surface-accent)");
  assert.equal(lastCssDeclaration(".compare-sheet-search .symbol-suggestions button.active", "color"), "var(--text)");
});

test("horizontal affordances use native touch carousel behavior", () => {
  const tickerChipsRule = css.match(/\.ticker-chips\s*\{([^}]*)\}/)?.[1] || "";
  const comparePickListRule = css.match(/\.compare-pick-list,\s*\.compare-suggestions\s*\{([^}]*)\}/)?.[1] || "";
  const compareMetricTableRule = css.match(/\.compare-metric-table\s*\{([^}]*)\}/)?.[1] || "";

  assert.match(tickerChipsRule, /scroll-snap-type:\s*x proximity;/);
  assert.match(css, /\.ticker-chips button\s*\{[\s\S]*?scroll-snap-align:\s*start;/);
  assert.match(comparePickListRule, /-webkit-overflow-scrolling:\s*touch;/);
  assert.match(comparePickListRule, /scroll-snap-type:\s*x proximity;/);
  assert.match(css, /\.compare-picks span,[\s\S]*?\.compare-suggestions button\s*\{[\s\S]*?scroll-snap-align:\s*start;/);
  assert.match(compareMetricTableRule, /scroll-snap-type:\s*x proximity;/);
  assert.match(css, /@supports \(\(mask-image:\s*linear-gradient\(90deg,\s*#000,\s*#000\)\) or \(-webkit-mask-image:\s*linear-gradient\(90deg,\s*#000,\s*#000\)\)\)/);
});

test("compare page separates detail origin from neutral compare rows", () => {
  assert.match(dashboardSource, /origin/);
  assert.match(compareSource, /searchParams\.get\("origin"\)/);
  assert.match(compareSource, /originTicker/);
  assert.match(compareSource, /detailHref = originTicker/);
  assert.doesNotMatch(compareSource, /item\.ticker === baseTicker \? "선택한 종목" : "비교 종목"/);
  assert.doesNotMatch(compareSource, /className=\{index === 0 \? "base" : ""\}/);
  assert.doesNotMatch(compareSource, /ComparePendingCards|CompareWaitingCardsSkeleton|ComparePendingRowsSkeleton/);
});
