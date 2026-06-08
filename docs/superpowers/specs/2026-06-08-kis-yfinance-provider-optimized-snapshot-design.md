# KIS/yfinance Provider-Optimized Snapshot Design

## Goal

KIS OpenAPI and yfinance만으로 상세, 기술적 분석, 비교 화면의 데이터 준비 지연을 줄이고, 특정 provider 실패가 전체 큐를 막지 않게 만든다. 유료 provider 추상화는 지금 만들지 않고, 나중에 교체할 수 있을 정도의 경계만 유지한다.

## Current Problem

- Vercel 사용자 요청은 snapshot-only라서 직접 provider를 호출하지 않는 방향은 맞다.
- 하지만 snapshot miss가 발생하면 `stock_refresh_jobs`에 들어간 작업이 백그라운드 worker에 의존한다.
- 현재 GitHub Actions worker는 quote drain이 먼저 실패하면 score/technical drain까지 실행되지 않는다.
- IONQ 사례에서 quote snapshot은 준비됐지만 score snapshot이 빠졌고, quote worker가 KIS 만료 토큰 오류로 실패하면서 score queue가 계속 남았다.
- 기술적 분석, 상세, 비교는 모두 snapshot miss를 겪을 수 있으므로 한 화면만 고치는 UX 패치로는 해결되지 않는다.

## Provider Constraints

### KIS OpenAPI

- 장점: 국내/해외 시세, 일봉, 현재가 조회에 적합하고 공식 OpenAPI다.
- 제약: app key/secret, OAuth access token, TR ID, 호출 제한, 장 운영 시간, 해외시장 코드 fallback을 관리해야 한다.
- 운영 원칙: 토큰은 공유 캐시에 저장하고 만료 오류가 확인되면 캐시를 무효화한 뒤 한 번만 재발급 재시도한다. KIS 요청은 전역 rate limit과 worker throttle을 통과해야 한다.

### yfinance

- 장점: 미국/국내 일부 종목의 기초 재무, 히스토리, 보조 필드 확보가 쉽다.
- 제약: Yahoo Finance의 공식 상업용 API가 아니며 필드 누락, 429, 응답 구조 변화, 종목별 데이터 공백을 제어할 수 없다.
- 운영 원칙: 사용자 요청 경로에서는 호출하지 않는다. background enrichment에서만 명시적으로 켜고, Supabase/file cache의 fresh/stale 값을 우선 사용한다.

Reference:

- KIS OpenAPI portal: https://apiportal.koreainvestment.com/apiservice-apiservice
- yfinance project: https://github.com/ranaroussi/yfinance
- yfinance API reference: https://ranaroussi.github.io/yfinance/reference/index.html

## Recommended Architecture For Now

### 1. Request Path

- Vercel API는 Supabase snapshot과 메모리 캐시만 읽는다.
- cache hit: 바로 payload 반환.
- stale hit: stale payload를 보여주고 refresh job을 enqueue한다.
- miss: skeleton/partial UX를 보여주고 refresh job을 enqueue한다.
- 사용자 요청 중 KIS/yfinance 직접 호출은 금지한다.

### 2. Queue Workers

- quote, score, technical은 서로 실패 격리한다.
- quote worker 실패가 score/technical worker 실행을 막으면 안 된다.
- GitHub Actions는 당장 유지하되, primary worker로 믿지 않고 backstop으로 취급한다.
- 자체 worker는 다음 단계에서 Supabase RPC claim loop를 도는 작은 long-running process로 올린다.

### 3. KIS Strategy

- token cache key는 `base_url + app_key` 기준으로 유지한다.
- provider 응답에서 토큰 만료 문구가 나오면 process-local token cache와 Supabase token row를 무효화한다.
- 무효화 후 같은 요청에서 한 번만 새 토큰을 받아 재시도한다.
- 해외 주식은 성공한 market discovery를 재사용하고 실패 시 fallback market을 순회한다.
- quote와 daily bar 위주로 사용하고, 기술적 분석 fast path는 기초 재무/뉴스/애널리스트 조회를 하지 않는다.

### 4. yfinance Strategy

- `STOCK_YFINANCE_REQUEST_FETCH=0`을 production/snapshot 기본값으로 유지한다.
- background enrichment만 `STOCK_YFINANCE_REQUEST_FETCH=1`을 사용한다.
- fresh cache는 정상 점수에 반영한다.
- stale cache는 낮은 confidence와 함께 반영한다.
- miss는 점수 confidence를 낮추되 화면을 막지 않는다.

### 5. UX Strategy

- 사용자가 보는 화면은 `300초` 같은 내부 queue hint를 노출하지 않는다.
- quote만 먼저 준비되면 가격/헤더/스켈레톤을 부분 렌더한다.
- score/technical이 준비되는 즉시 같은 화면에서 자동 교체한다.
- 오래 대기하는 종목은 “데이터 준비 중” 상태와 다시 확인 액션을 유지하되, 작업이 실패한 경우에는 원인별 짧은 문구로 바꾼다.

## Phased Implementation

### Phase 0: Immediate Stabilization

- KIS 만료 토큰 응답 감지.
- Node quote worker와 Python score worker 모두 공유 토큰 캐시 무효화 후 1회 재시도.
- GitHub Actions workflow에서 quote 실패가 score drain을 막지 않게 job을 분리.
- IONQ 같은 pending job이 처리되는지 queue status와 `/api/score`로 확인.

### Phase 1: Provider-Aware Queue Discipline

- quote, score, technical queue depth와 due age를 별도로 보고한다.
- permanent provider failure와 temporary provider failure를 분리한다.
- KIS rate limit, KIS auth failure, yfinance disabled/miss/429을 안정적인 error class로 기록한다.

### Phase 2: Lightweight Self-Hosted Worker

- Supabase `claim_stock_refresh_jobs_by_kind`를 돌며 quote/score/technical을 처리하는 long-running worker를 만든다.
- GitHub Actions는 fallback/backstop으로 남긴다.
- worker health endpoint 또는 logs로 queue depth, claimed count, success/failure count를 확인한다.

### Phase 3: Partial Read Model

- 상세, 기술적 분석, 비교 API가 `ready_parts`, `pending_parts`, `stale_parts`를 내려준다.
- UI는 준비된 데이터부터 보여주고, 빠진 부분만 skeleton으로 유지한다.
- 기술적 분석은 chart/quote/identity가 준비되면 먼저 렌더하고 rule summary는 snapshot 준비 후 교체한다.

## Non-Goals

- 모든 상장 종목을 매 5분마다 prewarm하지 않는다.
- yfinance를 실시간/상업용 정답 provider처럼 취급하지 않는다.
- 지금 단계에서 유료 provider용 대형 adapter framework를 만들지 않는다.
- Vercel request handler에서 Python collector를 다시 켜지 않는다.

## Success Criteria

- quote worker 장애가 score/technical queue drain을 막지 않는다.
- KIS 만료 토큰 오류는 같은 worker run에서 자동 회복된다.
- cache miss 사용자 요청은 provider를 직접 호출하지 않고 enqueue만 수행한다.
- yfinance fetch disabled 상태에서도 stale/miss를 점수 confidence로 흡수하며 화면은 막지 않는다.
- IONQ처럼 처음 조회한 단일종목도 quote, detail score, technical snapshot이 순차적으로 준비된다.
