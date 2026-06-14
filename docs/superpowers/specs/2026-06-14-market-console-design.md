# Market Console Design Spec

## Decision

Use **B: Market Console Content** for the application body and **C: Signature Dashboard** for the landing page.

The body of the product will prioritize trust, readable web-content rhythm, dense scanning only where data matters, and consistent navigation. It must not become a full-screen enterprise dashboard. The landing page can be more expressive and memorable, but it must show real product affordances and keep search available immediately.

## References

- `google-labs-code/design.md`: Use its DESIGN.md structure as the local source of truth.
- `nexu-io/open-design`: Use the DESIGN.md-as-brand-contract convention and componentized artifact workflow; do not copy app code or demo surfaces.
- `VoltAgent/awesome-design-md`: Use Linear, Coinbase, and IBM as pattern inputs. Do not copy a preset directly.
- `shadcn-ui/ui`: Use component philosophy and accessible primitive expectations.
- `shadcnblockscom/shadcn-ui-blocks`: Use as visual inspiration only unless a compatible license is confirmed for a specific block.
- `shadcnblocks/shadcntemplates`: Use only as broad shadcn ecosystem reference.
- `shadcnstore/shadcn-dashboard-landing-template`: MIT; dashboard shell and table ideas are safe to adapt.
- `cruip/tailwind-dashboard-template`: GPL; visual reference only, no code copy.

## Fixed Product Anchors

- Desktop top GNB stays fixed to the top edge.
- Desktop GNB includes global stock search and removes search collapse/expand behavior.
- Desktop contextual navigation remains a floating/sticky table-of-contents rail.
- Compare page uses the rail for selected tickers and add/search.
- Cards nested inside cards are disallowed for the main layout.
- Mobile is a primary surface, not a cleanup pass. Search, sheets, floating buttons, keyboard behavior, and safe-area spacing must be verified directly.
- The service is web content, not an edge-to-edge dashboard. Desktop widths should stay readable, with wider treatment only where tables genuinely need it.

## App Body Direction

The app body should feel like calm financial web content with console-grade clarity:

- White/off-white background.
- Deep ink typography.
- Cobalt blue for action and selection only.
- Hairline borders and tonal backgrounds over heavy shadows.
- Data tables and matrices treated as primary components.
- Detail, compare, technical, and market-cap pages sharing the same shell rhythm.
- Main content width capped for reading; market-cap can go wider for table scanning.

The current issue is not just color. It is accumulated page-specific CSS overrides, experimental variant layers, and inconsistent surface rules. The rework must remove or override those inconsistently applied layers with a coherent token-driven system.

## Landing Direction

Landing is allowed to be more ambitious:

- First viewport shows the product category and useful search immediately.
- Use a signature dark market-console preview or animated board to make the service memorable.
- Avoid generic SaaS hero composition.
- Avoid decorative orbs, bokeh, or abstract gradient illustrations.
- The visual story should represent actual flows: search, score, comparison, market-cap dashboard.
- Landing can be more dramatic than the app body, but it still starts from useful content/search rather than a full-screen decorative dashboard.

## Component Rules

- Top GNB: 64px, white, fixed, hairline bottom, nav left, search right.
- Side rail: 184px desktop, sticky under GNB, compact, white, no artificial height fill.
- Section bands: transparent or white, separated by hairlines, not floating card stacks.
- Repeated stock/metric items can be cards.
- Tables: header gray, row hover subtle blue, tabular numbers.
- Buttons: black/ink default for secondary, cobalt on hover/active; primary cobalt.
- Popovers/sheets: align to source control, avoid covering active input on mobile.
- Mobile sheets: fullscreen only when editing/searching needs keyboard space; otherwise compact bottom actions must keep content visible.
- Mobile floating actions: compact, safe-area aware, never over active suggestions.

## Implementation Scope

1. Add root `DESIGN.md` and align token naming to it.
2. Refactor the global visual layer so the approved system wins over older variant CSS.
3. Rework desktop detail and compare shells into the same readable Market Console Content rhythm.
4. Rework market-cap table to match the console system.
5. Rework landing as Signature Dashboard while preserving immediate search.
6. Verify PC and mobile screenshots for overlap, excessive nesting, keyboard/sheet behavior, and navigation usability.

## Non-Goals

- No provider/data-source changes.
- No new design library migration unless required by the existing code.
- No wholesale external template copy.
- No change to deployed routing semantics.
