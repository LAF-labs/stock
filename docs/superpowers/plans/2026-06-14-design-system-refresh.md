# Design System Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable design system foundation and apply it to navigation, search, compare, detail, technical analysis, market-cap, and home UI without changing data behavior.

**Architecture:** Add role-based CSS tokens first, then reusable UI primitives, then page-level layout patterns. Existing route paths, query hooks, provider policies, and API payload shapes stay unchanged; page components migrate gradually to shared primitives while current helper tests and CSS guardrails are extended.

**Tech Stack:** Next.js App Router, React 19, TypeScript, CSS custom properties, lucide-react, Node test runner, Playwright/browser visual verification.

---

## Scope Boundary

This plan implements the approved design direction from `docs/superpowers/specs/2026-06-14-design-system-refresh-design.md`.

In scope:

- Design tokens for color, spacing, radius, typography, shadow, motion, z-index, and control sizing.
- Reusable UI primitives for actions, surfaces, sheets, data display, chips, and price changes.
- Shared desktop GNB and mobile floating navigation primitives.
- Compare mobile editor pattern with selected tickers inside the fullscreen sheet.
- Page pattern migration for detail, technical analysis, market-cap, and home search surfaces.
- Focused automated guardrails plus visual verification.

Out of scope:

- Provider selection and provider call timing.
- Supabase schema changes.
- KIS/yfinance token logic.
- Scoring model changes.
- Route path changes.

## File Structure

Create:

- `src/styles/design-tokens.css`: semantic design tokens and backward-compatible aliases for existing CSS variables.
- `src/styles/primitives.css`: shared class contracts for action, surface, data, navigation, and search primitives.
- `src/components/ui/Button.tsx`: text button primitive.
- `src/components/ui/IconButton.tsx`: icon-only button primitive.
- `src/components/ui/FloatingActionButton.tsx`: mobile floating action primitive.
- `src/components/ui/Panel.tsx`: reusable panel/surface wrapper.
- `src/components/ui/Sheet.tsx`: accessible bottom/fullscreen sheet wrapper.
- `src/components/ui/PriceChange.tsx`: positive/negative/neutral price change display.
- `src/components/ui/JudgmentChip.tsx`: compact judgment/status chip.
- `src/components/ui/MetricTile.tsx`: small metric tile.
- `src/components/ui/DataTable.tsx`: role-friendly data table/list shell.
- `src/components/ui/index.ts`: primitive exports.
- `src/components/layout/AppShellNav.tsx`: desktop GNB wrapper.
- `src/components/layout/MobileNavLauncher.tsx`: closed hamburger launcher and opened bottom navigation.
- `src/components/layout/SearchChrome.tsx`: shared search chrome frame.
- `src/components/compare/CompareSelectedTickerList.tsx`: selected ticker chip list.
- `src/components/compare/CompareEditSheet.tsx`: compare editor fullscreen sheet.
- `tests/uiPrimitives.test.ts`: source and helper guardrails for primitives.

Modify:

- `src/app/globals.css`: import token/primitive CSS and remove duplicated visual rules as screens migrate.
- `src/components/AppNavigationMenu.tsx`: delegate shell and mobile launcher rendering to layout primitives.
- `src/components/AppNavigationLinks.tsx`: keep link mapping but align variant class contracts.
- `src/components/SearchChromeWithNavigation.tsx`: use `SearchChromeFrame`.
- `src/components/StockCompare.tsx`: use compare editor components and floating action primitive.
- `src/components/stockCompareHelpers.ts`: add compact selected ticker label helper.
- `src/components/StockDashboard.tsx`: keep behavior and migrate search/nav shell hooks.
- `src/components/StockDetailSections.tsx`: use data/status primitives where the component already renders repeated tiles or chips.
- `src/components/TechnicalAnalysisPage.tsx`: keep data flow and use shared navigation surface.
- `src/components/TechnicalAnalysisSections.tsx`: migrate repeated chips/buttons to primitives.
- `src/components/MarketCapDashboard.tsx`: use `DataTable`, `PriceChange`, `Panel`, and shared filter/action class contracts.
- `tests/uiCssGuardrails.test.ts`: token, primitive, and page pattern CSS/source guardrails.
- `tests/appNavigationMenu.test.ts`: navigation component boundary guardrails.
- `tests/stockCompareHelpers.test.ts`: compact selected ticker label behavior.
- `tests/marketCapDashboardHelpers.test.ts`: formatting guardrails if table labels change.

---

### Task 1: Foundation Tokens

**Files:**
- Create: `src/styles/design-tokens.css`
- Modify: `src/app/globals.css`
- Modify: `tests/uiCssGuardrails.test.ts`

- [ ] **Step 1: Write the failing token guardrail**

Add this read near the existing CSS reads in `tests/uiCssGuardrails.test.ts`:

```ts
const designTokensCss = readFileSync(join(process.cwd(), "src/styles/design-tokens.css"), "utf8");
```

Add this test near the existing CTA/token tests:

```ts
test("design system foundation tokens are role based and imported first", () => {
  assert.match(css, /@import "\.\.\/styles\/design-tokens\.css";/);
  assert.match(designTokensCss, /--color-app-bg:\s*#f5f7fa;/);
  assert.match(designTokensCss, /--color-surface:\s*#ffffff;/);
  assert.match(designTokensCss, /--color-text-primary:\s*#191f28;/);
  assert.match(designTokensCss, /--color-accent:\s*#2878f0;/);
  assert.match(designTokensCss, /--space-4:\s*16px;/);
  assert.match(designTokensCss, /--radius-pill:\s*999px;/);
  assert.match(designTokensCss, /--control-height-lg:\s*56px;/);
  assert.match(designTokensCss, /--motion-standard:\s*180ms cubic-bezier\(0\.22, 1, 0\.36, 1\);/);
  assert.match(designTokensCss, /--bg:\s*var\(--color-app-bg\);/);
  assert.match(designTokensCss, /--surface:\s*var\(--color-surface\);/);
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```bash
npm test -- tests/uiCssGuardrails.test.ts
```

Expected: FAIL because `src/styles/design-tokens.css` does not exist.

- [ ] **Step 3: Add the token file**

Create `src/styles/design-tokens.css` with this content:

```css
:root {
  --color-app-bg: #f5f7fa;
  --color-surface: #ffffff;
  --color-surface-subtle: #f7f8fa;
  --color-surface-accent: #eef6ff;
  --color-border: #edf0f3;
  --color-border-strong: #e5e8eb;
  --color-text-primary: #191f28;
  --color-text-secondary: #4e5968;
  --color-text-muted: #8b95a1;
  --color-accent: #2878f0;
  --color-accent-strong: #1b64da;
  --color-accent-soft: #e8f3ff;
  --color-positive: #0ca678;
  --color-negative: #e5484d;
  --color-neutral: #6b7684;
  --color-warning: #f59f00;
  --color-danger: #e5484d;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;

  --radius-xs: 6px;
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-pill: 999px;

  --control-height-sm: 36px;
  --control-height-md: 44px;
  --control-height-lg: 56px;
  --control-icon-sm: 18px;
  --control-icon-md: 20px;
  --control-icon-lg: 24px;

  --font-size-caption: 12px;
  --font-size-body: 15px;
  --font-size-title: 20px;
  --font-size-display: 42px;
  --line-height-tight: 1.15;
  --line-height-body: 1.5;

  --shadow-floating: 0 14px 36px rgba(15, 23, 42, 0.12);
  --shadow-sheet: 0 -18px 42px rgba(15, 23, 42, 0.18);
  --shadow-panel: 0 18px 44px rgba(15, 23, 42, 0.08);

  --motion-fast: 120ms ease;
  --motion-standard: 180ms cubic-bezier(0.22, 1, 0.36, 1);
  --motion-enter: 220ms cubic-bezier(0.22, 1, 0.36, 1);

  --z-sticky-search: 60;
  --z-desktop-nav: 70;
  --z-mobile-nav: 90;
  --z-sheet: 100;

  --bg: var(--color-app-bg);
  --surface: var(--color-surface);
  --surface-soft: var(--color-surface-subtle);
  --surface-accent: var(--color-surface-accent);
  --text: var(--color-text-primary);
  --subtext: var(--color-text-secondary);
  --muted: var(--color-text-muted);
  --line: var(--color-border);
  --line-strong: var(--color-border-strong);
  --accent: var(--color-accent);
  --accent-strong: var(--color-accent-strong);
  --accent-soft: var(--color-accent-soft);
  --red: var(--color-negative);
  --red-soft: #fff0f2;
  --down: var(--color-accent);
  --focus: var(--color-accent);
}
```

- [ ] **Step 4: Import tokens before existing global rules**

Add this as the first line of `src/app/globals.css`:

```css
@import "../styles/design-tokens.css";
```

Do not remove the existing `:root` block in this step. The aliases in `design-tokens.css` keep current screens stable while following tasks move declarations onto role tokens.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npm test -- tests/uiCssGuardrails.test.ts
```

Expected: PASS.

Commit:

```bash
git add src/styles/design-tokens.css src/app/globals.css tests/uiCssGuardrails.test.ts
git commit -m "Add design system foundation tokens"
```

---

### Task 2: Action And Surface Primitives

**Files:**
- Create: `src/styles/primitives.css`
- Create: `src/components/ui/Button.tsx`
- Create: `src/components/ui/IconButton.tsx`
- Create: `src/components/ui/FloatingActionButton.tsx`
- Create: `src/components/ui/Panel.tsx`
- Create: `src/components/ui/Sheet.tsx`
- Create: `src/components/ui/index.ts`
- Modify: `src/app/globals.css`
- Create: `tests/uiPrimitives.test.ts`
- Modify: `tests/uiCssGuardrails.test.ts`

- [ ] **Step 1: Write failing primitive source tests**

Create `tests/uiPrimitives.test.ts`:

```ts
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
  assert.match(fabSource, /ui-fab--compact/);
  assert.match(primitivesCss, /\.ui-button\s*\{/);
  assert.match(primitivesCss, /\.ui-icon-button\s*\{/);
  assert.match(primitivesCss, /\.ui-fab\s*\{/);
});

test("surface primitives expose panel and sheet class hooks", () => {
  assert.match(panelSource, /ui-panel/);
  assert.match(sheetSource, /role=\{role\}/);
  assert.match(sheetSource, /aria-modal=\{modal\}/);
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
```

Add this assertion to `tests/uiCssGuardrails.test.ts`:

```ts
test("primitive stylesheet is imported after tokens", () => {
  assert.match(css, /@import "\.\.\/styles\/design-tokens\.css";\s*@import "\.\.\/styles\/primitives\.css";/);
});
```

- [ ] **Step 2: Run tests and confirm they fail**

Run:

```bash
npm test -- tests/uiPrimitives.test.ts tests/uiCssGuardrails.test.ts
```

Expected: FAIL because primitive files and stylesheet import do not exist.

- [ ] **Step 3: Add action components**

Create `src/components/ui/Button.tsx`:

```tsx
import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
};

export default function Button({
  variant = "primary",
  size = "md",
  icon,
  className = "",
  children,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={["ui-button", `ui-button--${variant}`, `ui-button--${size}`, className].filter(Boolean).join(" ")}
      {...props}
    >
      {icon ? <span className="ui-button-icon" aria-hidden="true">{icon}</span> : null}
      <span className="ui-button-label">{children}</span>
    </button>
  );
}

export type { ButtonProps, ButtonSize, ButtonVariant };
```

Create `src/components/ui/IconButton.tsx`:

```tsx
import type { ButtonHTMLAttributes, ReactNode } from "react";

type IconButtonVariant = "plain" | "soft" | "solid";
type IconButtonSize = "sm" | "md" | "lg";

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  "aria-label": string;
  icon: ReactNode;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
};

export default function IconButton({
  icon,
  variant = "soft",
  size = "md",
  className = "",
  type = "button",
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={["ui-icon-button", `ui-icon-button--${variant}`, `ui-icon-button--${size}`, className].filter(Boolean).join(" ")}
      {...props}
    >
      {icon}
    </button>
  );
}

export type { IconButtonProps, IconButtonSize, IconButtonVariant };
```

Create `src/components/ui/FloatingActionButton.tsx`:

```tsx
import type { ButtonHTMLAttributes, ReactNode } from "react";

type FloatingActionButtonVariant = "full" | "compact";

type FloatingActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: ReactNode;
  variant?: FloatingActionButtonVariant;
};

export default function FloatingActionButton({
  icon,
  variant = "full",
  className = "",
  children,
  type = "button",
  ...props
}: FloatingActionButtonProps) {
  return (
    <button
      type={type}
      className={["ui-fab", variant === "compact" ? "ui-fab--compact" : "ui-fab--full", className].filter(Boolean).join(" ")}
      {...props}
    >
      <span className="ui-fab-icon" aria-hidden="true">{icon}</span>
      <span className="ui-fab-label">{children}</span>
    </button>
  );
}

export type { FloatingActionButtonProps, FloatingActionButtonVariant };
```

- [ ] **Step 4: Add surface components**

Create `src/components/ui/Panel.tsx`:

```tsx
import type { HTMLAttributes } from "react";

type PanelTone = "default" | "subtle" | "accent";

type PanelProps = HTMLAttributes<HTMLElement> & {
  as?: "section" | "article" | "div";
  tone?: PanelTone;
};

export default function Panel({
  as: Component = "section",
  tone = "default",
  className = "",
  ...props
}: PanelProps) {
  return <Component className={["ui-panel", `ui-panel--${tone}`, className].filter(Boolean).join(" ")} {...props} />;
}

export type { PanelProps, PanelTone };
```

Create `src/components/ui/Sheet.tsx`:

```tsx
import type { ReactNode } from "react";

type SheetProps = {
  open: boolean;
  labelledBy: string;
  children: ReactNode;
  className?: string;
  modal?: boolean;
  role?: "dialog" | "region";
  onClose: () => void;
};

export default function Sheet({
  open,
  labelledBy,
  children,
  className = "",
  modal = true,
  role = "dialog",
  onClose,
}: SheetProps) {
  if (!open) return null;

  return (
    <div className={["ui-sheet", className].filter(Boolean).join(" ")} role={role} aria-modal={modal} aria-labelledby={labelledBy}>
      <button type="button" className="ui-sheet-backdrop" aria-label="닫기" onClick={onClose} />
      <section className="ui-sheet-panel">{children}</section>
    </div>
  );
}

export type { SheetProps };
```

Create `src/components/ui/index.ts`:

```ts
export { default as Button } from "./Button";
export { default as IconButton } from "./IconButton";
export { default as FloatingActionButton } from "./FloatingActionButton";
export { default as Panel } from "./Panel";
export { default as Sheet } from "./Sheet";
```

- [ ] **Step 5: Add primitive CSS and import it**

Create `src/styles/primitives.css` with action and surface classes:

```css
.ui-button,
.ui-icon-button,
.ui-fab {
  border: 0;
  font: inherit;
  font-weight: 700;
  letter-spacing: 0;
  transition: transform var(--motion-fast), background-color var(--motion-fast), color var(--motion-fast), box-shadow var(--motion-fast);
}

.ui-button {
  min-height: var(--control-height-md);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: 0 var(--space-4);
  border-radius: var(--radius-pill);
}

.ui-button--sm { min-height: var(--control-height-sm); padding-inline: var(--space-3); font-size: 13px; }
.ui-button--lg { min-height: var(--control-height-lg); padding-inline: var(--space-5); font-size: 16px; }
.ui-button--primary { background: var(--color-accent); color: #fff; }
.ui-button--secondary { background: var(--color-accent-soft); color: var(--color-accent-strong); }
.ui-button--ghost { background: transparent; color: var(--color-text-secondary); }
.ui-button--danger { background: #fff0f2; color: var(--color-danger); }
.ui-button:hover { transform: translateY(-1px); }
.ui-button:disabled { opacity: 0.45; transform: none; cursor: not-allowed; }

.ui-icon-button {
  width: var(--control-height-md);
  height: var(--control-height-md);
  display: inline-grid;
  place-items: center;
  border-radius: 50%;
}

.ui-icon-button--sm { width: var(--control-height-sm); height: var(--control-height-sm); }
.ui-icon-button--lg { width: var(--control-height-lg); height: var(--control-height-lg); }
.ui-icon-button--plain { background: transparent; color: var(--color-text-secondary); }
.ui-icon-button--soft { background: var(--color-surface-subtle); color: var(--color-accent-strong); }
.ui-icon-button--solid { background: var(--color-accent); color: #fff; }

.ui-fab {
  min-height: var(--control-height-lg);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: 0 var(--space-5);
  border-radius: var(--radius-pill);
  background: var(--color-accent);
  color: #fff;
  box-shadow: var(--shadow-floating);
}

.ui-fab--compact {
  width: var(--control-height-lg);
  padding: 0;
}

.ui-fab--compact .ui-fab-label {
  width: 0;
  opacity: 0;
  overflow: hidden;
}

.ui-panel {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.ui-panel--subtle { background: var(--color-surface-subtle); }
.ui-panel--accent { background: var(--color-accent-soft); border-color: transparent; }

.ui-sheet {
  position: fixed;
  inset: 0;
  z-index: var(--z-sheet);
}

.ui-sheet-backdrop {
  position: absolute;
  inset: 0;
  border: 0;
  background: rgba(15, 23, 42, 0.24);
}

.ui-sheet-panel {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  max-height: calc(100dvh - 24px);
  overflow: auto;
  padding: var(--space-5) var(--space-4) max(var(--space-6), env(safe-area-inset-bottom, 0px));
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  background: var(--color-surface);
  box-shadow: var(--shadow-sheet);
}
```

Add this after the token import in `src/app/globals.css`:

```css
@import "../styles/primitives.css";
```

- [ ] **Step 6: Verify and commit**

Run:

```bash
npm test -- tests/uiPrimitives.test.ts tests/uiCssGuardrails.test.ts
npm run typecheck
```

Expected: both commands PASS.

Commit:

```bash
git add src/styles/primitives.css src/app/globals.css src/components/ui tests/uiPrimitives.test.ts tests/uiCssGuardrails.test.ts
git commit -m "Add action and surface primitives"
```

---

### Task 3: Data Primitives

**Files:**
- Create: `src/components/ui/PriceChange.tsx`
- Create: `src/components/ui/JudgmentChip.tsx`
- Create: `src/components/ui/MetricTile.tsx`
- Create: `src/components/ui/DataTable.tsx`
- Modify: `src/components/ui/index.ts`
- Modify: `src/styles/primitives.css`
- Modify: `tests/uiPrimitives.test.ts`

- [ ] **Step 1: Write failing data primitive tests**

Append to `tests/uiPrimitives.test.ts`:

```ts
import { priceChangeToneForValue } from "../src/components/ui/PriceChange";

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
  assert.match(judgmentChipSource, /type JudgmentChipTone = "neutral" \| "positive" \| "negative" \| "warning" \| "accent";/);
  assert.match(metricTileSource, /ui-metric-tile/);
  assert.match(dataTableSource, /role=\{role\}/);
  assert.match(primitivesCss, /\.ui-price-change\s*\{/);
  assert.match(primitivesCss, /\.ui-judgment-chip\s*\{/);
  assert.match(primitivesCss, /\.ui-metric-tile\s*\{/);
  assert.match(primitivesCss, /\.ui-data-table\s*\{/);
});
```

- [ ] **Step 2: Run tests and confirm they fail**

Run:

```bash
npm test -- tests/uiPrimitives.test.ts
```

Expected: FAIL because `PriceChange.tsx` and related data primitive files do not exist.

- [ ] **Step 3: Add data primitive components**

Create `src/components/ui/PriceChange.tsx`:

```tsx
import type { HTMLAttributes } from "react";

type PriceChangeTone = "positive" | "negative" | "neutral";

function priceChangeToneForValue(value: number | undefined): PriceChangeTone {
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0) return "neutral";
  return value > 0 ? "positive" : "negative";
}

type PriceChangeProps = HTMLAttributes<HTMLSpanElement> & {
  value?: number;
  children: string;
  tone?: PriceChangeTone;
};

export default function PriceChange({ value, tone = priceChangeToneForValue(value), className = "", children, ...props }: PriceChangeProps) {
  return (
    <span className={["ui-price-change", `ui-price-change--${tone}`, className].filter(Boolean).join(" ")} {...props}>
      {children}
    </span>
  );
}

export { priceChangeToneForValue };
export type { PriceChangeProps, PriceChangeTone };
```

Create `src/components/ui/JudgmentChip.tsx`:

```tsx
import type { HTMLAttributes, ReactNode } from "react";

type JudgmentChipTone = "neutral" | "positive" | "negative" | "warning" | "accent";

type JudgmentChipProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: JudgmentChipTone;
  icon?: ReactNode;
};

export default function JudgmentChip({ tone = "neutral", icon, className = "", children, ...props }: JudgmentChipProps) {
  return (
    <span className={["ui-judgment-chip", `ui-judgment-chip--${tone}`, className].filter(Boolean).join(" ")} {...props}>
      {icon ? <span aria-hidden="true">{icon}</span> : null}
      {children}
    </span>
  );
}

export type { JudgmentChipProps, JudgmentChipTone };
```

Create `src/components/ui/MetricTile.tsx`:

```tsx
import type { HTMLAttributes, ReactNode } from "react";

type MetricTileProps = HTMLAttributes<HTMLElement> & {
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  tone?: "default" | "accent" | "positive" | "negative";
};

export default function MetricTile({ label, value, caption, tone = "default", className = "", ...props }: MetricTileProps) {
  return (
    <article className={["ui-metric-tile", `ui-metric-tile--${tone}`, className].filter(Boolean).join(" ")} {...props}>
      <span>{label}</span>
      <strong>{value}</strong>
      {caption ? <small>{caption}</small> : null}
    </article>
  );
}

export type { MetricTileProps };
```

Create `src/components/ui/DataTable.tsx`:

```tsx
import type { HTMLAttributes } from "react";

type DataTableProps = HTMLAttributes<HTMLDivElement> & {
  role?: "table" | "list";
  density?: "comfortable" | "compact";
};

export default function DataTable({
  role = "table",
  density = "comfortable",
  className = "",
  ...props
}: DataTableProps) {
  return <div role={role} className={["ui-data-table", `ui-data-table--${density}`, className].filter(Boolean).join(" ")} {...props} />;
}

export type { DataTableProps };
```

Update `src/components/ui/index.ts`:

```ts
export { default as Button } from "./Button";
export { default as IconButton } from "./IconButton";
export { default as FloatingActionButton } from "./FloatingActionButton";
export { default as Panel } from "./Panel";
export { default as Sheet } from "./Sheet";
export { default as PriceChange, priceChangeToneForValue } from "./PriceChange";
export { default as JudgmentChip } from "./JudgmentChip";
export { default as MetricTile } from "./MetricTile";
export { default as DataTable } from "./DataTable";
```

- [ ] **Step 4: Add data CSS**

Append to `src/styles/primitives.css`:

```css
.ui-price-change {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  padding: 0 var(--space-3);
  border-radius: var(--radius-pill);
  font-size: 14px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.ui-price-change--positive { color: var(--color-positive); background: rgba(12, 166, 120, 0.1); }
.ui-price-change--negative { color: var(--color-negative); background: rgba(229, 72, 77, 0.1); }
.ui-price-change--neutral { color: var(--color-neutral); background: var(--color-surface-subtle); }

.ui-judgment-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-height: 30px;
  padding: 0 var(--space-3);
  border-radius: var(--radius-pill);
  font-size: 13px;
  font-weight: 800;
  white-space: nowrap;
}

.ui-judgment-chip--neutral { color: var(--color-text-secondary); background: var(--color-surface-subtle); }
.ui-judgment-chip--positive { color: var(--color-positive); background: rgba(12, 166, 120, 0.1); }
.ui-judgment-chip--negative { color: var(--color-negative); background: rgba(229, 72, 77, 0.1); }
.ui-judgment-chip--warning { color: #a16207; background: rgba(245, 159, 0, 0.14); }
.ui-judgment-chip--accent { color: var(--color-accent-strong); background: var(--color-accent-soft); }

.ui-metric-tile {
  min-width: 0;
  padding: var(--space-5);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.ui-metric-tile > span {
  display: block;
  color: var(--color-text-muted);
  font-size: 13px;
  font-weight: 800;
}

.ui-metric-tile > strong {
  display: block;
  margin-top: var(--space-2);
  color: var(--color-text-primary);
  font-size: 22px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.ui-metric-tile > small {
  display: block;
  margin-top: var(--space-1);
  color: var(--color-text-muted);
  font-size: 13px;
  font-weight: 700;
}

.ui-data-table {
  width: 100%;
  overflow: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.ui-data-table--compact {
  font-size: 14px;
}
```

- [ ] **Step 5: Verify and commit**

Run:

```bash
npm test -- tests/uiPrimitives.test.ts
npm run typecheck
```

Expected: both commands PASS.

Commit:

```bash
git add src/components/ui src/styles/primitives.css tests/uiPrimitives.test.ts
git commit -m "Add data display primitives"
```

---

### Task 4: Shared Navigation Shell

**Files:**
- Create: `src/components/layout/AppShellNav.tsx`
- Create: `src/components/layout/MobileNavLauncher.tsx`
- Modify: `src/components/AppNavigationMenu.tsx`
- Modify: `src/components/AppNavigationLinks.tsx`
- Modify: `src/styles/primitives.css`
- Modify: `src/app/globals.css`
- Modify: `tests/appNavigationMenu.test.ts`
- Modify: `tests/uiCssGuardrails.test.ts`

- [ ] **Step 1: Write failing navigation boundary tests**

Add these source reads to `tests/appNavigationMenu.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

const appNavigationMenuSource = readFileSync(join(process.cwd(), "src/components/AppNavigationMenu.tsx"), "utf8");
const appShellNavSource = readFileSync(join(process.cwd(), "src/components/layout/AppShellNav.tsx"), "utf8");
const mobileNavLauncherSource = readFileSync(join(process.cwd(), "src/components/layout/MobileNavLauncher.tsx"), "utf8");
```

Add this test:

```ts
test("navigation menu delegates desktop and mobile chrome to layout primitives", () => {
  assert.match(appNavigationMenuSource, /AppShellNav/);
  assert.match(appNavigationMenuSource, /MobileNavLauncher/);
  assert.doesNotMatch(appNavigationMenuSource, /function BottomNavigationLink/);
  assert.match(appShellNavSource, /app-desktop-nav/);
  assert.match(appShellNavSource, /AppNavigationLinks/);
  assert.match(mobileNavLauncherSource, /nextMobileNavigationOpen/);
  assert.match(mobileNavLauncherSource, /FloatingActionButton/);
  assert.match(mobileNavLauncherSource, /Menu/);
});
```

Add to `tests/uiCssGuardrails.test.ts`:

```ts
test("navigation primitives use shared mobile z-index and action sizing", () => {
  assert.match(css, /\.app-bottom-menu-trigger\s*\{[\s\S]*?z-index:\s*var\(--z-mobile-nav\);/);
  assert.match(css, /\.app-bottom-context-action\s*\{[\s\S]*?min-height:\s*var\(--control-height-lg\);/);
  assert.match(css, /\.app-bottom-nav\s*\{[\s\S]*?box-shadow:\s*var\(--shadow-floating\);/);
});
```

- [ ] **Step 2: Run tests and confirm they fail**

Run:

```bash
npm test -- tests/appNavigationMenu.test.ts tests/uiCssGuardrails.test.ts
```

Expected: FAIL because layout navigation files do not exist and `AppNavigationMenu` still owns the mobile link component.

- [ ] **Step 3: Add desktop shell component**

Create `src/components/layout/AppShellNav.tsx`:

```tsx
import AppNavigationLinks from "@/components/AppNavigationLinks";
import type { AppNavigationItem } from "@/components/appNavigationMenuHelpers";

type AppShellNavProps = {
  items: ReadonlyArray<AppNavigationItem>;
};

export default function AppShellNav({ items }: AppShellNavProps) {
  return (
    <nav className="app-desktop-nav" aria-label="주요 페이지">
      <div className="app-desktop-nav-inner">
        <a className="app-desktop-nav-brand" href="/">스톡스토커</a>
        <AppNavigationLinks items={items} variant="global" className="app-desktop-nav-links" />
      </div>
    </nav>
  );
}
```

- [ ] **Step 4: Add mobile launcher component**

Create `src/components/layout/MobileNavLauncher.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { BarChart3, FileText, GitCompareArrows, Menu, PencilLine, Plus, Search } from "lucide-react";
import { FloatingActionButton } from "@/components/ui";
import {
  mobileContextActionVariant,
  nextMobileNavigationOpen,
  type AppNavigationItem,
  type GlobalNavigationId,
  type MobileContextActionVariant,
} from "@/components/appNavigationMenuHelpers";

type MobileContextAction = {
  label: string;
  ariaLabel?: string;
  disabled?: boolean;
  icon?: "plus" | "edit";
  onClick: () => void;
};

type MobileNavLauncherProps = {
  items: ReadonlyArray<AppNavigationItem>;
  mobileContextAction?: MobileContextAction;
};

export default function MobileNavLauncher({ items, mobileContextAction }: MobileNavLauncherProps) {
  const mobileNavigation = useMobileFloatingNavigation();
  const MobileContextIcon = mobileContextAction?.icon === "edit" ? PencilLine : Plus;

  return (
    <>
      {mobileNavigation.isOpen ? (
        <button
          type="button"
          className="app-bottom-nav-backdrop"
          aria-label="주요 페이지 메뉴 닫기"
          onClick={mobileNavigation.closeFromOutside}
        />
      ) : null}

      <button
        type="button"
        className={["app-bottom-menu-trigger", mobileNavigation.isOpen ? "is-hidden" : ""].filter(Boolean).join(" ")}
        aria-label="주요 페이지 메뉴 열기"
        aria-expanded={mobileNavigation.isOpen}
        onClick={mobileNavigation.toggle}
      >
        <Menu aria-hidden="true" />
      </button>

      <nav className={["app-bottom-nav", mobileNavigation.isOpen ? "is-open" : ""].filter(Boolean).join(" ")} aria-label="주요 페이지" aria-hidden={!mobileNavigation.isOpen}>
        {items.map((item) => (
          <BottomNavigationLink
            key={`${item.id}:${item.href}`}
            item={item}
            tabIndex={mobileNavigation.isOpen ? undefined : -1}
          />
        ))}
      </nav>

      {mobileContextAction ? (
        <FloatingActionButton
          className="app-bottom-context-action"
          variant={mobileNavigation.contextActionVariant === "compact" ? "compact" : "full"}
          disabled={mobileContextAction.disabled}
          aria-label={mobileContextAction.ariaLabel || mobileContextAction.label}
          icon={<MobileContextIcon aria-hidden="true" />}
          onClick={() => {
            mobileNavigation.closeFromOutside();
            mobileContextAction.onClick();
          }}
        >
          {mobileContextAction.label}
        </FloatingActionButton>
      ) : null}
    </>
  );
}

function BottomNavigationLink({ item, tabIndex }: { item: AppNavigationItem; tabIndex?: number }) {
  const Icon = iconForItem(item.id);
  return (
    <a className={["app-bottom-nav-item", item.active ? "active" : ""].filter(Boolean).join(" ")} href={item.href} aria-current={item.active ? "page" : undefined} tabIndex={tabIndex}>
      <Icon aria-hidden="true" />
      <span>{item.shortLabel || item.label}</span>
    </a>
  );
}

function iconForItem(id: GlobalNavigationId | undefined) {
  if (id === "detail") return FileText;
  if (id === "compare") return GitCompareArrows;
  if (id === "marketCap") return BarChart3;
  return Search;
}

function useMobileFloatingNavigation(): {
  isOpen: boolean;
  contextActionVariant: MobileContextActionVariant;
  toggle: () => void;
  closeFromOutside: () => void;
} {
  const [isOpen, setIsOpen] = useState(false);
  const [contextActionVariant, setContextActionVariant] = useState<MobileContextActionVariant>(() => (
    typeof window === "undefined" ? "full" : mobileContextActionVariant(window.scrollY)
  ));

  useEffect(() => {
    let frame = 0;

    const update = () => {
      frame = 0;
      setContextActionVariant(mobileContextActionVariant(window.scrollY));
      setIsOpen((currentOpen) => nextMobileNavigationOpen({ currentOpen, event: "scroll" }));
    };

    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(update);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return {
    isOpen,
    contextActionVariant,
    toggle: () => setIsOpen((currentOpen) => nextMobileNavigationOpen({ currentOpen, event: "toggle" })),
    closeFromOutside: () => setIsOpen((currentOpen) => nextMobileNavigationOpen({ currentOpen, event: "outside" })),
  };
}
```

- [ ] **Step 5: Refactor `AppNavigationMenu`**

Replace direct desktop/mobile rendering in `src/components/AppNavigationMenu.tsx` with:

```tsx
"use client";

import { useMemo } from "react";
import AppShellNav from "@/components/layout/AppShellNav";
import MobileNavLauncher from "@/components/layout/MobileNavLauncher";
import {
  globalNavigationItemsForContext,
  type AppNavigationContext,
} from "@/components/appNavigationMenuHelpers";

type MobileContextAction = {
  label: string;
  ariaLabel?: string;
  disabled?: boolean;
  icon?: "plus" | "edit";
  onClick: () => void;
};

type AppNavigationMenuProps = {
  context: AppNavigationContext;
  className?: string;
  mobileContextAction?: MobileContextAction;
  suppressMobileChrome?: boolean;
};

export default function AppNavigationMenu({
  context,
  className = "",
  mobileContextAction,
  suppressMobileChrome = false,
}: AppNavigationMenuProps) {
  const items = useMemo(() => globalNavigationItemsForContext(context), [context]);

  return (
    <div className={["app-navigation-chrome", className].filter(Boolean).join(" ")}>
      <AppShellNav items={items} />
      {!suppressMobileChrome ? (
        <MobileNavLauncher items={items} mobileContextAction={mobileContextAction} />
      ) : null}
    </div>
  );
}
```

- [ ] **Step 6: Align navigation CSS with primitive tokens**

In `src/app/globals.css`, update existing `.app-bottom-*` rules so they keep their class names and use tokenized values:

```css
.app-bottom-nav {
  box-shadow: var(--shadow-floating);
}

.app-bottom-menu-trigger {
  z-index: var(--z-mobile-nav);
  width: var(--control-height-lg);
  height: var(--control-height-lg);
}

.app-bottom-context-action {
  z-index: calc(var(--z-mobile-nav) + 1);
  min-height: var(--control-height-lg);
}
```

Keep existing positioning, open/close transform, and media-query behavior unless a tokenized value replaces a direct duplicate.

- [ ] **Step 7: Verify and commit**

Run:

```bash
npm test -- tests/appNavigationMenu.test.ts tests/uiPrimitives.test.ts tests/uiCssGuardrails.test.ts
npm run typecheck
```

Expected: both commands PASS.

Commit:

```bash
git add src/components/AppNavigationMenu.tsx src/components/AppNavigationLinks.tsx src/components/layout src/app/globals.css src/styles/primitives.css tests/appNavigationMenu.test.ts tests/uiCssGuardrails.test.ts
git commit -m "Refactor navigation onto shared layout primitives"
```

---

### Task 5: Compare Mobile Editor Pattern

**Files:**
- Create: `src/components/compare/CompareSelectedTickerList.tsx`
- Create: `src/components/compare/CompareEditSheet.tsx`
- Modify: `src/components/StockCompare.tsx`
- Modify: `src/components/stockCompareHelpers.ts`
- Modify: `src/app/globals.css`
- Modify: `tests/stockCompareHelpers.test.ts`
- Modify: `tests/uiCssGuardrails.test.ts`

- [ ] **Step 1: Write failing compare label tests**

Add to imports in `tests/stockCompareHelpers.test.ts`:

```ts
  compareCollapsedTickerLabel,
```

Add this test:

```ts
test("compare collapsed ticker label uses Korean names for KR and tickers for US", () => {
  assert.equal(compareCollapsedTickerLabel([
    { ticker: "KR:035720", label: "카카오" },
    { ticker: "US:NVDA", label: "엔비디아" },
    { ticker: "US:AAPL", label: "애플" },
  ]), "카카오 · NVDA · AAPL");

  assert.equal(compareCollapsedTickerLabel([
    { ticker: "KR:005930", label: "삼성전자" },
    { ticker: "KR:000660", label: "SK하이닉스" },
  ]), "삼성전자 · SK하이닉스");

  assert.equal(compareCollapsedTickerLabel([]), "비교 종목");
});
```

Add to `tests/uiCssGuardrails.test.ts`:

```ts
test("compare mobile editor keeps selected tickers inside the sheet and uses shared floating action", () => {
  assert.match(compareSource, /CompareEditSheet/);
  assert.match(compareSource, /compareCollapsedTickerLabel/);
  assert.doesNotMatch(compareSource, /function CompareSearchSheet/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.compare-ticker-rail\s*\{[\s\S]*?display:\s*none;/);
  assert.match(css, /\.compare-sheet-selection\s*\{[\s\S]*?border:\s*1px solid var\(--color-border\);/);
  assert.match(css, /\.app-bottom-context-action\s*\{[\s\S]*?transition:[\s\S]*?transform var\(--motion-standard\)/);
});
```

- [ ] **Step 2: Run tests and confirm they fail**

Run:

```bash
npm test -- tests/stockCompareHelpers.test.ts tests/uiCssGuardrails.test.ts
```

Expected: FAIL because the compact label helper and extracted compare sheet do not exist.

- [ ] **Step 3: Add compact label helper**

In `src/components/stockCompareHelpers.ts`, add:

```ts
type CompareCollapsedTickerEntry = {
  ticker: string;
  label: string;
};

export function compareCollapsedTickerLabel(entries: readonly CompareCollapsedTickerEntry[]): string {
  if (!entries.length) return "비교 종목";
  return entries.map((entry) => {
    if (entry.ticker.startsWith("KR:")) return entry.label || displayTickerRef(entry.ticker);
    return displayTickerRef(entry.ticker);
  }).join(" · ");
}
```

- [ ] **Step 4: Extract selected ticker list**

Create `src/components/compare/CompareSelectedTickerList.tsx`:

```tsx
export type CompareSelectedTickerEntry = {
  ticker: string;
  label: string;
  removeDisabled: boolean;
};

type CompareSelectedTickerListProps = {
  entries: CompareSelectedTickerEntry[];
  onRemove: (ticker: string) => void;
  emptyLabel: string;
  className?: string;
};

export default function CompareSelectedTickerList({
  entries,
  onRemove,
  emptyLabel,
  className = "",
}: CompareSelectedTickerListProps) {
  return (
    <div className={["compare-pick-list", className].filter(Boolean).join(" ")}>
      {entries.length ? entries.map((entry) => (
        <span key={entry.ticker}>
          <em className="compare-pick-label">{entry.label}</em>
          <button
            type="button"
            onClick={() => onRemove(entry.ticker)}
            aria-label={`${entry.label} 삭제`}
            disabled={entry.removeDisabled}
          >
            ×
          </button>
        </span>
      )) : (
        <span className="is-empty">
          <em className="compare-pick-label">{emptyLabel}</em>
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Extract compare edit sheet**

Create `src/components/compare/CompareEditSheet.tsx`:

```tsx
import SymbolAutocomplete from "@/components/SymbolAutocomplete";
import CompareSelectedTickerList, { type CompareSelectedTickerEntry } from "@/components/compare/CompareSelectedTickerList";
import { Sheet, Button } from "@/components/ui";
import { MAX_COMPARE } from "@/components/stockCompareHelpers";
import type { SymbolSearchItem } from "@/lib/symbolTypes";

type CompareEditSheetProps = {
  isOpen: boolean;
  value: string;
  onValueChange: (value: string) => void;
  onSelect: (item: SymbolSearchItem) => void;
  onClose: () => void;
  compareLimitReached: boolean;
  selectedCount: number;
  selectedTickers: CompareSelectedTickerEntry[];
  onRemoveTicker: (ticker: string) => void;
  closeLabel: string;
};

export default function CompareEditSheet({
  isOpen,
  value,
  onValueChange,
  onSelect,
  onClose,
  compareLimitReached,
  selectedCount,
  selectedTickers,
  onRemoveTicker,
  closeLabel,
}: CompareEditSheetProps) {
  return (
    <Sheet open={isOpen} labelledBy="compare-add-sheet-title" onClose={onClose} className="compare-add-sheet">
      <header className="compare-sheet-header">
        <div>
          <span>종목 편집</span>
          <h2 id="compare-add-sheet-title">비교 종목 편집</h2>
        </div>
        <Button variant="secondary" size="md" onClick={onClose}>{closeLabel}</Button>
      </header>
      <section className="compare-sheet-selection" aria-label="선택한 종목">
        <div>
          <span>선택한 종목</span>
          <strong>{selectedCount}/{MAX_COMPARE}</strong>
        </div>
        <CompareSelectedTickerList
          entries={selectedTickers}
          onRemove={onRemoveTicker}
          emptyLabel="아직 선택한 종목이 없어요"
          className="compare-sheet-picks"
        />
      </section>
      <SymbolAutocomplete
        id="compare-ticker-sheet"
        value={value}
        onValueChange={onValueChange}
        onSelect={onSelect}
        placeholder={compareLimitReached ? "종목을 빼면 다시 추가할 수 있어요" : "추가할 종목명 또는 티커"}
        buttonLabel={compareLimitReached ? "완료" : "추가"}
        label="비교할 국내·미국 주식 검색"
        disabled={compareLimitReached}
        className="stock-search-form compare-add-form compare-sheet-search"
        autoFocusOnMount
      />
    </Sheet>
  );
}
```

- [ ] **Step 6: Wire the compare page**

In `src/components/StockCompare.tsx`:

- Import `CompareEditSheet`.
- Import `CompareSelectedTickerList` and its entry type.
- Import `compareCollapsedTickerLabel`.
- Delete the local `CompareSelectedTickerList` and `CompareSearchSheet` functions.
- Keep the desktop `.compare-ticker-rail` section.
- Pass a compact aria label to the floating context action:

```tsx
const compactSelectionLabel = compareCollapsedTickerLabel(selectedTickerEntries);
```

Use:

```tsx
<AppNavigationMenu
  context={{ page: "compare", originTicker, detailHref }}
  suppressMobileChrome={isMobileSearchOpen}
  mobileContextAction={{
    label: compactSelectionLabel === "비교 종목" ? "종목 편집" : compactSelectionLabel,
    ariaLabel: "비교 종목 편집",
    icon: "edit",
    onClick: () => setIsMobileSearchOpen(true),
  }}
/>
```

Replace the local sheet with:

```tsx
<CompareEditSheet
  isOpen={isMobileSearchOpen}
  value={input}
  onValueChange={setInput}
  onSelect={addSymbol}
  onClose={() => setIsMobileSearchOpen(false)}
  compareLimitReached={compareLimitReached}
  selectedCount={selectedCount}
  selectedTickers={selectedTickerEntries}
  onRemoveTicker={removeTicker}
  closeLabel={compareLimitReached ? "완료" : "닫기"}
/>
```

- [ ] **Step 7: Update compare CSS**

In `src/app/globals.css`, keep desktop rails and hide mobile top selected ticker rail:

```css
@media (max-width: 640px) {
  .compare-ticker-rail {
    display: none;
  }
}
```

Update sheet styles to target primitive sheet structure:

```css
.compare-add-sheet .ui-sheet-panel {
  display: grid;
  gap: var(--space-4);
}

.compare-sheet-selection {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface-subtle);
}

.app-bottom-context-action {
  max-width: min(320px, calc(100vw - 96px));
  transition:
    width var(--motion-standard),
    padding var(--motion-standard),
    transform var(--motion-standard),
    opacity var(--motion-fast);
}

.app-bottom-context-action .ui-fab-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 8: Verify and commit**

Run:

```bash
npm test -- tests/stockCompareHelpers.test.ts tests/uiPrimitives.test.ts tests/uiCssGuardrails.test.ts
npm run typecheck
```

Expected: both commands PASS.

Commit:

```bash
git add src/components/StockCompare.tsx src/components/compare src/components/stockCompareHelpers.ts src/app/globals.css tests/stockCompareHelpers.test.ts tests/uiCssGuardrails.test.ts
git commit -m "Move compare editing into shared sheet pattern"
```

---

### Task 6: Page Pattern Migration

**Files:**
- Create: `src/components/layout/SearchChrome.tsx`
- Modify: `src/components/SearchChromeWithNavigation.tsx`
- Modify: `src/components/MarketCapDashboard.tsx`
- Modify: `src/components/StockDashboard.tsx`
- Modify: `src/components/StockDetailSections.tsx`
- Modify: `src/components/TechnicalAnalysisPage.tsx`
- Modify: `src/components/TechnicalAnalysisSections.tsx`
- Modify: `src/app/globals.css`
- Modify: `tests/uiCssGuardrails.test.ts`
- Modify: `tests/marketCapDashboardHelpers.test.ts`

- [ ] **Step 1: Write failing page pattern guardrails**

Add these reads to `tests/uiCssGuardrails.test.ts`:

```ts
const searchChromeFrameSource = readFileSync(join(process.cwd(), "src/components/layout/SearchChrome.tsx"), "utf8");
```

Add this test:

```ts
test("page patterns use shared search and data primitives", () => {
  assert.match(searchChromeFrameSource, /search-chrome-frame/);
  assert.match(searchChromeSource, /SearchChromeFrame/);
  assert.match(marketCapSource, /DataTable/);
  assert.match(marketCapSource, /PriceChange/);
  assert.match(marketCapSource, /Panel/);
  assert.match(css, /\.market-cap-table-row\s*\{[\s\S]*?font-variant-numeric:\s*tabular-nums;/);
  assert.match(css, /\.stock-detail-app \.quick-read\s*\{[\s\S]*?gap:\s*var\(--space-4\);/);
});
```

- [ ] **Step 2: Run tests and confirm they fail**

Run:

```bash
npm test -- tests/uiCssGuardrails.test.ts tests/marketCapDashboardHelpers.test.ts
```

Expected: FAIL because `SearchChrome.tsx` does not exist and market-cap still renders raw table wrappers.

- [ ] **Step 3: Add search chrome frame**

Create `src/components/layout/SearchChrome.tsx`:

```tsx
import type { ReactNode, RefCallback } from "react";

type SearchChromeFrameProps = {
  className: string;
  frameRef?: RefCallback<HTMLElement>;
  children: ReactNode;
};

export default function SearchChromeFrame({ className, frameRef, children }: SearchChromeFrameProps) {
  return (
    <section ref={frameRef} className={["search-chrome-frame", className].filter(Boolean).join(" ")}>
      {children}
    </section>
  );
}
```

Modify `src/components/SearchChromeWithNavigation.tsx` to use `SearchChromeFrame`:

```tsx
"use client";

import type { ReactNode } from "react";
import AppNavigationMenu from "@/components/AppNavigationMenu";
import SearchChromeFrame from "@/components/layout/SearchChrome";
import type { AppNavigationContext } from "@/components/appNavigationMenuHelpers";
import type { CollapsibleSearchChrome } from "@/components/useCollapsibleSearchChrome";

type SearchChromeWithNavigationProps = {
  className: string;
  context: AppNavigationContext;
  searchChrome: CollapsibleSearchChrome;
  children: ReactNode;
};

export default function SearchChromeWithNavigation({
  className,
  context,
  searchChrome,
  children,
}: SearchChromeWithNavigationProps) {
  return (
    <>
      <span ref={searchChrome.anchorRef} className="search-chrome-scroll-anchor" aria-hidden="true" />
      <SearchChromeFrame frameRef={searchChrome.containerRef} className={searchChrome.className(className)}>
        <AppNavigationMenu context={context} />
        {children}
      </SearchChromeFrame>
    </>
  );
}
```

- [ ] **Step 4: Migrate market-cap table primitives**

In `src/components/MarketCapDashboard.tsx`, import:

```tsx
import { DataTable, Panel, PriceChange } from "@/components/ui";
```

Replace:

```tsx
<section className="market-cap-panel" aria-label="시가총액 순위">
```

with:

```tsx
<Panel className="market-cap-panel" aria-label="시가총액 순위">
```

Replace:

```tsx
<div className="market-cap-table" role="table" aria-label={`${marketCapScopeLabel(scope)} 시가총액 상위 종목`}>
```

with:

```tsx
<DataTable className="market-cap-table" role="table" density="compact" aria-label={`${marketCapScopeLabel(scope)} 시가총액 상위 종목`}>
```

Replace the change cell:

```tsx
<span className={`market-cap-change ${marketCapChangeTone(row)}`}>{formatMarketCapChange(row)}</span>
```

with:

```tsx
<PriceChange className={`market-cap-change ${marketCapChangeTone(row)}`} value={row.priceChangePercent}>
  {formatMarketCapChange(row)}
</PriceChange>
```

Close `Panel` and `DataTable` with matching tags.

- [ ] **Step 5: Tokenize page pattern CSS**

In `src/app/globals.css`, update page pattern declarations without changing DOM behavior:

```css
.stock-detail-app .quick-read {
  gap: var(--space-4);
}

.market-cap-table-row {
  font-variant-numeric: tabular-nums;
}

.market-cap-panel {
  border-radius: var(--radius-md);
}

.search-chrome-frame {
  width: 100%;
}
```

Keep the existing media queries and layout rules that control detail, compare, technical, and market-cap responsive behavior.

- [ ] **Step 6: Use primitives in repeated detail and technical UI**

In `src/components/StockDetailSections.tsx` and `src/components/TechnicalAnalysisSections.tsx`, replace repeated hand-styled status chips only where the surrounding markup already renders a chip-like `span`.

Use:

```tsx
import { JudgmentChip } from "@/components/ui";
```

For a positive or accent chip, render:

```tsx
<JudgmentChip tone="accent">매수신호 관망</JudgmentChip>
```

Do not change copy, section order, chart behavior, or API-driven conditions.

- [ ] **Step 7: Verify and commit**

Run:

```bash
npm test -- tests/uiCssGuardrails.test.ts tests/marketCapDashboardHelpers.test.ts tests/technicalAnalysisHelpers.test.ts
npm run typecheck
```

Expected: both commands PASS.

Commit:

```bash
git add src/components/SearchChromeWithNavigation.tsx src/components/layout/SearchChrome.tsx src/components/MarketCapDashboard.tsx src/components/StockDashboard.tsx src/components/StockDetailSections.tsx src/components/TechnicalAnalysisPage.tsx src/components/TechnicalAnalysisSections.tsx src/app/globals.css tests/uiCssGuardrails.test.ts tests/marketCapDashboardHelpers.test.ts
git commit -m "Apply shared page pattern primitives"
```

---

### Task 7: Verification And Visual QA

**Files:**
- Modify only files touched by Tasks 1-6 if verification finds defects.

- [ ] **Step 1: Run focused UI tests**

Run:

```bash
npm test -- tests/uiPrimitives.test.ts tests/uiCssGuardrails.test.ts tests/appNavigationMenu.test.ts tests/stockCompareHelpers.test.ts tests/marketCapDashboardHelpers.test.ts tests/searchAlignmentGuard.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full TypeScript and build checks**

Run:

```bash
npm run typecheck
npm run build
```

Expected: both commands PASS.

- [ ] **Step 3: Start the dev server**

Run:

```bash
npm run dev
```

Expected: local server starts on the default Next.js port or the next available port. Keep the session open only during visual verification.

- [ ] **Step 4: Capture visual states**

Use browser automation to inspect these URLs:

- Desktop 1440px: `/`, `/?ticker=US%3ANVDA`, `/compare?tickers=US%3ANVDA,US%3AAAPL&origin=US%3ANVDA`, `/market-cap`, `/technical?ticker=US%3ANVDA`.
- Mobile 390px: same URL set.
- Compare mobile states: top of page, scrolled page, editor sheet open, editor search focused with the keyboard-safe layout simulated by viewport height reduction.

Save screenshots under `output/playwright/design-system-refresh/`. This directory is an ignored artifact location.

- [ ] **Step 5: Fix visual defects found by inspection**

For each observed defect, make the smallest scoped change and rerun the focused test that covers the touched area:

```bash
npm test -- tests/uiCssGuardrails.test.ts tests/searchAlignmentGuard.test.ts
```

Expected: PASS after each scoped fix.

- [ ] **Step 6: Run final verification**

Run:

```bash
npm test
npm run typecheck
npm run build
```

Expected: all commands PASS.

- [ ] **Step 7: Stop the dev server and commit final fixes**

Stop the dev server with `Ctrl-C`.

If Step 5 changed files, commit:

```bash
git add src tests
git commit -m "Polish design system visual QA"
```

If Step 5 did not change files, do not create an empty commit.
