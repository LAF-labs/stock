import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("detail page keeps the sticky mini decision bar contract", () => {
  const component = readFileSync("src/components/StockDashboard.tsx", "utf8");
  const styles = readFileSync("src/app/globals.css", "utf8");

  assert.match(component, /function DetailMiniDecisionBar/);
  assert.match(component, /detail-mini-decision-bar/);
  assert.match(component, /showMiniDecisionBar/);
  assert.match(component, /href=\{compareHref\}/);
  assert.match(component, /품질/);
  assert.match(component, /기회/);

  assert.match(styles, /\.detail-mini-decision-bar/);
  assert.match(styles, /\.detail-mini-decision-bar\.visible/);
  assert.match(styles, /position:\s*fixed/);
});
