# Cache-First Latency Strategy Design

## Goal

KIS OpenAPI와 yfinance만 쓰는 현재 조건에서 처음 조회하는 단일종목도 사용자가 최대한 덜 기다리게 만든다. 핵심은 provider를 더 많이 호출하는 것이 아니라, 오래 캐시해도 되는 데이터를 더 오래 들고 가고, 준비된 데이터부터 화면에 즉시 승격하는 것이다.

## Scope

- 대상 화면: 종목 상세, 기술적 분석, 비교.
- 대상 상품: 단일종목 전체. ETF, ETN, 레버리지/인버스, 워런트, 펀드, 기타 파생상품성 상품은 기술적 분석 진입 버튼을 제공하지 않는다.
- 대상 provider: 지금은 KIS OpenAPI와 yfinance에 최적화한다. 유료 provider는 설계상 교체 여지만 남기고 실제 의존성으로 만들지 않는다.
- 대상 데이터: identity, quote, daily OHLCV, technical rules, score, fundamentals, industry benchmarks, rule judgment.

## Provider Facts

- KIS OpenAPI는 공식 API이고 시세, 현재가, 일봉 조회에 적합하다. 운영상 app key/secret, OAuth token, TR ID, 해외시장 코드 fallback, 호출 제한을 반드시 관리해야 한다.
- yfinance는 Yahoo Finance와 직접 제휴한 공식 상업용 API가 아니다. 사용자 요청 경로에서는 호출하지 않고, 재무/컨센서스 보강용 batch enrichment로만 사용한다.
- 조사 결론상 지금 당장 대기시간을 줄이는 최선의 방법은 provider를 교체하는 것이 아니라 cache/worker/read-model을 고치는 것이다.
- 유료 provider 후보는 나중에 붙일 수 있지만, 기술적 분석은 provider indicator API보다 cached OHLCV 기반 자체 계산을 유지한다.
- 참고:
  - KIS OpenAPI portal: https://apiportal.koreainvestment.com/apiservice-apiservice
  - KIS official examples: https://github.com/koreainvestment/open-trading-api
  - yfinance docs: https://ranaroussi.github.io/yfinance/
  - Provider evaluation: `docs/provider-evaluation-2026-06.md`

## Current Pain

현재 구조는 snapshot-only request path라는 큰 방향은 맞다. 다만 cold ticker에서 snapshot이 없으면 사용자는 `snapshot_pending` 하나만 받고, quote만 준비됐는지 chart만 준비됐는지 알 수 없다. worker가 GitHub Actions backstop에 묶이면 POET처럼 2분 이상 대기할 수 있고, 실제로는 일부 데이터가 먼저 준비되어도 화면 전체가 스켈레톤으로 남는다.

또 다른 문제는 cache TTL이 데이터 성격보다 화면 단위에 가깝다는 점이다. quote는 짧게 봐야 하지만, 종목명/상장시장/상품유형/재무제표/산업분류/과거 일봉 대부분은 더 오래 들고 가도 된다. 이 구분이 없으면 매번 비싼 score snapshot을 기다리게 된다.

## Data Freshness Classes

### Class A: Static Identity

Examples:

- ticker, market, symbol, Korean/English name
- exchange, instrument type, asset class
- technical eligibility
- KIS US exchange discovery result

Policy:

- fresh: 30 days
- stale: 180 days
- negative cache: 1 day for not-found, 7 days for derivative/unsupported classification
- refresh: symbol master job, profile backfill, listing/delisting maintenance

User behavior:

- Identity must be available before page shell renders.
- If identity is stale but present, show it and refresh silently.
- Technical CTA eligibility must use stale identity rather than blocking.

### Class B: Market Calendar

Examples:

- market open/close, holiday, early close, next open

Policy:

- seed ahead: 18-24 months for US and KR
- refresh: monthly, plus manual before known holiday-calendar changes
- stale: usable until a newer calendar is seeded, with fallback hours only as emergency

User behavior:

- Calendar miss must not block a page.
- Calendar miss lowers cache-expiry precision, not data availability.

### Class C: Quote

Examples:

- latest price, change, percent change, currency, market session

Policy:

- market open fresh: 5 minutes by default
- market closed fresh: until next open when calendar is available
- stale: 1 day for normal display with clear cache state
- stale beyond 1 day: only use as last-known fallback in skeleton/pending state, not as "current price"

User behavior:

- Quote is the fastest lane and should be requested first.
- A stale quote is better than a blank header.
- Quote freshness must not imply score freshness.

### Class D: Daily OHLCV Chart

Examples:

- daily candles, volume, adjusted close if available
- immutable historical bars and latest mutable bar

Policy:

- historical closed bars: cache 30-180 days
- latest trading-day bar while market open: fresh 5-15 minutes
- chart snapshot stale fallback: 30 days
- incremental refresh: fetch recent window first, then merge into stored history

User behavior:

- Technical page should render candles as soon as chart history exists.
- Missing latest quote should not hide historical candles.
- If a newly listed stock has few bars, render limited analysis instead of waiting for impossible indicators.

### Class E: Technical Derived Data

Examples:

- EMA20/EMA50/MA200
- RSI, divergence
- Ichimoku, Fibonacci, FVG, OB, trend, candle/volume rules

Policy:

- derived from cached daily OHLCV whenever possible
- recompute locally from chart cache before calling KIS
- fresh: same as chart latest-bar freshness
- stale: 7 days for rule summary, 30 days for visual overlays when chart is stale

User behavior:

- Price is always candlestick.
- Every non-price overlay can be toggled on/off.
- Rule text must be short, plain Korean, and tied to visible marks on the chart.
- If data is insufficient, show "확인 가능한 항목만" rather than a failure.

### Class F: Fundamentals And Analyst Enrichment

Examples:

- margins, ROE, revenue/earnings growth
- debt, cash, current ratio
- PER/PBR/PS/EV/Revenue
- analyst target price, analyst count, recommendation mean

Policy:

- current mixed yfinance cache: fresh 12 hours, stale 7 days
- target policy after split:
  - financial-statement facts: fresh 7 days, stale 180 days
  - ratios dependent on market price: fresh 1 day, stale 30 days
  - analyst target/recommendation: fresh 1 day, stale 30 days
  - average volume/beta/liquidity fields: fresh 1 day, stale 30 days
- yfinance fetch is background-only.
- Existing `stock_fundamental_snapshots` retention cap of 30 days is too short for financial-statement facts; split or relax retention before long stale windows.

User behavior:

- Missing fundamentals lowers confidence and narrows explanation, but does not block detail/compare.
- A stale fundamentals-backed score is shown with cache age and refreshed in the background.

### Class G: Industry And Rule Judgment

Examples:

- sector/industry classification
- industry PER/PBR benchmark
- rule-based judgment sentence

Policy:

- classification: fresh 90 days, stale 365 days
- benchmark: fresh until next relevant market close plus maintenance grace
- benchmark stale fallback: 7 days with lower confidence
- judgment text: cache by input hash, score bucket, benchmark version, and rule version
- judgment fresh: 24 hours if input hash unchanged
- judgment stale: 7 days if input hash unchanged

User behavior:

- If industry benchmark is missing, say that benchmark is not ready only in the valuation explanation.
- Do not degrade the whole score page because PER/PBR benchmark is absent.

## Target Request Model

The request path must read only memory, Supabase, and optionally a reachable internal market-data service. It must not call yfinance or start Python on Vercel.

Recommended response contract:

```json
{
  "ok": true,
  "ticker": "US:KO",
  "parts": {
    "identity": { "state": "fresh", "fetched_at": "..." },
    "quote": { "state": "stale", "fetched_at": "...", "refresh_started": true },
    "chart": { "state": "fresh", "fetched_at": "..." },
    "technical": { "state": "pending", "job_id": "..." },
    "score": { "state": "stale", "fetched_at": "...", "refresh_started": true },
    "fundamentals": { "state": "stale", "fetched_at": "..." }
  },
  "payload": {
    "identity": {},
    "quote": {},
    "chart": {},
    "technical": {},
    "score": {}
  }
}
```

The exact shape can evolve, but the important rule is that a missing part should not turn the whole response into `snapshot_pending` when other parts are usable.

## Target Worker Model

Use an always-on worker as the primary queue drain and GitHub Actions as backstop only.

Priority lanes:

1. user-visible quote miss
2. user-visible chart miss
3. user-visible technical miss after chart exists
4. user-visible detail/compare score miss
5. stale quote refresh
6. stale score/technical refresh
7. yfinance fundamentals enrichment
8. prewarm and maintenance

Worker rules:

- Poll Supabase queue every 3-5 seconds.
- Claim small bounded batches per lane.
- Keep KIS requests under a global token bucket.
- Keep yfinance concurrency low and batch symbols where possible.
- Retry transient KIS/yfinance failures quickly at first, then back off.
- Mark permanent unsupported products instead of retrying.

## Provider Roadmap

Current posture:

- Keep KIS as the primary KR/US quote and daily-bar provider for now.
- Keep yfinance only as background enrichment and internal fallback; do not use it as a production request-time dependency.
- Add OpenDART as the first realistic KR fundamentals improvement when implementation capacity allows.
- Use SEC EDGAR as the US canonical financial-statement direction if US fundamentals quality becomes a priority.

Deferred paid-provider posture:

- US quote/chart: Polygon/Massive or Twelve Data are the strongest practical candidates.
- Global/KR delayed daily OHLCV backup: Twelve Data, EODHD, or FMP can be trialed, but KR real-time replacement remains weak without exchange/broker licensing.
- US fundamentals/analyst: FMP is the low-cost candidate; Intrinio is the conservative business-license candidate; Finnhub is useful for analyst/sector enrichment but more expensive.
- KR fundamentals/consensus/news: OpenDART should be canonical for filings; DeepSearch/FnGuide/WISEfn/NICE-style sources are paid enrichment candidates.
- KR real-time commercial display: eventually requires broker terms review or KRX/Koscom-style market-data licensing.

## User Experience Rules

- Never show internal queue hints such as "300초".
- Show skeleton only for the section that is actually missing.
- If quote is ready, show header/price immediately.
- If chart is ready, show candlestick chart immediately.
- If technical rules are pending, show chart with overlay toggles disabled or in loading state.
- If score is stale, show it with a subtle data-age state and refresh silently.
- On newly listed stocks:
  - render available candles
  - hide or mark MA200/Ichimoku/fibonacci rules that need more bars
  - explain in one short sentence: "상장 초기라 장기 지표는 아직 확인하기 어려워요."

## Success Targets

- cached quote p95: under 300 ms from Vercel API
- cached detail/technical p95: under 700 ms locally, under 1.5 s production including Supabase
- cold quote first usable display: under 3 seconds with always-on worker
- cold chart/technical first usable display: under 10-30 seconds
- cold full score: under 30-60 seconds when KIS succeeds and yfinance cache is not required
- yfinance enrichment: non-blocking, usually 1-5 minutes
- request-path provider calls: zero on Vercel

## Non-Goals

- Do not prewarm every listed stock every few minutes.
- Do not make yfinance a real-time dependency.
- Do not build a large paid-provider abstraction before choosing a paid provider.
- Do not show technical analysis for derivatives.
- Do not hide stale-but-useful sections behind a full-page loading state.

## Self-Review

- No requirement depends on refreshing the entire stock universe.
- The design keeps single-stock technical analysis available for all eligible single stocks.
- Newly listed stocks are handled by limited-mode technical analysis.
- The design separates short-lived quote freshness from long-lived fundamentals and identity.
- The design requires partial response state; without that, longer caching alone cannot fix perceived latency.
