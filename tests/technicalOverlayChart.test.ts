import test from "node:test";
import assert from "node:assert/strict";

import {
  TECHNICAL_OVERLAY_CONTROLS,
  candleShapeForPoint,
  defaultTechnicalOverlayVisibility,
} from "../src/components/TechnicalOverlayChart";

test("technical chart renders price as candle shapes with OHLC fallback", () => {
  const up = candleShapeForPoint(
    { open: 10, high: 12, low: 9, close: 11 },
    24,
    6,
    (value) => value,
  );
  assert.deepEqual(up, {
    x: 24,
    width: 6,
    tone: "up",
    wickY1: 9,
    wickY2: 12,
    bodyY: 10,
    bodyHeight: 2,
  });

  const fallback = candleShapeForPoint(
    { close: 7 },
    24,
    6,
    (value) => value,
  );
  assert.equal(fallback?.tone, "flat");
  assert.equal(fallback?.bodyHeight, 2);
});

test("technical overlay controls exclude price and default every indicator on", () => {
  const controlIds = TECHNICAL_OVERLAY_CONTROLS.map((control) => control.id);
  assert.deepEqual(controlIds, ["ema20", "ema50", "sma200", "fvg", "ob", "fib"]);
  assert.equal((controlIds as string[]).includes("price"), false);
  assert.deepEqual(defaultTechnicalOverlayVisibility(), {
    ema20: true,
    ema50: true,
    sma200: true,
    fvg: true,
    ob: true,
    fib: true,
  });
});
