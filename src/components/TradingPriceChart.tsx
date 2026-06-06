"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatMonthLabel } from "@/components/stockDashboardHelpers";
import type { ChartSeriesPoint } from "@/lib/types";
import type { CandlestickData, HistogramData, IChartApi, LineData, Time } from "lightweight-charts";

type ChartPoint = ChartSeriesPoint & { close: number; date: string };

const MOVING_AVERAGES = [
  { period: 5, color: "#f59f00" },
  { period: 20, color: "#18a976" },
  { period: 60, color: "#7c3aed" },
  { period: 120, color: "#475569" },
] as const;

function chartPriceLabel(point: ChartPoint) {
  if (point.close_label) return point.close_label;
  const currency = typeof point.currency === "string" ? point.currency : "USD";
  return priceLabel(point.close, currency);
}

function priceLabel(value: number | undefined, currency: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  if (currency === "KRW") return `${new Intl.NumberFormat("ko-KR").format(Math.round(value))}원`;
  if (currency === "USD") {
    return `$${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;
  }
  return `${currency} ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)}`;
}

export default function TradingPriceChart({ points, mode, describedBy }: { points: ChartPoint[]; mode: "line" | "candle"; describedBy?: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; date: string; price: string } | null>(null);
  const [renderState, setRenderState] = useState<"loading" | "ready" | "error">("loading");
  const [scrollRange, setScrollRange] = useState<{ start: number; span: number; maxStart: number } | null>(null);

  const chartData = useMemo(() => {
    const lineData: LineData<Time>[] = [];
    const candleData: CandlestickData<Time>[] = [];
    const volumeData: HistogramData<Time>[] = [];
    const labels = new Map<string, string>();

    points.forEach((point) => {
      const time = point.date as Time;
      const open = typeof point.open === "number" && Number.isFinite(point.open) ? point.open : point.close;
      const high = typeof point.high === "number" && Number.isFinite(point.high) ? point.high : Math.max(open, point.close);
      const low = typeof point.low === "number" && Number.isFinite(point.low) ? point.low : Math.min(open, point.close);
      const volume = typeof point.volume === "number" && Number.isFinite(point.volume) ? point.volume : 0;
      const isUp = point.close >= open;

      lineData.push({ time, value: point.close });
      candleData.push({ time, open, high, low, close: point.close });
      volumeData.push({
        time,
        value: volume,
        color: isUp ? "rgba(240, 68, 82, 0.24)" : "rgba(49, 130, 246, 0.24)",
      });
      labels.set(point.date, chartPriceLabel(point));
    });

    const movingAverages = MOVING_AVERAGES.map((average) => ({
      ...average,
      data: movingAverageData(points, average.period),
    }));

    return { lineData, candleData, volumeData, labels, movingAverages };
  }, [points]);

  useEffect(() => {
    if (!containerRef.current) return;

    let disposed = false;
    let resizeObserver: ResizeObserver | undefined;
    let chartApi: IChartApi | undefined;
    let wheelHandler: ((event: WheelEvent) => void) | undefined;
    let visibleRangeHandler: ((range: { from: number; to: number } | null) => void) | undefined;
    setRenderState("loading");
    setScrollRange(null);

    async function renderChart() {
      const currentContainer = containerRef.current;
      if (!currentContainer) return;
      try {
        const { createChart, LineSeries, CandlestickSeries, HistogramSeries, ColorType, CrosshairMode } = await import("lightweight-charts");
        if (disposed || !containerRef.current) return;

        currentContainer.replaceChildren();
        const chart = createChart(currentContainer, {
        width: Math.max(1, currentContainer.clientWidth),
        height: 360,
        layout: {
          background: { type: ColorType.Solid, color: "#f8fafc" },
          textColor: "#8b95a1",
          fontFamily: "inherit",
          fontSize: 12,
        },
        grid: {
          vertLines: { color: "rgba(222, 228, 235, 0.65)" },
          horzLines: { color: "rgba(222, 228, 235, 0.65)" },
        },
        rightPriceScale: {
          borderVisible: false,
          scaleMargins: mode === "candle" ? { top: 0.08, bottom: 0.26 } : { top: 0.08, bottom: 0.12 },
        },
        timeScale: {
          borderVisible: false,
          timeVisible: false,
          secondsVisible: false,
          fixLeftEdge: true,
          fixRightEdge: true,
          minBarSpacing: 2,
          tickMarkFormatter: (time: Time) => (typeof time === "string" ? formatMonthLabel(time) : ""),
        },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: { color: "rgba(49, 130, 246, 0.34)", width: 1, labelVisible: false },
          horzLine: { color: "rgba(49, 130, 246, 0.24)", width: 1, labelVisible: false },
        },
        handleScroll: {
          mouseWheel: false,
          pressedMouseMove: true,
          horzTouchDrag: true,
          vertTouchDrag: false,
        },
        handleScale: {
          axisPressedMouseMove: false,
          mouseWheel: true,
          pinch: true,
        },
      });

        chartApi = chart;
        chartRef.current = chart;
        const priceSeries =
          mode === "candle"
            ? chart.addSeries(CandlestickSeries, {
              upColor: "#f04452",
              downColor: "#3182f6",
              borderUpColor: "#f04452",
              borderDownColor: "#3182f6",
              wickUpColor: "#f04452",
              wickDownColor: "#3182f6",
            })
            : chart.addSeries(LineSeries, {
              color: "#3182f6",
              lineWidth: 3,
              crosshairMarkerVisible: true,
              crosshairMarkerRadius: 5,
            });

        if (mode === "candle") {
          priceSeries.setData(chartData.candleData);
          chartData.movingAverages.forEach((average) => {
            if (!average.data.length) return;
            const averageSeries = chart.addSeries(LineSeries, {
              color: average.color,
              lineWidth: average.period <= 20 ? 2 : 1,
              priceLineVisible: false,
              lastValueVisible: false,
              crosshairMarkerVisible: false,
            });
            averageSeries.setData(average.data);
          });
          const volumeSeries = chart.addSeries(HistogramSeries, {
          priceFormat: { type: "volume" },
          priceScaleId: "",
          lastValueVisible: false,
          priceLineVisible: false,
        });
          volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
          volumeSeries.setData(chartData.volumeData);
        } else {
          priceSeries.setData(chartData.lineData);
        }

        const attributionLink = currentContainer.querySelector<HTMLAnchorElement>("#tv-attr-logo");
        attributionLink?.setAttribute("aria-label", "TradingView 차트 제공");
        attributionLink?.setAttribute("rel", "noopener noreferrer");

        chart.subscribeCrosshairMove((param) => {
          if (!containerRef.current || !param.point || param.point.x < 0 || param.point.y < 0 || !param.time) {
            setTooltip(null);
            return;
          }

          const time = String(param.time);
          const seriesValue = param.seriesData.get(priceSeries) as { value?: number; close?: number } | undefined;
          const value = typeof seriesValue?.value === "number" ? seriesValue.value : seriesValue?.close;
          if (typeof value !== "number" || !Number.isFinite(value)) {
            setTooltip(null);
            return;
          }

          setTooltip({
            x: param.point.x,
            y: param.point.y,
            date: time,
            price: chartData.labels.get(time) || priceLabel(value, points[0]?.currency as string),
          });
        });

        chart.timeScale().fitContent();
        visibleRangeHandler = (range: { from: number; to: number } | null) => {
          setScrollRange(scrollStateFromRange(range, chartData.lineData.length));
        };
        chart.timeScale().subscribeVisibleLogicalRangeChange(visibleRangeHandler);
        visibleRangeHandler(chart.timeScale().getVisibleLogicalRange());

        wheelHandler = (event: WheelEvent) => {
          if (!containerRef.current || chartData.lineData.length < 2) return;
          event.preventDefault();
          const totalSpan = chartData.lineData.length - 1;
          const currentRange = chart.timeScale().getVisibleLogicalRange() || { from: 0, to: totalSpan };
          const currentSpan = Math.max(1, currentRange.to - currentRange.from);
          const nextSpan = Math.max(8, Math.min(totalSpan, currentSpan * (event.deltaY < 0 ? 0.82 : 1.18)));
          if (nextSpan >= totalSpan - 0.1) {
            chart.timeScale().fitContent();
            return;
          }

          const bounds = containerRef.current.getBoundingClientRect();
          const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width)));
          const anchor = currentRange.from + currentSpan * ratio;
          let from = anchor - nextSpan * ratio;
          from = Math.max(0, Math.min(totalSpan - nextSpan, from));
          chart.timeScale().setVisibleLogicalRange({ from, to: from + nextSpan });
        };
        currentContainer.addEventListener("wheel", wheelHandler, { passive: false });

        resizeObserver = new ResizeObserver(() => {
          if (!containerRef.current) return;
          chart.applyOptions({ width: Math.max(1, containerRef.current.clientWidth) });
        });
        resizeObserver.observe(currentContainer);
        setRenderState("ready");
      } catch {
        if (disposed) return;
        currentContainer.replaceChildren();
        setTooltip(null);
        setRenderState("error");
      }
    }

    renderChart();

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      if (chartApi && visibleRangeHandler) chartApi.timeScale().unsubscribeVisibleLogicalRangeChange(visibleRangeHandler);
      if (wheelHandler) containerRef.current?.removeEventListener("wheel", wheelHandler);
      chartApi?.remove();
      if (chartRef.current === chartApi) chartRef.current = null;
      containerRef.current?.replaceChildren();
      setTooltip(null);
      setScrollRange(null);
    };
  }, [chartData, mode, points]);

  function scrollChart(value: string) {
    const nextStart = Number(value);
    if (!Number.isFinite(nextStart) || !scrollRange || !chartRef.current) return;
    chartRef.current.timeScale().setVisibleLogicalRange({
      from: nextStart,
      to: nextStart + scrollRange.span,
    });
  }

  const showRangeScrollbar = !!scrollRange && scrollRange.maxStart > 0.5;

  return (
    <div className="chart-plot">
      <div ref={containerRef} className="trading-chart" role="img" aria-label={mode === "candle" ? "캔들 가격 차트" : "선 가격 차트"} aria-describedby={describedBy} />
      {mode === "candle" ? (
        <div className="chart-ma-legend" aria-label="이동평균선">
          {MOVING_AVERAGES.map((average) => (
            <span key={average.period}>
              <i style={{ background: average.color }} />
              {average.period}일
            </span>
          ))}
        </div>
      ) : null}
      {showRangeScrollbar ? (
        <input
          className="chart-range-scrollbar"
          type="range"
          min="0"
          max={scrollRange.maxStart}
          step="0.1"
          value={Math.min(scrollRange.start, scrollRange.maxStart)}
          aria-label="차트 표시 구간 이동"
          onChange={(event) => scrollChart(event.currentTarget.value)}
        />
      ) : null}
      {renderState === "loading" ? (
        <p className="chart-fallback" role="status" aria-live="polite">차트를 그리는 중이에요.</p>
      ) : null}
      {renderState === "error" ? (
        <p className="chart-fallback error" role="alert">차트를 표시하지 못했어요. 아래 가격 요약을 참고해주세요.</p>
      ) : null}
      {tooltip ? (
        <div
          className="chart-floating-tip"
          style={{
            left: `${tooltip.x}px`,
            top: `${tooltip.y}px`,
          }}
        >
          <strong>{tooltip.date}</strong>
          <span>{tooltip.price}</span>
        </div>
      ) : null}
    </div>
  );
}

function movingAverageData(points: ChartPoint[], period: number): LineData<Time>[] {
  const data: LineData<Time>[] = [];
  let rolling = 0;
  points.forEach((point, index) => {
    rolling += point.close;
    if (index >= period) rolling -= points[index - period].close;
    if (index < period - 1) return;
    data.push({
      time: point.date as Time,
      value: rolling / period,
    });
  });
  return data;
}

function scrollStateFromRange(range: { from: number; to: number } | null, length: number): { start: number; span: number; maxStart: number } | null {
  if (!range || length < 2) return null;
  const totalSpan = length - 1;
  const span = Math.max(1, Math.min(totalSpan, range.to - range.from));
  const maxStart = Math.max(0, totalSpan - span);
  return {
    start: Math.max(0, Math.min(maxStart, range.from)),
    span,
    maxStart,
  };
}
