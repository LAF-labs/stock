import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
const dashboardSource = readFileSync(join(process.cwd(), "src/components/StockDashboard.tsx"), "utf8");
const compareSource = readFileSync(join(process.cwd(), "src/components/StockCompare.tsx"), "utf8");
const autocompleteSource = readFileSync(join(process.cwd(), "src/components/SymbolAutocomplete.tsx"), "utf8");
const stockDetailSectionsSource = readFileSync(join(process.cwd(), "src/components/StockDetailSections.tsx"), "utf8");
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
  assert.match(compareRouteSource, /hasTickers \?[\s\S]*비교할 종목을 검색해서 추가해주세요/);
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
});

test("home search is a floating pill that collapses to an icon-only circle", () => {
  assert.match(dashboardSource, /isSearchCollapsed/);
  assert.match(dashboardSource, /variant="floating"/);
  assert.match(dashboardSource, /onExpandRequest/);
  assert.match(dashboardSource, /scrollY/);
  assert.match(autocompleteSource, /function SearchIcon/);
  assert.match(autocompleteSource, /function ClearIcon/);
  assert.match(autocompleteSource, /className=\{`symbol-search-action/);
  assert.match(autocompleteSource, /onValueChange\(""\)/);
  assert.match(autocompleteSource, /variant === "floating"/);
  assert.match(css, /\.stock-search-form\.symbol-autocomplete-floating\s*\{[\s\S]*?border-radius:\s*999px;/);
  assert.match(css, /\.stock-search-form\.symbol-autocomplete-floating\.is-collapsed\s*\{[\s\S]*?width:\s*56px;/);
  assert.match(css, /\.stock-search-form\.symbol-autocomplete-floating\.is-collapsed input\s*\{[\s\S]*?opacity:\s*0;/);
  assert.match(css, /\.stock-search-form\.symbol-autocomplete-floating\.is-collapsed \.symbol-search-action\s*\{[\s\S]*?border-radius:\s*50%;/);
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
