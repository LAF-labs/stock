# Dual Quality And Opportunity Score Design

## Goal

기존 `score`는 회사의 기초체력과 가격 부담을 보는 품질점수로 유지하고, 새 `opportunity_score`는 추정 성장, 모멘텀, 목표가 여지, 유동성, 위험을 보는 별도 점수로 제공한다.

## Score Meaning

- `quality_score`: 기존 v4 종합점수와 같은 의미다. 이익성, 성장 흐름, 거래 안정성, 모멘텀, 밸류에이션을 보수적으로 합산한다.
- `opportunity_score`: 지금 새로 관심을 둘 만한 setup인지 본다. 품질점수와 합치지 않는다.
- `score`: 하위 호환을 위해 `quality_score`와 같은 값을 유지한다.

## Opportunity Formula

기회점수는 사용 가능한 공통 데이터만 사용한다.

- 모멘텀 30%: 1/3/6/52주 수익률, 52주 고점 거리, 50/200일 이동평균 위치
- 추정 성장 25%: 매출 성장률, 이익 성장률
- 애널리스트/목표가 20%: 평균 목표가 대비 상승 여지, 투자의견 평균, 커버리지 수
- 유동성/관심 15%: 20일 거래량, 20일/60일 거래량 가속, 시가총액
- 위험 제어 10%: ATR, RSI 과열, 베타

데이터가 부족하면 해당 항목의 confidence를 낮추고 최종 점수는 `raw * confidence + 50 * (1 - confidence)`로 중립에 당긴다.

## Risk Caps

- 적자 또는 현금흐름 부실인데 EV/Revenue 또는 P/S가 20배 이상이면 최대 72점
- Forward PER이 없고 애널리스트가 3명 미만이면 최대 68점
- 단기 변동성 ATR 10% 초과 또는 RSI 85 초과면 최대 75점
- 목표가가 현재가보다 낮고 성장률도 약하면 최대 65점
- 유동성 데이터가 매우 낮으면 최대 60점

## API Contract

모든 score payload는 다음 필드를 포함한다.

- `score`, `quality_score`, `quality_grade`
- `opportunity_score`, `opportunity_grade`, `opportunity_confidence`
- `components`, `opportunity_components`
- `sia_snapshot.quality_score`, `sia_snapshot.opportunity_score`, `sia_snapshot.opportunity_confidence`

## Operations

실시간 검색은 yfinance/KIS에서 이미 얻는 필드와 6시간/12시간 캐시를 재사용한다. 전체 유니버스 percentile 기반 상대 점수는 별도 일일 배치로 확장하되, 그 전까지는 현재 산식의 confidence anchoring으로 과신을 막는다.
