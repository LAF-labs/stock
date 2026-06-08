import test from "node:test";
import assert from "node:assert/strict";

import { activeSymbolItemForQuery, shouldFetchSymbolSearch } from "../src/components/symbolAutocompleteHelpers";
import type { SymbolSearchItem } from "../src/lib/symbolTypes";

const koItem: SymbolSearchItem = {
  key: "US:KO",
  market: "US",
  ticker: "KO",
  displayName: "Coca-Cola",
  subtitle: "KO",
  exchange: "NYSE",
  exchangeName: "NYSE",
  koreanName: "코카콜라",
  englishName: "Coca-Cola",
  instrumentType: "STOCK",
};

test("symbol search avoids one-character server lookups", () => {
  assert.equal(shouldFetchSymbolSearch(""), false);
  assert.equal(shouldFetchSymbolSearch("k"), false);
  assert.equal(shouldFetchSymbolSearch("삼"), false);
  assert.equal(shouldFetchSymbolSearch("ko"), true);
  assert.equal(shouldFetchSymbolSearch("삼성"), true);
});

test("active autocomplete item is ignored when result query is stale", () => {
  assert.equal(activeSymbolItemForQuery([koItem], "ko", "k", 0), undefined);
  assert.equal(activeSymbolItemForQuery([koItem], "ko", "ko", 0), koItem);
  assert.equal(activeSymbolItemForQuery([koItem], "ko", "ko", 4), koItem);
});
