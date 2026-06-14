import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
  assert.match(sheetSource, /role=\{role\}/);
  assert.match(sheetSource, /aria-modal=\{modal\}/);
  assert.match(sheetSource, /event\.key === "Escape"/);
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
