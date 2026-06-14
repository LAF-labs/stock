import { LandingProductShowcase } from "@/components/landing/LandingProductShowcase";

const landingSections = [
  {
    className: "dashboard-landing-hero",
    eyebrow: "관심 종목 필터링",
    title: "관심 종목, 먼저 숫자로 좁혀보세요",
    body: "실적이 좋아도 밸류에이션이 앞서 있으면 수익률은 달라집니다.",
    points: [
      "품질·기회 점수로 재무와 가격 부담을 나눠 봐요.",
      "PER·PBR·목표가 괴리율을 같은 흐름에서 확인해요.",
      "검토할 종목만 비교 후보로 넘겨요.",
    ],
    showcase: "search",
  },
  {
    className: "landing-story-market",
    eyebrow: "시장 무게중심",
    title: "시총과 섹터로 시장의 무게중심을 봐요",
    body: "주도주는 보통 시총, 거래대금, 섹터 안에서 먼저 티가 납니다.",
    points: [
      "국내·해외 시총 상위 종목을 같은 기준으로 정렬해요.",
      "섹터별 강세가 이어지는지 좁혀봐요.",
      "거래대금과 등락률이 같이 움직이는 종목을 먼저 열어봐요.",
    ],
    showcase: "rank",
  },
  {
    className: "landing-story-info",
    eyebrow: "종목 브리프",
    title: "좋은 회사인지보다, 얼마에 사는지가 먼저예요",
    body: "매출 성장, 마진, ROE가 좋아도 가격이 이미 반영했는지 봐야 합니다.",
    points: [
      "실적 모멘텀과 수익성 지표를 함께 봐요.",
      "PER·PBR 부담과 목표가 여력을 같이 확인해요.",
      "뉴스가 숫자와 같은 방향인지 확인해요.",
    ],
    showcase: "brief",
  },
  {
    className: "landing-story-technical",
    eyebrow: "진입 구간",
    title: "캔들 흐름으로 진입 구간을 따로 확인해요",
    body: "좋은 종목도 20일 추세와 변동성이 흔들리면 기다릴 이유가 생깁니다.",
    points: [
      "캔들, 추세, 변동성을 점수와 분리해서 봐요.",
      "단기 과열과 눌림 구간을 구분해요.",
      "진입 전 리스크 신호를 한 번 더 확인해요.",
    ],
    showcase: "chart",
  },
  {
    className: "landing-story-compare",
    eyebrow: "후보 비교",
    title: "비슷한 후보는 같은 지표로 눌러봐요",
    body: "테마가 같아도 ROE, 마진, 밸류에이션 차이가 수익률을 가릅니다.",
    points: [
      "품질·기회·가격 흐름을 한 줄에 맞춰 봐요.",
      "ROE와 마진이 더 버티는 쪽을 확인해요.",
      "PER 부담이 작은 대안을 같이 남겨요.",
    ],
    showcase: "compare",
  },
] as const;

export default function StockLanding() {
  return (
    <section className="dashboard-landing" aria-label="주식 점수 검색 시작">
      {landingSections.map((section) => (
        <article className={`landing-story-section ${section.className}`} key={section.showcase}>
          <div className="landing-copy">
            <span>{section.eyebrow}</span>
            <h2>{section.title}</h2>
            <p>{section.body}</p>
            <div className="landing-proof-list">
              {section.points.map((point) => (
                <span key={point}>{point}</span>
              ))}
            </div>
          </div>

          <div className="landing-visual" aria-hidden="true">
            <LandingProductShowcase variant={section.showcase} />
          </div>
        </article>
      ))}
    </section>
  );
}
