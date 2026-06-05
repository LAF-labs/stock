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

캐시는 현재가와 전체 점수를 분리합니다. 장중 현재가는 짧게, 전체 점수는 1시간 캐시하고, 폐장/휴장 중에는 `market_calendar.next_open_at`까지 캐시합니다. 휴장일 판단은 런타임 API가 아니라 Supabase `market_calendar` 테이블을 사용합니다.

```text
STOCK_QUOTE_CACHE_OPEN_SECONDS=180
STOCK_SCORE_DETAIL_CACHE_SECONDS=3600
STOCK_SCORE_COMPARE_CACHE_SECONDS=3600
STOCK_SCORE_CACHE_STALE_SECONDS=86400
STOCK_QUOTE_CACHE_STALE_SECONDS=86400
STOCK_REFRESH_COOLDOWN_SECONDS=900
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
STOCK_AI_JUDGMENT_RATE_LIMIT=30
STOCK_AI_JUDGMENT_RATE_LIMIT_WINDOW_SECONDS=21600
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

AI 판단문은 모델/프롬프트/티커 기준으로 6시간 버킷에 캐시합니다. 캐시 미스에서만 OpenAI API를 호출하며, 공개 배포에서는 `STOCK_RATE_LIMIT_SECRET`과 Supabase rate limit migration을 적용해야 합니다.

Rust 기반 `market-data` 서비스는 요청 중 Python subprocess 실행을 없애기 위한 rewrite 경로입니다. 현재 public Next API는 `MARKET_DATA_BACKEND=python`을 기본 fallback으로 유지하며, Rust 서비스는 `/healthz`, `/metrics`와 내부 인증 골격부터 제공합니다. 다음 단계에서 KIS client, cache/job pipeline, score engine을 순차적으로 이관합니다.

## 실행

```bash
npm run dev
```

```text
http://127.0.0.1:3000/?ticker=KO
```

## 배포

이 앱의 API는 Python collector를 subprocess로 실행하므로, 공개 배포는 Python venv가 포함된 long-lived container/VM을 기준으로 합니다.

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
