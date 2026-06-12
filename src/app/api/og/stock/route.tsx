import { NextRequest } from "next/server";
import { stockShareImageResponse } from "@/app/api/og/shareImage";
import { buildStockDisplayPayload } from "@/lib/stockDisplayModel";
import { stockShareImageModelFromPayload } from "@/lib/stockShareMetadata";

export async function GET(request: NextRequest) {
  const ticker = request.nextUrl.searchParams.get("ticker")?.trim();
  const payload = ticker ? await safeStockDisplayPayload(ticker) : undefined;
  return stockShareImageResponse(stockShareImageModelFromPayload(payload));
}

async function safeStockDisplayPayload(ticker: string) {
  try {
    return await buildStockDisplayPayload({ ticker, view: "detail" });
  } catch {
    return undefined;
  }
}
