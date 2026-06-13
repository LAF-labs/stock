import test from "node:test";
import assert from "node:assert/strict";

import {
  globalNavigationItemsForContext,
  navigationItemsForContext,
  nextBottomNavigationHidden,
} from "../src/components/appNavigationMenuHelpers";

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

test("bottom navigation visibility hides only on deliberate downward scroll", () => {
  assert.equal(nextBottomNavigationHidden({ currentHidden: true, scrollY: 40, delta: 12 }), false);
  assert.equal(nextBottomNavigationHidden({ currentHidden: true, scrollY: 220, delta: -7 }), false);
  assert.equal(nextBottomNavigationHidden({ currentHidden: false, scrollY: 180, delta: 9 }), true);
  assert.equal(nextBottomNavigationHidden({ currentHidden: true, scrollY: 180, delta: 2 }), true);
  assert.equal(nextBottomNavigationHidden({ currentHidden: false, scrollY: 120, delta: 9 }), false);
});
