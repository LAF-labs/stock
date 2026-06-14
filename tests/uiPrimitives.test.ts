import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { priceChangeToneForValue } from "../src/components/ui/PriceChange";

const primitivesCss = readFileSync(join(process.cwd(), "src/styles/primitives.css"), "utf8");
const buttonSource = readFileSync(join(process.cwd(), "src/components/ui/Button.tsx"), "utf8");
const iconButtonSource = readFileSync(join(process.cwd(), "src/components/ui/IconButton.tsx"), "utf8");
const fabSource = readFileSync(join(process.cwd(), "src/components/ui/FloatingActionButton.tsx"), "utf8");
const panelSource = readFileSync(join(process.cwd(), "src/components/ui/Panel.tsx"), "utf8");
const sheetSource = readFileSync(join(process.cwd(), "src/components/ui/Sheet.tsx"), "utf8");
const uiIndexSource = readFileSync(join(process.cwd(), "src/components/ui/index.ts"), "utf8");

test("action primitives expose stable variants and class hooks", () => {
  assert.match(buttonSource, /type ButtonVariant = "primary" \| "secondary" \| "ghost" \| "danger";/);
  assert.match(buttonSource, /className=\{\["ui-button", `ui-button--\$\{variant\}`/);
  assert.match(iconButtonSource, /aria-label/);
  assert.match(iconButtonSource, /ui-icon-button/);
  assert.match(fabSource, /type FloatingActionButtonVariant = "full" \| "compact";/);
  assert.match(fabSource, /type FloatingActionButtonAccessibleName =[\s\S]*children: ReactNode;[\s\S]*"aria-label"\?: string[\s\S]*\|[\s\S]*children\?: ReactNode;[\s\S]*"aria-label": string/);
  assert.match(fabSource, /Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" \| "aria-label">/);
  assert.match(fabSource, /ui-fab--compact/);
  assert.match(primitivesCss, /\.ui-button\s*\{/);
  assert.match(primitivesCss, /\.ui-icon-button\s*\{/);
  assert.match(primitivesCss, /\.ui-fab\s*\{/);
});

test("surface primitives expose panel and sheet class hooks", () => {
  assert.match(panelSource, /ui-panel/);
  assert.match(sheetSource, /"use client";/);
  assert.match(sheetSource, /useEffect/);
  assert.match(sheetSource, /useRef/);
  assert.match(sheetSource, /previousActiveElementRef/);
  assert.match(sheetSource, /returnFocusRef/);
  assert.match(sheetSource, /focusableElements/);
  assert.match(sheetSource, /role=\{role\}/);
  assert.match(sheetSource, /aria-modal=\{modal\}/);
  assert.match(sheetSource, /event\.key === "Escape"/);
  assert.match(sheetSource, /event\.key === "Tab"/);
  assert.match(sheetSource, /event\.shiftKey/);
  assert.match(sheetSource, /\(returnFocusRef\?\.current \?\? previousActiveElementRef\.current\)\?\.focus\(\)/);
  assert.match(sheetSource, /tabIndex=\{-1\}/);
  assert.match(sheetSource, /<div className="ui-sheet-backdrop" aria-hidden="true" onClick=\{onClose\} \/>/);
  assert.doesNotMatch(sheetSource, /<button[^>]*className="ui-sheet-backdrop"/);
  assert.match(primitivesCss, /\.ui-panel\s*\{/);
  assert.match(primitivesCss, /\.ui-sheet-backdrop\s*\{/);
  assert.match(primitivesCss, /\.ui-sheet-panel\s*\{/);
});

test("ui index exports action and surface primitives", () => {
  assert.match(uiIndexSource, /export \{ default as Button \} from "\.\/Button";/);
  assert.match(uiIndexSource, /export \{ default as IconButton \} from "\.\/IconButton";/);
  assert.match(uiIndexSource, /export \{ default as FloatingActionButton \} from "\.\/FloatingActionButton";/);
  assert.match(uiIndexSource, /export \{ default as Panel \} from "\.\/Panel";/);
  assert.match(uiIndexSource, /export \{ default as Sheet \} from "\.\/Sheet";/);
});

test("price change tone helper keeps missing and flat values neutral", () => {
  assert.equal(priceChangeToneForValue(undefined), "neutral");
  assert.equal(priceChangeToneForValue(Number.NaN), "neutral");
  assert.equal(priceChangeToneForValue(0), "neutral");
  assert.equal(priceChangeToneForValue(0.01), "positive");
  assert.equal(priceChangeToneForValue(-0.01), "negative");
});

test("data primitives expose table, metric, and chip class hooks", () => {
  const priceChangeSource = readFileSync(join(process.cwd(), "src/components/ui/PriceChange.tsx"), "utf8");
  const judgmentChipSource = readFileSync(join(process.cwd(), "src/components/ui/JudgmentChip.tsx"), "utf8");
  const metricTileSource = readFileSync(join(process.cwd(), "src/components/ui/MetricTile.tsx"), "utf8");
  const dataTableSource = readFileSync(join(process.cwd(), "src/components/ui/DataTable.tsx"), "utf8");

  assert.match(priceChangeSource, /ui-price-change--\$\{tone\}/);
  assert.match(priceChangeSource, /type PriceChangeTone = "positive" \| "negative" \| "neutral" \| "price-up" \| "price-down";/);
  assert.match(judgmentChipSource, /type JudgmentChipTone = "neutral" \| "positive" \| "negative" \| "warning" \| "accent";/);
  assert.match(judgmentChipSource, /type JudgmentChipAccessibleName =[\s\S]*children: ReactNode;[\s\S]*"aria-label"\?: string[\s\S]*\|[\s\S]*children\?: ReactNode;[\s\S]*"aria-label": string/);
  assert.match(judgmentChipSource, /Omit<HTMLAttributes<HTMLSpanElement>, "children" \| "aria-label">/);
  assert.match(metricTileSource, /ui-metric-tile/);
  assert.doesNotMatch(dataTableSource, /role\s*=\s*"table"/);
  assert.match(dataTableSource, /const roleProps = role \? \{ role \} : \{\};/);
  assert.match(dataTableSource, /<div \{\.\.\.roleProps\}/);
  assert.match(primitivesCss, /\.ui-price-change\s*\{/);
  assert.match(primitivesCss, /\.ui-price-change--price-up\s*\{[\s\S]*?color:\s*var\(--red\);[\s\S]*?background:\s*var\(--red-soft\);/);
  assert.match(primitivesCss, /\.ui-price-change--price-down\s*\{[\s\S]*?color:\s*var\(--down\);[\s\S]*?background:\s*#eff6ff;/);
  assert.match(primitivesCss, /\.ui-judgment-chip\s*\{/);
  assert.match(primitivesCss, /\.ui-metric-tile\s*\{/);
  assert.match(primitivesCss, /\.ui-metric-tile--accent\s*\{/);
  assert.match(primitivesCss, /\.ui-metric-tile--positive\s*\{/);
  assert.match(primitivesCss, /\.ui-metric-tile--negative\s*\{/);
  assert.match(primitivesCss, /\.ui-data-table\s*\{/);
});
