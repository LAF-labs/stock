# Design System Refresh Design

## Goal

현재 주식 서비스의 큰 정보 구조는 유지하되, 세부 마진, 텍스트 위계, 버튼, 검색, 내비게이션, 표, 바텀시트, 플로팅 액션을 하나의 디자인 시스템으로 정리한다.

방향은 사용자가 선택한 하이브리드안이다.

- 표면 감성은 A안: 토스증권처럼 조용하고 정돈된 금융 앱.
- 정보 내용은 C안: 단순 조회가 아니라 판단, 비교, 해석이 빠르게 보이는 리서치 도구.
- 구현 구조는 Foundation -> Primitives -> Patterns 순서로 만든다.

## Current Problem

최근 기능 추가 과정에서 화면별 UI가 독립적으로 보정되며 다음 문제가 생겼다.

- 버튼, 검색창, 플로팅 액션, 바텀시트의 높이와 반경이 화면마다 다르다.
- 모바일 비교 화면처럼 키보드, 스크롤, 플로팅 메뉴가 겹치는 상황에서 기준이 흔들린다.
- 상세, 비교, 기술적 분석, 시가총액 대시보드가 같은 서비스처럼 보이기보다 화면마다 다른 임시 규칙을 가진다.
- `src/app/globals.css`와 화면 컴포넌트에 시각 규칙이 섞여 있어 작은 수정이 다른 화면의 모양을 깨뜨리기 쉽다.
- 데이터 표, 숫자, 변화율, 판단 칩, 섹션 제목이 금융 서비스에 필요한 정밀함보다 다소 투박하게 보이는 구간이 있다.

## Design Principles

### Calm Surface

배경, 패널, 선, 그림자는 차분해야 한다. 사용자는 가격과 판단을 읽어야 하므로 장식은 줄이고, 화면의 기본 인상은 밝고 안정적인 금융 앱이어야 한다.

### Clear Judgment

사용자가 지금 무엇을 봐야 하는지 빠르게 알 수 있어야 한다. 점수, 강점, 주의점, 시가총액, 상승/하락, 비교 우위는 작은 문구와 칩으로 또렷하게 보이게 한다.

### Tidy Numbers

숫자는 같은 규칙으로 정렬하고 축약한다. 가격, 시총, 등락률, 점수는 행마다 흔들리지 않게 고정 폭, tabular number, 일관된 색상 역할을 사용한다.

### Mobile First Interaction

모바일에서는 검색, 종목 편집, 페이지 이동이 화면을 가리지 않아야 한다. 키보드가 올라오는 상황과 스크롤 중인 상황을 별도 상태로 보고, 항상 조작 가능한 하단 액션을 제공한다.

### Reusable Before Pretty

새 화면별 CSS를 추가하기 전에 공통 primitive로 표현 가능한지 먼저 본다. 단, 과한 추상화는 피하고 지금 서비스에서 반복되는 UI만 시스템화한다.

## Foundation

Foundation은 CSS custom properties와 작은 utility class로 제공한다. 시작 파일은 `src/styles/design-tokens.css`로 둔다.

### Color Roles

구체 색상보다 역할 이름을 우선한다.

- `--color-app-bg`: 앱 전체 배경.
- `--color-surface`: 카드, 패널, 시트의 기본 면.
- `--color-surface-subtle`: 입력창, 선택 영역, 옅은 강조 배경.
- `--color-border`: 기본 경계선.
- `--color-border-strong`: 표 헤더, 고정 영역 경계.
- `--color-text-primary`: 제목과 핵심 숫자.
- `--color-text-secondary`: 설명과 보조 값.
- `--color-text-muted`: 캡션, 메타 정보.
- `--color-accent`: 주요 액션과 선택 상태.
- `--color-accent-soft`: 선택된 메뉴/탭의 옅은 배경.
- `--color-positive`, `--color-negative`, `--color-neutral`: 등락률과 판단 상태.
- `--color-warning`, `--color-danger`: 데이터 지연, 실패, 주의 상태.

팔레트는 밝은 회색 배경, 흰색 표면, 파란색 액센트를 중심으로 하되 화면 전체가 파란색만으로 보이지 않게 상승/하락/주의 색을 독립적으로 둔다.

### Spacing

간격은 4px 기반 scale로 정리한다.

- `--space-1`: 4px
- `--space-2`: 8px
- `--space-3`: 12px
- `--space-4`: 16px
- `--space-5`: 20px
- `--space-6`: 24px
- `--space-8`: 32px
- `--space-10`: 40px
- `--space-12`: 48px

페이지 내부 섹션은 모바일 16px, 데스크톱 24px 이상을 기본 gutter로 둔다. 표와 리스트의 행 내부 여백은 별도 data density token으로 분리한다.

### Radius

반경은 목적별로 제한한다.

- `--radius-xs`: 6px, 표 내부 칩과 작은 입력.
- `--radius-sm`: 8px, 일반 버튼과 작은 카드.
- `--radius-md`: 12px, 검색창과 패널.
- `--radius-lg`: 16px, 모바일 바텀시트와 큰 패널.
- `--radius-pill`: 999px, 검색 pill, FAB, 상태 pill.

버튼과 검색은 완전한 원형 또는 pill일 때만 `999px`을 쓴다. 일반 카드가 과하게 둥글어지는 것은 피한다.

### Typography

텍스트는 역할 단위 class로 제공한다.

- `text-display`: 메인 종목명, 상세 페이지 핵심 제목.
- `text-title`: 섹션 제목, 대시보드 제목.
- `text-subtitle`: 카드 제목, 보조 블록 제목.
- `text-body`: 일반 본문.
- `text-caption`: 메타 정보.
- `text-number-xl`, `text-number-md`, `text-number-sm`: 가격, 시총, 점수, 등락률.

숫자 role에는 `font-variant-numeric: tabular-nums`를 기본 적용한다. 모바일 버튼 안 텍스트는 줄바꿈 없이 들어가야 하며, 긴 값은 ellipsis 규칙을 가진 별도 class를 사용한다.

### Elevation And Motion

그림자는 큰 장식이 아니라 계층 구분에만 쓴다.

- `--shadow-floating`: 모바일 하단 액션, 팝오버.
- `--shadow-sheet`: 바텀시트.
- `--shadow-panel`: 데스크톱 floating panel.

motion은 120-220ms 범위를 기본으로 한다. 검색창 확장, FAB 축소/확대, 하단 메뉴 열림은 같은 easing을 사용한다.

## Primitives

Primitive는 반복되는 UI를 작고 명확한 컴포넌트로 만든다. 시작 위치는 `src/components/ui/*`와 `src/styles/primitives.css`다.

### Action

대상:

- `Button`
- `IconButton`
- `FloatingActionButton`
- `BottomBarAction`
- `SegmentedButton`

규칙:

- 같은 크기 variant는 높이, padding, icon size를 공유한다.
- 모바일 floating button은 스크롤 상태에 따라 label형과 icon형을 오갈 수 있지만 위치와 그림자 규칙은 동일하다.
- destructive, primary, secondary, ghost 상태를 역할로 분리한다.

### Surface

대상:

- `Panel`
- `Sheet`
- `Popover`
- `Disclosure`
- `Section`

규칙:

- 페이지 섹션 자체를 카드처럼 겹겹이 감싸지 않는다.
- 반복 item, modal, sheet, popover만 명확한 surface로 다룬다.
- 모바일 sheet는 safe-area와 키보드 상황을 고려한다.

### Data

대상:

- `DataTable`
- `DataRow`
- `MetricTile`
- `PriceChange`
- `JudgmentChip`
- `RankBadge`
- `SkeletonBlock`

규칙:

- 순위, 티커, 가격, 시총, 등락률의 alignment를 고정한다.
- 긍정/부정 색상은 `PriceChange` primitive를 통하지 않고 직접 쓰지 않는다.
- skeleton은 실제 레이아웃 크기를 흔들지 않는 고정 height를 가진다.

### Navigation And Search

대상:

- `AppShellNav`
- `MobileNavLauncher`
- `SearchChrome`
- `SymbolAutocomplete`
- `PageTabs`
- `SectorFilter`

규칙:

- 데스크톱은 얇은 상단 GNB와 페이지별 보조 목차를 분리한다.
- 모바일은 기본적으로 닫힌 햄버거 launcher를 두고, 터치 시 하단 바로 전환한다.
- 비교 화면의 종목 편집은 전용 floating action과 fullscreen bottom sheet로 다룬다.
- 검색창 축소/확대는 화면별로 별도 CSS를 만들지 않고 `SearchChrome` 상태와 modifier로 표현한다.

## Page Patterns

패턴은 primitive를 조합한 화면 단위 규칙이다. 시작 위치는 `src/components/layout/*` 또는 기존 화면 컴포넌트 내부의 작은 adapter다.

### Home Search Pattern

홈은 검색을 가장 먼저 보여준다. 검색창은 서비스의 시작점이므로 여백이 충분해야 하지만, landing page처럼 과장된 hero는 만들지 않는다.

주요 규칙:

- 모바일은 검색창이 화면 상단에서 명확히 터치 가능해야 한다.
- 데스크톱은 GNB와 검색의 높이, 좌우 gutter를 맞춘다.
- 검색 결과 행은 종목명, 티커, 시장을 같은 순서로 표시한다.

### Stock Detail Pattern

상세는 판단 요약, 가격, 핵심 숫자를 한 번에 읽게 한다.

주요 규칙:

- 좌측 목차는 데스크톱에서 페이지 내부 보조 내비게이션으로 유지한다.
- 페이지 이동 메뉴는 목차 내부가 아니라 공통 GNB 또는 모바일 하단 메뉴로 제공한다.
- 가격과 등락률은 같은 row 안에서 안정적으로 정렬한다.
- 데이터 준비 상태는 큰 경고보다 조용한 skeleton 또는 muted 상태로 표시한다.

### Compare Pattern

비교는 모바일에서 가장 복잡하므로 우선 적용 대상이다.

주요 규칙:

- 상단에 선택 종목 목록을 길게 노출하지 않는다.
- `종목 편집` floating action으로 fullscreen bottom sheet를 열고, 그 안에서 검색/선택/삭제를 처리한다.
- 스크롤이 최상단이면 label형 버튼, 내려간 상태면 원형 `+` 버튼으로 전환한다.
- 축소/확대 전환은 opacity, scale, translate를 써서 자연스럽게 보이게 한다.
- 키보드가 올라왔을 때 검색/선택 영역과 모바일 메뉴가 겹치지 않아야 한다.

### Market Cap Dashboard Pattern

시가총액 대시보드는 데이터 테이블 중심 화면이다.

주요 규칙:

- 전체/국내/해외 탭과 섹터 필터는 table control bar에 둔다.
- 필터는 작지만 터치 가능한 크기를 지킨다.
- 등락률과 가격은 tabular number로 정렬한다.
- 모바일은 핵심 열을 우선하고 덜 중요한 정보는 보조 줄로 내려도 된다.

### Technical Analysis Pattern

기술적 분석은 차트와 규칙 해석이 주인공이다.

주요 규칙:

- 차트 조작 버튼은 icon 중심으로 통일한다.
- 분석 신호는 `JudgmentChip`과 짧은 설명을 함께 사용한다.
- 페이지 이동은 공통 navigation pattern을 따른다.

## Implementation Boundaries

이번 리워크에서 바꾸는 것은 UI 시스템과 화면 조합이다.

바꾸지 않는 것:

- 데이터 provider 선택
- KIS/yfinance 호출 정책
- Supabase schema
- route path
- market-cap refresh 정책
- scoring algorithm

데이터 호출은 현재 동작을 유지한다. UI 컴포넌트가 API 응답 shape를 바꾸도록 요구하면 안 된다.

## Proposed File Shape

새로 만들거나 정리할 파일:

- `src/styles/design-tokens.css`
- `src/styles/primitives.css`
- `src/components/ui/Button.tsx`
- `src/components/ui/IconButton.tsx`
- `src/components/ui/FloatingActionButton.tsx`
- `src/components/ui/Panel.tsx`
- `src/components/ui/Sheet.tsx`
- `src/components/ui/DataTable.tsx`
- `src/components/ui/MetricTile.tsx`
- `src/components/ui/PriceChange.tsx`
- `src/components/ui/JudgmentChip.tsx`
- `src/components/layout/AppShellNav.tsx`
- `src/components/layout/MobileNavLauncher.tsx`
- `src/components/layout/SearchChrome.tsx`

기존 컴포넌트는 한 번에 갈아엎지 않는다. `StockCompare`, `StockDashboard`, `MarketCapDashboard`, `TechnicalAnalysisPage`, `SearchChromeWithNavigation`, `AppNavigationMenu`는 새 primitive를 받아들이는 방향으로 점진 변경한다.

## Migration Order

### Phase 1: Foundation

- token 파일을 추가하고 `globals.css`에서 import한다.
- 기존 색상, 간격, radius, shadow 중 반복 사용되는 값을 role token으로 alias한다.
- 아직 화면의 DOM 구조는 바꾸지 않는다.

### Phase 2: Primitives

- 버튼, 아이콘 버튼, FAB, 칩, 패널, 시트, 가격 변화 표시부터 component화한다.
- 기존 class를 새 primitive 내부로 옮겨 화면별 중복 CSS를 줄인다.
- snapshot처럼 시각 회귀 가능성이 큰 부분은 변경 범위를 작게 유지한다.

### Phase 3: Compare Mobile

- 종목 편집 bottom sheet와 floating action을 design system primitive로 다시 연결한다.
- 선택 종목 표시, 검색 결과, 키보드 상황, 하단 메뉴 위치를 하나의 pattern으로 정리한다.
- 이전에 보고된 모바일 겹침/중앙 배치/애니메이션 부재 문제를 여기서 최종 정리한다.

### Phase 4: Detail And Technical

- 상세 페이지 목차, 가격 헤더, 핵심 숫자 카드, 기술적 분석 컨트롤을 primitive로 교체한다.
- 데스크톱 GNB와 페이지 보조 목차의 역할을 분리한다.

### Phase 5: Market Cap And Home

- 시가총액 table controls, tabs, sector filter, rank row를 data primitive로 교체한다.
- 홈 검색과 검색 결과를 같은 `SearchChrome` 계열로 정리한다.

## Testing And Verification

자동 검증:

- `npm test`
- `npm run typecheck`
- `npm run build`
- CSS guardrail 테스트에 token import, mobile floating action, z-index/safe-area 관련 회귀를 추가한다.

시각 검증:

- Playwright로 최소 모바일 390px, 모바일 키보드 유사 상황, 데스크톱 1440px 스크린샷을 남긴다.
- 비교 페이지에서 스크롤 최상단, 스크롤 이동 후, bottom sheet open, 검색 입력 상태를 확인한다.
- 상세 페이지에서 데스크톱 목차, GNB, 검색창 높이, 가격 header alignment를 확인한다.
- 시가총액 페이지에서 탭/필터/표 행이 overflow 없이 보이는지 확인한다.

수동 검증:

- 검색창 터치, 종목 추가/편집, 페이지 이동, 팝오버 외부 터치 닫힘을 실제 브라우저에서 확인한다.
- 모바일 하단 액션이 iOS safe-area와 겹치지 않는지 확인한다.

## Risks

- `globals.css`가 큰 파일이라 foundation 추출 중 cascade가 바뀔 수 있다. 작은 alias부터 시작하고 화면별 class 제거는 primitive 전환 시점에만 한다.
- 비교 화면은 키보드와 viewport 변화가 많아 브라우저별 차이가 생길 수 있다. 스크롤 기준과 visual viewport 기준을 분리해 검증한다.
- 디자인 시스템 이름만 만들고 화면별 예외가 계속 생기면 효과가 없다. 새 예외를 만들 때는 token 또는 primitive로 흡수 가능한지 먼저 본다.
- 한 번에 모든 화면을 리워크하면 기능 회귀를 찾기 어렵다. Phase 단위로 빌드와 시각 확인을 반복한다.

## Success Criteria

- 주요 버튼, 검색창, FAB, bottom sheet, table row의 높이와 간격이 화면마다 일관된다.
- 모바일 비교 화면에서 검색, 종목 편집, 하단 메뉴, 키보드가 서로 겹치지 않는다.
- 데스크톱 상세/기술/비교/시가총액 페이지의 페이지 이동 방식이 같은 규칙을 따른다.
- 시가총액과 비교 표의 숫자가 깔끔하게 정렬되고 금융 서비스처럼 읽힌다.
- 새 기능을 추가할 때 화면별 임시 CSS보다 token, primitive, pattern을 먼저 사용할 수 있다.
- 큰 정보 구조와 데이터 동작은 유지되면서도 서비스 전체가 하나의 제품처럼 보인다.

