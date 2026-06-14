import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  globalNavigationItemsForContext,
  mobileContextActionVariant,
  navigationItemsForContext,
  nextMobileNavigationOpen,
} from "../src/components/appNavigationMenuHelpers";

const appNavigationMenuSource = readFileSync(join(process.cwd(), "src/components/AppNavigationMenu.tsx"), "utf8");
const appShellNavSource = readFileSync(join(process.cwd(), "src/components/layout/AppShellNav.tsx"), "utf8");
const mobileNavLauncherSource = readFileSync(join(process.cwd(), "src/components/layout/MobileNavLauncher.tsx"), "utf8");

test("home navigation exposes compare and market-cap dashboard entry points", () => {
  assert.deepEqual(navigationItemsForContext({ page: "home" }).map((item) => item.label), [
    "종목 비교",
    "시가총액 대시보드",
  ]);
});

test("detail navigation includes compare, market-cap dashboard, and home", () => {
  assert.deepEqual(navigationItemsForContext({
    page: "detail",
    ticker: "US:NVDA",
    compareHref: "/compare?tickers=US%3ANVDA&origin=US%3ANVDA",
  }).map((item) => item.label), [
    "종목 비교",
    "시가총액 대시보드",
    "메인으로 돌아가기",
  ]);
});

test("technical navigation includes detail, compare, home, and market-cap dashboard", () => {
  assert.deepEqual(navigationItemsForContext({
    page: "technical",
    ticker: "KR:005930",
    detailHref: "/?ticker=KR%3A005930",
  }).map((item) => item.label), [
    "종목 비교",
    "종목 상세로 돌아가기",
    "메인으로 돌아가기",
    "시가총액 대시보드",
  ]);
});

test("compare navigation includes market-cap dashboard, detail, and home", () => {
  assert.deepEqual(navigationItemsForContext({
    page: "compare",
    originTicker: "US:AAPL",
    detailHref: "/?ticker=US%3AAAPL",
  }).map((item) => item.label), [
    "시가총액 대시보드",
    "종목 상세로 돌아가기",
    "메인으로 돌아가기",
  ]);
});

test("neutral compare navigation omits detail return links without an origin stock", () => {
  assert.deepEqual(navigationItemsForContext({ page: "compare" }).map((item) => item.label), [
    "시가총액 대시보드",
    "메인으로 돌아가기",
  ]);

  assert.deepEqual(globalNavigationItemsForContext({ page: "compare" }).map((item) => item.label), [
    "검색",
    "종목 비교",
    "시가총액",
  ]);
});

test("global navigation exposes core destinations with active state", () => {
  const items = globalNavigationItemsForContext({ page: "marketCap" });
  assert.deepEqual(items.map((item) => item.label), ["검색", "종목 비교", "시가총액"]);
  assert.equal(items.find((item) => item.id === "marketCap")?.active, true);
  assert.equal(items.find((item) => item.id === "compare")?.href, "/compare");
});

test("detail-aware global navigation adds a compact detail return target", () => {
  assert.deepEqual(globalNavigationItemsForContext({
    page: "technical",
    ticker: "KR:005930",
    detailHref: "/?ticker=KR%3A005930",
  }).map((item) => item.label), [
    "검색",
    "종목 상세",
    "종목 비교",
    "시가총액",
  ]);

  assert.equal(globalNavigationItemsForContext({
    page: "detail",
    ticker: "US:NVDA",
  }).find((item) => item.id === "detail")?.active, true);
});

test("mobile floating navigation opens from a trigger and closes on scroll or outside taps", () => {
  assert.equal(nextMobileNavigationOpen({ currentOpen: false, event: "toggle" }), true);
  assert.equal(nextMobileNavigationOpen({ currentOpen: true, event: "toggle" }), false);
  assert.equal(nextMobileNavigationOpen({ currentOpen: true, event: "scroll" }), false);
  assert.equal(nextMobileNavigationOpen({ currentOpen: true, event: "outside" }), false);
  assert.equal(nextMobileNavigationOpen({ currentOpen: false, event: "noop" }), false);
});

test("mobile context action is full at the top and compact after scrolling", () => {
  assert.equal(mobileContextActionVariant(0), "full");
  assert.equal(mobileContextActionVariant(8), "full");
  assert.equal(mobileContextActionVariant(24), "compact");
});

test("navigation menu delegates desktop and mobile chrome to layout primitives", () => {
  assert.match(appNavigationMenuSource, /AppShellNav/);
  assert.match(appNavigationMenuSource, /MobileNavLauncher/);
  assert.doesNotMatch(appNavigationMenuSource, /function BottomNavigationLink/);
  assert.match(appShellNavSource, /app-desktop-nav/);
  assert.match(appShellNavSource, /AppNavigationLinks/);
  assert.match(mobileNavLauncherSource, /nextMobileNavigationOpen/);
  assert.match(mobileNavLauncherSource, /FloatingActionButton/);
  assert.match(mobileNavLauncherSource, /Menu/);
  assert.match(mobileNavLauncherSource, /tabIndex=\{mobileNavigation\.isOpen \? -1 : undefined\}/);
  assert.match(mobileNavLauncherSource, /aria-hidden=\{mobileNavigation\.isOpen \? true : undefined\}/);
  assert.match(mobileNavLauncherSource, /navRef/);
  assert.match(mobileNavLauncherSource, /querySelector<HTMLElement>\("a, button"\)\?\.focus\(\)/);
});
