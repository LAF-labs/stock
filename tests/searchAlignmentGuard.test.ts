import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

test("desktop floating search stays right aligned while mobile collapsed search is centered", () => {
  assert.match(
    css,
    /\.stock-search-form\.symbol-autocomplete-floating\s*\{[\s\S]*?justify-self:\s*end;[\s\S]*?transform-origin:\s*right center;/,
  );
  assert.match(
    css,
    /@media \(max-width: 640px\)[\s\S]*?\.stock-detail-app \.stock-search\.search-collapsed \.stock-search-form\.symbol-autocomplete-floating\s*\{[\s\S]*?right:\s*0;[\s\S]*?left:\s*0;[\s\S]*?margin-inline:\s*auto;[\s\S]*?transform-origin:\s*center top;/,
  );
  assert.match(
    css,
    /@media \(max-width: 640px\)[\s\S]*?\.stock-detail-app \.stock-search\.search-expanding \.stock-search-form\.symbol-autocomplete-floating\s*\{[\s\S]*?right:\s*16px;[\s\S]*?left:\s*16px;[\s\S]*?transform-origin:\s*center top;/,
  );
});
