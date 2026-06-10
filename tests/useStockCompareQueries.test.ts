import test from "node:test";
import assert from "node:assert/strict";

import { compareItemsFromStates, shouldPromotePartialCompareData, type CompareLoadState } from "../src/components/useStockCompareQueries";
import type { StockScoreResponse } from "../src/lib/types";

test("compare query promotes priced fast-path partials into provisional compare items", () => {
  const pricedPartial = {
    status: "partial",
    ticker: "KR:064350",
    data: {
      ok: true,
      requested_ticker: "KR:064350",
      symbol: "064350",
      market: "KR",
      name: "현대로템",
      quality_score: 56.4,
      opportunity_score: 61.2,
      latest_price: 187400,
      data_quality: "quote_fast_path",
      fetch: { quote_only_fast_path: true, pending_enrichment: true },
      components: [{ key: "momentum", label: "모멘텀", score: 72 }],
      price_metrics: { latest_change: 0.018 },
    } as unknown as StockScoreResponse,
    message: "데이터를 준비하고 있어요.",
  } satisfies Extract<CompareLoadState, { status: "partial" }>;
  const identityOnlyPartial = {
    status: "partial",
    ticker: "US:ZVRA",
    data: {
      ok: true,
      requested_ticker: "US:ZVRA",
      symbol: "ZVRA",
      market: "US",
      name: "지브러 테라퓨틱스",
      data_quality: "identity_fast_path",
      fetch: { identity_only_fast_path: true, pending_enrichment: true },
    } as unknown as StockScoreResponse,
    message: "데이터를 준비하고 있어요.",
  } satisfies Extract<CompareLoadState, { status: "partial" }>;

  assert.equal(shouldPromotePartialCompareData(pricedPartial.data), true);
  assert.equal(shouldPromotePartialCompareData(identityOnlyPartial.data), false);

  const items = compareItemsFromStates([pricedPartial, identityOnlyPartial]);
  assert.equal(items.length, 1);
  assert.equal(items[0]?.ticker, "064350");
  assert.equal(items[0]?.provisional, true);
  assert.equal(items[0]?.score, 56.4);
});
