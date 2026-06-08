# Stock Data Provider Evaluation - June 2026

## Executive Decision

지금 바로 해야 할 일은 provider 교체가 아니라 데이터 역할 분리다. KIS/yfinance만으로도 사용자 대기시간을 크게 줄일 수 있는 지점은 많다. 단기 전략은 KIS를 quote/OHLCV primary로 유지하고, yfinance는 background enrichment로 격리하며, chart/technical/fundamentals를 장기 캐시하는 것이다.

유료 provider는 나중에 예산이 생긴 뒤 붙인다. 기술적 분석은 provider가 제공하는 indicator endpoint를 호출하지 않고, 신뢰 가능한 OHLCV를 저장한 뒤 자체 계산한다.

## Post-Implementation Gate - 2026-06-08

Phase 1-7 implementation kept the current KIS/yfinance posture and added cache policy, chart snapshots, partial responses, progressive UI, an always-on queue worker, field-class fundamentals retention, and a latency/cost gate.

Local production latency gate result:

| Scenario | Status | State | Duration |
| --- | ---: | --- | ---: |
| Hot detail | 200 | ready | 852.2ms |
| Cold detail | 200 | ready | 454.5ms |
| Hot technical | 200 | ready | 848.9ms |
| Cold technical | 200 | ready | 1311.2ms |
| Mixed compare | 200 | ready | 505.9ms |

Summary:

- p50: 848.9ms
- p95: 1311.2ms
- Provider guard: pass
- Paid provider dependency added: no

Decision after gate: keep KIS/yfinance for now. The measured local p95 is acceptable for the current stage once snapshots are warm and the always-on worker is available. The next bottleneck is not provider replacement; it is making cold technical queue creation, eligibility/profile lookup, and worker drain cadence consistently fast under production traffic.

## Current Providers

| Provider | Keep/Change | Reason |
| --- | --- | --- |
| KIS OpenAPI | Keep now | 공식 브로커 API이고 현재 코드와 운영이 이미 맞춰져 있다. 다만 토큰, TR ID, 호출제한, 시세 재표출 약관 검토가 계속 필요하다. |
| yfinance | Background only | 상업 서비스의 request-time 원천으로 보기 어렵다. 재무/컨센서스 보강을 batch cache로만 사용하고, miss가 있어도 화면을 막지 않는다. |

Sources:

- KIS OpenAPI portal: https://apiportal.koreainvestment.com/apiservice-apiservice
- KIS official examples: https://github.com/koreainvestment/open-trading-api
- yfinance docs: https://ranaroussi.github.io/yfinance/

## Quote And OHLCV Candidates

| Candidate | Coverage | Strength | Concern | Posture |
| --- | --- | --- | --- | --- |
| Polygon/Massive | US strong, KR none | US real-time/delayed quote, aggregates, snapshots, WebSocket, corporate actions, some indicators | KR coverage 없음. 상업 표시/거래소 라이선스 확인 필요 | US paid primary candidate |
| Twelve Data | US plus global, KR EOD/delayed possible | Batch/time-series/WebSocket options, broad market list | KR 실시간 대체는 약함. credit/min 관리 필요 | US/global backup or paid primary trial |
| EODHD | US/global EOD/intraday/fundamentals | 60+ exchanges, high daily call budget on paid tiers | Low-tier commercial terms and KR real-time suitability need review | EOD/OHLCV backup candidate |
| Finnhub | US strong | Quote/WebSocket plus analyst/fundamental endpoints | KR public coverage weak; paid tiers can be expensive | US enrichment/backup |
| FMP | US/global fundamentals and prices | Easy REST migration from yfinance-like usage | Bandwidth/commercial display terms and KR coverage need verification | Low-cost US enrichment and trial candidate |

Sources:

- Polygon/Massive stocks docs: https://massive.com/docs/rest/stocks/overview
- Polygon/Massive aggregates docs: https://massive.com/docs/rest/stocks/aggregates/custom-bars
- Twelve Data stocks: https://twelvedata.com/stocks
- Twelve Data business pricing: https://twelvedata.com/pricing-business
- EODHD: https://eodhd.com/
- EODHD API limits: https://eodhd.com/financial-apis/api-limits
- Finnhub docs: https://finnhub.io/docs/api/library
- Finnhub pricing: https://finnhub.io/pricing-stock-api-market-data
- FMP docs: https://site.financialmodelingprep.com/developer/docs/stable
- FMP pricing: https://site.financialmodelingprep.com/pricing-plans

## Fundamentals And Enrichment Candidates

| Candidate | Coverage | Strength | Concern | Posture |
| --- | --- | --- | --- | --- |
| SEC EDGAR | US filings | Canonical filings and statements | Normalization work required | US canonical future source |
| OpenDART | KR filings | Free official filings, major accounts, XBRL | Mapping/restatement logic required; call limits | KR canonical future source |
| FMP | US/global | Statements, ratios, estimates, target prices, peers, sector/industry metrics | Commercial/display license and KR field coverage must be verified | US yfinance replacement candidate |
| EODHD | Global, including possible KR symbols | Fundamentals, ratios, corporate actions, large universe | Analyst data weaker; commercial terms need review | Global background enrichment candidate |
| Finnhub | US/global paid | Analyst recommendations, target prices, estimates, sector metrics | Cost and commercial terms | Analyst/sector enrichment candidate |
| Intrinio | US | Business-use fundamentals, Zacks estimates/ratings | Higher annual cost, US-focused | Conservative US production-grade candidate |
| DeepSearch | KR | KR company, DART, news, reports, target prices | Enterprise/quote pricing | KR analyst/news enrichment candidate |

Sources:

- OpenDART API list: https://engopendart.fss.or.kr/intro/infoApiList.do
- OpenDART guide: https://engopendart.fss.or.kr/guide/detail.do?apiGrpCd=DE005&apiId=AE00076
- Finnhub financials docs: https://finnhub.io/docs/api/financials
- Intrinio pricing: https://intrinio.com/pricing
- Intrinio analyst ratings docs: https://docs.intrinio.com/documentation/web_api/get_security_zacks_analyst_ratings_snapshot_v2
- DeepSearch company master: https://help.deepsearch.com/dp/api/master
- DeepSearch target-price search: https://help.deepsearch.com/dp/api/func/company/consensus/searchtargetprices

## Korea-Specific Sources

| Source | Useful For | Risk | Posture |
| --- | --- | --- | --- |
| KRX Open API | KR symbol/basic info and daily OHLCV batch data | 비상업/제3자 제공 제한, key/day limits, no continuity guarantee | Internal/batch research only unless terms allow |
| 공공데이터포털 금융위 주식시세 | KR daily OHLCV batch cache | 제공 지연 가능, runtime low-latency source 아님 | Batch cache only |
| FinanceDataReader/Naver | Prototype/backfill | crawler/source terms/HTML change risk | Not production authority |
| Kiwoom REST API | KR quote/chart/WebSocket | Account required, low request rate, display terms | Small watchlist experiment only |
| LS Securities Open API | KR/US quote/chart/realtime categories | Account and approval required | KIS alternative candidate |
| DB Securities Open API | KR/US quote/chart/realtime categories | Display requires separate market-data contract | Broker alternative candidate |
| Toss Open API | KR/US REST/WebSocket direction | Pre-application/terms not mature | Watch only |
| Koscom/KRX paid data | Commercial KR real-time display | Contract and cost | Correct long-term KR real-time path |

Sources:

- KRX Open API guide: https://openapi.krx.co.kr/contents/OPP/INFO/OPPINFO002.jsp
- KRX Open API services: https://openapi.krx.co.kr/contents/OPP/INFO/service/OPPINFO004.cmd
- Public data stock quote API: https://www.data.go.kr/en/data/15094808/openapi.do
- FinanceDataReader: https://github.com/financedata/financedatareader
- Kiwoom OpenAPI: https://openapi.kiwoom.com/intro?dummyVal=0
- LS Securities OpenAPI: https://openapi.ls-sec.co.kr/about-openapi
- DB Securities OpenAPI: https://openapi.dbsec.co.kr/about-openapi
- Toss Open API: https://home.tossinvest.com/en/open-api
- Koscom Open API: https://koscom.gitbook.io/open-api/api

## Cache Strategy By Provider Type

| Data | Recommended TTL |
| --- | --- |
| Symbol identity/classification | fresh 30-90 days, stale 180-365 days |
| Closed daily bars | fresh after each close, stale 30-180 days, immutable unless corporate action changes adjustment |
| Latest quote | fresh 5 minutes while open, stale 1 day as last-known display |
| Financial statements | fresh 7 days around filings, stale 180 days or longer after stabilization |
| Price-based ratios | fresh 1 day, stale 30 days |
| Analyst target/recommendation | fresh 1 day, stale 30 days |
| Industry benchmark | fresh daily if price-based, stale 7 days |
| Rule judgment text | fresh 24 hours by input hash, stale 7 days |

## Recommendation Matrix

| Area | Decision |
| --- | --- |
| Current phase | Implement cache-first/partial-read/always-on-worker with KIS and yfinance only |
| US quote/chart paid future | Trial Polygon/Massive first if US latency matters; Twelve Data if global consolidation matters |
| KR quote/chart paid future | Keep KIS now; paid real-time display should go through broker terms review or Koscom/KRX licensing |
| US fundamentals future | SEC EDGAR canonical plus FMP/Intrinio/Finnhub paid enrichment |
| KR fundamentals future | OpenDART canonical plus DeepSearch/FnGuide/NICE-style enrichment if budget exists |
| Technical analysis | Always calculate from cached OHLCV internally |
| Reject as production authority | Naver scraping, FinanceDataReader as primary, yfinance runtime, unofficial KIND endpoints |

## Next Action

Do not add a paid-provider adapter yet. Run the latency gate and operations report after production deployment. Reopen paid-provider evaluation only if production shows repeated provider-driven pending, quote/chart p95 regressions, or unacceptable yfinance enrichment miss rates after the always-on worker is stable.
