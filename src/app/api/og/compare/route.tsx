import { NextRequest } from "next/server";
import { stockShareImageResponse } from "@/app/api/og/shareImage";
import { parseTickers } from "@/components/stockCompareHelpers";
import { buildStockDisplayPayload } from "@/lib/stockDisplayModel";
import { compareShareImageModelFromPayloads } from "@/lib/stockShareMetadata";
import type { StockDisplayPayload } from "@/lib/stockDisplayTypes";

export async function GET(request: NextRequest) {
  const tickers = parseTickers(request.nextUrl.searchParams.get("tickers") || request.nextUrl.searchParams.get("ticker") || "");
  const payloads = await Promise.all(tickers.map(safeStockDisplayPayload));
  return stockShareImageResponse(compareShareImageModelFromPayloads(
    payloads.filter((payload): payload is StockDisplayPayload => !!payload),
    tickers,
  ));
}

async function safeStockDisplayPayload(ticker: string) {
  try {
    return await buildStockDisplayPayload({ ticker, view: "compare" });
  } catch {
    return undefined;
  }
}
