# Stock Detail View 3s SLA Design

## Goal

주식 상세 화면에서 사용자가 3초 이상 빈 대기 상태를 보지 않게 만든다. 비가역 실패가 아닌 한, 상세 화면은 3초 안에 `partial` 또는 `ready` 화면을 보여주고, 백엔드는 그 이후에도 누락된 데이터를 계속 생성하고 갱신한다.

이 설계의 핵심은 스켈레톤을 포기 상태로 쓰지 않는 것이다. 스켈레톤은 최초 진입 직후의 짧은 준비 상태이며, 3초 이후에는 사용자가 실제 데이터를 볼 수 있어야 한다.

## Current Problem

- 현재 프론트는 `score`, `display`, `quote` 쿼리를 동시에 보고 `skeleton`, `partial`, `ready`, `error` 상태를 추론한다.
- API 응답과 캐시 상태가 조금만 어긋나도 빠른 점수 문구, pending 문구, identity-only partial, skeleton이 서로 다른 판단을 한다.
- 사용자 입장에서는 “데이터가 준비 중인지”, “정말 안 되는 종목인지”, “새로고침을 눌러야 하는지”가 흐릿하다.
- 백엔드 작업 실패가 `ok:false` payload나 빈 snapshot으로 흘러가면 화면은 계속 기다리는 것처럼 보일 수 있다.

## Product Contract

상세 화면의 제품 계약은 다음과 같다.

1. 사용자가 종목 상세로 진입하면 즉시 스켈레톤을 보여준다.
2. 비가역 실패가 아닌 한, 3초 안에 실제 화면 모델을 반환한다.
3. 실제 화면 모델은 완성 데이터가 아니어도 된다. 가격, 차트, 점수, 마지막 known-good, identity 중 사용자가 볼 가치가 있는 정보를 조합한다.
4. 3초 이후에도 누락된 파트는 durable job으로 계속 처리한다.
5. 부분 실패는 전체 실패가 아니다. provider timeout, queue delay, score 지연, 재무 데이터 지연은 모두 `recovering` 상태다.
6. 실패 화면은 invalid ticker, 실제 심볼 없음, 구조적으로 지원 불가처럼 비가역적인 경우에만 보여준다.

## Recommended Architecture

`/api/stock/detail-view`를 상세 화면의 단일 read model endpoint로 만든다.

프론트는 더 이상 `score`, `display`, `quote`를 각각 조합해서 사용자 경험 상태를 추론하지 않는다. 프론트는 `StockDetailViewModel.mode`만 보고 렌더링한다.

```ts
type StockDetailViewModel = {
  mode: "partial" | "ready" | "failed_irreversible";
  ticker: string;
  generatedAt: string;
  nextPollMs?: number;
  identity: StockIdentity;
  sections: {
    price?: PriceSection;
    chart?: ChartSection;
    score?: ScoreSection;
    financials?: FinancialSection;
    analyst?: AnalystSection;
  };
  parts: {
    price: StockPartState;
    chart: StockPartState;
    score: StockPartState;
    financials: StockPartState;
    analyst: StockPartState;
  };
  jobs: StockRefreshJobHint[];
};

type StockPartState =
  | "ready"
  | "stale_ready"
  | "refreshing"
  | "failed_retrying"
  | "missing"
  | "unsupported";
```

`skeleton`은 API mode가 아니라 클라이언트의 최초 화면 상태다. 서버 endpoint는 비가역 실패가 아닌 한 `partial` 또는 `ready`를 반환해야 한다.

## Data Selection Order

3초 안에 화면을 만들 때 백엔드는 다음 순서로 데이터를 조립한다.

1. fresh display snapshot
2. stale display snapshot with active refresh
3. last-known-good detail/display payload
4. fresh quote snapshot
5. stale quote snapshot
6. chart snapshot
7. score snapshot 또는 fast-path score
8. stock symbol master identity

`identity`만 있는 상태는 사용자 만족도가 낮으므로 성공적인 3초 응답으로 보지 않는다. 그래도 3초 내 확보 가능한 데이터가 identity뿐이면 `partial`로 반환해 빈 화면은 피하되, 이 응답은 degraded response로 기록하고 backend는 quote/chart/score job을 즉시 high priority로 올린다.

## Backend Flow

```text
GET /api/stock/detail-view?ticker=US:VLD
        |
        +-- validate ticker and resolve identity
        +-- read display, quote, chart, score snapshots concurrently
        +-- classify irreversible failure if applicable
        +-- enqueue missing or stale parts as durable jobs
        +-- build best visible StockDetailViewModel within 3s
        +-- return partial or ready with nextPollMs
```

백엔드는 request path에서 provider를 직접 오래 기다리지 않는다. 대신 snapshot과 durable job을 중심으로 동작한다. 단, 3초 SLA를 지키기 위해 snapshot read, identity resolve, job enqueue는 병렬로 수행한다.

## Durable Refresh Rules

- `price`, `chart`, `score`, `financials`, `analyst`는 독립 job으로 관리한다.
- 한 파트 실패가 다른 파트 완료를 막지 않는다.
- temporary failure는 `failed_retrying`으로 남기고 retry/backoff를 유지한다.
- permanent failure만 `unsupported` 또는 `failed_irreversible`에 반영한다.
- worker가 `ok:false` payload를 성공 처리하면 안 된다.
- job 상태는 화면 문구가 아니라 read model의 `parts`와 `jobs` hint로 흡수한다.

## Frontend Flow

프론트는 단일 query를 사용한다.

```ts
const detailView = useStockDetailView(ticker);

if (detailView.isInitialLoading) return <StockDetailSkeleton />;
if (detailView.data.mode === "failed_irreversible") return <StockNotFound />;
return <StockDetailView data={detailView.data} />;
```

`nextPollMs`가 있으면 그 간격으로 `/api/stock/detail-view`를 다시 가져온다. 새 snapshot이 준비되면 같은 화면 안에서 section이 채워진다. 사용자는 새로고침을 누를 필요가 없다.

## UX Rules

- 첫 3초 이후에는 전체 화면 스켈레톤을 유지하지 않는다.
- `partial` 화면에서는 확보된 실제 데이터를 보여준다.
- 누락 파트는 큰 경고 대신 조용한 loading affordance로 둔다.
- “안 됩니다” 문구는 비가역 실패에만 사용한다.
- 새로고침 버튼은 수동 재시도 보조 수단이지, 정상 업데이트의 필수 경로가 아니다.
- 빠른 점수 문구는 오래 지속되는 상태 설명으로 쓰지 않는다.

## Irreversible Failure

다음 경우만 `failed_irreversible`로 본다.

- ticker 형식이 잘못됨
- symbol master와 provider discovery 모두에서 실제 심볼을 찾을 수 없음
- 상세 화면에서 구조적으로 지원하지 않는 상품
- 정책상 제공할 수 없는 데이터

다음은 실패 화면이 아니라 `partial` 또는 `recovering`이다.

- KIS timeout
- yfinance miss 또는 429
- score worker 지연
- financials/analyst 지연
- chart snapshot miss
- refresh queue delay
- stale snapshot only

## Testing Strategy

테스트는 계약 중심으로 작성한다.

- `/api/stock/detail-view`는 비가역 실패가 아닌 snapshot miss에서 `partial`을 반환한다.
- identity-only partial은 high priority missing part jobs를 enqueue한다.
- price나 chart 중 하나라도 있으면 3초 이후 전체 스켈레톤 대신 partial view가 렌더된다.
- `nextPollMs`가 있는 응답은 query가 자동 refetch한다.
- worker는 `ok:false` score payload를 complete 처리하지 않는다.
- provider temporary failure는 `failed_retrying` part로 표시되고 전체 실패가 되지 않는다.
- invalid ticker 또는 real not-found만 `failed_irreversible`이 된다.

## Phased Implementation

### Phase 1: Detail View Model Contract

- `StockDetailViewModel` 타입을 추가한다.
- 기존 display, quote, chart, score snapshot을 조합하는 adapter를 만든다.
- `/api/stock/detail-view` route를 추가한다.
- 3초 내 `partial | ready | failed_irreversible` 반환 테스트를 작성한다.

### Phase 2: Frontend Single Query Migration

- `useStockDashboardQueries`의 사용자 표시 상태를 `detail-view` 중심으로 옮긴다.
- 기존 `score`, `display`, `quote` query는 내부 보조 또는 점진 제거 대상으로 둔다.
- 전체 스켈레톤은 최초 loading에만 사용한다.
- partial 화면은 `StockDetailViewModel.sections`를 기준으로 렌더한다.

### Phase 3: Durable Part Jobs

- missing part enqueue를 `price`, `chart`, `score`, `financials`, `analyst` 단위로 명확히 한다.
- queue worker가 part별 성공/실패를 독립적으로 snapshot에 반영한다.
- temporary/permanent error classification을 read model에 반영한다.

### Phase 4: Observability And SLA Guard

- 3초 안에 `partial`을 만들지 못한 요청을 metric/log로 남긴다.
- skeleton over 3s, partial-to-ready latency, part failure rate를 추적한다.
- 운영 리포트에서 queue due age와 화면 영향도를 함께 보여준다.

## Non-Goals

- 지금 단계에서 SSE/WebSocket을 도입하지 않는다.
- request path에서 provider를 오래 직접 호출하지 않는다.
- 모든 파트를 완성할 때까지 상세 화면을 막지 않는다.
- identity-only 상태를 만족스러운 최종 화면으로 취급하지 않는다.
- 기존 score 계산 모델을 이번 설계에서 바꾸지 않는다.

## Success Criteria

- 사용자는 비가역 실패가 아닌 종목에서 3초 이상 전체 스켈레톤만 보지 않는다.
- 새로고침 없이 partial 화면이 ready 화면으로 자동 갱신된다.
- provider 일부 실패가 전체 상세 화면 실패로 번지지 않는다.
- fast-path copy가 장기 pending 상태를 설명하는 주 문구로 남지 않는다.
- 운영자는 어떤 part가 막혔는지 job과 read model에서 확인할 수 있다.
