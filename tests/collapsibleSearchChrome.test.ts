import test from "node:test";
import assert from "node:assert/strict";
import { compareSearchScrollDecision, detailSearchScrollDecision } from "@/components/useCollapsibleSearchChrome";

test("detail search chrome collapses on downward scroll and expands near top or upward", () => {
  assert.equal(detailSearchScrollDecision({ scrollY: 120, delta: 18 }), "collapse");
  assert.equal(detailSearchScrollDecision({ scrollY: 120, delta: -1 }), "expand");
  assert.equal(detailSearchScrollDecision({ scrollY: 12, delta: 50 }), "expand");
  assert.equal(detailSearchScrollDecision({ scrollY: 120, delta: 0 }), "keep");
});

test("compare search chrome uses calmer scroll thresholds", () => {
  assert.equal(compareSearchScrollDecision({ scrollY: 93, delta: 9 }), "collapse");
  assert.equal(compareSearchScrollDecision({ scrollY: 92, delta: 40 }), "keep");
  assert.equal(compareSearchScrollDecision({ scrollY: 140, delta: 8 }), "keep");
  assert.equal(compareSearchScrollDecision({ scrollY: 140, delta: -25 }), "expand");
  assert.equal(compareSearchScrollDecision({ scrollY: 10, delta: 99 }), "expand");
});

test("compare search stays expanded until its natural position leaves the viewport", () => {
  assert.equal(compareSearchScrollDecision({ scrollY: 240, delta: 80, searchTop: 1 }), "expand");
  assert.equal(compareSearchScrollDecision({ scrollY: 240, delta: 80, searchTop: 0 }), "expand");
  assert.equal(compareSearchScrollDecision({ scrollY: 240, delta: 80, searchTop: -1 }), "collapse");
  assert.equal(compareSearchScrollDecision({ scrollY: 240, delta: -80, searchTop: -16 }), "keep");
});

test("compare search never collapses while the search field is focused", () => {
  assert.equal(compareSearchScrollDecision({ scrollY: 500, delta: 120, searchTop: -160, isFocusedWithin: true }), "expand");
});
