import test from "node:test";
import assert from "node:assert/strict";

import { newsTitleSegments } from "../src/components/StockDetailSections";

test("news title segments render Naver b highlights without treating other tags as markup", () => {
  assert.deepEqual(newsTitleSegments("삼성전자 <b>반도체</b> &amp; AI <script>x</script>"), [
    { text: "삼성전자 ", bold: false },
    { text: "반도체", bold: true },
    { text: " & AI <script>x</script>", bold: false },
  ]);
});
