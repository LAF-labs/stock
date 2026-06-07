# Single-Stock Technical Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a visually strong, beginner-readable technical analysis page for every eligible single stock, with derivative products blocked and newly listed stocks handled gracefully.

**Architecture:** Keep the existing detail page light, add a chart-bottom CTA only for eligible single stocks, and serve the promoted technical analysis experience from `/technical?ticker=...`. Technical analysis results are computed into score snapshots, not calculated on every page request, so all eligible single stocks can be served through the existing on-demand snapshot/queue model rather than a popularity-only rollout.

**Tech Stack:** Next.js 16, React 19, TypeScript, lightweight-charts 5.2, Supabase REST/RPC snapshots, Python 3.12 collector modules, Node test runner, Python unittest.

---

## Source Map

- Product report: `/Users/gimgibeom/Downloads/Technical Analysis Development Specification Report_ AI-Driven Stock Analysis Service.md`
- Detail route shell: `src/app/page.tsx`
- Detail UI and chart CTA insertion point: `src/components/StockDashboard.tsx`, `src/components/StockDetailSections.tsx`
- Existing chart renderer: `src/components/TradingPriceChart.tsx`
- Existing chart data builder: `scripts/stock_score/timeseries.py`
- Existing score payload builder: `scripts/fetch_stock_score.py`
- Existing cache/snapshot route: `src/app/api/score/route.ts`, `src/lib/stockSnapshotCache.ts`
- Existing symbol metadata: `src/lib/symbolSearch.ts`, `src/lib/symbolProfiles.ts`, `src/lib/symbolTypes.ts`
- Existing tests to extend: `tests/stockDashboardHelpers.test.ts`, `tests/test_score_helpers.py`

## Product Decisions

- Technical analysis is for single stocks only.
- All eligible single stocks should get the feature through on-demand snapshot generation; this is not an "only popular tickers first" feature.
- Derivative and product-like instruments do not show the CTA. Forced `/technical?ticker=...` entry redirects to the normal detail page for that ticker.
- Newly listed single stocks still get a technical analysis page, but the page switches to a data-coverage mode and hides unavailable long-window signals.
- Rule-based interpretation must be short, plain Korean, and attached to visual evidence.
- No 1:1 advice, portfolio-aware advice, guaranteed return language, or personalized entry/exit instructions.

## Eligibility Rules

Eligible:
- `instrumentType === "STOCK"` and not matched by derivative/product exclusion rules.
- Common listed US/KR single-company stocks even when chart history is short.

Blocked:
- `instrumentType === "ETF"`.
- Names or profile asset classes matching ETF, ETN, ELW, ETP, warrant, fund, leveraged, inverse, futures, covered call, bond-mixed, commodity, index, structured product, or similar product wrappers.
- Any payload with `industry_profile.asset_class` in `etf`, `etn`, `fund`, `derivative`, `warrant`, `structured_product`.

Forced entry behavior:
- `/technical?ticker=KR:005930` for eligible stocks renders the technical page.
- `/technical?ticker=KR:0194M0` or derivative-like products redirects to `/?ticker=KR:0194M0`.
- Invalid tickers redirect to `/?ticker=US:KO`.
- `view=technical` API requests for blocked products return a compact unsupported payload and do not enqueue score jobs.

## Newly Listed Coverage Rules

The page is available for every eligible single stock, but sections depend on usable daily bars.

| Bars | Coverage Tier | UI Behavior |
| ---: | --- | --- |
| 0-14 | `insufficient` | Show price chart if possible, explain that indicator history is too short, hide confluence score. |
| 15-19 | `starter` | Show candle/volume basics and RSI-only momentum; hide EMA ribbon, Ichimoku, Fibonacci, FVG/OB score. |
| 20-51 | `short` | Show 9/20 EMA, volume rules, simple trend, FVG candidates; hide Ichimoku and long trend confidence. |
| 52-119 | `standard` | Show Ichimoku, RSI divergence candidates, Fibonacci from available swing range, VPA. |
| 120-199 | `full` | Show all MVP features except 200-day long-term confirmation. |
| 200+ | `long_history` | Show all features and long-term confirmation. |

Newly listed copy:

```text
상장 초기라 장기 지표는 아직 덜 믿을 만해요. 지금은 캔들, 거래량, 단기 평균선 위주로 봅니다.
```

## Rule-Based Interpretation Copy Model

Each signal should emit:
- `title`: 14 characters or fewer where possible.
- `status`: `우호`, `주의`, `중립`, `데이터 부족`.
- `plain`: one short sentence explaining the meaning.
- `evidence`: one short sentence naming the exact observed rule.
- `visual`: chart layer key, color, and anchor dates/prices.

Example:

```json
{
  "title": "단기 추세 우위",
  "status": "우호",
  "plain": "가격이 짧은 평균선 위에 있어 단기 매수세가 남아 있어요.",
  "evidence": "종가가 9일 EMA와 20일 EMA 위에 있습니다.",
  "visual": { "layer": "ema_ribbon", "tone": "positive" }
}
```

## Rule Library For Visual Interpretation

These are the MVP rule families. Each rule should produce one visual mark and one short explanation, not a lecture.

| Family | Rule | Visual | Short Copy Pattern |
| --- | --- | --- | --- |
| EMA ribbon | At least 7 of 9 EMA slopes point the same way. | Colored ribbon above candles. | `평균선들이 같은 방향으로 모여 추세가 읽기 쉬워요.` |
| Ichimoku | Price above cloud and Tenkan above Kijun is positive; below cloud is cautious. | Cloud band, Tenkan/Kijun lines. | `가격이 구름 위에 있어 중기 흐름은 우호적이에요.` |
| RSI | RSI above 70 is hot, below 30 is weak, divergence is watch-only. | Lower panel line and marker. | `가격은 올랐지만 힘은 약해져 과열을 식히는지 봐야 해요.` |
| FVG | `Low[t] > High[t-2] + min_gap` or reverse. | Low-opacity box. | `가격이 빠르게 지나간 빈 구간이라 다시 확인될 수 있어요.` |
| OB | Last opposite candle before confirmed body-close BOS/CHoCH. | Low-opacity body zone. | `구조가 바뀌기 직전의 캔들 구간이라 반응을 확인해요.` |
| Fibonacci | Recent swing high/low creates 0.382, 0.5, 0.618, 0.786. | Horizontal levels. | `0.618 근처는 되돌림이 멈추는지 자주 보는 가격대예요.` |
| VPA | Wide candle plus high volume validates; narrow candle plus high volume warns absorption. | Volume highlight and candle badge. | `움직임에 거래량이 붙어 신뢰도가 올라갔어요.` |

Closed-bar rule:
- Confirmed signals use only completed daily bars.
- If the most recent bar is live or uncertain, mark it as `pending` and do not include it in confluence scoring.
- Pending signals can appear as lighter visual hints with the copy `오늘 캔들이 끝나야 확정돼요.`

## File Structure

Create:
- `src/lib/technicalAnalysisEligibility.ts`: shared ticker/product eligibility helpers.
- `src/lib/technicalAnalysisTypes.ts`: TypeScript data contract for `technical_analysis`.
- `src/components/TechnicalAnalysisPage.tsx`: client page shell for `/technical`.
- `src/components/TechnicalAnalysisChart.tsx`: visual chart with overlays and fallback.
- `src/components/TechnicalSignalCards.tsx`: concise rule explanation cards.
- `src/app/technical/page.tsx`: route entry and forced-entry redirect.
- `scripts/stock_score/technical_analysis.py`: Python calculation and rule-copy engine.
- `tests/technicalAnalysisEligibility.test.ts`: eligibility and redirect helper coverage.
- `tests/test_technical_analysis.py`: indicator and coverage-tier tests.

Modify:
- `src/lib/symbolSearch.ts`: export exact ticker lookup for server/API eligibility gates.
- `src/lib/stockSnapshotCache.ts`: allow `technical` score view.
- `src/app/api/score/route.ts`: accept `view=technical`.
- `scripts/fetch_stock_score.py`: add `technical` view payload generation.
- `src/lib/types.ts`: add `technical_analysis` response types.
- `src/components/StockDetailSections.tsx`: add chart-bottom CTA slot.
- `src/components/StockDashboard.tsx`: pass CTA only when eligible.
- `src/app/globals.css`: technical page layout and chart visual states.
- `supabase/migrations/*.sql`: allow `technical` in `stock_score_snapshots.view_mode`.
- `tests/stockDashboardHelpers.test.ts`: CTA helper tests.
- `tests/test_score_helpers.py`: exported Python helper coverage.

## Phase 1: Eligibility, Routing, And CTA Guard

### Task 1.1: Add Eligibility Helper Tests

**Files:**
- Create: `tests/technicalAnalysisEligibility.test.ts`
- Create: `src/lib/technicalAnalysisEligibility.ts`

- [ ] Write failing tests for single-stock allow, ETF block, derivative-name block, detail redirect path, and invalid ticker fallback.

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  detailPathForTicker,
  technicalAnalysisHrefForPayload,
  technicalEligibilityFromPayload,
} from "../src/lib/technicalAnalysisEligibility";

test("technical analysis allows ordinary single stocks", () => {
  const eligibility = technicalEligibilityFromPayload({
    requested_ticker: "KR:005930",
    market: "KR",
    symbol: "005930",
    name: "삼성전자",
    industry_profile: { asset_class: "stock" },
  });

  assert.deepEqual(eligibility, { eligible: true, ticker: "KR:005930" });
  assert.equal(technicalAnalysisHrefForPayload({ requested_ticker: "KR:005930", name: "삼성전자" }), "/technical?ticker=KR%3A005930");
});

test("technical analysis blocks ETF and derivative-like products", () => {
  assert.deepEqual(
    technicalEligibilityFromPayload({
      requested_ticker: "KR:0194M0",
      market: "KR",
      symbol: "0194M0",
      name: "ACE 삼성전자단일종목레버리지",
      industry_profile: { asset_class: "etf" },
    }),
    { eligible: false, ticker: "KR:0194M0", reason: "unsupported_product" }
  );

  assert.equal(
    technicalAnalysisHrefForPayload({
      requested_ticker: "KR:0194M0",
      name: "ACE 삼성전자단일종목레버리지",
      industry_profile: { asset_class: "etf" },
    }),
    undefined
  );
});

test("technical forced entry redirects to the detail page", () => {
  assert.equal(detailPathForTicker("KR:0194M0"), "/?ticker=KR%3A0194M0");
  assert.equal(detailPathForTicker("bad ticker"), "/?ticker=US%3AKO");
});
```

- [ ] Run the tests and confirm they fail because the helper does not exist.

```bash
npm test -- tests/technicalAnalysisEligibility.test.ts 2>&1 | head -c 8000
```

Expected:

```text
Cannot find module '../src/lib/technicalAnalysisEligibility'
```

### Task 1.2: Implement Eligibility Helper

**Files:**
- Modify: `src/lib/technicalAnalysisEligibility.ts`
- Test: `tests/technicalAnalysisEligibility.test.ts`

- [ ] Add the helper with explicit product blocking and safe paths.

```ts
import { parseStrictTickerRef } from "@/lib/tickerRef";

export type TechnicalEligibility =
  | { eligible: true; ticker: string }
  | { eligible: false; ticker: string; reason: "unsupported_product" | "invalid_ticker" };

const BLOCKED_ASSET_CLASSES = new Set(["etf", "etn", "fund", "derivative", "warrant", "structured_product"]);
const BLOCKED_NAME_RE = /(ETF|ETN|ELW|ETP|WARRANT|워런트|펀드|상장지수|레버리지|인버스|선물|파생|커버드콜|채권혼합|원자재|지수|단일종목)/i;

export function technicalEligibilityFromPayload(payload: Record<string, unknown>): TechnicalEligibility {
  const ticker = tickerFromPayload(payload);
  if (!ticker) return { eligible: false, ticker: "US:KO", reason: "invalid_ticker" };
  if (isUnsupportedProduct(payload)) return { eligible: false, ticker, reason: "unsupported_product" };
  return { eligible: true, ticker };
}

export function technicalAnalysisHrefForPayload(payload: Record<string, unknown>): string | undefined {
  const eligibility = technicalEligibilityFromPayload(payload);
  if (!eligibility.eligible) return undefined;
  return `/technical?ticker=${encodeURIComponent(eligibility.ticker)}`;
}

export function detailPathForTicker(value: string | undefined): string {
  const parsed = parseStrictTickerRef(value);
  const ticker = parsed.ok ? parsed.ticker : "US:KO";
  return `/?ticker=${encodeURIComponent(ticker)}`;
}

function tickerFromPayload(payload: Record<string, unknown>): string | undefined {
  const requested = typeof payload.requested_ticker === "string" ? payload.requested_ticker : undefined;
  const parsedRequested = parseStrictTickerRef(requested);
  if (parsedRequested.ok) return parsedRequested.ticker;
  const market = typeof payload.market === "string" ? payload.market : undefined;
  const symbol = typeof payload.symbol === "string" ? payload.symbol : undefined;
  const parsedSymbol = parseStrictTickerRef(market && symbol ? `${market}:${symbol}` : symbol);
  return parsedSymbol.ok ? parsedSymbol.ticker : undefined;
}

function isUnsupportedProduct(payload: Record<string, unknown>): boolean {
  const profile = recordFromUnknown(payload.industry_profile);
  const assetClass = text(profile?.asset_class).toLowerCase();
  if (BLOCKED_ASSET_CLASSES.has(assetClass)) return true;
  const instrumentType = text(payload.instrument_type || profile?.instrument_type).toUpperCase();
  if (instrumentType === "ETF") return true;
  const name = [payload.name, profile?.name].map(text).filter(Boolean).join(" ");
  return BLOCKED_NAME_RE.test(name);
}

function recordFromUnknown(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
```

- [ ] Run the focused test.

```bash
npm test -- tests/technicalAnalysisEligibility.test.ts 2>&1 | head -c 8000
```

Expected:

```text
tests 3
pass 3
```

### Task 1.3: Hide CTA For Blocked Products

**Files:**
- Modify: `src/components/StockDetailSections.tsx`
- Modify: `src/components/StockDashboard.tsx`
- Modify: `tests/stockDashboardHelpers.test.ts`

- [ ] Add a `technicalAnalysisHref?: string` prop to `ChartStory`.
- [ ] Render a button link below existing pattern chips only when the href is defined.
- [ ] In `StockDashboard`, compute `technicalAnalysisHrefForPayload(data)` and pass it to `ChartStory`.
- [ ] Add helper coverage that derivative payloads return no CTA.

```tsx
<ChartStory
  points={data.chart_series}
  patterns={data.chart_patterns}
  technicalAnalysisHref={technicalAnalysisHrefForPayload(data)}
/>
```

CTA copy:

```text
기술적 분석 보러가기
```

Run:

```bash
npm test -- tests/stockDashboardHelpers.test.ts tests/technicalAnalysisEligibility.test.ts 2>&1 | head -c 12000
npm run typecheck 2>&1 | head -c 12000
```

Expected:

```text
failures: 0
TypeScript: exit 0
```

### Task 1.4: Add Server/API Eligibility Gate

**Files:**
- Modify: `src/lib/symbolSearch.ts`
- Modify: `src/lib/technicalAnalysisEligibility.ts`
- Modify: `src/app/api/score/route.ts`
- Modify: `tests/technicalAnalysisEligibility.test.ts`
- Modify: `tests/apiRouteSecurity.test.ts`

- [ ] Export an exact symbol lookup that checks Supabase first through existing search and local generated symbols as fallback.
- [ ] Add `technicalEligibilityForTicker(ticker)` that uses exact symbol metadata before any technical snapshot lookup.
- [ ] In `/api/score`, when `view=technical` and eligibility is blocked, return:

```json
{
  "ok": false,
  "error": "technical_unsupported_product",
  "ticker": "KR:0194M0",
  "redirect_to": "/?ticker=KR%3A0194M0"
}
```

- [ ] Ensure this response does not enqueue a refresh job.
- [ ] Add a test asserting blocked technical requests do not call the refresh queue helper.

Exact lookup API shape:

```ts
export async function findExactSymbol(tickerRef: string): Promise<SymbolSearchItem | undefined> {
  const parsed = parseStrictTickerRef(tickerRef);
  if (!parsed.ok) return undefined;
  const candidates = await searchSymbols({ query: parsed.symbol, market: parsed.market, limit: 20 });
  return candidates.find((item) => item.market === parsed.market && item.ticker.toUpperCase() === parsed.symbol);
}
```

Run:

```bash
npm test -- tests/technicalAnalysisEligibility.test.ts tests/apiRouteSecurity.test.ts 2>&1 | head -c 16000
npm run typecheck 2>&1 | head -c 12000
```

Expected:

```text
failures: 0
TypeScript: exit 0
```

## Phase 2: Technical Snapshot View

### Task 2.1: Add `technical` View To Types And Cache

**Files:**
- Modify: `src/lib/stockSnapshotCache.ts`
- Modify: `src/app/api/score/route.ts`
- Modify: `scripts/publish_stock_snapshots.ts`
- Modify: tests that parse score views.

- [ ] Change `ScoreView` to include `technical`.

```ts
export type ScoreView = "detail" | "compare" | "technical";

export function cleanView(value: string | null): ScoreView {
  if (value === "compare") return "compare";
  if (value === "technical") return "technical";
  return "detail";
}
```

- [ ] Update `parseViews` in `scripts/publish_stock_snapshots.ts` to accept `technical`.
- [ ] Add a migration that changes the `stock_score_snapshots.view_mode` check to `('detail', 'compare', 'technical')`.
- [ ] Run:

```bash
npm test -- tests/publishStockSnapshotsTs.test.ts tests/stockCacheSnapshotMode.test.ts 2>&1 | head -c 12000
npm run typecheck 2>&1 | head -c 12000
```

Expected:

```text
failures: 0
TypeScript: exit 0
```

### Task 2.2: Add Technical Payload Contract

**Files:**
- Create: `src/lib/technicalAnalysisTypes.ts`
- Modify: `src/lib/types.ts`

- [ ] Add the shared TypeScript contract.

```ts
import type { ChartSeriesPoint, JsonValue } from "@/lib/types";

export type TechnicalCoverageTier = "insufficient" | "starter" | "short" | "standard" | "full" | "long_history";
export type TechnicalSignalStatus = "우호" | "주의" | "중립" | "데이터 부족";

export type TechnicalSignal = {
  key: string;
  title: string;
  status: TechnicalSignalStatus;
  plain: string;
  evidence: string;
  layer?: string;
};

export type TechnicalAnalysisPayload = {
  version: "technical-v1";
  timeframe: "1d";
  bars: number;
  coverage_tier: TechnicalCoverageTier;
  closed_bar_date?: string;
  summary: {
    tone: "positive" | "neutral" | "cautious" | "limited";
    headline: string;
    bullets: string[];
  };
  confluence?: {
    score: number;
    label: string;
    groups: Array<{ key: string; label: string; score: -1 | 0 | 1; weight: number; reason: string }>;
  };
  signals: TechnicalSignal[];
  overlays: Record<string, JsonValue>;
  chart_series?: ChartSeriesPoint[];
  warnings: string[];
};
```

- [ ] Add `technical_analysis?: TechnicalAnalysisPayload` to `StockScoreResponse`.
- [ ] Run:

```bash
npm run typecheck 2>&1 | head -c 12000
```

Expected:

```text
exit 0
```

## Phase 3: Python Rule Engine

### Task 3.1: Write Indicator Tests First

**Files:**
- Create: `tests/test_technical_analysis.py`
- Create: `scripts/stock_score/technical_analysis.py`

- [ ] Write tests for coverage tiers, EMA ribbon, FVG detection, derivative-free rule copy length, and newly listed warnings.

```python
import unittest

from scripts.stock_score.technical_analysis import (
    build_technical_analysis,
    coverage_tier_for_bars,
)


class TechnicalAnalysisTests(unittest.TestCase):
    def test_coverage_tiers(self):
        self.assertEqual(coverage_tier_for_bars(0), "insufficient")
        self.assertEqual(coverage_tier_for_bars(15), "starter")
        self.assertEqual(coverage_tier_for_bars(25), "short")
        self.assertEqual(coverage_tier_for_bars(60), "standard")
        self.assertEqual(coverage_tier_for_bars(130), "full")
        self.assertEqual(coverage_tier_for_bars(220), "long_history")

    def test_newly_listed_payload_is_limited_but_available(self):
        rows = [
            {"date": f"2026-06-{day:02d}", "open": 100 + day, "high": 102 + day, "low": 99 + day, "close": 101 + day, "volume": 100000 + day}
            for day in range(1, 16)
        ]
        payload = build_technical_analysis(rows)
        self.assertEqual(payload["coverage_tier"], "starter")
        self.assertIn("상장 초기", " ".join(payload["warnings"]))
        self.assertGreaterEqual(len(payload["signals"]), 1)

    def test_fvg_signal_is_short_and_evidence_based(self):
        rows = [
            {"date": "2026-06-01", "open": 100, "high": 101, "low": 99, "close": 100, "volume": 100000},
            {"date": "2026-06-02", "open": 100, "high": 103, "low": 100, "close": 102, "volume": 180000},
            {"date": "2026-06-03", "open": 105, "high": 108, "low": 104, "close": 107, "volume": 220000},
        ]
        payload = build_technical_analysis(rows)
        fvg = [signal for signal in payload["signals"] if signal["key"] == "fvg"]
        self.assertTrue(fvg)
        self.assertLessEqual(len(fvg[0]["plain"]), 80)
        self.assertIn("갭", fvg[0]["evidence"])
```

- [ ] Run and confirm failure.

```bash
npm run test:python -- tests/test_technical_analysis.py 2>&1 | head -c 10000
```

Expected:

```text
ImportError or ModuleNotFoundError
```

### Task 3.2: Implement Minimal Technical Engine

**Files:**
- Modify: `scripts/stock_score/technical_analysis.py`
- Modify: `scripts/stock_score/__init__.py` only if exports are needed.

- [ ] Implement coverage tiers, safe numeric extraction, EMA, RSI series, FVG, VPA, Fibonacci, and concise rule copy.
- [ ] Keep output bounded: use the last 260 bars and cap zones/signals to the most recent useful items.
- [ ] Apply closed-bar confirmation: confirmed signals exclude the latest bar when the collector cannot prove it is closed.

Required behaviors:
- `build_technical_analysis([])` returns `coverage_tier="insufficient"` and no confluence score.
- `build_technical_analysis(rows)` never throws for missing `open/high/low/volume`; it downgrades unavailable signals.
- All `plain` and `evidence` strings are shorter than 100 Korean characters where practical.
- `confluence.score` exists only from `short` tier upward.
- Pending live-bar hints never contribute to `confluence.score`.

Run:

```bash
npm run test:python -- tests/test_technical_analysis.py 2>&1 | head -c 12000
```

Expected:

```text
OK
```

### Task 3.3: Wire Technical View In Score Collector

**Files:**
- Modify: `scripts/fetch_stock_score.py`
- Modify: `tests/test_score_helpers.py`

- [ ] Import `build_technical_analysis`.
- [ ] After `chart_series` is built, compute `technical_analysis = build_technical_analysis(chart_series)`.
- [ ] If `view == "technical"`, return a compact payload with stock identity, `chart_series`, `price_metrics`, `technical_analysis`, `score_model_version`, and `fetch`.
- [ ] If `view == "detail"`, keep existing payload mostly unchanged and do not add large overlay arrays.

Technical compact payload shape:

```python
{
    "ok": True,
    "app": "Stock Score Reader",
    "requested_ticker": raw_ticker,
    "market": "KR",
    "symbol": symbol,
    "name": name,
    "exchange": exchange,
    "currency": currency,
    "score_model_version": SCORE_MODEL_VERSION,
    "latest_price": latest_price,
    "latest_bar_date": latest_date,
    "chart_series": chart_series,
    "price_metrics": price_metrics,
    "technical_analysis": technical_analysis,
    "fetch": {"source": "...", "history_rows": len(daily_rows), "view": "technical"},
}
```

Run:

```bash
npm run test:python 2>&1 | head -c 20000
```

Expected:

```text
OK
```

## Phase 4: Technical Page UI

### Task 4.1: Add Server Route With Forced Redirect

**Files:**
- Create: `src/app/technical/page.tsx`
- Create: `src/components/TechnicalAnalysisPage.tsx`
- Modify: `tests/technicalAnalysisEligibility.test.ts`

- [ ] Parse `ticker` from `searchParams`.
- [ ] If invalid, redirect to `/?ticker=US%3AKO`.
- [ ] Call `technicalEligibilityForTicker(ticker)` in the server page before rendering the client page.
- [ ] If the server eligibility result is blocked, call `redirect(detailPathForTicker(ticker))`.
- [ ] The client page fetches `/api/score?view=technical` only after server eligibility allows the ticker.
- [ ] If the API still returns `technical_unsupported_product` because metadata arrived later, the client calls `router.replace(payload.redirect_to)`.
- [ ] Ensure the URL never renders a technical page for derivatives.

Page copy:

```text
기술적 분석
일봉 기준으로 가격, 평균선, 거래량, 과열 신호를 함께 봅니다.
```

Run:

```bash
npm run typecheck 2>&1 | head -c 12000
```

Expected:

```text
exit 0
```

### Task 4.2: Build The Information Pyramid UI

**Files:**
- Modify: `src/components/TechnicalAnalysisPage.tsx`
- Create: `src/components/TechnicalSignalCards.tsx`
- Modify: `src/app/globals.css`

- [ ] Add top summary with headline, coverage badge, and 3 bullets.
- [ ] Add four compact visual cards: `추세`, `모멘텀`, `수급/거래량`, `주의 구간`.
- [ ] Add signal cards that use `plain` first and `evidence` second.
- [ ] Add limited-history banner for `insufficient`, `starter`, and `short` tiers.
- [ ] Add bold disclaimer at the bottom with at least the existing body font size and clear contrast.

Required short copy examples:

```text
추세: 평균선이 위로 모이면 상승 흐름이 더 읽기 쉬워요.
모멘텀: RSI는 가격 움직임에 힘이 남았는지 봅니다.
거래량: 큰 움직임에는 거래량이 따라붙어야 믿을 만해요.
주의 구간: FVG와 OB는 확정 신호가 아니라 다시 확인할 가격대예요.
```

Run:

```bash
npm run typecheck 2>&1 | head -c 12000
```

Expected:

```text
exit 0
```

## Phase 5: Technical Chart Visualization

### Task 5.1: Create Dedicated Technical Chart

**Files:**
- Create: `src/components/TechnicalAnalysisChart.tsx`
- Modify: `src/components/TechnicalAnalysisPage.tsx`
- Modify: `src/app/globals.css`

- [ ] Render candlesticks and volume by default.
- [ ] Add stable overlay toggles for EMA, Ichimoku, RSI, Fibonacci, FVG/OB, and volume events.
- [ ] Keep toggles as compact buttons with active state and accessible labels.
- [ ] Set fixed chart dimensions and responsive constraints to prevent layout shift.
- [ ] Use opacity around `0.15` for FVG/OB visual zones as requested by the report.

Layer priority:
1. Candles and volume
2. EMA ribbon
3. Signal markers
4. Fibonacci and trend lines
5. FVG/OB zones
6. Ichimoku cloud

Run:

```bash
npm run typecheck 2>&1 | head -c 12000
```

Expected:

```text
exit 0
```

### Task 5.2: Add Visual QA Gate

**Files:**
- Modify only files from Task 5.1 if visual defects are found.

- [ ] Start local server.

```bash
npm run dev 2>&1 | head -c 4000
```

- [ ] Open:

```text
http://127.0.0.1:3000/?ticker=KR:005930
http://127.0.0.1:3000/technical?ticker=KR:005930
http://127.0.0.1:3000/technical?ticker=US:NVDA
```

- [ ] Verify desktop and mobile:
  - CTA appears for ordinary single stocks.
  - CTA does not appear for derivative/product-like payloads.
  - Technical page has nonblank chart.
  - Overlay toggles do not overlap text.
  - Limited-history banner does not hide the chart.
  - Disclaimer is readable.

## Phase 6: Universal Single-Stock Coverage And Operations

### Task 6.1: Queue And Snapshot Coverage

**Files:**
- Modify: `src/lib/stockRefreshQueue.ts` only if view defaults reject `technical`.
- Modify: `scripts/publish_stock_snapshots.ts`
- Modify: `scripts/stock_refresh_queue_status.ts` if status grouping needs `technical`.

- [ ] Ensure a cache miss on `view=technical` enqueues a score refresh for that exact ticker.
- [ ] Ensure queue jobs preserve `view_mode="technical"`.
- [ ] Ensure no popularity gate or ticker whitelist exists.
- [ ] Keep rate limits aligned with existing score route; do not add per-ticker manual refresh to the technical page.

Run:

```bash
npm test -- tests/stockRefreshQueue.test.ts tests/publishStockSnapshotsTs.test.ts 2>&1 | head -c 12000
npm run typecheck 2>&1 | head -c 12000
```

Expected:

```text
failures: 0
TypeScript: exit 0
```

### Task 6.2: Ops Report And Freshness Visibility

**Files:**
- Modify: `scripts/stock_operations_report.ts`
- Modify: `docs/score-system-operations.md`
- Modify: `tests/stockOperationsReportTs.test.ts`

- [ ] Count `technical` snapshots separately from `detail` and `compare`.
- [ ] Add stale technical snapshot count.
- [ ] Document that all eligible single stocks are served on demand; warmup lists are operational optimization only, not product eligibility.
- [ ] Add a warning threshold for missing technical payloads only after the feature flag is enabled.

Run:

```bash
npm test -- tests/stockOperationsReportTs.test.ts 2>&1 | head -c 12000
```

Expected:

```text
failures: 0
```

## Phase 7: Release Gate

### Task 7.1: Full Verification

- [ ] Run Node tests.

```bash
npm test 2>&1 | head -c 20000
```

- [ ] Run Python tests.

```bash
npm run test:python 2>&1 | head -c 20000
```

- [ ] Run typecheck and build.

```bash
npm run typecheck 2>&1 | head -c 12000
npm run build 2>&1 | head -c 20000
```

- [ ] Run score smoke after technical view support is wired.

```bash
npm run score:smoke 2>&1 | head -c 16000
```

Expected:

```text
All commands exit 0.
```

### Task 7.2: Product Acceptance Checklist

- [ ] Ordinary single stock detail pages show `기술적 분석 보러가기`.
- [ ] ETF, ETN, leveraged, inverse, ELW, warrant, and fund-like pages do not show the CTA.
- [ ] Forced derivative technical URLs redirect to detail.
- [ ] Newly listed stocks render a limited but useful technical page.
- [ ] All eligible single stocks can request `view=technical`; no ticker popularity list blocks them.
- [ ] Technical copy is short, plain, and evidence-based.
- [ ] The chart is the main content, not a decorative preview.
- [ ] No screen says guaranteed profit, personalized advice, or fixed entry/exit instruction.

## Document Self-Review

### Review Fixes Applied

- Strengthened forced-entry handling from "client may redirect" to server/API eligibility gates.
- Added `technical_unsupported_product` API behavior so blocked products do not enqueue technical snapshots.
- Added exact ticker lookup requirements because payload-only eligibility is too late for forced-entry protection.
- Added the visual rule library so interpretation copy stays short, plain, and consistent.
- Fixed the score collector test expectation from a contradictory failure string to `OK`.
- Added closed-bar confirmation requirements to the Python engine task.

### Spec Coverage

- EMA trend ribbon: covered in Phase 3 and Phase 5.
- Ichimoku: covered in Phase 3 and Phase 5, available from enough history.
- RSI/Stoch RSI and closed-bar confirmation: covered in Phase 3.
- FVG/OB state: covered in Phase 3 and visualized in Phase 5.
- Fibonacci and trendlines: covered in Phase 3 and Phase 5.
- VPA: covered in Phase 3 and Phase 4.
- Confluence scoring: covered in Phase 2 and Phase 3.
- Compliance and safety copy: covered in Phase 4 and Phase 7.
- MAS/FastAPI/A2A: intentionally excluded from MVP because existing snapshot/queue architecture is safer for this service now.

### Gaps To Watch During Implementation

- The generated symbol master currently distinguishes `STOCK` and `ETF`; additional product-like filtering must use names and `industry_profile.asset_class`.
- `technical` snapshots increase storage and payload size; the compact technical view prevents detail-page bloat.
- FVG/OB interpretation is inherently subjective, so every card must say it is a watch zone, not a guaranteed pivot.
- Newly listed stocks need useful limited pages instead of feature denial.

### Placeholder Scan

This plan intentionally contains no `TBD`, generic "add tests" instruction without test shape, or popularity-only rollout assumption.
