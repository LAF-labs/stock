const MAX_TECHNICAL_BARS = 260;

type Bar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

type Signal = {
  key: string;
  title: string;
  status: string;
  tone: string;
  plain: string;
  evidence: string;
  layer: string;
  rule: string;
};

export function buildTechnicalAnalysis(rows: Array<Record<string, unknown>>, latestBarClosed = true): Record<string, unknown> {
  const bars = normalizeBars(rows);
  const tier = coverageTierForBars(bars.length);
  const signalBars = latestBarClosed ? bars : bars.slice(0, -1);
  const warnings = warningsForTier(tier, bars.length);

  if (!signalBars.length) {
    return {
      type: "technical_analysis",
      version: "technical-v1",
      timeframe: "1d",
      status: "unavailable",
      coverage_tier: tier,
      bars: bars.length,
      data_window: {
        available_days: bars.length,
        required_days: 20,
        is_newly_listed: bars.length > 0 && bars.length < 60,
        message: "가격 데이터가 부족해 기술적 분석을 계산할 수 없어요.",
      },
      summary: {
        tone: "limited",
        headline: "아직 판단할 차트 데이터가 부족해요",
        bullets: ["상장 초기이거나 가격 데이터가 충분히 쌓이지 않았어요."],
      },
      signals: [],
      indicators: [],
      overlays: {},
      warnings,
      glossary: glossary(),
    };
  }

  const closes = signalBars.map((bar) => bar.close);
  const ema20 = emaSeries(closes, 20);
  const ema50 = emaSeries(closes, 50);
  const sma200 = smaSeries(closes, 200);
  const rsi14 = rsiSeries(closes, 14);
  const fvgZones = detectFvg(signalBars);
  const orderBlocks = detectOrderBlocks(signalBars);
  const fib = fibonacciLevels(signalBars);
  const signals = [
    movingAverageSignal(signalBars, ema20, ema50, sma200),
    ichimokuSignal(signalBars),
    rsiSignal(signalBars, rsi14),
    fvgSignal(fvgZones),
    orderBlockSignal(orderBlocks, signalBars.at(-1)?.close ?? 0),
    fibonacciSignal(signalBars, fib),
    volumeCandleSignal(signalBars),
    trendSignal(signalBars),
  ].filter((item): item is Signal => Boolean(item));
  const confluence = confluenceFor(signals, tier);
  const payload: Record<string, unknown> = {
    type: "technical_analysis",
    version: "technical-v1",
    timeframe: "1d",
    status: tier === "standard" || tier === "full" || tier === "long_history" ? "ready" : "limited",
    coverage_tier: tier,
    bars: bars.length,
    closed_bar_date: signalBars.at(-1)?.date,
    data_window: {
      available_days: bars.length,
      required_days: 120,
      start_date: bars[0]?.date,
      end_date: bars.at(-1)?.date,
      is_newly_listed: bars.length < 60,
      message: dataWindowMessage(tier),
    },
    summary: summaryFor(signals, confluence),
    signals,
    indicators: indicatorCards(signals),
    overlays: {
      moving_average: {
        ema20: overlayLine(signalBars, ema20),
        ema50: overlayLine(signalBars, ema50),
        sma200: overlayLine(signalBars, sma200),
      },
      rsi14: overlayLine(signalBars, rsi14),
      fvg_zones: fvgZones.slice(-5),
      order_blocks: orderBlocks.slice(-4),
      fibonacci: fib,
    },
    warnings,
    glossary: glossary(),
  };
  if (confluence) payload.confluence = confluence;
  if (!latestBarClosed) warnings.push("마지막 봉은 진행 중일 수 있어 점수 계산에서 제외했어요.");
  return payload;
}

function coverageTierForBars(count: number): string {
  if (count <= 0) return "insufficient";
  if (count < 20) return "starter";
  if (count < 60) return "short";
  if (count < 120) return "standard";
  if (count < 200) return "full";
  return "long_history";
}

function normalizeBars(rows: Array<Record<string, unknown>>): Bar[] {
  const bars: Bar[] = [];
  for (const row of rows) {
    const date = text(row.date || row.ts).slice(0, 10);
    const close = number(row.close);
    if (!date || close === undefined) continue;
    const open = number(row.open) ?? close;
    let high = number(row.high) ?? Math.max(open, close);
    let low = number(row.low) ?? Math.min(open, close);
    if (low > high) [low, high] = [high, low];
    bars.push({ date, open, high, low, close, volume: number(row.volume) });
  }
  return bars.sort((left, right) => left.date.localeCompare(right.date)).slice(-MAX_TECHNICAL_BARS);
}

function warningsForTier(tier: string, bars: number): string[] {
  if (tier === "insufficient") return ["가격 데이터가 없어 기술적 분석을 제공할 수 없어요."];
  if (tier === "starter" || tier === "short") return [`상장 초기 또는 데이터 부족 구간이에요. 현재 ${bars}개 일봉만 반영했어요.`];
  return [];
}

function dataWindowMessage(tier: string): string {
  if (tier === "starter") return "짧은 차트라 이평선·거래량처럼 빠른 신호만 참고하세요.";
  if (tier === "short") return "중기 구름·피보나치는 제한적으로만 해석하세요.";
  return "주요 기술적 분석을 계산할 만큼 일봉 데이터가 쌓였어요.";
}

function emaSeries(values: number[], period: number): Array<number | undefined> {
  const alpha = 2 / (period + 1);
  let current: number | undefined;
  return values.map((value, index) => {
    current = current === undefined ? value : value * alpha + current * (1 - alpha);
    return index + 1 >= period ? round(current) : undefined;
  });
}

function smaSeries(values: number[], period: number): Array<number | undefined> {
  let sum = 0;
  return values.map((value, index) => {
    sum += value;
    if (index >= period) sum -= values[index - period] ?? 0;
    return index + 1 >= period ? round(sum / period) : undefined;
  });
}

function rsiSeries(values: number[], period: number): Array<number | undefined> {
  if (values.length < 2) return values.map(() => undefined);
  const result: Array<number | undefined> = [undefined];
  const gains: number[] = [];
  const losses: number[] = [];
  let avgGain: number | undefined;
  let avgLoss: number | undefined;
  for (let index = 1; index < values.length; index += 1) {
    const change = (values[index] ?? 0) - (values[index - 1] ?? 0);
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    gains.push(gain);
    losses.push(loss);
    if (index < period) {
      result.push(undefined);
      continue;
    }
    if (index === period) {
      avgGain = sum(gains.slice(-period)) / period;
      avgLoss = sum(losses.slice(-period)) / period;
    } else {
      avgGain = ((avgGain ?? 0) * (period - 1) + gain) / period;
      avgLoss = ((avgLoss ?? 0) * (period - 1) + loss) / period;
    }
    result.push(avgLoss === 0 ? 100 : round(100 - 100 / (1 + (avgGain ?? 0) / avgLoss), 2));
  }
  return result;
}

function movingAverageSignal(bars: Bar[], ema20: Array<number | undefined>, ema50: Array<number | undefined>, sma200: Array<number | undefined>): Signal {
  const latest = bars.at(-1)!;
  const e20 = lastValue(ema20);
  const e50 = lastValue(ema50);
  const s200 = lastValue(sma200);
  if (e20 === undefined || e50 === undefined) return signal("moving_average", "이평선", "limited", "20·50일선 계산 전이에요.", `일봉 ${bars.length}개`, "trend", "20EMA와 50EMA의 위치를 봐요.");
  if (latest.close > e20 && e20 > e50 && (s200 === undefined || latest.close > s200)) return signal("moving_average", "이평선", "bullish", "가격이 단기·중기선 위에 있어요.", `종가 ${fmt(latest.close)} > EMA20 ${fmt(e20)} > EMA50 ${fmt(e50)}`, "trend", "가격이 주요 이평선 위면 매수세가 우세해요.");
  if (latest.close < e20 && e20 < e50) return signal("moving_average", "이평선", "bearish", "가격이 이평선 아래로 눌려 있어요.", `종가 ${fmt(latest.close)} < EMA20 ${fmt(e20)} < EMA50 ${fmt(e50)}`, "trend", "가격이 이평선 아래면 반등 확인이 필요해요.");
  return signal("moving_average", "이평선", "neutral", "이평선 방향이 아직 섞여 있어요.", `종가 ${fmt(latest.close)} · EMA20 ${fmt(e20)} · EMA50 ${fmt(e50)}`, "trend", "선들이 엇갈리면 방향 판단을 보류해요.");
}

function ichimokuSignal(bars: Bar[]): Signal {
  if (bars.length < 52) return signal("ichimoku", "일목구름", "limited", "구름 계산에 필요한 52봉 전이에요.", `일봉 ${bars.length}개`, "cloud", "전환선·기준선·구름 위치를 봐요.");
  const tenkan = midpoint(bars.slice(-9));
  const kijun = midpoint(bars.slice(-26));
  const spanA = (tenkan + kijun) / 2;
  const spanB = midpoint(bars.slice(-52));
  const top = Math.max(spanA, spanB);
  const bottom = Math.min(spanA, spanB);
  const close = bars.at(-1)!.close;
  if (close > top && tenkan > kijun) return signal("ichimoku", "일목구름", "bullish", "가격이 구름 위에 있어요.", `종가 ${fmt(close)} > 구름상단 ${fmt(top)}`, "cloud", "구름 위는 추세가 위로 열린 상태로 봐요.");
  if (close < bottom && tenkan < kijun) return signal("ichimoku", "일목구름", "bearish", "가격이 구름 아래에 있어요.", `종가 ${fmt(close)} < 구름하단 ${fmt(bottom)}`, "cloud", "구름 아래는 저항 확인이 먼저예요.");
  return signal("ichimoku", "일목구름", "neutral", "가격이 구름 근처에서 방향을 고르고 있어요.", `구름 ${fmt(bottom)}~${fmt(top)}`, "cloud", "구름 안팎에서는 돌파·이탈을 기다려요.");
}

function rsiSignal(bars: Bar[], rsi14: Array<number | undefined>): Signal {
  const latest = lastValue(rsi14);
  if (latest === undefined) return signal("rsi_divergence", "RSI 다이버전스", "limited", "RSI 계산에 필요한 데이터가 적어요.", `일봉 ${bars.length}개`, "momentum", "가격 저점·고점과 RSI 방향을 비교해요.");
  const tone = latest >= 70 ? "caution" : latest <= 30 ? "bullish" : "neutral";
  const plain = latest >= 70 ? "과열권이라 식힘이 필요해요." : latest <= 30 ? "과매도권 반등을 볼 수 있어요." : "RSI는 중립 구간이에요.";
  return signal("rsi_divergence", "RSI 다이버전스", tone, plain, `RSI14 ${latest.toFixed(1)}`, "momentum", "RSI 70 이상은 과열, 30 이하는 과매도로 봐요.");
}

function fvgSignal(zones: Array<Record<string, unknown>>): Signal {
  if (!zones.length) return signal("fvg", "ICT FVG", "neutral", "최근 뚜렷한 가격 갭은 없어요.", "최근 3봉 갭 없음", "ict", "3봉 사이 빈 가격대를 FVG로 봐요.");
  const zone = zones.at(-1)!;
  const bullish = zone.direction === "bullish";
  return signal("fvg", "ICT FVG", bullish ? "bullish" : "bearish", bullish ? "매수 갭이 남아 되돌림 구간이에요." : "매도 갭이 남아 저항 구간이에요.", `${zone.date} 갭 ${fmt(number(zone.low))}~${fmt(number(zone.high))}`, "ict", "강한 캔들 뒤 빈 구간은 재방문 가능성이 있어요.");
}

function orderBlockSignal(blocks: Array<Record<string, unknown>>, close: number): Signal {
  if (!blocks.length) return signal("order_block", "ICT OB", "neutral", "최근 기준 주문블록은 약해요.", "강한 반전 전 캔들 없음", "ict", "강한 이동 직전 반대 캔들을 OB로 봐요.");
  const block = blocks.at(-1)!;
  const low = number(block.low) ?? 0;
  const high = number(block.high) ?? 0;
  const inZone = low <= close && close <= high;
  const demand = block.direction === "demand";
  return signal("order_block", "ICT OB", inZone ? demand ? "bullish" : "caution" : "neutral", inZone ? demand ? "수요 주문블록 근처예요." : "공급 주문블록 근처예요." : "가까운 주문블록을 참고하세요.", `${block.date} ${fmt(low)}~${fmt(high)}`, "ict", "OB 안에서는 반응 여부를 확인해요.");
}

function fibonacciSignal(bars: Bar[], fib: Record<string, unknown>): Signal {
  const levels = Array.isArray(fib.levels) ? fib.levels.filter(isRecord) : [];
  if (!levels.length) return signal("fibonacci", "피보나치", "limited", "피보나치 범위가 아직 짧아요.", `일봉 ${bars.length}개`, "levels", "최근 고점과 저점 사이 되돌림을 봐요.");
  const close = bars.at(-1)!.close;
  const nearest = levels.reduce((best, item) => {
    const price = number(item.price) ?? 0;
    const bestPrice = number(best.price) ?? 0;
    return Math.abs(close - price) < Math.abs(close - bestPrice) ? item : best;
  }, levels[0]!);
  return signal("fibonacci", "피보나치", "neutral", "주요 되돌림 가격 근처예요.", `${nearest.label} ${fmt(number(nearest.price))}`, "levels", "38.2·50·61.8%는 반응을 보기 좋은 선이에요.");
}

function volumeCandleSignal(bars: Bar[]): Signal {
  const latest = bars.at(-1)!;
  const volumes = bars.slice(-21, -1).map((bar) => bar.volume).filter((value): value is number => value !== undefined && value > 0);
  const avg = volumes.length ? sum(volumes) / volumes.length : undefined;
  if (avg === undefined || latest.volume === undefined) return signal("volume_candle", "거래량·캔들", "limited", "거래량 데이터가 부족해요.", "20일 평균 거래량 없음", "volume", "큰 거래량과 캔들 방향을 같이 봐요.");
  const ratio = latest.volume / avg;
  if (latest.close > latest.open && ratio >= 1.5) return signal("volume_candle", "거래량·캔들", "bullish", "큰 거래량 양봉이 나왔어요.", `거래량 ${ratio.toFixed(1)}배`, "volume", "거래량이 붙은 양봉은 수요 확인으로 봐요.");
  if (latest.close < latest.open && ratio >= 1.5) return signal("volume_candle", "거래량·캔들", "bearish", "큰 거래량 음봉이라 주의예요.", `거래량 ${ratio.toFixed(1)}배`, "volume", "거래량이 붙은 음봉은 매물 출회로 봐요.");
  return signal("volume_candle", "거래량·캔들", "neutral", "거래량은 평소 수준이에요.", `거래량 ${ratio.toFixed(1)}배`, "volume", "거래량이 평균을 넘는지 확인해요.");
}

function trendSignal(bars: Bar[]): Signal {
  const close = bars.at(-1)!.close;
  const ret20 = bars.length >= 21 && bars.at(-21)?.close ? close / bars.at(-21)!.close - 1 : undefined;
  if (ret20 !== undefined && ret20 > 0.05) return signal("trend", "추세", "bullish", "최근 추세는 위쪽이에요.", `20일 ${pct(ret20)}`, "trend", "고점·저점과 20일 수익률을 함께 봐요.");
  if (ret20 !== undefined && ret20 < -0.05) return signal("trend", "추세", "bearish", "최근 추세는 아래쪽이에요.", `20일 ${pct(ret20)}`, "trend", "하락 추세에서는 반등 확인이 먼저예요.");
  return signal("trend", "추세", "neutral", "추세는 아직 중립이에요.", `20일 ${pct(ret20)}`, "trend", "방향이 애매하면 지지·저항 확인이 우선이에요.");
}

function detectFvg(bars: Bar[]): Array<Record<string, unknown>> {
  const zones: Array<Record<string, unknown>> = [];
  for (let index = 2; index < bars.length; index += 1) {
    const left = bars[index - 2]!;
    const current = bars[index]!;
    if (current.low > left.high) zones.push({ direction: "bullish", date: current.date, low: round(left.high, 4), high: round(current.low, 4) });
    else if (current.high < left.low) zones.push({ direction: "bearish", date: current.date, low: round(current.high, 4), high: round(left.low, 4) });
  }
  return zones.slice(-12);
}

function detectOrderBlocks(bars: Bar[]): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = [];
  if (bars.length < 8) return blocks;
  const ranges = bars.map((bar) => Math.max(bar.high - bar.low, 0));
  for (let index = 1; index < bars.length; index += 1) {
    const previous = bars[index - 1]!;
    const current = bars[index]!;
    const window = ranges.slice(Math.max(0, index - 10), index);
    const avg = sum(window) / Math.max(1, window.length);
    const body = Math.abs(current.close - current.open);
    if (avg <= 0 || body < avg * 0.8) continue;
    if (current.close > current.open && previous.close < previous.open) blocks.push({ direction: "demand", date: previous.date, low: round(previous.low, 4), high: round(previous.high, 4) });
    else if (current.close < current.open && previous.close > previous.open) blocks.push({ direction: "supply", date: previous.date, low: round(previous.low, 4), high: round(previous.high, 4) });
  }
  return blocks.slice(-8);
}

function fibonacciLevels(bars: Bar[]): Record<string, unknown> {
  const lookback = bars.slice(-Math.min(bars.length, 120));
  if (lookback.length < 20) return { lookback: lookback.length, levels: [] };
  const highBar = lookback.reduce((best, bar) => (bar.high > best.high ? bar : best), lookback[0]!);
  const lowBar = lookback.reduce((best, bar) => (bar.low < best.low ? bar : best), lookback[0]!);
  const span = highBar.high - lowBar.low;
  if (span <= 0) return { lookback: lookback.length, levels: [] };
  const upMove = lowBar.date <= highBar.date;
  const levels = [
    ["23.6%", 0.236],
    ["38.2%", 0.382],
    ["50.0%", 0.5],
    ["61.8%", 0.618],
    ["78.6%", 0.786],
  ].map(([label, ratio]) => ({
    label,
    price: round(upMove ? highBar.high - span * Number(ratio) : lowBar.low + span * Number(ratio), 4),
  }));
  return {
    lookback: lookback.length,
    swing_high: { date: highBar.date, price: round(highBar.high, 4) },
    swing_low: { date: lowBar.date, price: round(lowBar.low, 4) },
    direction: upMove ? "up" : "down",
    levels,
  };
}

function indicatorCards(signals: Signal[]): Array<Record<string, unknown>> {
  const keys: Record<string, string> = {
    moving_average: "moving_average",
    ichimoku: "ichimoku",
    rsi_divergence: "rsi_divergence",
    fvg: "ict",
    fibonacci: "fibonacci",
    volume_candle: "volume_candle",
    trend: "trend",
  };
  const seen = new Set<string>();
  const cards: Array<Record<string, unknown>> = [];
  for (const item of signals) {
    const key = keys[item.key];
    if (!key || seen.has(key)) continue;
    seen.add(key);
    cards.push({ key, title: item.title, tone: item.tone, summary: item.plain, rule: item.rule, evidence: [item.evidence] });
  }
  return cards;
}

function confluenceFor(signals: Signal[], tier: string): Record<string, unknown> | undefined {
  if (tier === "insufficient" || tier === "starter") return undefined;
  const weights: Record<string, number> = { moving_average: 1.2, trend: 1.2, volume_candle: 0.9, fvg: 0.8, order_block: 0.6, rsi_divergence: 0.8, fibonacci: 0.5, ichimoku: 0.9 };
  let total = 0;
  let weightSum = 0;
  const groups = signals.map((item) => {
    const weight = weights[item.key] ?? 0.5;
    const score = statusScore(item.status);
    total += score * weight;
    weightSum += weight;
    return { key: item.key, label: item.title, score, weight, reason: item.plain };
  });
  const normalized = Math.max(0, Math.min(100, 50 + (weightSum ? total / weightSum : 0) * 50));
  return { score: round(normalized, 1), label: normalized >= 62 ? "우호" : normalized <= 38 ? "주의" : "중립", groups };
}

function summaryFor(signals: Signal[], confluence: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!confluence) return { tone: "limited", headline: "상장 초기라 빠른 신호만 참고하세요", bullets: [signals[0]?.plain || "가격 데이터가 더 쌓이면 신뢰도가 올라가요."] };
  const score = number(confluence.score) ?? 50;
  const tone = score >= 62 ? "positive" : score <= 38 ? "cautious" : "neutral";
  const headline = tone === "positive" ? "여러 신호가 상승 쪽으로 모여 있어요" : tone === "cautious" ? "하락·저항 신호를 먼저 확인하세요" : "신호가 엇갈려 확인이 필요해요";
  const bullets = [...signals].sort((left, right) => Math.abs(statusScore(right.status)) - Math.abs(statusScore(left.status))).slice(0, 3).map((item) => item.plain);
  return { tone, headline, bullets };
}

function signal(key: string, title: string, status: string, plain: string, evidence: string, layer: string, rule: string): Signal {
  return { key, title, status, tone: toneFromStatus(status), plain: short(plain), evidence: short(evidence), layer, rule: short(rule) };
}

function toneFromStatus(status: string): string {
  if (status === "bullish") return "bullish";
  if (status === "bearish") return "bearish";
  if (status === "caution") return "caution";
  if (status === "limited") return "insufficient";
  return "neutral";
}

function statusScore(status: string): number {
  if (status === "bullish") return 1;
  if (status === "bearish" || status === "caution") return -1;
  return 0;
}

function overlayLine(bars: Bar[], values: Array<number | undefined>): Array<Record<string, unknown>> {
  const points: Array<Record<string, unknown>> = [];
  for (let index = 0; index < bars.length; index += 1) {
    const value = values[index];
    if (value !== undefined) points.push({ date: bars[index]!.date, value: round(value, 4) });
  }
  return points.slice(-MAX_TECHNICAL_BARS);
}

function midpoint(bars: Bar[]): number {
  return (Math.max(...bars.map((bar) => bar.high)) + Math.min(...bars.map((bar) => bar.low))) / 2;
}

function lastValue(values: Array<number | undefined>): number | undefined {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];
    if (value !== undefined) return value;
  }
  return undefined;
}

function glossary(): Array<Record<string, string>> {
  return [
    { term: "이평선", meaning: "여러 날의 평균 가격선이에요. 가격이 선 위에 있으면 매수세가 강한 편으로 봐요." },
    { term: "FVG", meaning: "강한 캔들 뒤 비어 보이는 가격 구간이에요. 되돌림 때 반응을 확인해요." },
    { term: "OB", meaning: "큰 움직임 직전의 반대 캔들 구간이에요. 지지·저항 후보로 봐요." },
  ];
}

function number(value: unknown): number | undefined {
  if (typeof value === "boolean" || value === null || value === undefined || value === "") return undefined;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function fmt(value: number | undefined): string {
  if (value === undefined) return "-";
  if (Math.abs(value) >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (Math.abs(value) >= 100) return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pct(value: number | undefined): string {
  return value === undefined ? "-" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}

function short(value: string, limit = 96): string {
  const collapsed = value.split(/\s+/).join(" ");
  return collapsed.length <= limit ? collapsed : `${collapsed.slice(0, limit - 1).trimEnd()}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
