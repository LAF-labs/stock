import assert from "node:assert/strict";
import test from "node:test";

import { evaluateMarketOpenRows, marketTradeDate } from "../scripts/stock_market_open_guard";

test("market open guard skips when every configured market is closed", () => {
  const result = evaluateMarketOpenRows(
    [
      { market: "US", trade_date: "2026-06-06", is_open: false },
      { market: "KR", trade_date: "2026-06-06", is_open: false },
    ],
    [
      { market: "US", tradeDate: "2026-06-06" },
      { market: "KR", tradeDate: "2026-06-06" },
    ]
  );

  assert.equal(result.run, false);
  assert.deepEqual(result.openMarkets, []);
  assert.equal(result.reason, "all_markets_closed");
});

test("market open guard runs when one market is open", () => {
  const result = evaluateMarketOpenRows(
    [
      { market: "US", trade_date: "2026-06-05", is_open: true },
      { market: "KR", trade_date: "2026-06-06", is_open: false },
    ],
    [
      { market: "US", tradeDate: "2026-06-05" },
      { market: "KR", tradeDate: "2026-06-06" },
    ]
  );

  assert.equal(result.run, true);
  assert.deepEqual(result.openMarkets, ["US"]);
  assert.equal(result.reason, "market_open");
});

test("market open guard fails open when calendar rows are missing", () => {
  const result = evaluateMarketOpenRows(
    [{ market: "US", trade_date: "2026-06-05", is_open: false }],
    [
      { market: "US", tradeDate: "2026-06-05" },
      { market: "KR", tradeDate: "2026-06-05" },
    ]
  );

  assert.equal(result.run, true);
  assert.deepEqual(result.missingMarkets, ["KR"]);
  assert.equal(result.reason, "calendar_missing");
});

test("market open guard derives trade dates in each market timezone", () => {
  const now = new Date("2026-06-07T23:30:00.000Z");

  assert.equal(marketTradeDate("KR", now), "2026-06-08");
  assert.equal(marketTradeDate("US", now), "2026-06-07");
});
