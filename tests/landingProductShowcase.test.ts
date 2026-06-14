import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const showcaseSource = readFileSync(join(process.cwd(), "src/components/landing/LandingProductShowcase.tsx"), "utf8");
const landingSource = readFileSync(join(process.cwd(), "src/components/landing/StockLanding.tsx"), "utf8");
const packageJsonSource = readFileSync(join(process.cwd(), "package.json"), "utf8");

test("landing uses product UI previews instead of generated 3D ornament scenes", () => {
  assert.match(landingSource, /import \{ LandingProductShowcase \} from "@\/components\/landing\/LandingProductShowcase";/);
  assert.match(landingSource, /<LandingProductShowcase variant=\{section\.showcase\} \/>/);
  assert.doesNotMatch(landingSource, /LandingThreeScene|LandingLottie|lottie/i);
  assert.doesNotMatch(showcaseSource, /@react-three|three|Canvas|useFrame|MeshTransmissionMaterial|RoundedBox|ContactShadows|GLTFLoader|useGLTF/);
  assert.doesNotMatch(packageJsonSource, /"@react-three\/fiber"|"@react-three\/drei"|"three":/);
});

test("landing product showcase covers real investor workflows", () => {
  for (const variant of ["search", "rank", "brief", "chart", "compare"]) {
    assert.match(landingSource, new RegExp(`showcase: "${variant}"`));
  }

  for (const component of ["SearchWorkbench", "MarketWorkbench", "BriefWorkbench", "ChartWorkbench", "CompareWorkbench"]) {
    assert.match(showcaseSource, new RegExp(`function ${component}`));
  }

  for (const phrase of ["NVIDIA", "$142.80", "삼성전자", "품질 86", "20일 캔들", "20일선", "후보 비교", "뉴스"]) {
    assert.ok(showcaseSource.includes(phrase), `expected landing showcase source to include ${phrase}`);
  }
  for (const phrase of ["Apple", "Microsoft", "TSMC", "NVDA 브리프", "nextScore", "--move", "시가총액", "먼저 볼 것", "CompareCandidateState"]) {
    assert.ok(showcaseSource.includes(phrase), `expected landing showcase source to include ${phrase}`);
  }
  assert.doesNotMatch(showcaseSource, /landing-ui-toolbar|종목명이나 티커 검색/);
  assert.doesNotMatch(showcaseSource, /<strong>005930<\/strong>/);
});

test("landing chart preview uses domestic candle colors only in the chart workflow", () => {
  assert.match(showcaseSource, /className=\{`landing-ui-candle \$\{candle\.tone\}`\}/);
  assert.match(showcaseSource, /tone: "fall"/);
  assert.match(showcaseSource, /tone: "rise"/);
  assert.doesNotMatch(showcaseSource, /상승 빨강|하락 파랑/);
});
