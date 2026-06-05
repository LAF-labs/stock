# SIA Stock Score Landing & Dashboard Redesign

## 1. Purpose

이 문서는 현재 `Stock Score Reader`를 `SIA Stock Score` 성격의 검색 중심 주식 분석 서비스로 리디자인하기 위한 디자인 기획서다.

목표는 두 가지다.

1. `/` 첫 화면을 신규 랜딩 페이지로 전환한다. 상단 GNB 아래의 첫 번째 주요 작업 영역에 종목 검색창을 두고, 그 아래부터 서비스 소개와 사용 흐름을 짧고 명확하게 보여준다.
2. 기존 종목 상세/비교 페이지의 큰 레이아웃 틀은 유지하되, 표면/타이포/정보 구조/데이터 시각화를 크게 업그레이드한다.

참고한 외부 프롬프트는 스타일 레퍼런스로만 사용한다. 그대로 복제하지 않고, 이 서비스의 실제 구조인 검색, 좌측 플로팅 인덱스, 섹션 단위 그리드, 점수/차트/뉴스/재무 데이터에 맞춘 별도 디자인 시스템으로 재기획한다.

## 2. Fixed Constraints

- 검색바는 항상 첫 번째 주요 작업 영역에 둔다. 랜딩 상단 GNB가 있을 수 있지만, 검색이 화면의 주 인터랙션이어야 한다.
- PC 기준 좌측 플로팅 인덱스 이동 창은 유지한다.
- 상세 페이지의 섹션 순서는 크게 바꾸지 않는다: 요약, 가격 흐름, 점수 이유, 핵심 숫자, 뉴스, 회사 정보, 가격 부담, 재무 요약.
- 섹션 단위 그리드 구조를 유지한다.
- 모바일은 단일 컬럼, PC는 좌측 인덱스 + 우측 본문 구조를 유지한다.
- 구현 범위는 Next/React/CSS 중심으로 유지한다. 새 UI 라이브러리를 도입하지 않는다.
- 반투명 글래스모피즘을 사용하되, 글자 대비와 숫자 판독성을 우선한다.
- 라이트/다크 모드는 기본적으로 OS 시스템 설정을 따른다.
- 랜딩 페이지 상단 GNB 또는 command bar 영역에 테마 전환 토글을 둔다.

## 3. Source Map

현재 코드 기준 주요 화면과 파일:

- `/`: `src/app/page.tsx`, `src/components/StockDashboard.tsx`
- `/compare`: `src/app/compare/page.tsx`, `src/components/StockCompare.tsx`
- 검색 컴포넌트: `src/components/SymbolAutocomplete.tsx`
- 전역 스타일: `src/app/globals.css`

현재 서비스 기능:

- 국내/미국 종목명 및 티커 자동완성
- 종목 상세 점수, 현재가, 환산 가격, 차트, 점수 구성 요소, 뉴스, 프로필, 밸류에이션, 재무 요약
- 최대 5개 종목 비교
- 품질 점수와 기회 점수 분리
- 캐시/새로고침/데이터 준비 상태 제공

## 4. Design Thesis

SIA Stock Score는 마케팅 사이트보다 "개인 투자자가 종목을 검색한 뒤 빠르게 판단 근거를 읽는 분석 관제 화면"에 가깝다.

따라서 디자인 방향은 다음처럼 잡는다.

- `Search-first`: 첫 화면에서 바로 종목을 찾게 한다.
- `Data is the hero`: 제품 스크린샷이나 장식 이미지보다 실제 점수, 차트, 지표 카드가 시각의 중심이다.
- `Glass terminal`: 짙은 배경 위에 반투명 유리 패널을 쌓아 정보 밀도를 정리한다.
- `Signal color only`: 색은 상승/하락/기회/주의/활성 상태처럼 의미가 있을 때만 사용한다.
- `Readable density`: 많은 정보를 보여주되, 카드 제목, 핵심값, 보조 설명의 위계를 분명히 한다.

## 5. Visual Direction

키워드:

- Korean fintech dashboard
- frosted glass market terminal
- quiet premium analytics
- dark ink canvas with luminous data signals
- dense but breathable stock research cockpit

레퍼런스에서 가져올 점:

- `Idle Finance`: 금융 터미널 같은 밀도, 단일 시그널 컬러, 카드 경계선 중심 구조
- `Fey`: 어두운 캔버스, 제품 UI 자체가 메인 비주얼, 색을 의미로만 쓰는 절제
- `Visitors`: 글래스/헤어라인/제품 프리뷰 중심 랜딩, 반듯한 섹션 리듬

그대로 가져오지 않을 점:

- 과도한 네온 글로우
- 극단적인 자간 축소
- 장식용 3D 오브젝트
- 큰 마케팅 히어로
- 정보보다 분위기를 앞세우는 배경 이미지

## 6. Design Tokens

### Theme Strategy

기본 테마는 `prefers-color-scheme`를 따른다. 사용자가 랜딩 상단 GNB의 토글을 누르면 명시 선택값을 저장해 시스템 기본값보다 우선한다.

권장 상태:

- `system`: OS 설정을 따름
- `light`: 라이트 모드 고정
- `dark`: 다크 모드 고정

토글 UI는 복잡한 설정 메뉴가 아니라 작은 segmented control 또는 icon toggle로 만든다. 랜딩에서는 GNB 우측에 배치하고, 상세/비교 페이지에서는 검색 command bar 우측 보조 액션으로 이어갈 수 있다.

### Colors

아래는 다크 테마 기본 토큰이다.

```css
:root {
  --bg-ink: #08111f;
  --bg-ink-2: #0d1728;
  --bg-vignette: #111f35;

  --glass: rgba(255, 255, 255, 0.078);
  --glass-strong: rgba(255, 255, 255, 0.118);
  --glass-soft: rgba(255, 255, 255, 0.052);
  --glass-hover: rgba(255, 255, 255, 0.148);

  --line-glass: rgba(255, 255, 255, 0.14);
  --line-glass-strong: rgba(255, 255, 255, 0.24);

  --text-primary: #f7fbff;
  --text-secondary: #b8c4d6;
  --text-muted: #7f8da3;

  --accent: #74d7ff;
  --accent-strong: #3eb8ff;
  --accent-soft: rgba(116, 215, 255, 0.14);

  --up: #ff6478;
  --up-soft: rgba(255, 100, 120, 0.14);
  --down: #5fa8ff;
  --down-soft: rgba(95, 168, 255, 0.14);
  --opportunity: #59e6a6;
  --opportunity-soft: rgba(89, 230, 166, 0.13);
  --warning: #ffd166;
  --warning-soft: rgba(255, 209, 102, 0.14);
}
```

라이트 테마는 같은 의미 토큰을 유지하되 밝은 glass surface로 매핑한다.

```css
:root[data-theme="light"] {
  --bg-ink: #eef3f8;
  --bg-ink-2: #f7faff;
  --bg-vignette: #dbeafe;

  --glass: rgba(255, 255, 255, 0.72);
  --glass-strong: rgba(255, 255, 255, 0.86);
  --glass-soft: rgba(255, 255, 255, 0.58);
  --glass-hover: rgba(255, 255, 255, 0.94);

  --line-glass: rgba(40, 54, 78, 0.14);
  --line-glass-strong: rgba(40, 54, 78, 0.22);

  --text-primary: #0f172a;
  --text-secondary: #475569;
  --text-muted: #7b8798;

  --accent: #2563eb;
  --accent-strong: #1d4ed8;
  --accent-soft: rgba(37, 99, 235, 0.11);

  --up: #e5485f;
  --up-soft: rgba(229, 72, 95, 0.11);
  --down: #2563eb;
  --down-soft: rgba(37, 99, 235, 0.11);
  --opportunity: #0f9f6e;
  --opportunity-soft: rgba(15, 159, 110, 0.11);
  --warning: #b7791f;
  --warning-soft: rgba(183, 121, 31, 0.12);
}
```

한국 주식 UI 관습에 맞춰 상승은 붉은 계열, 하락은 푸른 계열을 유지한다. 그 외 강조색은 `accent`와 `opportunity`를 중심으로 제한한다.

### Typography

- 기본 폰트: 현재처럼 `Pretendard`, `Apple SD Gothic Neo`, `Noto Sans KR`, system sans
- 숫자: `font-variant-numeric: tabular-nums`
- 자간: `letter-spacing: 0` 유지. 지나친 음수 자간은 한글 가독성을 해친다.
- 히어로 검색 헤드라인: 34-52px, 800
- 종목 티커: 48-72px, 800
- 섹션 제목: 22-28px, 760
- 카드 핵심값: 24-48px, 780
- 보조 설명: 13-16px, 500-650

### Shape & Surface

- 전체 카드 반경: 8px
- 작은 버튼/칩/입력: 8px
- 원형/상태 pill: 999px
- PC 좌측 인덱스: 8px
- 차트/테이블 큰 표면: 8px

글래스 표면 기본값:

```css
.glass-panel {
  background: linear-gradient(145deg, rgba(255,255,255,0.13), rgba(255,255,255,0.055));
  border: 1px solid rgba(255,255,255,0.14);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(22px) saturate(135%);
}
```

단, 본문 텍스트가 많은 카드에는 더 어두운 반투명 표면을 쓰고 `text-secondary` 이하의 대비를 약하게 만들지 않는다.

## 7. Page Background

배경은 이미지 대신 CSS 기반 깊이감으로 만든다.

다크 모드:

- 기본: `#08111f`에서 `#0d1728`로 이어지는 짙은 잉크 그라데이션
- 상단 검색 영역 뒤: 아주 은은한 cyan/green/slate radial wash를 섞어 단일 blue 계열로 보이지 않게 한다.
- 하단: 미세한 격자 또는 헤어라인 패턴을 3-5% 투명도로만 사용
- 장식용 orb, bokeh blob, 과한 gradient blob은 사용하지 않는다.

라이트 모드:

- 기본: `#eef3f8`에서 `#f7faff`로 이어지는 차가운 금융 앱 배경
- 상단 검색 영역 뒤: 매우 옅은 blue/green wash를 섞어 단일 색조가 되지 않게 한다.
- 카드 표면: white glass를 사용하되 테두리와 그림자로 배경에서 분리
- 긴 본문 텍스트는 white glass 위에 `#0f172a` 계열로 표시

목표는 다크에서는 "분석 터미널의 깊이", 라이트에서는 "깨끗한 리서치 데스크"다.

## 8. New Landing Page

### Route Behavior

`/`는 검색 중심 랜딩 상태로 시작한다. 사용자가 종목을 선택하면 현재처럼 `/?ticker=US:KO` 형태의 상세 대시보드로 전환한다.

현재 기본값인 `US:KO` 자동 상세 진입은 랜딩 경험을 방해한다. 기본 종목은 상세 화면 대신 랜딩 아래의 "바로 보기 예시" 칩이나 프리뷰 카드로 노출한다.

### First View

구성 순서:

1. 상단 GNB/command bar: 브랜드명, 최소 링크, 테마 전환 토글
2. 최상단 주 검색바
3. 짧은 제품명/카테고리 헤드라인
4. 최근 조회 종목 칩
5. 실제 데이터 프리뷰 미니 카드 3개

GNB는 작고 조용해야 한다. 검색바가 화면의 첫 번째 주요 분석 인터랙션이며, 히어로 문구보다 위에 있어야 한다.

GNB 권장 구성:

- 좌측: `SIA Stock Score` 또는 확정된 서비스명
- 중앙 또는 좌측 보조: `분석`, `비교`, `데이터` 같은 최소 링크
- 우측: 라이트/다크 전환 토글
- 모바일: 브랜드명 + 토글만 남기고 링크는 숨기거나 축약

검색바 UX:

- 큰 입력창: "종목명이나 티커를 검색하세요"
- 버튼: "분석"
- 자동완성 드롭다운은 글래스 패널로 띄운다.
- 검색창 하단의 고정 추천 종목 리스트는 삭제한다.
- 검색창 하단에는 브라우저 localStorage 기반 최근 조회 종목을 chip rail로 표시한다.
- 최근 조회 칩은 종목명 우선, 티커 보조 표기다. 예: `코카콜라 KO`, `삼성전자 005930`
- 각 최근 조회 칩 오른쪽에는 작은 `x` 삭제 버튼을 둔다.
- `x`를 누르면 해당 종목만 최근 조회 목록에서 제거한다.
- 최근 조회가 없을 때는 칩 rail 자체를 숨기거나, "최근 조회 종목 없음" 같은 텍스트 대신 조용한 empty skeleton/empty state를 사용한다.
- 검색창은 sticky header로 유지하되, 랜딩 최상단에서는 카드처럼 떠 있는 느낌을 준다.

헤드라인 원칙:

- H1은 `SIA Stock Score` 또는 `주식 점수 리더`처럼 제품명/카테고리를 직접 보여준다.
- 기능 설명은 긴 문단이 아니라 검색 결과, 예시 종목, 실제 점수 프리뷰의 레이블로 흡수한다.
- 첫 화면은 마케팅 히어로가 아니라 바로 검색하고 눌러보는 작업 화면이어야 한다.

- `종목을 검색하면 점수, 차트, 재무 근거를 한 화면에 정리합니다.`

서브카피:

- `품질 점수와 기회 점수를 나눠 보고, 가격 흐름과 핵심 지표, 뉴스까지 빠르게 확인하세요.`

### Data Preview Sections

검색 아래부터는 기능 설명문이 아니라 실제 화면을 압축한 데이터 프리뷰 중심으로 간다.

1. `두 개의 점수`
   - 실제 예시 종목의 품질 점수와 기회 점수를 도넛/숫자로 표시한다.
   - 텍스트는 점수명, 숫자, 한 줄 verdict 정도만 둔다.

2. `한 화면 분석`
   - 현재가, 원화 환산, 1년 차트, 핵심 숫자, 판단문을 실제 상세 카드의 축소 프리뷰로 보여준다.

3. `비교`
   - 품질 x 기회 점수 맵, 5종목 컬럼 보드, 미니 히트맵 프리뷰를 데이터 샘플로 보여준다.

4. `데이터 상태`
   - 캐시, 새로고침, 데이터 준비 중, 뉴스/재무 fallback 상태는 작은 status pill 묶음으로 표시한다.

랜딩은 길게 팔지 않는다. 첫 화면 이후 3-4개 섹션 안에서 서비스 정체성을 끝낸다.

## 9. Existing Detail Page Redesign

### Overall Layout

기존 구조를 유지한다.

- 모바일: 검색바 + 단일 컬럼 섹션
- PC: 좌측 플로팅 인덱스 + 우측 본문
- 본문 최대 폭은 현재 860px보다 약간 넓혀도 된다. 권장: 920-1040px
- 섹션 간 gap은 16px에서 20-24px로 확장
- 카드 내부 padding은 모바일 18px, PC 28-34px

### Top Search

현재 검색바를 `market command bar`처럼 만든다.

- 반투명 글래스 배경
- 입력 필드는 카드 안쪽의 더 어두운 glass well
- 버튼은 `accent` filled
- 검색 하단 칩은 고정 추천 종목이 아니라 localStorage 기반 최근 조회 종목 pill이다.
- 최근 조회 종목 pill은 `종목명 + 작은 티커 + 삭제 x` 구조를 쓴다.
- 자동완성 결과는 거래소/국가/티커/회사명을 두 줄로 정렬

검색바는 랜딩과 상세에서 같은 컴포넌트 스타일을 공유한다.

자동완성 결과 UX:

- 종목명을 가장 크게 표시한다.
- 티커, 거래소, 국가, 자산 유형은 보조 meta row로 표시한다.
- ETF/ETN/펀드성 상품은 `ETF` 같은 asset type badge를 붙여 일반 주식과 구분한다.
- 동일하거나 비슷한 종목명이 여러 개일 때 시장/거래소 차이가 즉시 보이게 한다.
- 키보드 선택 active state는 글래스 fill + accent border로 명확히 보여준다.

### Floating Index

좌측 인덱스는 더 고급스럽게 만든다.

- 글래스 패널 + 얇은 헤어라인
- 상단 라벨: `SECTIONS`
- 활성 섹션은 왼쪽 2px accent rail + soft fill
- hover는 배경만 바꾸고 큰 움직임은 피한다.
- 항목은 32-36px 높이로 유지해 클릭 안정성을 확보한다.
- 상세 페이지의 플로팅 인덱스 하단에는 고정 `비교하기` 버튼을 둔다.
- `비교하기` 버튼은 현재 상세 종목을 비교 페이지에 포함해 이동하거나 비교 목록에 추가하는 primary action이다.
- 버튼은 인덱스 항목과 시각적으로 분리되도록 상단 구분선, accent fill 또는 accent outline을 사용한다.

### Summary Section

`StockHeader`는 종목 상세의 핵심이다. 현재 정보를 유지하되 시각 위계를 재정렬한다.

권장 구조:

- 상단: 거래소/최근 가격일 + 상승/하락 pill
- 대형 종목명 + 작은 티커/거래소 보조 표기
- 현재가/원화 환산 + 새로고침 아이콘 버튼
- 품질 점수와 기회 점수를 좌우 또는 2열 카드로 분리하고, 각 카드 안에 도넛 차트와 숫자를 함께 표시
- 강점/먼저 볼 것/시가총액은 작은 insight tile
- 판단문은 별도 `verdict panel`로 확장
- 비교 화면 진입은 하단의 얇은 action row로 처리

종목명 표시 원칙:

- 기본은 종목명 우선이다. 예: `코카콜라`가 메인, `KO · NYSE`가 보조
- 국내 종목은 한글 종목명을 메인으로 쓴다. 예: `삼성전자`, `005930 · KOSPI`
- 종목명이 없거나 ETF/펀드/소형 컨테이너에서는 티커를 메인으로 써도 된다.
- 비교 화면의 좁은 셀, 차트 legend, heatmap column header처럼 공간이 좁은 경우에는 티커를 우선한다.

점수 카드는 숫자만 크게 두지 않는다. 도넛 차트 중앙에 점수를 넣고, 카드 하단에는 "왜 이 점수인지"를 한 줄로 붙인다.

### Mini Decision Bar

상세 페이지에서 아래로 스크롤하면 작은 sticky decision bar가 나타난다.

목적은 사용자가 긴 상세 화면을 읽는 동안 현재 종목과 핵심 판단을 잃지 않게 하는 것이다.

구성:

- 종목명 + 작은 티커
- 현재가/등락 pill
- 품질 점수 compact donut 또는 숫자
- 기회 점수 compact donut 또는 숫자
- `비교 추가` action

표현 규칙:

- 처음 요약 카드가 화면에 보일 때는 과하게 중복되지 않도록 숨기거나 투명도를 낮춘다.
- 스크롤 후에만 조용히 나타난다.
- 모바일에서는 상단 sticky가 아니라 하단 action bar와 중복되지 않게 한다.

### Score Contribution Mini Bar

도넛 점수 아래에는 작은 점수 기여도 바를 둘 수 있다.

- 크기는 작게 유지한다.
- 점수 카드의 핵심 시각인 도넛보다 강해지면 안 된다.
- 예: `수익성 +18 · 성장성 +12 · 밸류에이션 -9 · 모멘텀 +6`
- positive contribution은 accent/opportunity, negative contribution은 warning/down으로 표시한다.
- 표시할 수 있는 데이터가 없으면 숨긴다.

### Data Status Layer

데이터 상태는 소극적으로, 그러나 숨기지 않는다.

- 캐시/수집/일부 누락/새로고침 제한 상태는 작은 status pill 또는 섹션 하단 meta로 표시한다.
- 본문보다 강한 색이나 큰 경고 박스를 사용하지 않는다.
- 예: `30분 캐시`, `현재가 최신`, `일부 재무 지표 없음`, `수집 중`
- 사용자가 판단할 필요 없는 내부 source/debug 값은 계속 숨긴다.

### Chart Section

가격 흐름 섹션은 "차트 + 패턴 해석"으로 유지하되 시각적 품질을 높인다.

- 차트 배경도 glass surface 안의 deep chart well로 변경
- 라인 차트 accent, 캔들 차트는 한국 관습 색상 유지
- 차트 모드 탭은 segmented control
- 패턴 칩 3개는 같은 높이의 3열 카드
- tooltip은 어두운 glass tooltip

차트가 데이터의 중심이므로 장식보다 축, hover, 여백, 대비가 우선이다.

### Factor Sections

`품질 점수 이유`와 `기회 점수 이유`는 가장 구조화가 필요한 영역이다.

각 factor article:

- 좌측: 항목명 + 짧은 설명
- 우측: 점수 pill
- 중간: progress bar
- 하단: metric mini grid

progress bar 색상:

- 80 이상: opportunity
- 60-79: accent
- 45-59: warning
- 45 미만: down 또는 muted

metric mini grid는 glass chip 형태로 두되, 숫자는 반드시 `text-primary` 또는 충분한 대비를 가진 색을 쓴다.

### Lists & Accordions

핵심 숫자, 회사 정보, 가격 부담, 재무 요약은 "테이블처럼 읽히는 카드"로 바꾼다.

- 모바일: accordion 유지
- PC: `desktopOpen` 항목은 펼친 상태 유지
- label/value 2열 구조 유지
- 긴 설명 note는 value 아래 작은 텍스트로 유지
- 중첩 record는 들여쓰기보다 inner glass well로 분리

단순 행 나열이 지루해 보이지 않도록:

- 핵심 숫자는 2-3열 metric tile로 우선 노출
- 상세 row는 아래 table section으로 배치
- 밸류에이션은 PER/PBR 등 가격 부담 지표를 "낮음/보통/높음" 상태 pill과 함께 표시할 수 있다.
- `yfinance`, `source`, `market_scope`, `signal_source`, `speculative_expensive_sales`, `적용 상한`처럼 사용자가 판단할 필요 없는 내부용 키/출처/계산 상한 문구는 UI에서 숨긴다.
- 가격 부담 섹션은 지표명, 값, 상태, 쉬운 설명만 남긴다. 출처 문자열은 상세한 디버그/운영 화면이 아닌 이상 노출하지 않는다.

### News

뉴스는 현재처럼 리스트가 적합하다.

- 각 뉴스 item을 작은 glass row로 만든다.
- publisher와 시간은 상단 meta row
- 제목은 2줄 clamp
- hover 시 border/accent만 변경
- 외부 링크 아이콘은 텍스트 대신 작은 symbol로 처리한다.

### Pending & Skeleton States

데이터 준비 중 상태는 투박한 텍스트 문단으로 노출하지 않는다.

예를 들어 `US:PEP 데이터를 준비하고 있어요. 수집이 끝나면 비교 점수가 표시됩니다. 보통 60초 안에 다시 확인할 수 있어요.` 같은 문장은 그대로 카드 안에 보여주지 않는다.

대신 다음처럼 처리한다.

- 해당 종목의 카드/column 자리는 유지한다.
- 종목명 또는 티커 header는 표시한다.
- 점수 도넛, 핵심 지표, factor row, 차트 영역은 skeleton shimmer로 표시한다.
- 준비 상태 메시지는 카드 하단의 작은 status pill 또는 tooltip 수준으로 축소한다.
- pending 종목이 있어도 비교 보드 전체 레이아웃이 흔들리지 않아야 한다.
- loading, pending, unavailable, refresh cooldown 모두 같은 skeleton/status 시스템을 공유한다.

## 10. Compare Page Redesign

비교 페이지는 "최대 5개 종목 카드 모음"이 아니라 "최대 5개 종목 데이터 보드"가 되어야 한다. 사용자는 종목별 성격, 우열, 리스크, 가격 흐름을 같은 축에서 즉시 비교할 수 있어야 한다.

기존 상단 검색/선택 chip 구조는 유지하되, 상세 페이지와 동일하게 PC 좌측 플로팅 인덱스를 추가한다.

상단:

- 뒤로가기 + 추가 검색바를 같은 glass toolbar에 유지
- 선택된 종목 chip은 horizontal rail
- 기준 종목 chip은 accent filled
- 종목 chip은 가능한 경우 종목명을 우선 표시하고, 티커는 작게 붙인다.
- 공간이 좁은 경우에는 티커만 표시한다.
- 추천 비교 종목 버튼 묶음은 기본 노출하지 않는다. 필요하면 최근 조회 또는 현재 종목의 same-industry 후보를 별도 접힌 영역으로 둔다.

좌측 플로팅 인덱스:

- 상세 페이지와 같은 glass floating index를 비교 페이지에도 적용한다.
- 권장 섹션: `요약`, `점수 맵`, `종목 보드`, `가격 흐름`, `팩터 히트맵`, `지표 매트릭스`, `리스크/메모`
- active section, hover, scroll behavior는 상세 페이지와 동일하게 맞춘다.

### Compare Summary: Decision Strip

기존 `먼저 볼 차이` 섹션은 개별 카드 나열이 아니라 한 줄로 훑는 decision strip으로 바꾼다.

Decision strip 항목:

- 품질 1위
- 기회 1위
- 최근 흐름 1위
- 가격 부담이 낮은 종목
- 수익성이 좋은 종목
- 먼저 확인할 리스크

각 항목은 작은 카드가 아니라 lane/pill 형태의 compact data module로 표시한다.

각 module 구조:

- label
- winner 종목명 또는 티커
- 핵심값
- 1줄 이유
- 미니 bar 또는 rank marker

목표는 긴 문장 설명을 줄이고, "어디를 먼저 볼지"를 시각적으로 안내하는 것이다.

Decision strip interaction:

- 각 module은 관련 상세 섹션으로 이동하거나 하이라이트할 수 있어야 한다.
- `수익성 좋은 종목`을 누르면 factor heatmap의 `수익성` row가 강조된다.
- `가격 부담 낮음`을 누르면 metric matrix의 valuation group 또는 factor heatmap의 `밸류에이션` row가 강조된다.
- `먼저 확인할 리스크`를 누르면 해당 risk/factor cell이 강조된다.
- 이동/강조는 과한 애니메이션보다 짧은 outline pulse 또는 scroll highlight로 처리한다.

### Quality x Opportunity Map

비교 화면의 대표 시각화다.

- X축: 품질 점수
- Y축: 기회 점수
- 각 종목: ticker/name dot
- dot 내부 또는 옆에는 짧은 ticker 표시
- dot 색: 최근 수익률 또는 상승/하락 상태
- dot 크기: 시가총액 또는 거래대금이 있으면 반영하고, 없으면 균일하게 둔다.
- 사분면 라벨:
  - 우상단: 우선 검토
  - 우하단: 좋은 회사, 가격 확인
  - 좌상단: 기회는 있으나 리스크 확인
  - 좌하단: 보류

이 맵은 사용자가 "이 종목이 어떤 성격인지"를 가장 빠르게 이해하는 핵심 데이터 콘텐츠다.

### Five-Stock Column Board

기존 종목 카드 grid는 5개 종목을 같은 행 기준으로 비교하는 column board로 바꾼다.

PC 구조:

- 열: 최대 5개 종목
- 행:
  - 종목명/티커/등락 pill
  - 품질 점수 도넛
  - 기회 점수 도넛
  - 강점
  - 먼저 볼 리스크
  - 시가총액
  - 1개월/3개월/6개월/52주 수익률

각 종목 column은 같은 높이와 같은 행 순서를 유지한다. 비교 화면의 아름다움은 "같은 위치에 같은 정보가 정렬되는 것"에서 나온다.

모바일 구조:

- 5개 column을 그대로 찌그러뜨리지 않는다.
- 종목별 카드는 세로 스택으로 두되, 각 카드 내부 row 순서는 PC와 동일하게 유지한다.
- 또는 horizontal scroll board를 허용하되, 첫 열/row label은 읽을 수 있어야 한다.

### Score Display

점수 표시는 카드 안에 도넛 차트와 숫자를 함께 표시한다.

- 도넛 중앙: `84.2`
- 도넛 하단 또는 옆: `품질 점수`
- 카드 하단: `수익성 강함 · 밸류에이션 확인`
- 품질 점수와 기회 점수는 같은 크기의 twin donut card로 배치한다.
- 도넛 stroke는 점수에 따라 색상이 달라지되, 배경 stroke는 항상 낮은 대비로 유지한다.
- 80 이상: opportunity
- 60-79: accent
- 45-59: warning
- 45 미만: down 또는 muted

### Factor Heatmap Matrix

수익성, 성장성, 재무건전성, 모멘텀, 밸류에이션, 기회 구성 요소는 progress bar 나열이 아니라 heatmap matrix로 보여준다.

- 행: factor
- 열: 종목
- 셀: 점수 숫자 + 색 농도
- best cell: 작은 crown/marker 또는 brighter border
- lowest cell: warning dot
- hover/focus: 셀의 근거 metric tooltip

이 섹션은 "어떤 종목이 무엇 때문에 좋은지"를 가장 예쁘고 빠르게 보여주는 데이터 콘텐츠다.

### Price Trend

가격 흐름은 두 가지 모드를 제공한다.

- `Overlay`: 1년 전을 100으로 맞춘 normalized line chart
- `Small multiples`: 종목별 동일 축 미니 차트

기본은 overlay지만, 4-5개 종목에서는 small multiples 전환이 필요하다. legend에는 가능한 경우 종목명을 쓰되 공간이 좁으면 티커를 쓴다.

### Metric Matrix

지표 매트릭스는 표처럼 보이되, 각 셀에 작은 bar/heat를 넣어 데이터 그래픽처럼 만든다.

함께 보면 좋은 지표:

- 가격/흐름: 전일 대비, 1개월, 3개월, 6개월, 52주 수익률, 52주 고점 거리
- 변동성/거래: RSI14, ATR14 비중, 20일 평균 거래량, 60일 평균 거래량, 베타
- 사업 체력: 순이익률, 영업이익률, ROE, 매출 성장률, 이익 성장률, 총매출
- 현금/재무: 영업현금흐름, 부채/자본, 유동비율, 당좌비율
- 가격 부담: PER, Forward PER, PBR, EV/Revenue, Price/Sales
- 기대/커버리지: 목표가, 평균 목표가 대비 여력, 애널리스트 수, 투자의견 평균
- 점수 메타: 품질 점수, 기회 점수, 기회 신뢰도

표현 규칙:

- 높은 값이 좋은 지표와 낮은 값이 좋은 지표를 구분한다.
- best cell은 `accent-soft` 또는 `opportunity-soft`
- 음수 수익률은 down color
- 주의 값은 warning 또는 down marker
- 모든 셀에는 숫자를 남긴다. 색만으로 판단하게 만들지 않는다.
- 내부용 source/key/debug 값은 표시하지 않는다.

## 11. Component Specs

### Glass Card

- `border-radius: 16px`
- `background: linear-gradient(145deg, rgba(255,255,255,0.12), rgba(255,255,255,0.055))`
- `border: 1px solid rgba(255,255,255,0.14)`
- `box-shadow: 0 20px 56px rgba(0,0,0,0.26)`
- `backdrop-filter: blur(22px) saturate(135%)`

### Metric Tile

- label 12-13px, muted
- value 20-28px, primary
- optional note 12-13px, secondary
- height stable across grid rows

### Donut Score Card

- 카드 안에 도넛 차트와 숫자를 함께 표시한다.
- 중앙 숫자는 1자리 소수까지 표시한다. 예: `84.2`
- 중앙 숫자 아래 또는 옆에 `품질`, `기회` 같은 짧은 label을 둔다.
- 도넛 stroke는 점수 구간에 따라 의미색을 사용한다.
- 도넛 배경 stroke는 낮은 대비의 glass line으로 둔다.
- 카드 하단에는 한 줄 해석을 둔다.
- 상세 화면에서는 품질/기회 twin card로, 비교 화면에서는 각 종목 column 안의 compact donut으로 사용한다.
- pending 상태에서는 도넛 stroke 영역과 숫자 영역을 skeleton shimmer로 대체한다.

### Recent Stock Chip

- 검색창 하단의 고정 추천 종목 칩을 대체한다.
- 브라우저 쿠키 기반 최근 조회 종목을 보여준다.
- 구조: `종목명` + 작은 `티커` + 삭제 `x`
- `x`는 독립 button이며, 누르면 해당 칩만 삭제한다.
- 칩 전체를 누르면 해당 종목 상세로 이동한다.
- 최대 노출 개수는 6-8개로 제한한다.
- 종목명은 한 줄 ellipsis, 티커는 작고 고정 폭에 가깝게 표시한다.

### Status Pill

- 상승: red soft bg + red text
- 하락: blue soft bg + blue text
- 기회: green soft bg + green text
- 대기/캐시: muted glass bg + secondary text

### Skeleton Data Module

- pending/loading 상태를 텍스트 문단으로 대체하지 않는다.
- 실제 데이터 모듈과 같은 크기의 skeleton을 보여준다.
- 도넛, score row, metric cell, chart well, factor heatmap cell 각각에 맞는 skeleton 형태를 둔다.
- status pill로만 짧게 상태를 보조한다. 예: `데이터 준비 중`, `다시 확인 가능`
- skeleton은 layout shift를 막기 위해 실제 카드와 같은 min-height를 가진다.

### Segmented Control

- wrapper: glass-soft
- active: accent-soft + accent text + border
- inactive: transparent + secondary text

### Mobile Bottom Action Bar

모바일 상세 페이지에서는 좌측 플로팅 인덱스가 없으므로 하단에 아주 작은 action bar를 둔다.

- 버튼은 `비교 추가`와 `맨 위로` 두 개만 둔다.
- 화면을 가리지 않도록 safe area를 고려한 glass bar로 만든다.
- `비교 추가`는 현재 종목을 비교 페이지에 포함해 이동하거나 비교 목록에 추가한다.
- `맨 위로`는 검색/요약 영역으로 스크롤한다.
- 섹션 이동, 검색, 기타 메뉴는 이 하단 바에 넣지 않는다.

### Share Link

상세/비교 페이지에는 분석 링크 복사 기능을 둔다.

- 상세: 현재 종목 링크 복사
- 비교: 현재 비교 종목 조합 링크 복사
- 공유 링크는 종목/비교 조합 중심으로 구성한다.
- 테마, 스크롤 위치, 일시적인 UI highlight 상태는 공유하지 않는다.
- 복사 성공은 작은 toast/status pill로만 알려준다.

### Icon Buttons

현재 새로고침의 `↻`는 가능하면 아이콘 스타일로 정리한다. 별도 아이콘 라이브러리를 도입하지 않는다면 같은 문자라도 원형 glass button 안에 안정적으로 배치한다.

## 12. Responsive Rules

Mobile:

- body background는 어두운 캔버스 유지
- 카드 좌우 padding 16px
- 검색바 sticky
- 좌측 인덱스 숨김
- factor metric grid는 1열 또는 2열
- 점수 카드는 세로 배치
- 최근 조회 종목 칩은 horizontal scroll rail
- 비교 column board는 세로 카드 스택 또는 horizontal scroll board로 전환
- 도넛 점수 카드는 너무 커지지 않게 96-120px 범위로 제한
- 상세 페이지 하단에는 `비교 추가`, `맨 위로` 두 버튼만 있는 mobile bottom action bar를 둔다.
- mobile bottom action bar와 sticky 검색/요약 요소가 서로 겹치지 않게 safe area와 하단 padding을 확보한다.

Tablet:

- 본문 폭 720px 전후
- 비교 카드 2열
- factor metric grid 2-3열
- 비교 heatmap은 horizontal scroll을 허용하되 row label이 읽혀야 한다.

Desktop:

- 좌측 인덱스 표시
- 본문 폭 920-1040px
- 요약 insight tile 3-5열
- 패턴 칩 3열
- factor metric grid 3열
- 비교 페이지는 1180px 전후 유지
- 비교 페이지에도 좌측 플로팅 인덱스 표시
- 5종목 column board는 같은 row alignment를 유지
- factor heatmap과 metric matrix는 5개 종목까지 한 화면에서 비교 가능해야 한다.
- 상세 페이지는 스크롤 후 mini decision bar를 표시한다.
- 상세 플로팅 인덱스 하단에는 `비교하기` 버튼이 고정된다.

## 13. Accessibility & Readability

- 모든 본문 텍스트는 어두운 배경에서 충분한 대비를 가져야 한다.
- 라이트/다크 양쪽에서 주요 텍스트, 버튼, 차트 축, tooltip 대비를 확인해야 한다.
- `text-muted`는 label/meta에만 쓰고 긴 문장에는 쓰지 않는다.
- 숫자는 tabular nums 유지
- focus-visible outline은 accent 계열로 명확히 표시
- hover에만 의존하지 않고 active/aria-current 상태를 표시
- 차트 색상은 상승/하락 의미와 일관되어야 한다.
- 반투명 카드 뒤에 복잡한 배경 패턴이 오지 않게 한다.
- 테마 토글은 스크린리더에서 현재 테마와 다음 동작을 알 수 있어야 한다.
- 종목명 우선 표시가 기본이며, 티커만으로는 초보 사용자가 종목을 식별하기 어려운 위치를 피한다.
- ETF, 좁은 chart legend, heatmap column header처럼 티커가 더 명확한 맥락에서는 티커를 허용한다.
- 내부용 key/source/debug 데이터는 사용자 화면에 노출하지 않는다.
- 데이터 상태 pill은 작고 보조적이어야 하며, 핵심 판단 UI보다 시각적으로 강하면 안 된다.
- 공유 링크 복사, 최근 조회 삭제, 비교 추가, 맨 위로 버튼은 키보드와 스크린리더에서 명확한 label을 가진다.

## 14. Footer & Disclaimer

푸터는 작고 조용하게 둔다.

- 긴 법적 문구처럼 보이지 않게 한다.
- 핵심 문장: `점수는 투자 추천이 아니라 비교를 돕는 분석 기준입니다.`
- 라이트/다크 양쪽에서 낮은 대비로 보이되 읽을 수 있어야 한다.
- 푸터에는 서비스명, 간단한 데이터/면책 문구, 필요 시 링크만 둔다.

## 15. Implementation Phases

### Phase 1. Design Tokens & Surface Foundation

- `globals.css`의 색상/표면/폰트 토큰 교체
- `prefers-color-scheme` 기반 라이트/다크 토큰 추가
- 사용자 선택 테마를 저장하고 `system/light/dark` 상태를 적용하는 최소 로직 추가
- body 배경과 기본 glass card 스타일 추가
- 기존 카드 class에 glass surface 적용
- 검색바, 좌측 인덱스, 기본 섹션 카드부터 시각 업그레이드

완료 기준:

- 상세 페이지 전체가 새 glass visual direction으로 보인다.
- 라이트/다크 양쪽에서 글자 대비가 떨어지는 카드가 없다.

### Phase 2. Landing State

- `/`에서 ticker query가 없을 때 landing content를 표시
- 랜딩 상단 GNB/command bar 추가
- GNB 우측에 테마 전환 토글 추가
- 검색바를 첫 번째 주요 작업 영역에 유지
- 고정 추천 종목 칩 삭제
- 쿠키 기반 최근 조회 종목 chip rail 추가
- 최근 조회 종목 칩의 개별 삭제 `x` 동작 추가
- 서비스 소개 섹션 3-4개 추가
- 최근 조회 chip 클릭 시 상세 페이지로 이동
- 자동완성 결과에서 종목명 우선, 티커/거래소/국가/자산유형 보조 표시 적용

완료 기준:

- 첫 화면에서 검색 없이도 서비스 정체성을 이해할 수 있다.
- 검색/자동완성/최근 조회 칩 진입이 동작한다.

### Phase 3. Detail Dashboard Structure Upgrade

- `StockHeader` 정보 위계 재정렬
- 종목명 우선, 티커 보조 표시 체계 적용
- 품질/기회 점수를 donut score card로 변경
- 작은 score contribution mini bar 추가
- 스크롤 후 mini decision bar 추가
- 상세 플로팅 인덱스 하단 `비교하기` 버튼 추가
- 모바일 하단 `비교 추가`, `맨 위로` action bar 추가
- insight tile, verdict panel 시각 강화
- chart well, pattern chip, factor card 개선
- list/accordion row를 table-like glass layout으로 정리
- 내부용 source/key/debug 값과 불필요한 출처 문자열 필터링
- pending/loading/error/cooldown 상태를 skeleton/status module로 정리
- 데이터 상태 pill/meta를 소극적으로 추가

완료 기준:

- 사용자가 처음 보는 화면에서 현재가, 점수, 강점/주의점, 판단문을 10초 안에 파악할 수 있다.
- `yfinance`, `speculative_expensive_sales`, `적용 상한` 같은 내부 문구가 사용자 화면에 보이지 않는다.

### Phase 4. Compare Page Upgrade

- compare toolbar와 chip rail glass 적용
- 비교 페이지 좌측 플로팅 인덱스 추가
- 기존 `먼저 볼 차이` 카드 묶음을 decision strip으로 전환
- decision strip module 클릭 시 관련 heatmap/matrix row highlight 또는 scroll 이동
- Quality x Opportunity Map 추가
- 5종목 column board 추가
- 품질/기회 점수를 donut score card로 표시
- factor heatmap matrix 추가
- normalized performance chart의 overlay/small multiples 방향 반영
- 비교 지표 matrix에 흐름/변동성/사업/현금/밸류에이션/기대 지표 추가
- best/negative/status 색상 체계 통일
- pending 종목은 텍스트 문단이 아니라 skeleton column/module로 표시
- 상세/비교 링크 복사 기능 추가

완료 기준:

- 3-5개 종목 비교 시 같은 행/축에서 점수와 지표를 비교할 수 있다.
- pending 종목이 있어도 비교 보드 레이아웃이 유지된다.

### Phase 5. Footer & Disclaimer

- 작은 푸터 추가
- 투자 추천이 아니라 비교/분석 보조 기준이라는 면책 문구 추가
- 라이트/다크 양쪽에서 푸터 대비 확인

완료 기준:

- 면책 문구가 존재하되, 주요 분석 경험을 방해하지 않는다.

### Phase 6. QA

- 모바일 390px, 430px
- 태블릿 768px
- 데스크톱 1440px
- OS 다크 설정 기본 진입
- OS 라이트 설정 기본 진입
- 사용자 토글로 light/dark/system 전환
- 긴 한국어 종목명, 긴 뉴스 제목, 긴 재무 label
- 로딩/대기/error/cooldown 상태
- 비교 pending 상태: 일부 종목만 데이터 준비 중인 경우
- 최근 조회 종목 추가/삭제/재진입
- 자동완성 결과의 종목명/티커/자산유형 구분
- mini decision bar 표시/숨김
- 상세 플로팅 인덱스 하단 `비교하기`
- 모바일 하단 `비교 추가`, `맨 위로`
- decision strip에서 heatmap/matrix row 연결
- 상세/비교 링크 복사
- 푸터 면책 문구
- 종목명 우선 표시와 ETF/좁은 셀의 티커 표시 예외
- 내부용 key/source/debug 값 미노출
- 자동완성 드롭다운 clipping 여부
- 차트 렌더링과 tooltip 위치

## 16. Non-goals

- 데이터 모델 변경
- API 응답 구조 변경
- 새 분석 지표 추가
- 새 차트 라이브러리 도입
- 랜딩을 마케팅 사이트처럼 길게 확장
- 큰 내비게이션/브랜드 사이트 구조 추가

## 17. Open Decisions

- 서비스명을 화면에 `SIA Stock Score`로 노출할지, 현재 `Stock Score Reader`를 유지할지 결정 필요
- `/` 기본 상태에서 분석 프리뷰를 실제 데이터로 보여줄지, 정적 설명 카드만 보여줄지 결정 필요
- 최근 조회 종목 저장 개수와 만료 기간 결정 필요. 권장: 8개, 30일

## 18. Acceptance Checklist

- 검색창이 랜딩 첫 화면의 첫 번째 주요 분석 인터랙션이다.
- 랜딩 상단 GNB에 라이트/다크 전환 토글이 있다.
- 최초 테마는 OS 시스템 설정을 따른다.
- 사용자가 선택한 테마는 새로고침 후에도 유지된다.
- 랜딩은 검색 아래에서 서비스 소개를 짧게 보여준다.
- 고정 추천 종목 리스트는 사라지고, 쿠키 기반 최근 조회 종목 칩이 표시된다.
- 최근 조회 종목 칩은 `x`로 개별 삭제할 수 있다.
- 상세 페이지의 큰 레이아웃 구조는 유지된다.
- PC 좌측 플로팅 인덱스가 유지되고 새 스타일로 개선된다.
- 상세 페이지 PC 플로팅 인덱스 하단에 `비교하기` 버튼이 있다.
- 상세 페이지는 스크롤 후 mini decision bar로 종목명, 현재가, 품질/기회 점수, 비교 추가를 계속 확인할 수 있다.
- 점수 카드에는 작은 score contribution mini bar가 들어가되 도넛보다 시각적으로 강하지 않다.
- 데이터 상태는 작은 pill/meta로 소극적으로 표시된다.
- 종목 비교 페이지에도 PC 좌측 플로팅 인덱스가 추가된다.
- 섹션 단위 그리드가 유지된다.
- 모든 주요 카드가 글래스모피즘 방향으로 통일된다.
- 품질/기회 점수는 카드 안의 도넛 차트와 숫자로 표시된다.
- 점수, 가격, 수익률, 상태 색상이 의미 기반으로만 사용된다.
- 종목명 우선 표시가 기본이고, 티커는 보조 표기다.
- 좁은 비교 셀, ETF, chart legend 등 티커가 더 적합한 곳은 티커를 허용한다.
- `yfinance`, `speculative_expensive_sales`, `적용 상한` 같은 내부용/출처/debug 문구는 사용자 화면에 노출되지 않는다.
- pending/loading 상태는 투박한 텍스트 문단이 아니라 skeleton animation/status module로 표시된다.
- 종목 비교의 `먼저 볼 차이`는 카드 나열이 아니라 decision strip 또는 시각화된 비교 요약으로 제공된다.
- decision strip 항목은 관련 heatmap/matrix row로 이동하거나 강조할 수 있다.
- 최대 5개 종목 비교는 Quality x Opportunity Map, column board, factor heatmap, metric matrix로 한눈에 비교된다.
- 자동완성 결과는 종목명 우선, 티커/거래소/국가/자산유형 보조 표시다.
- 모바일 상세 하단 action bar에는 `비교 추가`, `맨 위로` 두 버튼만 있다.
- 상세/비교 페이지는 공유 가능한 링크 복사 기능을 제공한다.
- 푸터에 작은 면책 문구가 있다: 점수는 투자 추천이 아니라 비교를 돕는 분석 기준이다.
- 긴 한국어 텍스트와 숫자가 카드 밖으로 넘치지 않는다.
- 모바일에서 정보가 눌리거나 겹치지 않는다.
- 로딩/대기/에러/새로고침 cooldown 상태도 새 스타일 안에서 자연스럽다.
