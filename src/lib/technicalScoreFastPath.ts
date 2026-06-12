import { fetchKisDailyChart } from "@/lib/kisQuoteClient";
import { SCORE_MODEL_VERSION } from "@/lib/scoreModel";
import { STOCKSTALKER_SERVICE_NAME } from "@/lib/stockShareMetadata";
import { buildTechnicalAnalysis } from "@/lib/technicalAnalysisEngine";
import { envValue } from "@/lib/supabaseRest";
import type { StockPayload } from "@/lib/stockScoreContract";

export function technicalRequestFastPathEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const raw = env.STOCK_TECHNICAL_REQUEST_FAST_PATH?.trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off";
}

export async function buildTechnicalScoreFastPathPayload(ticker: string): Promise<StockPayload> {
  const daily = await fetchKisDailyChart(ticker);
  const technicalAnalysis = buildTechnicalAnalysis(daily.chartSeries);
  technicalAnalysis.ticker = `${daily.market}:${daily.symbol}`;
  technicalAnalysis.market = daily.market;
  technicalAnalysis.symbol = daily.symbol;
  return {
    ok: true,
    app: STOCKSTALKER_SERVICE_NAME,
    requested_ticker: daily.requestedTicker,
    market: daily.market,
    symbol: daily.symbol,
    name: daily.name,
    exchange: daily.exchange,
    ...(daily.exchangeCode ? { exchange_code: daily.exchangeCode } : {}),
    currency: daily.currency,
    score_model_version: SCORE_MODEL_VERSION,
    latest_price: daily.latestPrice,
    latest_bar_date: daily.latestDate,
    chart_series: daily.chartSeries,
    price_metrics: daily.priceMetrics,
    technical_analysis: technicalAnalysis,
    fetch: {
      ...daily.fetch,
      view: "technical",
      score_model_version: SCORE_MODEL_VERSION,
      request_fast_path: true,
      timeout_ms: technicalRequestFastPathTimeoutMs(),
    },
  };
}

function technicalRequestFastPathTimeoutMs(): number {
  const parsed = Number(envValue("STOCK_TECHNICAL_KIS_TIMEOUT_MS"));
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 2_500;
}
