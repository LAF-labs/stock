import { chartPointPriceLabel, usableChartPoints } from "@/components/stockDashboardHelpers";
import { formatCurrencyAmount } from "@/lib/format";
import type { TechnicalAnalysisPayload } from "@/lib/technicalAnalysisTypes";
import type { ChartSeriesPoint } from "@/lib/types";

type ChartPoint = ChartSeriesPoint & { close: number; date: string };
type OverlayPoint = { date: string; value: number };
type Zone = { direction: string | undefined; date: string; low: number; high: number };
type FibLevel = { label: string; price: number };

const SVG_WIDTH = 760;
const SVG_HEIGHT = 340;
const PAD = { top: 18, right: 18, bottom: 34, left: 76 };

export default function TechnicalOverlayChart({
  points,
  technical,
}: {
  points: ChartSeriesPoint[] | undefined;
  technical: TechnicalAnalysisPayload;
}) {
  const chartPoints = usableChartPoints(points).slice(-160);
  if (chartPoints.length < 2) {
    return (
      <section className="technical-chart-panel">
        <div className="section-title">
          <span>시각화</span>
          <h2>차트 데이터가 더 필요해요</h2>
        </div>
        <p className="technical-chart-empty">가격선과 보조선을 그릴 일봉 데이터가 부족해요.</p>
      </section>
    );
  }

  const ema20 = overlayLine(technical, "ema20", chartPoints);
  const ema50 = overlayLine(technical, "ema50", chartPoints);
  const sma200 = overlayLine(technical, "sma200", chartPoints);
  const fvgZones = overlayZones(technical, "fvg_zones");
  const orderBlocks = overlayZones(technical, "order_blocks");
  const fibLevels = fibonacciLevels(technical);
  const yDomain = priceDomain(chartPoints, [ema20, ema50, sma200], fvgZones, orderBlocks, fibLevels);
  const chartCurrency = typeof chartPoints[0]?.currency === "string" ? chartPoints[0].currency : undefined;
  const indexByDate = new Map(chartPoints.map((point, index) => [point.date, index]));
  const x = (index: number) => PAD.left + (index / Math.max(1, chartPoints.length - 1)) * (SVG_WIDTH - PAD.left - PAD.right);
  const y = (value: number) => PAD.top + ((yDomain.max - value) / Math.max(1, yDomain.max - yDomain.min)) * (SVG_HEIGHT - PAD.top - PAD.bottom);
  const pricePath = pathFor(chartPoints.map((point, index) => ({ x: x(index), y: y(point.close) })));

  return (
    <section className="technical-chart-panel">
      <div className="section-title">
        <span>시각화</span>
        <h2>가격선과 핵심 구간</h2>
      </div>
      <div className="technical-chart-shell">
        <svg viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`} role="img" aria-label="기술적 분석 오버레이 차트" preserveAspectRatio="xMidYMid meet">
          <rect x="0" y="0" width={SVG_WIDTH} height={SVG_HEIGHT} rx="8" className="technical-chart-bg" />
          {gridValues(yDomain).map((value) => (
            <g key={value}>
              <line x1={PAD.left} x2={SVG_WIDTH - PAD.right} y1={y(value)} y2={y(value)} className="technical-grid-line" />
              <text x={PAD.left - 8} y={y(value) + 4} textAnchor="end" className="technical-axis-label">{axisLabel(value, chartCurrency)}</text>
            </g>
          ))}
          {fvgZones.map((zone, index) => zoneRect(zone, indexByDate, x, y, "fvg", index))}
          {orderBlocks.map((zone, index) => zoneRect(zone, indexByDate, x, y, "ob", index))}
          {fibLevels.map((level) => (
            <g key={level.label}>
              <line x1={PAD.left} x2={SVG_WIDTH - PAD.right} y1={y(level.price)} y2={y(level.price)} className="technical-fib-line" />
              <text x={SVG_WIDTH - PAD.right - 4} y={y(level.price) - 5} textAnchor="end" className="technical-fib-label">{level.label}</text>
            </g>
          ))}
          <path d={pathFor(ema20.map((point) => ({ x: x(indexByDate.get(point.date) || 0), y: y(point.value) })))} className="technical-ma technical-ema20" />
          <path d={pathFor(ema50.map((point) => ({ x: x(indexByDate.get(point.date) || 0), y: y(point.value) })))} className="technical-ma technical-ema50" />
          <path d={pathFor(sma200.map((point) => ({ x: x(indexByDate.get(point.date) || 0), y: y(point.value) })))} className="technical-ma technical-sma200" />
          <path d={pricePath} className="technical-price-line" />
          <circle cx={x(chartPoints.length - 1)} cy={y(chartPoints[chartPoints.length - 1].close)} r="4" className="technical-last-price-dot" />
          <text x={PAD.left} y={SVG_HEIGHT - 10} className="technical-axis-label">{chartPoints[0].date}</text>
          <text x={SVG_WIDTH - PAD.right} y={SVG_HEIGHT - 10} textAnchor="end" className="technical-axis-label">{chartPoints[chartPoints.length - 1].date}</text>
        </svg>
      </div>
      <div className="technical-chart-legend" aria-label="차트 범례">
        <span><i className="price" />가격</span>
        <span><i className="ema20" />EMA20</span>
        <span><i className="ema50" />EMA50</span>
        <span><i className="fvg" />FVG</span>
        <span><i className="ob" />OB</span>
        <span><i className="fib" />피보나치</span>
      </div>
    </section>
  );
}

function overlayLine(technical: TechnicalAnalysisPayload, key: "ema20" | "ema50" | "sma200", points: ChartPoint[]): OverlayPoint[] {
  const availableDates = new Set(points.map((point) => point.date));
  const movingAverage = record(record(technical.overlays)?.moving_average);
  const rawValues = movingAverage?.[key];
  const values = Array.isArray(rawValues) ? rawValues : [];
  return values
    .map((item) => {
      const row = record(item);
      const date = typeof row?.date === "string" ? row.date : "";
      const value = number(row?.value);
      return date && value !== undefined && availableDates.has(date) ? { date, value } : undefined;
    })
    .filter((item): item is OverlayPoint => Boolean(item));
}

function overlayZones(technical: TechnicalAnalysisPayload, key: "fvg_zones" | "order_blocks"): Zone[] {
  const rawValues = record(technical.overlays)?.[key];
  const values = Array.isArray(rawValues) ? rawValues : [];
  return values
    .map((item) => {
      const row = record(item);
      const date = typeof row?.date === "string" ? row.date : "";
      const low = number(row?.low);
      const high = number(row?.high);
      const direction = typeof row?.direction === "string" ? row.direction : undefined;
      return date && low !== undefined && high !== undefined ? { date, low, high, direction } : undefined;
    })
    .filter((item): item is Zone => Boolean(item))
    .slice(-6);
}

function fibonacciLevels(technical: TechnicalAnalysisPayload): FibLevel[] {
  const fib = record(record(technical.overlays)?.fibonacci);
  const rawValues = fib?.levels;
  const values = Array.isArray(rawValues) ? rawValues : [];
  return values
    .map((item) => {
      const row = record(item);
      const label = typeof row?.label === "string" ? row.label : "";
      const price = number(row?.price);
      return label && price !== undefined ? { label, price } : undefined;
    })
    .filter((item): item is FibLevel => Boolean(item));
}

function priceDomain(points: ChartPoint[], lines: OverlayPoint[][], fvgZones: Zone[], orderBlocks: Zone[], fibLevels: FibLevel[]) {
  const values = points.flatMap((point) => [point.low, point.high, point.close].filter((value): value is number => typeof value === "number" && Number.isFinite(value)));
  for (const line of lines) values.push(...line.map((point) => point.value));
  for (const zone of [...fvgZones, ...orderBlocks]) values.push(zone.low, zone.high);
  values.push(...fibLevels.map((level) => level.price));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = Math.max((max - min) * 0.08, Math.abs(max) * 0.01, 1);
  return { min: min - padding, max: max + padding };
}

function gridValues(domain: { min: number; max: number }) {
  const step = (domain.max - domain.min) / 4;
  return [0, 1, 2, 3, 4].map((index) => domain.min + step * index);
}

function zoneRect(zone: Zone, indexByDate: Map<string, number>, x: (index: number) => number, y: (value: number) => number, kind: "fvg" | "ob", index: number) {
  const start = indexByDate.get(zone.date);
  if (start === undefined) return null;
  const x1 = x(start);
  const y1 = y(zone.high);
  const y2 = y(zone.low);
  return (
    <rect
      key={`${kind}-${zone.date}-${index}`}
      x={x1}
      y={Math.min(y1, y2)}
      width={SVG_WIDTH - PAD.right - x1}
      height={Math.max(3, Math.abs(y2 - y1))}
      className={kind === "fvg" ? "technical-zone-fvg" : "technical-zone-ob"}
    />
  );
}

function pathFor(points: Array<{ x: number; y: number }>) {
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
}

function axisLabel(value: number, currency: string | undefined) {
  if (currency) return formatCurrencyAmount(value, currency);
  return chartPointPriceLabel({ close: value });
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
