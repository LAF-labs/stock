# 스톡스토커

Next.js 기반 주식 티커 조회 리더입니다.

## 기능

- 미국/국내 주식 티커 검색 및 자동완성
- 시세 조회 API로 현재가, 현재가상세, 기간별 시세, 상품기본정보, 뉴스 조회
- NASDAQ, NYSE, AMEX, 국내 주요 시장 종목 조회
- 현재가, 원화 환산, 시가총액, 기간별 수익률, PER/PBR/EPS/BPS 표시
- 기간별 시세 기반 가격 차트와 비교 화면
- 한 번에 최대 5개 종목 비교
- 조회 결과를 서버 메모리와 Supabase `stock_score_snapshots`에 저장해 반복 조회 시 API 호출 축소
- yfinance 펀더멘털 보강값을 Supabase `stock_fundamental_snapshots`에 저장하고 로컬 파일 캐시는 fallback으로 사용
- 룰 기반 판단문을 6시간 버킷에 캐시하고, PER/PBR은 업종/섹터 벤치마크와 비교
- 종목별 업종 profile/tag를 Supabase에 미리 백필하고, 요청 경로에서는 24시간 캐시된 profile만 조회

## 티커 지원 정책

API 내부 경로는 provider별로 동일하게 조회할 수 있는 canonical ticker만 허용합니다. 사용자 입력 경로는 먼저 deterministic alias resolver를 통과한 뒤 strict ticker parser로 들어갑니다. 예를 들어 `BRK/B`, `US:BRK/B`, `BRK B`는 known class-share alias로 `US:BRK.B`가 되고, `삼전`, `하닉`, `엔비디아`, `온큐`처럼 인기 종목에 대해 1:1로 확정된 별칭은 canonical ticker로 자동 변환됩니다. 반대로 `XFLH/UN`처럼 매핑이 없는 slash ticker는 계속 거부합니다.

국내 종목은 6자리 숫자 ticker와 거래소 master에 존재하는 6자리 영문/숫자 ticker를 허용합니다. `005930.KS`, `005930.KQ`, `KR:005930.KS`처럼 provider suffix가 붙은 국내 표기는 6자리 국내 ticker로 확정 가능한 경우 `KR:005930`처럼 자동 정규화합니다. `삼성`, `SK`, `LG`, `반도체`, `AI주` 같은 그룹명/테마어는 단일 종목으로 확정하지 않습니다.

## 설치

필수 툴체인은 CI와 맞춥니다.

- Node.js 24.x
- Python 3.12 권장
- stable Rust toolchain
- Supabase CLI는 schema push가 필요한 운영자만 설치

```bash
npm ci
python3.12 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
cargo test --manifest-path services/market-data/Cargo.toml
```

`.env.example`을 기준으로 `.env.local`에 시세 조회 API 키와 Supabase 키를 설정해야 합니다.

```text
STOCK_API_APP_KEY=...
STOCK_API_APP_SECRET=...
STOCK_API_BASE=https://openapi.koreainvestment.com:9443
SUPABASE_URL=...
SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
STOCK_REFRESH_COOKIE_SECRET=...
STOCK_RATE_LIMIT_SECRET=...
# 선택: /api/health/stock-data?verbose=1 상세 점검용
STOCK_HEALTH_CHECK_TOKEN=...
```

`SUPABASE_PUBLISHABLE_KEY`는 공개 캐시 조회용입니다. `SUPABASE_SERVICE_ROLE_KEY`가 있어야 서버가 점수/현재가/펀더멘털 캐시와 새로고침 쿨다운을 Supabase에 기록합니다. service role key는 브라우저 번들에 노출하지 마세요. `/api/health/stock-data`는 기본 응답에서 환경변수 이름과 커밋 정보를 숨기고, `STOCK_HEALTH_CHECK_TOKEN` 또는 `MARKET_DATA_INTERNAL_TOKEN` Bearer 토큰이 있을 때만 `?verbose=1` 상세 정보를 보여줍니다.

Vercel에서는 `STOCK_DATA_RUNTIME=python`을 실수로 넣어도 기본적으로 `snapshot` 모드로 닫힙니다. 정말로 Vercel에서 Python subprocess fallback을 켜야 하는 특수 상황이 아니라면 `STOCK_ALLOW_VERCEL_PYTHON_RUNTIME=1`을 쓰지 마세요.

Supabase CLI용 access token은 앱 런타임 env와 분리해 `.env.supabase.local`에 저장합니다. 이 파일은 `.gitignore`의 `.env*.local` 규칙으로 커밋되지 않습니다.

```text
SUPABASE_ACCESS_TOKEN=sbp_...
```

Supabase CLI는 아래 래퍼로 실행하면 `.env.supabase.local`을 자동으로 읽습니다.

```bash
powershell -ExecutionPolicy Bypass -File scripts/supabase-cli.ps1 db push --linked --yes
```

macOS/Linux에서 PowerShell 래퍼를 쓰지 않는 경우에는 토큰 파일을 shell에만 로드한 뒤 Supabase CLI를 직접 실행합니다.

```bash
set -a
. .env.supabase.local
set +a
supabase db push --linked --yes
```

캐시는 demand-driven read-through 방식입니다. 사용자가 조회한 종목만 Supabase snapshot으로 살아남고, 장중 현재가/등락률은 5분, 점수/판정/분석은 30분 동안 공유됩니다. 현재가 새로고침 버튼은 quote만 즉시 갱신하며 사용자별 5분 cooldown과 종목별 refresh lease로 외부 API 폭주를 막습니다. 폐장/휴장 중에는 `market_calendar.next_open_at`까지 캐시하되, 장마감 이후 확정된 snapshot만 다음 개장까지 연장합니다.

```text
STOCK_QUOTE_CACHE_OPEN_SECONDS=300
STOCK_SCORE_DETAIL_CACHE_SECONDS=1800
STOCK_SCORE_COMPARE_CACHE_SECONDS=1800
STOCK_SCORE_CACHE_STALE_SECONDS=86400
STOCK_QUOTE_CACHE_STALE_SECONDS=86400
STOCK_SCORE_SNAPSHOT_EXPIRES_SECONDS=1800
STOCK_QUOTE_SNAPSHOT_EXPIRES_SECONDS=300
STOCK_QUOTE_SNAPSHOT_STALE_SECONDS=86400
STOCK_REFRESH_COOLDOWN_SECONDS=300
STOCK_REFRESH_COOKIE_SECRET=...
STOCK_RATE_LIMIT_SECRET=...
STOCK_SCORE_RATE_LIMIT=180
STOCK_SCORE_RATE_LIMIT_WINDOW_SECONDS=60
STOCK_SCORE_REFRESH_RATE_LIMIT=6
STOCK_SCORE_REFRESH_RATE_LIMIT_WINDOW_SECONDS=900
STOCK_SCORE_BATCH_RATE_LIMIT=45
STOCK_SCORE_BATCH_RATE_LIMIT_WINDOW_SECONDS=60
STOCK_QUOTE_RATE_LIMIT=240
STOCK_QUOTE_RATE_LIMIT_WINDOW_SECONDS=60
STOCK_QUOTE_REFRESH_RATE_LIMIT=8
STOCK_QUOTE_REFRESH_RATE_LIMIT_WINDOW_SECONDS=900
STOCK_REFRESH_LEASE_SECONDS=30
STOCK_QUOTE_REFRESH_LEASE_SECONDS=30
STOCK_KIS_QUOTE_PROVIDER_RATE_LIMIT=120
STOCK_KIS_QUOTE_PROVIDER_RATE_LIMIT_WINDOW_SECONDS=60
STOCK_RULE_JUDGMENT_RATE_LIMIT=600
STOCK_RULE_JUDGMENT_RATE_LIMIT_WINDOW_SECONDS=60
STOCK_RULE_JUDGMENT_MEMORY_CACHE_MAX_ENTRIES=5000
STOCK_JUDGMENT_BODY_MAX_BYTES=65536
STOCK_SYMBOL_SEARCH_RATE_LIMIT=120
STOCK_SYMBOL_SEARCH_RATE_LIMIT_WINDOW_SECONDS=60
STOCK_REFRESH_QUEUE_RETRY_AFTER_SECONDS=300
STOCK_SCORE_MISS_RETRY_AFTER_SECONDS=5
STOCK_INDUSTRY_BENCHMARK_CACHE_SECONDS=21600
STOCK_INDUSTRY_BENCHMARK_CACHE_MAX_ENTRIES=5000
STOCK_INDUSTRY_BENCHMARK_TIMEOUT_MS=1500
STOCK_SYMBOL_PROFILE_CACHE_SECONDS=86400
STOCK_SYMBOL_PROFILE_CACHE_MAX_ENTRIES=20000
STOCK_SYMBOL_PROFILE_TIMEOUT_MS=1500
STOCK_SCORE_COLLECTOR_RATE_LIMIT=30
STOCK_SCORE_COLLECTOR_RATE_LIMIT_WINDOW_SECONDS=60
STOCK_FUNDAMENTALS_CACHE_SECONDS=43200
STOCK_FUNDAMENTALS_STALE_SECONDS=604800
STOCK_COLLECTOR_OUTPUT_MAX_BYTES=1000000
STOCK_SCORE_MEMORY_CACHE_MAX_ENTRIES=1000
STOCK_QUOTE_MEMORY_CACHE_MAX_ENTRIES=2000
STOCK_DATA_RUNTIME=snapshot
MARKET_DATA_SERVICE_ENABLE_QUOTE=1
MARKET_DATA_SERVICE_ENABLE_SCORE=0
MARKET_DATA_SERVICE_URL=http://127.0.0.1:8080
MARKET_DATA_BIND_ADDR=0.0.0.0:8080
MARKET_DATA_INTERNAL_TOKEN=...
REDIS_URL=
```

`REDIS_URL`은 향후 durable cache/queue backend를 붙일 때만 설정합니다. 현재 Rust 서비스는 `REDIS_URL`이 비어 있으면 bounded memory cache/queue로 동작하고, `/readyz`의 `durable_refresh_available=false`는 score durable refresh가 아직 Rust 소유가 아님을 뜻합니다.

`MARKET_DATA_SERVICE_ENABLE_SCORE=1`은 Rust market-data 서비스가 durable score refresh/cache 경로까지 담당할 때만 켜세요. 현재 기본 경로에서는 quote만 Rust 서비스로 넘기고, score snapshot 생성은 Supabase queue + worker/Python collector가 담당합니다. Rust 서비스의 quote/score cache와 refresh queue는 bounded memory fallback으로 동작하며, `/readyz`와 `/metrics`에서 active backend, capacity, queue depth, provider error class를 확인할 수 있습니다.

Quote serving contract values shared by Next and Rust live in `shared/quote-contract.json`: domestic KIS market division, domestic exchange label, US exchange fallback order, and default quote freshness/stale TTL. Change that file first when quote semantics change, then run Node and Rust quote contract tests.

판단문은 LLM 호출 없이 서버 룰 엔진에서 생성합니다. 결과는 `stock_rule_judgments`에 6시간 버킷으로 캐시하고, 프로세스 메모리 캐시를 먼저 확인해 인기 종목 반복 조회 비용을 줄입니다. PER/PBR 업종 비교는 `stock_industry_benchmarks`를 읽으며, 이 테이블은 요청 경로에서 집계하지 않습니다.

종목별 업종은 `stock_symbol_profiles`와 `stock_symbol_industry_tags`에 사전 백필합니다. 한 종목이 여러 taxonomy/tag를 가질 수 있지만 런타임 판단에는 `stock_symbol_profiles.primary_sector`와 `primary_industry`를 우선 사용합니다. profile 조회는 프로세스 메모리에 기본 24시간 캐시되며, yfinance/KIS 같은 외부 제공자 조회는 사용자 요청 중 실행하지 않습니다.
업종 원천과 운영 주기는 [docs/industry-data-sources.md](docs/industry-data-sources.md)에, 점수 모델 버전/캐시/스모크 운영은 [docs/score-system-operations.md](docs/score-system-operations.md)에 정리되어 있습니다. 점수 정확도 개선을 위한 데이터 보강 검토는 [docs/score-data-enrichment-review.md](docs/score-data-enrichment-review.md)를 보세요.

운영 리포트는 refresh queue backlog, stale/dead job, score snapshot 모델 분포, 점수 동점률, 결측/저신뢰 고득점 위험을 한 번에 확인합니다. `thresholds`는 배포를 막는 실패 기준이고, `freshness_risks`는 demand-driven cache에서 임계값을 넘지 않아도 확인해야 하는 경고입니다. `MARKET_DATA_SERVICE_URL`과 `MARKET_DATA_INTERNAL_TOKEN`이 설정되어 있으면 Rust market-data `/healthz`와 인증된 `/metrics`도 함께 점검합니다. 직접 진단할 때는 bearer 인증이 필요한 `/readyz`를 사용해 cache/queue backend가 memory인지, score durable refresh가 아직 비활성인지 확인하세요.

```bash
npm run ops:report
```

`npm run ops:check`는 배포 게이트라서 market-data 서비스도 threshold에 포함합니다. 로컬에서 실행할 때는 `MARKET_DATA_SERVICE_URL`과 `MARKET_DATA_INTERNAL_TOKEN`을 설정하거나 Docker target을 먼저 띄우세요.

현재 release gate 값은 `package.json`의 `ops:check` 스크립트와 동일해야 합니다.

| Check | Gate | Remediation |
| --- | ---: | --- |
| `refresh_queue.dead_jobs` | `0` | dead job 원인 로그를 보고 재시도 가능 job만 reset |
| `refresh_queue.stale_running_jobs` | `0` | lock을 잡은 worker 장애 확인 후 stale lock 정리 |
| `refresh_queue.queued_jobs` | `<= 1000` | queue drain worker 증설 또는 provider rate limit 조정 |
| `score_calibration.stale_snapshots` | `<= 100` | score queue drain 또는 hot ticker score refresh |
| `score_calibration.current_model_rate` | `>= 0.9` | 구버전 score snapshot drain/삭제 후 재생성 |
| `score_calibration.duplicate_score_rate` | `<= 0.5` | 점수 모델 rounding/coverage 회귀 조사 |
| `score_calibration.low_confidence_high_score_count` | `0` | score guardrail 회귀로 보고 배포 중단 |
| `quote_freshness.missing_price_count` | `<= 25` | quote provider/스냅샷 upsert 오류 확인 |
| `industry_benchmarks.expired_rows` | `0` | benchmark refresh workflow 수동 실행 |
| `market_calendar.missing_or_thin_markets` | `0` | `npm run market-calendar:sync` 실행 |
| `market_data_service.failure_count` | `0` | `/healthz`, `/readyz`, `/metrics`와 token/env 확인 |

`freshness_risks`는 threshold failure가 아니라 운영 경고입니다. `quote_stale_rate >= 0.75` 또는 oldest due job age `> 60`분이면 medium 경고, 각각 `>= 0.95` 또는 `> 240`분이면 high 경고로 보고 queue drain과 provider 상태를 먼저 확인하세요.

업종 리포트는 canonical 업종 mapping 누락, 표본 수가 작은 업종, 이름만 다른 유사 업종을 점검합니다. 업종이 비어 있는 행은 실제 보강 대상인 `asset_class=stock`과 ETF/ETN/스팩/우선주 등 없어도 되는 비단일주식 대상으로 나눠 보여줍니다.

```bash
PYTHON_BIN=.venv/bin/python npm run industry:audit
```

운영 초기화 순서는 아래와 같습니다.

```bash
python scripts/sync_symbol_master.py
python scripts/backfill_symbol_profiles.py --source master --batch-size 1000
python scripts/backfill_symbol_profiles.py --source kind --market KR --batch-size 1000
python scripts/backfill_symbol_profiles.py --source nasdaq --market US --batch-size 1000
python scripts/seed_industry_taxonomy_map.py
```

`master`는 전체 종목을 pending profile로 빠르게 채웁니다. 국내 종목은 KIND 상장법인목록 bulk download를 1차 업종 소스로 사용합니다. 이 파일은 한 번의 요청으로 회사명, 시장구분, 종목코드, 업종, 주요제품, 상장일을 내려주므로 KOSPI/KOSDAQ/KONEX를 종목별 외부 호출 없이 채울 수 있습니다. 미국 종목은 Nasdaq screener bulk source를 1차 업종 소스로 사용하고, `yfinance`는 bulk source 구멍을 메우는 수동 fallback으로만 사용합니다. `SUPABASE_SERVICE_ROLE_KEY`가 있으면 REST upsert를 쓰고, service role key가 없으면 `.env.supabase.local`의 `SUPABASE_ACCESS_TOKEN`으로 `supabase db query`를 실행합니다.

업종 마스터는 매일 갱신하지 않습니다. 초기 백필 후에는 분기별 또는 상장/상폐 반영 시점에만 아래처럼 전체 classification을 다시 채웁니다. KIND/Nasdaq bulk source에 없는 종목만 보강할 때 `--run-yfinance-fallback` 또는 `--lane KR:KOSPI:50`처럼 명시적으로 켭니다.

```bash
python scripts/run_industry_maintenance.py --seed-master --refresh-classifications
python scripts/run_industry_maintenance.py --run-yfinance-fallback --lane KR:KOSPI:50 --lane KR:KOSDAQ:50
python scripts/seed_industry_taxonomy_map.py
```

매일 갱신할 대상은 업종 자체가 아니라 업종별 valuation benchmark입니다. 배포 후 Supabase migration을 적용한 뒤, 운영 작업에서 아래 RPC를 하루 1회 실행해 업종/섹터 벤치마크를 갱신합니다. 기본 표본 수는 8개이고, 기존 `stock_score_snapshots`의 detail payload에서 PER, Forward PER, PBR, Price/Sales, EV/Revenue를 집계합니다.

```sql
select public.refresh_stock_industry_benchmarks(current_date, 8);
```

```bash
python scripts/run_industry_maintenance.py --refresh-benchmarks
```

점수 모델 변경 배포 후에는 새 모델 버전 캐시만 사용되는지 확인하고, 대표 종목 가드레일을 통과하는지 스모크 체크를 실행합니다.

```bash
PYTHON_BIN=.venv/bin/python npm run score:smoke
```

Rust 기반 `market-data` 서비스는 요청 중 Python subprocess 실행을 줄이기 위한 rewrite 경로입니다. 현재 public Next API는 Supabase snapshot을 기본으로 읽고, quote는 Node KIS client 또는 Rust market-data service로 즉시 갱신할 수 있습니다. Rust quote provider는 `shared/quote-contract.json`에 정의된 국내 `UN` market division, `KRX/NXT` 라벨, 미국 `NAS`, `NYS`, `AMS` fallback 순서를 사용해 Node KIS path와 같은 계약을 따릅니다. score snapshot 생성은 durable Rust/TypeScript score refresh가 완성될 때까지 Supabase queue + legacy Python score worker가 담당합니다. 상세 화면의 점수 기준 표시는 score `server_cache`를 따로 보여주므로, 현재가가 방금 갱신돼도 점수 스냅샷이 stale이면 stale로 표시됩니다.

Vercel preview/prod 빌드는 `STOCK_DATA_RUNTIME=python` 같은 값이 실수로 들어와도 기본적으로 Python collector 파일을 함수 번들에 포함하지 않습니다. 정말로 Vercel에서 Python subprocess fallback을 번들링해야 하는 특수 상황에서는 `STOCK_ALLOW_VERCEL_PYTHON_RUNTIME=1`까지 함께 설정해야 합니다. Docker나 자체 Node 서버에서 요청 중 score collector fallback을 유지해야 하면 `INCLUDE_PYTHON_COLLECTOR=1` 또는 `STOCK_DATA_RUNTIME=python`/`STOCK_DATA_BACKEND=python`을 빌드 환경에 명시하세요.

## 실행

```bash
npm run dev
```

```text
http://127.0.0.1:3000/?ticker=KO
```

## 검증

로컬 전체 검증은 CI 순서와 동일하게 실행합니다.

```bash
npm run check:all
npm run supabase:readiness
npm run ops:check
```

`npm run check:all`은 Node tests, Python unittest, Rust tests, TypeScript, production build를 모두 실행합니다. `ops:check`는 Supabase service role과 market-data service URL/token이 필요하므로, market-data target을 띄우지 않은 관찰 목적이면 `npm run ops:report`를 사용하세요.

프론트엔드 변경 후에는 dev server에서 최소 두 경로를 desktop/mobile 폭으로 확인합니다.

```text
http://127.0.0.1:3000/?ticker=US:KO
http://127.0.0.1:3000/compare?tickers=US:KO,US:PEP,US:MNST
```

확인 항목은 차트 비어 있음, 텍스트 겹침/가로 overflow, 자동완성 키보드 이동, retry/status/alert 상태, `h1`, chart `aria-describedby`, compare semantic table입니다.

## 배포

Vercel + Supabase 배포에서는 공개 요청 경로에서 무거운 Python score collector를 실행하지 않습니다. Next API는 Supabase snapshot을 먼저 읽고, quote는 KIS 키가 있으면 Vercel Node 런타임에서 종목별 lease 아래 즉시 갱신합니다. score/analysis가 없거나 너무 오래되었고 즉시 만들 수 없는 경우에는 `stock_refresh_jobs`에 수집 작업을 넣은 뒤 pending 응답을 반환합니다.

Vercel preview/runtime env. 수동 preview 배포는 branch-specific preview env를 받지 않으므로, 최소한 preview 공통 env에 아래 값을 등록하세요:

```text
STOCK_DATA_RUNTIME=snapshot
SUPABASE_URL=...
SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
STOCK_REFRESH_COOKIE_SECRET=...
STOCK_RATE_LIMIT_SECRET=...
STOCK_API_APP_KEY=...
STOCK_API_APP_SECRET=...
STOCK_API_BASE=https://openapi.koreainvestment.com:9443
```

`STOCK_API_*` 값은 quote 수동 새로고침과 만료 quote의 요청 주도 갱신에 사용합니다. GitHub Actions는 모든 종목을 계속 만드는 주 데이터 경로가 아니라 queue drain, hot ticker optional warm-up, 업종 benchmark, 상장/상폐 delta 같은 유지보수 역할입니다. 배포 후에는 값을 노출하지 않는 진단 엔드포인트로 env 연결 상태를 확인할 수 있습니다.

```bash
curl https://<preview-url>/api/health/stock-data
```

Preview 수동 배포는 branch preview env 이름을 검증한 뒤 Vercel 프로젝트 env로 배포하는 스크립트를 사용합니다. secret 값은 CLI 인자로 넘기지 않습니다. `--prod`는 사용하지 않습니다.

```bash
npm run deploy:preview
```

Python/yfinance collector는 score snapshot legacy worker와 데이터 백필/감사 스크립트에만 남깁니다. quote refresh는 TypeScript worker가 `stock_refresh_jobs` queue를 drain하고, 필요할 때 최근 인기 종목이나 운영자가 지정한 warm ticker quote를 함께 갱신합니다.

GitHub Actions `schedule`은 GitHub default branch에 workflow가 올라간 뒤에만 동작합니다. 기능 브랜치 preview를 수동 배포한 상태에서는 사용자가 만든 queue가 자동으로 비워지지 않으므로, merge 전 preview 점검은 아래 수동 drain 명령이나 `workflow_dispatch`가 가능한 default-branch workflow를 사용하세요.

```bash
npm run snapshots:drain:quote -- --queue-limit 50
node --import tsx scripts/publish_stock_snapshots.ts --tickers NVDA,TSLA,KO,005930,000660 --drain-queue --kind quote --queue-limit 50 --json
PYTHON_BIN=.venv/bin/python npm run snapshots:drain:score-legacy -- --queue-limit 50
```

GitHub Actions 스케줄러를 쓰려면 repository secrets에 `STOCK_API_APP_KEY`, `STOCK_API_APP_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`를 넣으세요. 선택적으로 repository variable `STOCK_WARM_TICKERS`에 warm ticker 목록을 넣을 수 있지만, 비워 두면 queue drain만 실행합니다. 기본 queue drain은 휴장일을 건너뛰고 5분마다 실행되며, quote는 최대 50개, chart backstop은 기본 15개를 처리합니다. workflow concurrency로 provider 호출이 겹치지 않게 합니다. quote refresh는 TypeScript worker가 처리합니다. score refresh는 Rust/TS durable score worker가 완성될 때까지 `STOCK_LEGACY_SCORE_WORKER_ENABLED=1`의 legacy Python score worker가 `score` job만 분리 claim해서 처리하되, due score job 또는 workflow_dispatch 수동 ticker가 있을 때만 Python을 설치/실행합니다. technical score가 chart 데이터를 함께 만들면 chart snapshot으로 재사용하고, chart queue는 그 뒤의 bounded backstop으로만 돕습니다. chart status gate는 due queued job과 expired running lock을 함께 보므로 worker crash 후에도 다음 실행에서 claim RPC가 복구를 시도합니다. `STOCK_SNAPSHOT_QUEUE_LIMIT`, `STOCK_CHART_SNAPSHOT_QUEUE_LIMIT`, `STOCK_SNAPSHOT_SLEEP_SECONDS`, `STOCK_REFRESH_QUEUE_RETRY_AFTER_SECONDS`, `STOCK_SCORE_MISS_RETRY_AFTER_SECONDS`로 처리량, provider 간격, 사용자 pending 재시도 안내를 조정합니다.

업종 평균과 외부 업종 PER은 `.github/workflows/maintain-industry-benchmarks.yml`에서 미국 정규/애프터마켓 종료 후 하루 1번 갱신합니다. 이 workflow는 `scripts/sync_market_calendar.py`로 US/KR 시장 달력도 550일치 유지합니다. 배포 전에는 Node 기반 `npm run supabase:readiness`와 `npm run ops:check`로 필수 테이블/RPC와 운영 threshold를 확인하고, 운영 중에는 `npm run ops:report`로 큐, 점수 snapshot, 현재가 freshness, 업종 benchmark 만료, 시장 달력 커버리지, market-data service 상태를 함께 점검합니다. queue drain worker는 실행 전 `stock_runtime_readiness` preflight를 수행하므로 필수 RPC/table이 빠진 환경에서는 job을 claim하지 않습니다.

Docker/VM 배포에서는 기존처럼 Python venv가 포함된 long-lived container를 사용할 수 있습니다.

```bash
docker build -t stock-score-reader .
docker run --env-file .env.local -p 3000:3000 stock-score-reader
```

Rust market-data 서비스 이미지만 빌드할 때는 Docker target을 지정합니다.

```bash
scripts/docker-build-market-data.sh stock-market-data
docker run --env-file .env.local -p 8080:8080 stock-market-data
curl http://127.0.0.1:8080/healthz
curl -H "Authorization: Bearer $MARKET_DATA_INTERNAL_TOKEN" http://127.0.0.1:8080/readyz
curl -H "Authorization: Bearer $MARKET_DATA_INTERNAL_TOKEN" http://127.0.0.1:8080/metrics
```

macOS에서 Docker Desktop이 관리자 권한 설정에 막히면 Colima를 사용할 수 있습니다.

```bash
brew install colima
colima start --runtime docker --cpu 4 --memory 4 --disk 30
scripts/docker-build-market-data.sh stock-market-data
```

Supabase migration을 먼저 적용해야 API rate limit과 서버 전용 cache read 정책이 함께 동작합니다.

## 알려진 배포 제약

- CSP는 production에서도 Next runtime script/style 동작을 위해 `script-src 'unsafe-inline'`과 `style-src 'unsafe-inline'`을 허용합니다. 직접 HTML injection sink는 쓰지 않고, nonce/hash 기반 CSP로 줄이는 작업은 별도 배포 전략이 필요합니다.
- development에서만 `script-src 'unsafe-eval'`이 추가됩니다. production header에 포함되면 배포를 중단하세요.
- Vercel은 `STOCK_DATA_RUNTIME=python`이 들어와도 기본적으로 snapshot mode로 fail closed 됩니다. Python collector를 Vercel bundle에 넣는 것은 `STOCK_ALLOW_VERCEL_PYTHON_RUNTIME=1`이 있을 때만 허용합니다.
- Vercel에서는 localhost market-data URL을 사용하지 않습니다. preview/prod에는 외부 접근 가능한 `MARKET_DATA_SERVICE_URL`과 `MARKET_DATA_INTERNAL_TOKEN`을 설정하거나 Rust service 연동을 끄세요.
- `SUPABASE_PUBLISHABLE_KEY`는 public read 전용입니다. production에서 service-role read fallback은 명시 override 없이는 허용하지 않으며, `SUPABASE_SERVICE_ROLE_KEY`는 서버 작업과 queue/cache write 전용으로만 둡니다.

주의: 점수는 조회값을 화면용으로 계산한 참고 지표입니다. 투자 판단이나 자동매매에 그대로 사용하면 안 됩니다.
