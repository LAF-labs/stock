import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("detail page keeps the sticky mini decision bar contract", () => {
  const component = readFileSync("src/components/StockDashboard.tsx", "utf8");
  const styles = readFileSync("src/app/globals.css", "utf8");

  assert.match(component, /function DetailMiniDecisionBar/);
  assert.match(component, /detail-mini-decision-bar/);
  assert.match(component, /showMiniDecisionBar/);
  assert.match(component, /function DetailMobileActionBar/);
  assert.match(component, /detail-mobile-action-bar/);
  assert.match(component, /비교 추가/);
  assert.match(component, /맨 위로/);
  assert.match(component, /href=\{compareHref\}/);
  assert.match(component, /품질/);
  assert.match(component, /기회/);
  assert.match(component, /score-contribution-bar/);

  assert.match(styles, /\.detail-mini-decision-bar/);
  assert.match(styles, /\.detail-mini-decision-bar\.visible/);
  assert.match(styles, /\.detail-mobile-action-bar/);
  assert.match(styles, /position:\s*fixed/);
});

test("shared chrome keeps copy-link and disclaimer contracts", () => {
  const chrome = readFileSync("src/components/AppChrome.tsx", "utf8");
  const dashboard = readFileSync("src/components/StockDashboard.tsx", "utf8");
  const compare = readFileSync("src/components/StockCompare.tsx", "utf8");
  const styles = readFileSync("src/app/globals.css", "utf8");

  assert.match(chrome, /copyCurrentUrl/);
  assert.match(chrome, /링크 복사/);
  assert.match(chrome, /AppDisclaimerFooter/);
  assert.match(chrome, /점수는 투자 추천이 아니라 비교를 돕는 분석 기준입니다/);
  assert.match(dashboard, /AppDisclaimerFooter/);
  assert.match(compare, /AppDisclaimerFooter/);
  assert.match(styles, /\.app-disclaimer-footer/);
});
