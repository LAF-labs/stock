---
version: alpha
name: Stockstalker Market Console
description: "A Korean retail-investor web content product that combines Coinbase-style financial trust, IBM/Carbon data clarity, and Linear-like quiet product chrome. The product uses a fixed top GNB with global search, a desktop floating table-of-contents rail, and carefully placed mobile actions. It is not a full-screen enterprise dashboard; the app should feel like readable financial web content with dense moments where data matters."
colors:
  ink: "#111827"
  ink-muted: "#4b5563"
  ink-subtle: "#7c8794"
  canvas: "#f5f7fa"
  surface: "#ffffff"
  surface-soft: "#f8fafc"
  surface-raised: "#ffffff"
  surface-accent: "#eef6ff"
  surface-console: "#0f172a"
  hairline: "#e5e7eb"
  hairline-soft: "#edf0f3"
  hairline-strong: "#d6dbe3"
  primary: "#2563eb"
  primary-hover: "#1d4ed8"
  primary-soft: "#eaf2ff"
  secondary: "#14b8a6"
  secondary-soft: "#e6fffb"
  warning: "#f59e0b"
  positive: "#0ca678"
  negative: "#e5484d"
  on-primary: "#ffffff"
  on-console: "#f8fafc"
typography:
  display-lg:
    fontFamily: "Pretendard, Apple SD Gothic Neo, Noto Sans KR, Segoe UI, sans-serif"
    fontSize: 44px
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: 0
  display-md:
    fontFamily: "Pretendard, Apple SD Gothic Neo, Noto Sans KR, Segoe UI, sans-serif"
    fontSize: 34px
    fontWeight: 600
    lineHeight: 1.14
    letterSpacing: 0
  title-lg:
    fontFamily: "Pretendard, Apple SD Gothic Neo, Noto Sans KR, Segoe UI, sans-serif"
    fontSize: 24px
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: 0
  title-md:
    fontFamily: "Pretendard, Apple SD Gothic Neo, Noto Sans KR, Segoe UI, sans-serif"
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: 0
  body:
    fontFamily: "Pretendard, Apple SD Gothic Neo, Noto Sans KR, Segoe UI, sans-serif"
    fontSize: 15px
    fontWeight: 500
    lineHeight: 1.55
    letterSpacing: 0
  body-sm:
    fontFamily: "Pretendard, Apple SD Gothic Neo, Noto Sans KR, Segoe UI, sans-serif"
    fontSize: 13px
    fontWeight: 600
    lineHeight: 1.45
    letterSpacing: 0
  caption:
    fontFamily: "Pretendard, Apple SD Gothic Neo, Noto Sans KR, Segoe UI, sans-serif"
    fontSize: 12px
    fontWeight: 700
    lineHeight: 1.35
    letterSpacing: 0
  number:
    fontFamily: "Pretendard, Apple SD Gothic Neo, Noto Sans KR, Segoe UI, ui-monospace, monospace"
    fontSize: 16px
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: 0
rounded:
  xs: 4px
  sm: 6px
  md: 8px
  lg: 12px
  xl: 16px
  pill: 9999px
  full: 9999px
spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
  nav-height: 64px
  desktop-rail: 184px
  desktop-gutter: 28px
components:
  top-gnb:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xs}"
    height: 64px
  global-search:
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: 40px
  side-index:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.md}"
    padding: 14px
  section-band:
    backgroundColor: transparent
    textColor: "{colors.ink}"
    rounded: "{rounded.xs}"
    padding: 32px 0
  table-panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: 0
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.pill}"
    height: 40px
  button-secondary:
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: 36px
---

# Stockstalker Market Console Design System

> Category: Korean retail-investor financial web content
> Calm stock research pages with fixed global search, sticky contextual rails, readable market data, and mobile-first editing flows. Inspired by Open Design's DESIGN.md-as-contract approach, but tuned for Stockstalker's product shell rather than copied from a generic template.

## Overview

Stockstalker is financial web content for Korean retail investors. It should feel calmer than a trading terminal, denser than a marketing site, and more trustworthy than a casual stock blog. The app body follows a **Market Console Content** direction: fixed top navigation with global stock search, a desktop floating table-of-contents rail, readable section bands, and table/list-first financial information where data density matters. It must not become a full-screen enterprise dashboard.

The landing page follows a more expressive **Signature Dashboard** direction: product workflow, market data, and comparison previews can be animated and visually memorable, but the first viewport must still be usable, content-led, and directly connected to search.

The system blends three reference traits: Coinbase-like financial trust, IBM/Carbon-like data density and hairlines, and Linear-like quiet product chrome. It must not become a generic shadcn template. No nested card stacks, no decorative gradient blobs, no purple-blue SaaS wash, and no giant marketing hero that hides the actual product.

## Colors

The app uses white and off-white surfaces, deep ink text, cobalt as the single primary action color, teal only as a secondary data accent, and market red/green only for financial movement. Blue should identify actions, active navigation, focus, and selected rows. Red and green should not be used as backgrounds except for very soft semantic hints.

Desktop app surfaces should rely on hairline borders and tonal steps rather than heavy shadows. The landing page may use a dark console surface (`surface-console`) and one animated accent layer, but the core controls stay in the same token family. The overall page should remain light, readable, and content-like rather than immersive dashboard chrome.

## Typography

Use Pretendard/system Korean UI fonts. Letter spacing is always `0`. Use tabular numbers globally for prices, market caps, scores, percentages, and ranks. Large display sizes are reserved for landing and the primary stock name; panels, side rails, buttons, tables, and compact cards use restrained title/body sizes.

Weights should cluster around 500-700. Do not use ultra-bold labels as decoration. Data values can be strong, but surrounding labels must stay quiet.

## Layout

The fixed desktop GNB is the product chrome and always includes global search. Desktop content uses a two-column content shell when contextual navigation exists: a 184px sticky rail and a main content column with a 28px gutter. The main column should stay close to editorial web-content widths instead of stretching edge-to-edge. Detail, technical, and compare pages should share this rhythm. Market-cap can be wider for table readability, but it still reads as a web page section, not an admin dashboard canvas.

Sections are not floating cards inside other cards. A page is composed of section bands separated by hairlines, then repeated cards/tables inside those bands only when repetition helps scanning. On mobile, controls must respect the keyboard path, search suggestions, safe areas, and thumb reach. Floating actions should be compact, should never sit over active text input/results, and content should read as a single clean scroll.

## Elevation & Depth

Depth is mostly tonal. Use borders, soft backgrounds, and sticky positioning before shadows. Shadows are allowed only for the fixed GNB, desktop floating rail, mobile bottom actions, popovers, and sheets. Avoid blue-tinted glow around every major section; it makes the UI feel decorative instead of trustworthy.

## Shapes

Use 8px as the default rectangular radius and full pill radius for search, compact chips, and floating actions. Large cards above 16px radius are discouraged. Icon buttons are circular only when they represent standalone floating controls or removal actions.

## Components

**Top GNB:** fixed to the top edge, 64px high, white with a single bottom hairline. Brand and navigation sit left; global search sits right on desktop. Search always routes to stock detail.  
**Floating Side Index:** sticky, compact, white, no blank lower fill. Detail uses it for section scroll; compare uses it for selected tickers and add/search; navigation links do not compete with section links.  
**Inputs:** pill or 8px rounded depending on context. Search suggestions use the same row height and typography across GNB, rail, and sheets.  
**Tables:** market-cap and compare matrices are first-class surfaces. Header rows are subtle gray, body rows are white with hairline dividers and hover states.  
**Buttons:** primary actions are cobalt pills. Secondary actions are neutral/soft surfaces with black default text and blue hover.  
**Landing Blocks:** can use a dark console preview, live-looking market strips, comparison board, and a more memorable first screen. It should still expose search immediately.

## Do's and Don'ts

- Do keep fixed GNB + global search and desktop floating table-of-contents as non-negotiable product anchors.
- Do make detail, compare, technical, and market-cap feel like one product shell while preserving web-content readability.
- Do treat mobile as a primary design target, especially search, comparison editing, sheets, keyboard behavior, and safe-area spacing.
- Do flatten nested surfaces; a section may contain cards, but cards must not contain decorative cards inside decorative cards.
- Do use cobalt only for action, focus, selected state, and sparse highlights.
- Do keep data dense enough for scanning on PC.
- Don't use one-note blue gradients across the whole product.
- Don't turn the app into a full-screen admin dashboard or a landing page; the first screen should remain useful web content.
- Don't copy external repo code when the license is GPL or unclear.
- Don't let mobile floating controls cover form fields, suggestions, or the keyboard path.
