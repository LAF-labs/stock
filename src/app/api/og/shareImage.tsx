import { ImageResponse } from "next/og";
import type { CSSProperties } from "react";
import type { StockShareCandle, StockShareImageModel } from "@/lib/stockShareMetadata";

const IMAGE_WIDTH = 1200;
const IMAGE_HEIGHT = 630;
const CHART_WIDTH = 760;
const CHART_HEIGHT = 250;

export function stockShareImageResponse(model: StockShareImageModel): ImageResponse {
  return new ImageResponse(
    (
      <div style={styles.frame}>
        <div style={styles.content}>
          <div style={styles.metaRow}>
            <span style={styles.brand}>{model.serviceName}</span>
            <span style={styles.ticker}>{model.ticker}</span>
          </div>
          <div style={styles.mainRow}>
            <div style={styles.copyColumn}>
              <h1 style={styles.title}>{model.title}</h1>
              <div style={styles.priceRow}>
                <span style={styles.price}>{model.price}</span>
                <span style={changeStyle(model.change)}>{model.change}</span>
              </div>
              <p style={styles.description}>{model.description}</p>
            </div>
            <ShareCandles candles={model.candles} />
          </div>
        </div>
      </div>
    ),
    {
      width: IMAGE_WIDTH,
      height: IMAGE_HEIGHT,
      headers: {
        "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=3600",
      },
    },
  );
}

function ShareCandles({ candles }: { candles: StockShareCandle[] }) {
  if (!candles.length) {
    return (
      <div style={{ ...styles.chartPanel, justifyContent: "center", alignItems: "center" }}>
        <span style={styles.chartEmpty}>차트 데이터 준비 중</span>
      </div>
    );
  }

  const shapes = candleShapes(candles);
  return (
    <div style={styles.chartPanel}>
      <div style={styles.chartGridLineTop} />
      <div style={styles.chartGridLineMid} />
      <div style={styles.chartGridLineBottom} />
      {shapes.map((shape) => (
        <div key={shape.key} style={{ display: "contents" }}>
          <div
            style={{
              position: "absolute",
              left: shape.x + shape.width / 2 - 1,
              top: shape.wickTop,
              width: 2,
              height: Math.max(1, shape.wickHeight),
              background: shape.color,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: shape.x,
              top: shape.bodyTop,
              width: shape.width,
              height: Math.max(3, shape.bodyHeight),
              borderRadius: 3,
              background: shape.color,
            }}
          />
        </div>
      ))}
    </div>
  );
}

function candleShapes(candles: StockShareCandle[]) {
  const highs = candles.map((candle) => candle.high);
  const lows = candles.map((candle) => candle.low);
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const range = Math.max(1, max - min);
  const plotTop = 28;
  const plotHeight = CHART_HEIGHT - 56;
  const candleWidth = Math.max(7, Math.min(14, Math.floor(CHART_WIDTH / Math.max(1, candles.length) * 0.42)));
  const xStep = candles.length > 1 ? (CHART_WIDTH - 56) / (candles.length - 1) : 0;
  const y = (value: number) => plotTop + ((max - value) / range) * plotHeight;

  return candles.map((candle, index) => {
    const x = 28 + index * xStep - candleWidth / 2;
    const openY = y(candle.open);
    const closeY = y(candle.close);
    const highY = y(candle.high);
    const lowY = y(candle.low);
    const color = candle.tone === "up" ? "#e5484d" : candle.tone === "down" ? "#2563eb" : "#8b95a1";
    return {
      key: `${candle.date}-${index}`,
      x,
      width: candleWidth,
      wickTop: highY,
      wickHeight: lowY - highY,
      bodyTop: Math.min(openY, closeY),
      bodyHeight: Math.abs(closeY - openY),
      color,
    };
  });
}

function changeStyle(value: string): CSSProperties {
  const color = value.trim().startsWith("-") || value.trim().startsWith("−") ? "#2563eb" : value.trim() === "-" ? "#5f6b7a" : "#e5484d";
  return {
    ...styles.change,
    color,
    background: value.trim() === "-" ? "#eef1f5" : color === "#e5484d" ? "#fff0f0" : "#eef4ff",
  };
}

const styles: Record<string, CSSProperties> = {
  frame: {
    width: IMAGE_WIDTH,
    height: IMAGE_HEIGHT,
    display: "flex",
    background: "#f4f7fb",
    color: "#101828",
    fontFamily: "Apple SD Gothic Neo, Noto Sans KR, Arial, sans-serif",
    padding: 40,
  },
  content: {
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    borderRadius: 28,
    background: "#ffffff",
    border: "1px solid #d9e1ec",
    padding: "46px 52px",
  },
  metaRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
  },
  brand: {
    display: "flex",
    alignItems: "center",
    color: "#1769e0",
    fontSize: 30,
    fontWeight: 800,
  },
  ticker: {
    display: "flex",
    alignItems: "center",
    minHeight: 44,
    padding: "0 18px",
    borderRadius: 999,
    background: "#edf4ff",
    color: "#1769e0",
    fontSize: 24,
    fontWeight: 800,
  },
  mainRow: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 42,
  },
  copyColumn: {
    width: 330,
    display: "flex",
    flexDirection: "column",
  },
  title: {
    margin: 0,
    color: "#10223f",
    fontSize: 64,
    lineHeight: 1.05,
    fontWeight: 900,
  },
  priceRow: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    marginTop: 30,
  },
  price: {
    display: "flex",
    color: "#101828",
    fontSize: 34,
    fontWeight: 850,
  },
  change: {
    display: "flex",
    alignItems: "center",
    minHeight: 44,
    padding: "0 15px",
    borderRadius: 999,
    fontSize: 24,
    fontWeight: 900,
  },
  description: {
    margin: "30px 0 0",
    color: "#475467",
    fontSize: 28,
    lineHeight: 1.35,
    fontWeight: 700,
  },
  chartPanel: {
    position: "relative",
    width: CHART_WIDTH,
    height: CHART_HEIGHT,
    display: "flex",
    borderRadius: 22,
    background: "#f8fafc",
    border: "1px solid #e1e8f0",
    overflow: "hidden",
  },
  chartGridLineTop: {
    position: "absolute",
    left: 28,
    right: 28,
    top: 52,
    height: 1,
    background: "#e6edf5",
  },
  chartGridLineMid: {
    position: "absolute",
    left: 28,
    right: 28,
    top: 124,
    height: 1,
    background: "#e6edf5",
  },
  chartGridLineBottom: {
    position: "absolute",
    left: 28,
    right: 28,
    bottom: 52,
    height: 1,
    background: "#e6edf5",
  },
  chartEmpty: {
    display: "flex",
    color: "#667085",
    fontSize: 30,
    fontWeight: 800,
  },
};
