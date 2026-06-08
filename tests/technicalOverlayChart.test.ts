import test from "node:test";
import assert from "node:assert/strict";

import {
  TECHNICAL_OVERLAY_CONTROLS,
  candleShapeForPoint,
  defaultTechnicalOverlayVisibility,
  technicalOverlayAvailability,
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

test("technical overlay availability disables pending indicator controls", () => {
  assert.deepEqual(technicalOverlayAvailability(undefined), {
    ema20: false,
    ema50: false,
    sma200: false,
    fvg: false,
    ob: false,
    fib: false,
  });

  const technical = {
      overlays: {
        moving_average: {
          ema20: [{ date: "2026-06-08", value: 12 }],
          ema50: [],
        },
        fvg_zones: [{ date: "2026-06-08", low: 10, high: 11 }],
        fibonacci: { levels: [{ label: "50.0%", price: 10.5 }] },
      },
    } as any;

  assert.deepEqual(
    technicalOverlayAvailability(technical),
    {
      ema20: true,
      ema50: false,
      sma200: false,
      fvg: true,
      ob: false,
      fib: true,
    }
  );
});
