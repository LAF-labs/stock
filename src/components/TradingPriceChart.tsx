"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatMonthLabel } from "@/components/stockDashboardHelpers";
import type { ChartSeriesPoint } from "@/lib/types";
import type { CandlestickData, HistogramData, LineData, Time } from "lightweight-charts";

type ChartPoint = ChartSeriesPoint & { close: number; date: string };

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
  const [tooltip, setTooltip] = useState<{ x: number; y: number; date: string; price: string } | null>(null);
  const [renderState, setRenderState] = useState<"loading" | "ready" | "error">("loading");

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

    return { lineData, candleData, volumeData, labels };
  }, [points]);

  useEffect(() => {
    if (!containerRef.current) return;

    let disposed = false;
    let resizeObserver: ResizeObserver | undefined;
    let chartApi: { remove: () => void } | undefined;
    setRenderState("loading");

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
          mouseWheel: false,
          pinch: true,
        },
      });

        chartApi = chart;
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
      chartApi?.remove();
      containerRef.current?.replaceChildren();
      setTooltip(null);
    };
  }, [chartData, mode, points]);

  return (
    <div className="chart-plot">
      <div ref={containerRef} className="trading-chart" role="img" aria-label={mode === "candle" ? "캔들 가격 차트" : "선 가격 차트"} aria-describedby={describedBy} />
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
