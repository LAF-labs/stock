# Stock Score Reader

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

## 설치

```bash
npm install
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
```

`SUPABASE_PUBLISHABLE_KEY`는 공개 캐시 조회용입니다. `SUPABASE_SERVICE_ROLE_KEY`가 있어야 서버가 점수/현재가/펀더멘털 캐시와 새로고침 쿨다운을 Supabase에 기록합니다. service role key는 브라우저 번들에 노출하지 마세요.

Supabase CLI용 access token은 앱 런타임 env와 분리해 `.env.supabase.local`에 저장합니다. 이 파일은 `.gitignore`의 `.env*.local` 규칙으로 커밋되지 않습니다.

```text
SUPABASE_ACCESS_TOKEN=sbp_...
```

Supabase CLI는 아래 래퍼로 실행하면 `.env.supabase.local`을 자동으로 읽습니다.

```bash
powershell -ExecutionPolicy Bypass -File scripts/supabase-cli.ps1 db push --linked --yes
```

캐시는 demand-driven read-through 방식입니다. 사용자가 조회한 종목만 Supabase snapshot으로 살아남고, 장중 현재가/등락률은 5분, 점수/판정/분석은 30분 동안 공유됩니다. 현재가 새로고침 버튼은 quote만 즉시 갱신하며 사용자별 5분 cooldown과 종목별 refresh lease로 외부 API 폭주를 막습니다. 폐장/휴장 중에는 `market_calendar.next_open_at`까지 캐시하되, 장마감 이후 확정된 snapshot만 다음 개장까지 연장합니다.

```text
STOCK_QUOTE_CACHE_OPEN_SECONDS=300
STOCK_SCORE_DETAIL_CACHE_SECONDS=1800
STOCK_SCORE_COMPARE_CACHE_SECONDS=1800
STOCK_SCORE_CACHE_STALE_SECONDS=86400
STOCK_QUOTE_CACHE_STALE_SECONDS=86400
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
STOCK_INDUSTRY_BENCHMARK_CACHE_SECONDS=21600
STOCK_INDUSTRY_BENCHMARK_CACHE_MAX_ENTRIES=5000
STOCK_INDUSTRY_BENCHMARK_TIMEOUT_MS=1500
STOCK_SYMBOL_PROFILE_CACHE_SECONDS=86400
STOCK_SYMBOL_PROFILE_CACHE_MAX_ENTRIES=20000
STOCK_SYMBOL_PROFILE_TIMEOUT_MS=1500
STOCK_SCORE_COLLECTOR_RATE_LIMIT=30
STOCK_SCORE_COLLECTOR_RATE_LIMIT_WINDOW_SECONDS=60
STOCK_QUOTE_COLLECTOR_RATE_LIMIT=60
STOCK_QUOTE_COLLECTOR_RATE_LIMIT_WINDOW_SECONDS=60
STOCK_FUNDAMENTALS_CACHE_SECONDS=43200
STOCK_FUNDAMENTALS_STALE_SECONDS=604800
STOCK_COLLECTOR_OUTPUT_MAX_BYTES=1000000
STOCK_SCORE_MEMORY_CACHE_MAX_ENTRIES=1000
STOCK_QUOTE_MEMORY_CACHE_MAX_ENTRIES=2000
MARKET_DATA_BACKEND=python
MARKET_DATA_SERVICE_URL=http://127.0.0.1:8080
MARKET_DATA_BIND_ADDR=0.0.0.0:8080
MARKET_DATA_INTERNAL_TOKEN=...
REDIS_URL=redis://127.0.0.1:6379
```

판단문은 LLM 호출 없이 서버 룰 엔진에서 생성합니다. 결과는 `stock_rule_judgments`에 6시간 버킷으로 캐시하고, 프로세스 메모리 캐시를 먼저 확인해 인기 종목 반복 조회 비용을 줄입니다. PER/PBR 업종 비교는 `stock_industry_benchmarks`를 읽으며, 이 테이블은 요청 경로에서 집계하지 않습니다.

종목별 업종은 `stock_symbol_profiles`와 `stock_symbol_industry_tags`에 사전 백필합니다. 한 종목이 여러 taxonomy/tag를 가질 수 있지만 런타임 판단에는 `stock_symbol_profiles.primary_sector`와 `primary_industry`를 우선 사용합니다. profile 조회는 프로세스 메모리에 기본 24시간 캐시되며, yfinance/KIS 같은 외부 제공자 조회는 사용자 요청 중 실행하지 않습니다.
업종 원천과 운영 주기는 [docs/industry-data-sources.md](docs/industry-data-sources.md)에, 점수 모델 버전/캐시/스모크 운영은 [docs/score-system-operations.md](docs/score-system-operations.md)에 정리되어 있습니다. 점수 정확도 개선을 위한 데이터 보강 검토는 [docs/score-data-enrichment-review.md](docs/score-data-enrichment-review.md)를 보세요.

운영 리포트는 refresh queue backlog, stale/dead job, score snapshot 모델 분포, 점수 동점률, 결측/저신뢰 고득점 위험을 한 번에 확인합니다.

```bash
PYTHON_BIN=.venv/bin/python npm run ops:report
```

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

Rust 기반 `market-data` 서비스는 요청 중 Python subprocess 실행을 없애기 위한 rewrite 경로입니다. 현재 public Next API는 `MARKET_DATA_BACKEND=python`을 기본 fallback으로 유지하며, Rust 서비스는 `/healthz`, `/metrics`와 내부 인증 골격부터 제공합니다. 다음 단계에서 KIS client, cache/job pipeline, score engine을 순차적으로 이관합니다.

## 실행

```bash
npm run dev
```

```text
http://127.0.0.1:3000/?ticker=KO
```

## 배포

Vercel + Supabase 배포에서는 공개 요청 경로에서 무거운 Python score collector를 실행하지 않습니다. Next API는 Supabase snapshot을 먼저 읽고, quote는 KIS 키가 있으면 Vercel Node 런타임에서 종목별 lease 아래 즉시 갱신합니다. score/analysis가 없거나 너무 오래되었고 즉시 만들 수 없는 경우에는 `stock_refresh_jobs`에 수집 작업을 넣은 뒤 pending 응답을 반환합니다.

Vercel preview/runtime env:

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

Preview 수동 배포는 branch preview env를 검증하고 명시 주입하는 스크립트를 사용합니다. `--prod`는 사용하지 않습니다.

```bash
npm run deploy:preview
```

Python/yfinance collector는 GitHub Actions, 로컬 관리 머신, 또는 별도 worker에서만 실행합니다. 기본 역할은 사용자가 만든 `stock_refresh_jobs` queue를 drain하는 것이고, 필요할 때만 최근 인기 종목이나 운영자가 지정한 warm ticker를 함께 갱신합니다.

```bash
python scripts/publish_stock_snapshots.py --drain-queue --queue-limit 50 --score-ttl-seconds 1800 --json
python scripts/publish_stock_snapshots.py --tickers NVDA,TSLA,KO,005930,000660 --drain-queue --queue-limit 50 --score-ttl-seconds 1800 --json
PYTHON_BIN=.venv/bin/python npm run snapshots:drain -- --queue-limit 50
```

GitHub Actions 스케줄러를 쓰려면 repository secrets에 `STOCK_API_APP_KEY`, `STOCK_API_APP_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`를 넣으세요. 선택적으로 repository variable `STOCK_WARM_TICKERS`에 warm ticker 목록을 넣을 수 있지만, 비워 두면 queue drain만 실행합니다. 기본 queue drain은 평일 5분마다 최대 50개이고, workflow concurrency로 provider 호출이 겹치지 않게 합니다. `STOCK_SNAPSHOT_QUEUE_LIMIT`, `STOCK_SNAPSHOT_SLEEP_SECONDS`, `STOCK_REFRESH_QUEUE_RETRY_AFTER_SECONDS`로 처리량, provider 간격, 사용자 pending 재시도 안내를 조정합니다.

Docker/VM 배포에서는 기존처럼 Python venv가 포함된 long-lived container를 사용할 수 있습니다.

```bash
docker build -t stock-score-reader .
docker run --env-file .env.local -p 3000:3000 stock-score-reader
```

Rust market-data 서비스 이미지만 빌드할 때는 Docker target을 지정합니다.

```bash
scripts/docker-build-market-data.sh stock-market-data
docker run --env-file .env.local -p 8080:8080 stock-market-data
```

macOS에서 Docker Desktop이 관리자 권한 설정에 막히면 Colima를 사용할 수 있습니다.

```bash
brew install colima
colima start --runtime docker --cpu 4 --memory 4 --disk 30
scripts/docker-build-market-data.sh stock-market-data
```

Supabase migration을 먼저 적용해야 API rate limit과 서버 전용 cache read 정책이 함께 동작합니다.

주의: 점수는 조회값을 화면용으로 계산한 참고 지표입니다. 투자 판단이나 자동매매에 그대로 사용하면 안 됩니다.
