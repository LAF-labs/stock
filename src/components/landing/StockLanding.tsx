import type { CSSProperties } from "react";

export default function StockLanding() {
  return (
    <section className="dashboard-landing" aria-label="주식 점수 검색 시작">
      <article className="landing-story-section dashboard-landing-hero">
        <div className="landing-copy">
          <span>Stockstalker</span>
          <h2>시장을 훑고, 후보만 남깁니다</h2>
          <p>검색 한 번으로 종목의 가격, 점수, 비교 근거를 이어서 확인합니다.</p>
          <div className="landing-proof-list">
            <span>한글 종목명·해외 티커 모두 검색</span>
            <span>시가총액 순위에서 상세 분석까지 연결</span>
            <span>관심 종목은 비교 화면에서 같은 기준으로 대조</span>
          </div>
        </div>

        <div className="landing-visual landing-stock-visual" aria-hidden="true">
          <div className="landing-grid" />
          <div className="landing-scanline" />
          <div className="landing-score-stack">
            <div className="landing-score-card">
              <span>QUALITY</span>
              <strong>82</strong>
            </div>
            <div className="landing-score-card secondary">
              <span>OPPORTUNITY</span>
              <strong>74</strong>
            </div>
          </div>
          <div className="landing-stock-loop">
            <div className="landing-loop-window">
              <div className="landing-loop-track">
                <div className="landing-loop-group">
                  <span>NVDA</span>
                  <span>애플</span>
                  <span>TSLA</span>
                  <span>엔비디아</span>
                  <span>삼성전자</span>
                  <span>SK하이닉스</span>
                  <span>현대차</span>
                  <span>네이버</span>
                </div>
                <div className="landing-loop-group" aria-hidden="true">
                  <span>NVDA</span>
                  <span>애플</span>
                  <span>TSLA</span>
                  <span>엔비디아</span>
                  <span>삼성전자</span>
                  <span>SK하이닉스</span>
                  <span>현대차</span>
                  <span>네이버</span>
                </div>
              </div>
            </div>
          </div>
          <div className="landing-console">
            <span>검색</span>
            <i />
            <span>상세 분석</span>
          </div>
        </div>
      </article>

      <article className="landing-story-section landing-story-market">
        <div className="landing-copy">
          <span>Market Cap Board</span>
          <h2>큰 종목부터 빠르게 봅니다</h2>
          <p>전체, 국내, 해외 상위 종목을 같은 테이블 언어로 확인합니다.</p>
          <div className="landing-proof-list">
            <span>순위·티커·시총·주가·등락폭을 한 줄에 정리</span>
            <span>섹터 필터로 관심 산업만 좁히기</span>
            <span>행을 누르면 바로 종목 상세로 이동</span>
          </div>
        </div>

        <div className="landing-visual landing-market-visual" aria-hidden="true">
          <div className="landing-grid" />
          <div className="landing-market-table">
            <div>
              <span>1</span>
              <strong>엔비디아</strong>
              <b>NVDA</b>
              <em>$4.2T</em>
            </div>
            <div>
              <span>2</span>
              <strong>애플</strong>
              <b>AAPL</b>
              <em>$3.1T</em>
            </div>
            <div>
              <span>3</span>
              <strong>삼성전자</strong>
              <b>005930</b>
              <em>478조</em>
            </div>
            <div>
              <span>4</span>
              <strong>마이크로소프트</strong>
              <b>MSFT</b>
              <em>$3.0T</em>
            </div>
          </div>
          <div className="landing-market-filter">
            <span>전체</span>
            <span>국내</span>
            <span>해외</span>
            <strong>반도체</strong>
          </div>
        </div>
      </article>

      <article className="landing-story-section landing-story-info">
        <div className="landing-copy">
          <span>Company Brief</span>
          <h2>상세 페이지는 판단 순서대로 읽힙니다</h2>
          <p>가격, 점수, 강점과 부담을 위에서 아래로 자연스럽게 확인합니다.</p>
          <div className="landing-proof-list">
            <span>시총·섹터·재무를 한 화면에서 정리</span>
            <span>뉴스와 밸류에이션 부담을 함께 확인</span>
            <span>국내·해외 종목 표기를 읽기 쉽게 변환</span>
          </div>
        </div>

        <div className="landing-visual landing-info-visual" aria-hidden="true">
          <div className="landing-grid" />
          <div className="landing-info-orbit">
            <span>섹터</span>
            <span>시총</span>
            <span>재무</span>
          </div>
          <div className="landing-info-panel">
            <span>AI 반도체</span>
            <strong>상위 1%</strong>
            <i />
          </div>
          <div className="landing-info-list">
            <span>
              매출
              <b>+18%</b>
            </span>
            <span>
              마진
              <b>개선</b>
            </span>
            <span>
              뉴스
              <b>확인</b>
            </span>
          </div>
        </div>
      </article>

      <article className="landing-story-section landing-story-technical">
        <div className="landing-copy">
          <span>Technical Flow</span>
          <h2>가격 흐름은 따로 분리합니다</h2>
          <p>가격 흐름을 점수와 분리해서 봅니다.</p>
          <div className="landing-proof-list">
            <span>추세·변동성·신호를 따로 해석</span>
            <span>차트 패턴과 단기 리스크를 구분</span>
            <span>기술적 분석 화면으로 바로 이동</span>
          </div>
        </div>

        <div className="landing-visual landing-technical-visual" aria-hidden="true">
          <div className="landing-grid" />
          <div className="landing-chart-stage">
            <div className="landing-chart-bars">
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
            </div>
            <div className="landing-chart-line">
              <i />
            </div>
          </div>
          <div className="landing-signal-row">
            <span>추세</span>
            <b>상승</b>
            <span>변동성</span>
            <b>중립</b>
          </div>
        </div>
      </article>

      <article className="landing-story-section landing-story-compare">
        <div className="landing-copy">
          <span>Compare Mode</span>
          <h2>마지막엔 후보를 나란히 둡니다</h2>
          <p>고민 중인 종목을 같은 기준에 올리고 차이만 남깁니다.</p>
          <div className="landing-proof-list">
            <span>후보를 나란히 비교</span>
            <span>점수·재무·밸류에이션을 한 번에 대조</span>
            <span>가장 강한 지표를 자동으로 강조</span>
          </div>
        </div>

        <div className="landing-visual landing-compare-visual" aria-hidden="true">
          <div className="landing-grid" />
          <div className="landing-compare-board">
            <div className="landing-compare-card" style={{ "--landing-line": "86%" } as CSSProperties}>
              <span>AAPL</span>
              <strong>86</strong>
              <i />
            </div>
            <div className="landing-compare-card" style={{ "--landing-line": "78%" } as CSSProperties}>
              <span>삼성전자</span>
              <strong>78</strong>
              <i />
            </div>
            <div className="landing-compare-card" style={{ "--landing-line": "72%" } as CSSProperties}>
              <span>MSFT</span>
              <strong>72</strong>
              <i />
            </div>
          </div>
        </div>
      </article>
    </section>
  );
}
