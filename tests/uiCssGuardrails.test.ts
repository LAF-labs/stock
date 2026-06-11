import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
const dashboardSource = readFileSync(join(process.cwd(), "src/components/StockDashboard.tsx"), "utf8");
const compareSource = readFileSync(join(process.cwd(), "src/components/StockCompare.tsx"), "utf8");
const autocompleteSource = readFileSync(join(process.cwd(), "src/components/SymbolAutocomplete.tsx"), "utf8");
const symbolSearchHookSource = readFileSync(join(process.cwd(), "src/components/useSymbolSearchQuery.ts"), "utf8");
const stockDetailSectionsSource = readFileSync(join(process.cwd(), "src/components/StockDetailSections.tsx"), "utf8");
const loadingSkeletonSource = readFileSync(join(process.cwd(), "src/components/StockLoadingSkeletons.tsx"), "utf8");
const compareRouteSource = readFileSync(join(process.cwd(), "src/app/compare/page.tsx"), "utf8");
const technicalRouteSource = readFileSync(join(process.cwd(), "src/app/technical/page.tsx"), "utf8");

test("visited link color is scoped to news links", () => {
  assert.doesNotMatch(css, /(^|})\s*a:visited\s*\{/);
  assert.match(css, /\.news-list\s+a:visited\s*\{[\s\S]*?color:\s*#6b4eff;/);
});

test("desktop index layouts use centered grid containers", () => {
  assert.doesNotMatch(
    css,
    /--detail-index-left|--detail-content-left|--compare-side-left|--compare-content-left|calc\(50vw - 600px\)/,
  );
  assert.match(css, /\.stock-detail-app:has\(> \.stock-detail-index\)\s*\{[\s\S]*?grid-template-columns:\s*184px minmax\(0, 1fr\);/);
  assert.match(css, /\.compare-app\s*\{[\s\S]*?grid-template-columns:\s*184px minmax\(0, 1fr\);/);
});

test("font weights stay on supported tiers", () => {
  assert.doesNotMatch(css, /font-weight:\s*(?:550|650|750|760|780|790|820)\b/);
});

test("first-screen display typography uses a calmer scale", () => {
  assert.match(css, /\/\* Typography density refinement \*\//);
  assert.match(css, /\.stock-detail-app \.stock-name-row h2\s*\{[\s\S]*?font-size:\s*42px;[\s\S]*?font-weight:\s*600;/);
  assert.match(css, /\.stock-detail-app \.price-block strong\s*\{[\s\S]*?font-size:\s*36px;[\s\S]*?font-weight:\s*600;/);
  assert.match(css, /\.compare-app \.compare-hero h1\s*\{[\s\S]*?font-size:\s*30px;[\s\S]*?font-weight:\s*600;/);
  assert.match(css, /\.compare-score-line strong\s*\{[\s\S]*?font-size:\s*24px;[\s\S]*?font-weight:\s*600;/);
  assert.match(css, /\.technical-analysis-app \.technical-hero-heading h1\s*\{[\s\S]*?font-size:\s*36px;[\s\S]*?font-weight:\s*600;/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.stock-detail-app \.stock-name-row h2\s*\{[\s\S]*?font-size:\s*30px;/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.compare-app \.compare-hero h1\s*\{[\s\S]*?font-size:\s*26px;/);
});

test("primary CTA styles use shared tokens instead of black overrides", () => {
  assert.match(css, /--cta-primary-bg:\s*var\(--accent\);/);
  assert.match(css, /\.technical-analysis-link\s*\{[\s\S]*?background:\s*var\(--cta-primary-bg\);/);
  assert.doesNotMatch(css, /\.technical-analysis-link\s*\{[\s\S]*?background:\s*#111827;/);
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

test("home search is a floating pill that collapses to an icon-only circle", () => {
  assert.match(dashboardSource, /isSearchCollapsed/);
  assert.match(dashboardSource, /variant="floating"/);
  assert.match(dashboardSource, /onExpandRequest/);
  assert.match(dashboardSource, /scrollY/);
  assert.match(autocompleteSource, /function SearchIcon/);
  assert.match(autocompleteSource, /type=\{isCollapsed \? "button" : "submit"\}/);
  assert.match(autocompleteSource, /formAction/);
  assert.match(autocompleteSource, /inputName/);
  assert.match(autocompleteSource, /variant === "floating"/);
  assert.match(dashboardSource, /formAction="\/"/);
  assert.match(dashboardSource, /inputName="ticker"/);
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
  assert.match(compareSource, /홈으로 돌아가기/);
  assert.match(compareSource, /tickers\.length <= 1/);
  assert.match(compareSource, /disabled=\{removeDisabled\}/);
  assert.doesNotMatch(compareSource, /선택됨|먼저 볼 차이|높을수록 유리해요|CompareBrief|compareItemSummary/);
  assert.doesNotMatch(css, /compare-insight|compare-metric-values|compare-stock-card > p|compare-picks b\s*\{|compare-picks span\.base|--compare-count/);
  assert.match(css, /\.compare-card-grid\s*\{[\s\S]*?grid-template-columns:\s*1fr;/);
  assert.match(css, /\.compare-metric-column-head,[\s\S]*?\.compare-metric-row\s*\{[\s\S]*?repeat\(var\(--compare-cols\), minmax\(96px, 1fr\)\)/);
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
  assert.match(css, /\.compare-metric-row\s*\{[\s\S]*?min-width:\s*calc\(132px \+ var\(--compare-cols\) \* 88px \+ \(var\(--compare-cols\) \+ 1\) \* 6px\);/);
});

test("mobile compare navigation is a compact horizontal action rail", () => {
  const mobileCompareNavRule = css.match(/@media \(max-width: 899px\)[\s\S]*?\.compare-side-index\s*\{([^}]*)\}/)?.[1] || "";
  const mobileCompareNavLinkRule = css.match(/@media \(max-width: 899px\)[\s\S]*?\.compare-side-index a\s*\{([^}]*)\}/)?.[1] || "";

  assert.match(mobileCompareNavRule, /display:\s*flex;/);
  assert.match(mobileCompareNavRule, /overflow-x:\s*auto;/);
  assert.match(mobileCompareNavRule, /scroll-snap-type:\s*x proximity;/);
  assert.match(mobileCompareNavLinkRule, /flex:\s*0 0 auto;/);
  assert.match(mobileCompareNavLinkRule, /min-height:\s*40px;/);
  assert.match(mobileCompareNavLinkRule, /scroll-snap-align:\s*start;/);
});

test("mobile route headers keep first content flush and compact", () => {
  assert.match(css, /\/\* Mobile route header polish \*\//);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.stock-search\.search-collapsed\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?width:\s*100%;/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.stock-detail-app \.stock-feed\s*\{[\s\S]*?margin-top:\s*0;/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.stock-detail-app \.stock-title-card,[\s\S]*?\.compare-app \.compare-hero\s*\{[\s\S]*?border:\s*0;[\s\S]*?border-radius:\s*0;/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.compare-side-index\s*\{[\s\S]*?min-height:\s*52px;[\s\S]*?margin:\s*0;[\s\S]*?border-bottom:\s*1px solid var\(--line\);/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.compare-side-index a,[\s\S]*?\.technical-topbar a\s*\{[\s\S]*?min-height:\s*32px;[\s\S]*?font-size:\s*12px;/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.compare-picks\s*\{[\s\S]*?padding-top:\s*10px;[\s\S]*?padding-bottom:\s*12px;/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.technical-analysis-app \.technical-hero\s*\{[\s\S]*?border-top:\s*0;[\s\S]*?padding-top:\s*28px;/);
});

test("compare search explains the five ticker limit in place", () => {
  assert.match(compareSource, /const compareLimitReached = tickers\.length >= MAX_COMPARE;/);
  assert.match(compareSource, /placeholder=\{compareLimitReached \? "최대 5개입니다" : "비교할 종목 검색"\}/);
  assert.match(compareSource, /buttonLabel=\{compareLimitReached \? "완료" : "추가"\}/);
  assert.match(compareSource, /disabled=\{compareLimitReached\}/);
});

test("horizontal affordances use native touch carousel behavior", () => {
  const tickerChipsRule = css.match(/\.ticker-chips\s*\{([^}]*)\}/)?.[1] || "";
  const comparePicksRule = css.match(/\.compare-picks,\s*\.compare-suggestions\s*\{([^}]*)\}/)?.[1] || "";
  const compareMetricTableRule = css.match(/\.compare-metric-table\s*\{([^}]*)\}/)?.[1] || "";

  assert.match(tickerChipsRule, /scroll-snap-type:\s*x proximity;/);
  assert.match(css, /\.ticker-chips button\s*\{[\s\S]*?scroll-snap-align:\s*start;/);
  assert.match(comparePicksRule, /-webkit-overflow-scrolling:\s*touch;/);
  assert.match(comparePicksRule, /scroll-snap-type:\s*x proximity;/);
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
